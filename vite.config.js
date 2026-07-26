import { defineConfig } from 'vite';

// GitHub Pages project-page path. Change this if the repo is renamed,
// or set to '/' if this ever moves to a user/org page (username.github.io).
const BASE_PATH = '/stock-diary/';

// A per-build id, baked into the bundle (__BUILD_ID__) AND emitted as version.json.
// The running app fetches version.json fresh (no-store) and reloads itself when
// the deployed id differs — so a phone showing a stale service-worker copy can't
// silently keep rendering old data. See src/lib/appUpdate.js.
const BUILD_ID = String(Date.now());

function emitVersion() {
  return {
    name: 'emit-version-json',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: `${JSON.stringify({ buildId: BUILD_ID })}\n` });
    },
  };
}

export default defineConfig({
  base: BASE_PATH,
  publicDir: 'public',
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  plugins: [emitVersion()],
  build: {
    outDir: 'dist',
  },
});
