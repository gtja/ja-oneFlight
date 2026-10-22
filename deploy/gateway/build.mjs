import { build } from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
await build({
  entryPoints: ['src/bootstrap.js', 'src/adapter.js', 'src/auth-expired.js', 'src/entry-denied.js'],
  outdir: 'dist', bundle: true, format: 'iife', platform: 'browser',
  target: ['chrome100', 'firefox100', 'safari15.4'], minify: true,
  legalComments: 'eof', sourcemap: false,
});
await cp('public', 'dist', { recursive: true });
