import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { swDevPlugin } from './vite-plugin-sw-dev';

export default defineConfig({
  plugins: [react(), swDevPlugin()],
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        sw: 'src/sw.ts',
      },
      output: {
        entryFileNames: (chunkInfo) =>
          chunkInfo.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js',
      },
    },
  },
});
