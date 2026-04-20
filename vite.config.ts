import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { swDevPlugin } from './vite-plugin-sw-dev';

export default defineConfig({
  define: {
    // Mirrors VITE_LOG_LEVEL for code that reads process.env.LOG_LEVEL (see src/core/logger)
    'process.env.LOG_LEVEL': JSON.stringify(process.env.VITE_LOG_LEVEL ?? process.env.LOG_LEVEL ?? 'error'),
  },
  plugins: [react(), swDevPlugin()],
  build: {
    /**
     * After `tsup` writes the library to `dist/`, `vite build` must not wipe it.
     * Use: `rm -rf dist && tsup && vite build`
     */
    emptyOutDir: false,
    rollupOptions: {
      input: {
        main: 'index.html',
      },
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
      },
    },
  },
});
