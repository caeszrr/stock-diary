import { defineConfig } from 'vite';

// GitHub Pages project-page path. Change this if the repo is renamed,
// or set to '/' if this ever moves to a user/org page (username.github.io).
const BASE_PATH = '/stock-diary/';

export default defineConfig({
  base: BASE_PATH,
  publicDir: 'public',
  build: {
    outDir: 'dist',
  },
});
