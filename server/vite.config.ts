import { defineConfig } from 'vite';

// Builds the game server into one plain JavaScript file (server/dist/frenymies-server.js) with ws and zod
// inside, for the VPS: it runs on plain Node 20 or newer, with no npm install there.
// `npm run build:server`, then copy that one file over (see DEPLOY.md).
export default defineConfig({
  // in the bundle, the server file is the program, so the "am I the program?" check is simply true
  // (Node 20 does not have import.meta.main)
  define: { 'import.meta.main': 'true' },
  ssr: { noExternal: true, target: 'node' },
  build: {
    ssr: 'server/src/index.ts',
    outDir: 'server/dist',
    emptyOutDir: true,
    target: 'node20',
    minify: false,
    rollupOptions: {
      // ws's optional native speed-ups; it works without them
      external: ['bufferutil', 'utf-8-validate'],
      output: { entryFileNames: 'frenymies-server.js', format: 'es', codeSplitting: false },
    },
  },
});
