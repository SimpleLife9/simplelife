import { defineConfig } from 'vite';

const crossOriginIsolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
};

function appShellPrecacheManifest() {
  return {
    name: 'simplelife-app-shell-precache-manifest',
    apply: 'build',
    generateBundle(_options, bundle) {
      const assets = Object.keys(bundle)
        .filter((fileName) => fileName !== 'precache-manifest.json'
          && fileName !== 'sw.js'
          && !fileName.endsWith('.map'))
        .map((fileName) => '/' + fileName);

      this.emitFile({
        type: 'asset',
        fileName: 'precache-manifest.json',
        source: JSON.stringify({ version: 1, assets }, null, 2),
      });
    },
  };
}

export default defineConfig({
  // Cloudflare's Workers Builds initializer injects its plugin here.
  // Keep the local build plugin alongside that deployment integration.
  plugins: [appShellPrecacheManifest()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    headers: crossOriginIsolationHeaders,
  },
  preview: {
    headers: crossOriginIsolationHeaders,
  },
  build: {
    target: 'es2022',
    sourcemap: false,
  },
});
