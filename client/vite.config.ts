import { defineConfig } from 'vite';

// The game page also passes the game connection through to the game server (/ws -> port 3100),
// so one address carries both. That is what lets a single Cloudflare tunnel link work for friends.
const proxy = { '/ws': { target: 'ws://127.0.0.1:3100', ws: true } };
// Cloudflare quick tunnel addresses look like https://random-words.trycloudflare.com
const allowedHosts = ['localhost', '127.0.0.1', '.trycloudflare.com'];

export default defineConfig({
  // the client imports the shared game rules from ../packages/shared
  server: { fs: { allow: ['..'] }, proxy, allowedHosts },
  preview: { proxy, allowedHosts },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 2000 },
});
