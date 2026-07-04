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
    setupFiles: ['./src/test/setup.ts'],
    globals: false,
    // src/lib/supabase.ts calls createClient() at module top level, so any
    // test that transitively imports it needs these VITE_ vars to exist at
    // collection time. Dummy values only — tests that exercise the client
    // vi.mock it (see src/lib/orgs/__tests__/orgEventsApi.test.ts).
    env: {
      VITE_SUPABASE_URL: 'http://localhost:54321',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key',
    },
  },
});
