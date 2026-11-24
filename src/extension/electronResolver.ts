import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, realpathSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

function isExecutableFile(filePath: string): boolean {
  try {
    const st = statSync(filePath);
    return st.isFile() && st.size > 0;
  } catch {
    return false;
  }
}

function findElectronOnPath(): string | null {
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    const out = execFileSync(cmd, ['electron'], { encoding: 'utf8', timeout: 2500 });
    const first = out
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find(Boolean);
    if (first && isExecutableFile(first)) return first;
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Automatically locate an Electron runtime binary without bundling Electron inside the repo/VSIX.
 */
export function resolveElectronExecutable(extensionPath: string, configuredPath?: string): string | null {
  const userHome = process.env.USERPROFILE || process.env.HOME || '';
  const exeRel =
    process.platform === 'win32'
      ? 'electron.exe'
      : process.platform === 'darwin'
        ? join('Electron.app', 'Contents', 'MacOS', 'Electron')
        : 'electron';

  const candidates = [
    configuredPath?.trim(),
    process.env.GEMINI_PET_ELECTRON_PATH?.trim(),
    resolve(extensionPath, 'runtime', 'electron', exeRel),
    resolve(extensionPath, 'node_modules', 'electron', 'dist', exeRel),
    userHome ? join(userHome, '.dsh', 'electron', exeRel) : undefined,
  ].filter((p): p is string => Boolean(p));

  for (const candidate of candidates) {
    if (isExecutableFile(candidate)) {
      return candidate;
    }
  }

  return findElectronOnPath();
}

function isOnCDriveWindows(dirPath: string): boolean {
  if (process.platform !== 'win32') return false;
  try {
    const real = existsSync(dirPath) ? realpathSync(dirPath) : resolve(dirPath);
    return /^[cC]:[\\/]/.test(real);
  } catch {
    return /^[cC]:[\\/]/.test(dirPath);
  }
}

function isDirWritable(dirPath: string): boolean {
  try {
    mkdirSync(dirPath, { recursive: true });
    const probe = join(dirPath, '.write-probe');
    writeFileSync(probe, 'ok');
    unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve a writable runtime data directory.
 * On Windows, skip C:\ paths so caches never land on the system drive.
 */
export function resolveRuntimeDataDir(extensionPath: string, configuredDir?: string): string {
  const candidates: string[] = [];
  if (configuredDir?.trim()) candidates.push(resolve(configuredDir.trim()));
  if (process.env.GEMINI_PET_RUNTIME_DIR?.trim()) {
    candidates.push(resolve(process.env.GEMINI_PET_RUNTIME_DIR.trim()));
  }

  let realExt = extensionPath;
  try {
    realExt = realpathSync(extensionPath);
  } catch {
    /* keep extensionPath */
  }
  const extRuntime = resolve(realExt, '.runtime');
  if (!isOnCDriveWindows(extRuntime)) {
    candidates.push(extRuntime);
  }

  const osTemp = process.env.TEMP || process.env.TMP || '';
  if (osTemp && !isOnCDriveWindows(osTemp)) {
    candidates.push(join(osTemp, 'antigravity-gemini-pet-runtime'));
  }

  // Generic non-C fallback (not a machine-specific project path).
  if (process.platform === 'win32') {
    candidates.push(join('D:\\Temp', 'antigravity-gemini-pet-runtime'));
  } else {
    candidates.push(extRuntime);
  }

  for (const dir of candidates) {
    if (process.platform === 'win32' && isOnCDriveWindows(dir)) continue;
    if (isDirWritable(dir)) return dir;
  }

  return process.platform === 'win32' ? join('D:\\Temp', 'antigravity-gemini-pet-runtime') : extRuntime;
}
