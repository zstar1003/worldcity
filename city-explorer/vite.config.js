import { defineConfig } from 'vite';
export default defineConfig(({ mode }) => ({
  base: mode === 'pages' ? '/worldcity/' : '/',
  publicDir: mode === 'pages' ? '.pages-public' : 'public',
  build: { target: 'es2022', outDir: mode === 'pages' ? 'dist-pages' : 'dist' },
}));
