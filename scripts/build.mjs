import { build } from 'esbuild';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateIconPng } from './generate-icon-png.mjs';

const ROOT = resolve(import.meta.dirname, '..');

async function main() {
  mkdirSync(resolve(ROOT, 'dist', 'extension'), { recursive: true });
  mkdirSync(resolve(ROOT, 'dist', 'webview'), { recursive: true });
  mkdirSync(resolve(ROOT, 'dist', 'desktop'), { recursive: true });

  // 1. Extension Host bundle (Node CJS, external vscode)
  await build({
    entryPoints: [resolve(ROOT, 'src', 'extension', 'extension.ts')],
    outfile: resolve(ROOT, 'dist', 'extension', 'extension.js'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['vscode'],
    sourcemap: false,
    minify: false,
  });

  // 2. IDE Sidebar Webview bundle (Browser IIFE)
  await build({
    entryPoints: [resolve(ROOT, 'src', 'webview', 'panel.ts')],
    outfile: resolve(ROOT, 'dist', 'webview', 'panel.js'),
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    sourcemap: false,
    minify: false,
  });

  // 3. Shared Core bundle for Electron Desktop Helper renderer (Browser global window.GeminiPetCore)
  await build({
    entryPoints: [resolve(ROOT, 'src', 'shared', 'desktop-bundle.ts')],
    outfile: resolve(ROOT, 'dist', 'desktop', 'shared-core.js'),
    bundle: true,
    platform: 'browser',
    format: 'iife',
    globalName: 'GeminiPetCore',
    target: 'es2022',
    sourcemap: false,
    minify: false,
  });

  // 4. Preserve HD cutout icon.png (only fallback-generate if missing)
  const iconPath = resolve(ROOT, 'assets', 'icon.png');
  if (!existsSync(iconPath)) {
    generateIconPng(iconPath);
  }
  console.log('[gemini-pet] build completed cleanly -> dist/');
}

main().catch((err) => {
  console.error('[gemini-pet] build failed:', err);
  process.exit(1);
});
