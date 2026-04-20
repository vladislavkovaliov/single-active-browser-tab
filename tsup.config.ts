import { defineConfig } from 'tsup';

/** Library: CJS + ESM + types from src/core */
const library = defineConfig({
  entry: ['src/core/single-tab-manager.ts'],
  dts: true,
  format: ['cjs', 'esm'],
  outDir: 'dist',
  sourcemap: true,
  clean: true,
  target: 'esnext',
});

/** Service worker: single ESM bundle under dist/assets/sw.js */
const serviceWorker = defineConfig({
  entry: { 'assets/sw': 'src/sw.ts' },
  format: ['esm'],
  dts: false,
  outDir: 'dist',
  sourcemap: true,
  clean: false,
  target: 'esnext',
  platform: 'browser',
});

export default [library, serviceWorker];
