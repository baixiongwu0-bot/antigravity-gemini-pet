import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { PetInstanceConfig } from '../shared/types';

export interface HelperLaunchOptions {
  electronExe: string;
  extensionPath: string;
  runtimeDir: string;
  serverUrl: string;
  pets: PetInstanceConfig[];
  enableTray: boolean;
  onStatusChange?: (running: boolean) => void;
  logger?: (msg: string) => void;
}

export function buildHelperSpawnEnv(
  hostPid: number,
  runtimeDir: string,
  extra: Record<string, string>,
): NodeJS.ProcessEnv {
  const tempDir = join(runtimeDir, 'temp');
  const userDataDir = join(runtimeDir, 'electron-userdata');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TEMP: tempDir,
    TMP: tempDir,
    GEMINI_PET_HOST_PID: String(hostPid),
    GEMINI_PET_USER_DATA: userDataDir,
    ...extra,
  };
  // CRITICAL: VS Code / Antigravity extension host runs inside Electron with ELECTRON_RUN_AS_NODE=1!
  // If inherited, child electron.exe starts in pure Node mode and fails to load `require('electron')`.
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

export class HelperManager {
  private child: ChildProcess | null = null;
  private stopping = false;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private consecutiveFailures = 0;
  private lastStartAt = 0;
  private sawOutput = false;
  private sandboxFallback = false;
  private currentOptions: HelperLaunchOptions | null = null;

  isRunning(): boolean {
    return this.child !== null && !this.stopping;
  }

  async sync(options: HelperLaunchOptions, shouldRun: boolean): Promise<void> {
    if (!shouldRun || options.pets.length === 0) {
      await this.stopAndWait();
      return;
    }

    const prevSig = this.currentOptions
      ? JSON.stringify({
          exe: this.currentOptions.electronExe,
          url: this.currentOptions.serverUrl,
          tray: this.currentOptions.enableTray,
          ids: this.currentOptions.pets.map((p) => p.id),
        })
      : '';
    const nextSig = JSON.stringify({
      exe: options.electronExe,
      url: options.serverUrl,
      tray: options.enableTray,
      ids: options.pets.map((p) => p.id),
    });

    this.currentOptions = options;
    if (this.child && prevSig === nextSig) {
      return;
    }

    if (this.child) {
      await this.stopAndWait();
    }
    this.stopping = false;
    this.consecutiveFailures = 0;
    this.startNow();
  }

  private startNow(): void {
    const opts = this.currentOptions;
    if (!opts || this.child || this.stopping) return;

    const helperMain = resolve(opts.extensionPath, 'runtime', 'electron-helper', 'main.js');
    const tempDir = join(opts.runtimeDir, 'temp');
    const userDataDir = join(opts.runtimeDir, 'electron-userdata');
    mkdirSync(tempDir, { recursive: true });
    mkdirSync(userDataDir, { recursive: true });

    const args: string[] = [];
    if (this.sandboxFallback) args.push('--no-sandbox');
    if (process.platform === 'linux' && process.env.WAYLAND_DISPLAY && process.env.DISPLAY) {
      args.push('--ozone-platform=x11');
    }
    args.push(helperMain);

    this.sawOutput = false;
    this.lastStartAt = Date.now();

    const env = buildHelperSpawnEnv(process.pid, opts.runtimeDir, {
      GEMINI_PET_SERVER_URL: opts.serverUrl,
      GEMINI_PET_TRAY: opts.enableTray ? '1' : '0',
      GEMINI_PET_PETS: JSON.stringify(
        opts.pets.map((p, index) => ({
          id: p.id,
          name: p.name,
          size: p.size,
          index,
          position: p.position,
        })),
      ),
    });

    const child = spawn(opts.electronExe, args, {
      cwd: opts.runtimeDir,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    this.child = child;
    opts.onStatusChange?.(true);

    child.stdout?.on('data', (chunk) => {
      const s = String(chunk).trim();
      if (s) {
        this.sawOutput = true;
        opts.logger?.(`[helper] ${s}`);
      }
    });

    child.stderr?.on('data', (chunk) => {
      const s = String(chunk).trim();
      if (s) {
        this.sawOutput = true;
        opts.logger?.(`[helper:err] ${s}`);
      }
    });

    child.once('error', (err) => {
      opts.logger?.(`[helper] spawn error: ${err.message}`);
      if (this.child === child) {
        this.child = null;
        opts.onStatusChange?.(false);
        this.scheduleRestart();
      }
    });

    child.once('exit', (code, signal) => {
      if (this.child !== child) return;
      this.child = null;
      opts.onStatusChange?.(false);
      if (this.stopping) return;

      const ranMs = Date.now() - this.lastStartAt;
      const isSandboxBreakpoint = code === 0x80000003 || code === 2147483651 || code === -2147483645;
      if (!this.sandboxFallback && !this.sawOutput && ranMs < 5000 && isSandboxBreakpoint) {
        this.sandboxFallback = true;
        opts.logger?.('[helper] retrying once with --no-sandbox');
        this.startNow();
        return;
      }

      opts.logger?.(`[helper] exited code=${String(code)} signal=${String(signal)}`);
      this.scheduleRestart();
    });
  }

  private scheduleRestart(): void {
    if (this.stopping || this.restartTimer || !this.currentOptions) return;
    const ranMs = Date.now() - this.lastStartAt;
    if (ranMs > 120_000) this.consecutiveFailures = 0;
    else this.consecutiveFailures += 1;

    if (this.consecutiveFailures > 6) {
      this.currentOptions.logger?.('[helper] too many crashes; circuit breaker opened');
      return;
    }

    const delay = Math.min(15_000, 800 * Math.pow(2, this.consecutiveFailures - 1));
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.startNow();
    }, delay);
    this.restartTimer.unref?.();
  }

  async stopAndWait(timeoutMs = 2500): Promise<void> {
    this.stopping = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    const child = this.child;
    if (!child) return;

    await new Promise<void>((resolveExit) => {
      let settled = false;
      const done = (): void => {
        if (settled) return;
        settled = true;
        if (this.child === child) this.child = null;
        this.currentOptions?.onStatusChange?.(false);
        resolveExit();
      };

      child.once('exit', done);
      try {
        child.kill();
      } catch {
        done();
        return;
      }

      const timer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* ignore */
        }
        setTimeout(done, 250);
      }, timeoutMs);
      timer.unref?.();
    });
  }

  stopSync(): void {
    this.stopping = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    const child = this.child;
    this.child = null;
    if (child) {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
    }
  }
}
