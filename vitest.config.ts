import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    // happy-dom for component tests; pure-function tests still work.
    environment: 'happy-dom',
    include: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      // _shared edge-function helpers (e.g. Svix signature verification) are
      // pure Web-Crypto code that runs equally well in vitest. Co-locating
      // the test next to the helper keeps discovery + import paths simple.
      'supabase/functions/_shared/__tests__/*.test.ts',
    ],
    // Deno-only test (Deno.test + https: std imports) — run via `deno test`,
    // permanently un-collectable under vitest's node ESM loader.
    exclude: ['**/node_modules/**', 'supabase/functions/_shared/__tests__/ingestPipeline.test.ts'],
    // src/lib/supabase.ts calls createClient() at module scope and throws
    // without these. Dummy values are safe: the client does no I/O at
    // construction, and every test that exercises data paths mocks the API
    // layer anyway. Keeps the suite green with no .env (fresh clones, CI).
    env: {
      VITE_SUPABASE_URL: 'http://localhost:54321',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key',
    },
    setupFiles: ['./src/test/setup.ts'],
    globals: false,
  },
});
