import * as vscode from 'vscode';
import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { resolveHighestWorkStatus } from '../shared/state-machine';
import { parseTranscriptTailLines } from '../shared/transcript-parser';
import type { WorkStatusSnapshot, WorkStatusState } from '../shared/types';

interface SignalEntry {
  state: WorkStatusState | null;
  task: string | null;
  source: string;
  updatedAt: number;
  expiresAt?: number;
}

export class AgentWatcher implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private signals = new Map<string, SignalEntry>();
  private current: WorkStatusSnapshot = {
    state: null,
    task: null,
    source: 'idle',
    updatedAt: Date.now(),
    seq: 1,
  };
  private enabled = true;
  private brainDirOverride = '';
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastTranscriptSignature = '';
  private activeTerminals = 0;
  private activeTasks = 0;
  private activeDebug = 0;
  private onChange: (snapshot: WorkStatusSnapshot) => void;

  constructor(opts: {
    enabled: boolean;
    brainDirOverride?: string;
    onChange: (snapshot: WorkStatusSnapshot) => void;
  }) {
    this.enabled = opts.enabled;
    this.brainDirOverride = opts.brainDirOverride?.trim() || '';
    this.onChange = opts.onChange;
    this.attachIdeEvents();
    this.startTranscriptPolling();
  }

  setOptions(opts: { enabled?: boolean; brainDirOverride?: string }): void {
    if (opts.enabled !== undefined) this.enabled = opts.enabled;
    if (opts.brainDirOverride !== undefined) this.brainDirOverride = opts.brainDirOverride.trim();
    if (!this.enabled) {
      this.signals.clear();
      this.recompute();
    }
  }

  getSnapshot(): WorkStatusSnapshot {
    return this.current;
  }

  /** External entry point (HTTP /work-status or simulation command) */
  pushSignal(source: string, state: WorkStatusState | null, task: string | null, ttlMs?: number): void {
    const now = Date.now();
    if (!state) {
      this.signals.delete(source);
      if (source === 'http' || source === 'manual') {
        // Explicit idle reset clears other transient manual/http states too
        this.signals.delete('http');
        this.signals.delete('manual');
      }
    } else {
      const defaultTtl =
        state === 'success' || state === 'error' || state === 'result' ? 9_000 : ttlMs ?? 45_000;
      this.signals.set(source, {
        state,
        task,
        source,
        updatedAt: now,
        expiresAt: now + (ttlMs ?? defaultTtl),
      });
    }
    this.recompute();
  }

  private recompute(): void {
    const now = Date.now();
    for (const [k, entry] of this.signals.entries()) {
      if (entry.expiresAt !== undefined && entry.expiresAt <= now) {
        this.signals.delete(k);
      }
    }
    const best = this.enabled
      ? resolveHighestWorkStatus(this.signals.values(), now)
      : { state: null, task: null, source: 'disabled', updatedAt: now };

    if (
      best.state !== this.current.state ||
      best.task !== this.current.task ||
      best.source !== this.current.source
    ) {
      this.current = {
        state: best.state,
        task: best.task,
        source: best.source,
        updatedAt: best.updatedAt,
        expiresAt: best.state === 'success' || best.state === 'error' || best.state === 'result' ? now + 9_000 : undefined,
        seq: this.current.seq + 1,
      };
      this.onChange(this.current);
    }
  }

  private attachIdeEvents(): void {
    const winAny = vscode.window as unknown as {
      onDidStartTerminalShellExecution?: (cb: (e: { execution?: { commandLine?: { value?: string } } }) => void) => vscode.Disposable;
      onDidEndTerminalShellExecution?: (cb: (e: { exitCode?: number }) => void) => vscode.Disposable;
    };

    if (typeof winAny.onDidStartTerminalShellExecution === 'function') {
      this.disposables.push(
        winAny.onDidStartTerminalShellExecution((e) => {
          if (!this.enabled) return;
          this.activeTerminals += 1;
          const cmd = e.execution?.commandLine?.value?.slice(0, 28) || '终端命令';
          this.pushSignal('ide-terminal', 'working', `执行：${cmd}`, 120_000);
        }),
      );
    }

    if (typeof winAny.onDidEndTerminalShellExecution === 'function') {
      this.disposables.push(
        winAny.onDidEndTerminalShellExecution((e) => {
          if (!this.enabled) return;
          this.activeTerminals = Math.max(0, this.activeTerminals - 1);
          if (this.activeTerminals === 0) {
            this.signals.delete('ide-terminal');
            if (typeof e.exitCode === 'number' && e.exitCode !== 0) {
              this.pushSignal('ide-terminal-end', 'error', `终端返回退出码 ${e.exitCode}`, 8_000);
            } else {
              this.pushSignal('ide-terminal-end', 'success', '终端命令运行完成', 7_000);
            }
          }
        }),
      );
    }

    this.disposables.push(
      vscode.tasks.onDidStartTaskProcess((e) => {
        if (!this.enabled) return;
        this.activeTasks += 1;
        this.pushSignal('ide-task', 'working', `任务：${e.execution.task.name}`, 120_000);
      }),
      vscode.tasks.onDidEndTaskProcess((e) => {
        if (!this.enabled) return;
        this.activeTasks = Math.max(0, this.activeTasks - 1);
        if (this.activeTasks === 0) {
          this.signals.delete('ide-task');
          if (e.exitCode && e.exitCode !== 0) {
            this.pushSignal('ide-task-end', 'error', `任务失败 (code=${e.exitCode})`, 8_000);
          } else {
            this.pushSignal('ide-task-end', 'success', '构建/运行任务顺利完成', 7_000);
          }
        }
      }),
      vscode.debug.onDidStartDebugSession((s) => {
        if (!this.enabled) return;
        this.activeDebug += 1;
        this.pushSignal('ide-debug', 'working', `调试：${s.name}`, 180_000);
      }),
      vscode.debug.onDidTerminateDebugSession(() => {
        if (!this.enabled) return;
        this.activeDebug = Math.max(0, this.activeDebug - 1);
        if (this.activeDebug === 0) {
          this.signals.delete('ide-debug');
          this.pushSignal('ide-debug-end', 'result', '调试会话已结束', 5_000);
        }
      }),
      vscode.workspace.onDidSaveTextDocument((doc) => {
        if (!this.enabled || doc.isUntitled) return;
        const name = doc.fileName.split(/[\\/]/).pop() || '文件';
        // Only gently pulse result when idle
        if (this.signals.size === 0) {
          this.pushSignal('ide-save', 'result', `已保存 ${name}`, 4_500);
        }
      }),
    );
  }

  private resolveBrainDirs(): string[] {
    if (this.brainDirOverride) return [this.brainDirOverride];
    const dirs: string[] = [];
    const userHome = process.env.USERPROFILE || process.env.HOME || '';
    const envBrain = process.env.ANTIGRAVITY_BRAIN_DIR?.trim() || process.env.GEMINI_BRAIN_DIR?.trim() || '';
    const candidates = [
      envBrain,
      userHome ? join(userHome, '.gemini', 'antigravity-ide', 'brain') : '',
      userHome ? join(userHome, '.gemini', 'antigravity', 'brain') : '',
    ].filter(Boolean);

    for (const c of candidates) {
      if (existsSync(c)) dirs.push(c);
    }
    return dirs;
  }

  private findNewestTranscriptFile(): { filePath: string; mtimeMs: number; size: number } | null {
    let newest: { filePath: string; mtimeMs: number; size: number } | null = null;
    for (const brainDir of this.resolveBrainDirs()) {
      let convEntries: string[] = [];
      try {
        convEntries = readdirSync(brainDir);
      } catch {
        continue;
      }
      for (const convId of convEntries) {
        const candidate = join(brainDir, convId, '.system_generated', 'logs', 'transcript.jsonl');
        try {
          const st = statSync(candidate);
          if (!st.isFile() || st.size === 0) continue;
          if (!newest || st.mtimeMs > newest.mtimeMs) {
            newest = { filePath: candidate, mtimeMs: st.mtimeMs, size: st.size };
          }
        } catch {
          /* skip */
        }
      }
    }
    return newest;
  }

  private readTailUtf8(filePath: string, size: number, maxBytes = 16_384): string {
    const start = Math.max(0, size - maxBytes);
    const len = size - start;
    const fd = openSync(filePath, 'r');
    try {
      const buf = Buffer.alloc(len);
      const read = readSync(fd, buf, 0, len, start);
      return buf.toString('utf8', 0, read);
    } finally {
      closeSync(fd);
    }
  }

  private pollTranscriptOnce(): void {
    if (!this.enabled) return;
    const now = Date.now();
    this.recompute(); // expire old signals cleanly

    const newest = this.findNewestTranscriptFile();
    if (!newest) return;
    // Ignore stale transcripts older than 30s
    if (now - newest.mtimeMs > 30_000) {
      this.signals.delete('antigravity-transcript');
      this.recompute();
      return;
    }

    const sig = `${newest.filePath}:${newest.mtimeMs}:${newest.size}`;
    if (sig === this.lastTranscriptSignature) return;
    this.lastTranscriptSignature = sig;

    try {
      const tail = this.readTailUtf8(newest.filePath, newest.size);
      const parsed = parseTranscriptTailLines(tail);
      if (parsed && parsed.state) {
        const ttl = parsed.state === 'success' || parsed.state === 'error' || parsed.state === 'result' ? 8_000 : 25_000;
        this.pushSignal('antigravity-transcript', parsed.state, parsed.task, ttl);
      }
    } catch {
      /* read-only failure ignored */
    }
  }

  private startTranscriptPolling(): void {
    this.pollTimer = setInterval(() => {
      this.pollTranscriptOnce();
    }, 1200);
    this.pollTimer.unref?.();
  }

  dispose(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.signals.clear();
  }
}
