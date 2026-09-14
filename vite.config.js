import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  root: path.resolve('./web'),
  plugins: [react()],
  build: {
    outDir: path.resolve('./public/assets'),
    emptyOutDir: true,
    target: 'es2020',
    rollupOptions: {
      input: {
        site: path.resolve('./web/site/main.js'),
        admin: path.resolve('./web/admin/main.jsx'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name]-chunk.js',
        assetFileNames: (info) => {
          const name = (info.names && info.names[0]) || info.name || '';
          if (name.endsWith('.css')) return '[name][extname]';
          return 'media/[name][extname]';
        },
      },
    },
  },
});
