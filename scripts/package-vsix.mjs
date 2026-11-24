import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
const distDir = resolve(ROOT, 'dist');
mkdirSync(distDir, { recursive: true });
const outFile = resolve(distDir, `${pkg.name}-${pkg.version}.vsix`);

// Keep packaging temp under the repo's gitignored .runtime/ (never force machine-specific paths).
const runtimeTmp = resolve(ROOT, '.runtime', 'tmp');
mkdirSync(runtimeTmp, { recursive: true });

const env = {
  ...process.env,
  TEMP: runtimeTmp,
  TMP: runtimeTmp,
};

const vsceBin = resolve(ROOT, 'node_modules', '@vscode', 'vsce', 'vsce');
const res = spawnSync(
  process.execPath,
  [vsceBin, 'package', '--no-dependencies', '--allow-missing-repository', '--out', outFile],
  { cwd: ROOT, env, stdio: 'inherit' },
);

if (res.status !== 0) {
  process.exit(res.status ?? 1);
}
console.log('[gemini-pet] packaged VSIX ->', outFile);
