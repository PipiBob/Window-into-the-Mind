import { defineConfig } from 'vite';

export default defineConfig(({mode}) => ({
  root: 'frontend',
  publicDir: mode === 'pages' ? '../.frontend-pages-assets' : '../.frontend-study-assets',
  base: './',
  server: { host: '0.0.0.0', port: 5173, strictPort: true },
  preview: { host: '0.0.0.0', port: 4173, strictPort: true },
  build: { outDir: mode === 'pages' ? '../dist-pages' : '../dist', emptyOutDir: true },
}));
