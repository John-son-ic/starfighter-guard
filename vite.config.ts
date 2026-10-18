import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 5173, strictPort: true, proxy: { '/ws': { target: 'ws://127.0.0.1:8787', ws: true } } },
  preview: { port: 4173, strictPort: true },
});
