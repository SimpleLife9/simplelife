import { defineConfig } from 'vite';

export default defineConfig({
  // Cloudflare's Workers Builds initializer injects its plugin here.
  // Keeping an explicit array also allows plain Vite builds to run unchanged.
  plugins: [],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    sourcemap: false,
  },
});
