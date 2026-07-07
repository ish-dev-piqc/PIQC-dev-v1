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
    exclude: [
      '**/node_modules/**',
      // Deno test (its own header says `deno test supabase/functions/_shared/
      // __tests__/`) — imports deno.land std asserts, which Node's ESM loader
      // cannot resolve (https: scheme). Vitest must skip it.
      'supabase/functions/_shared/__tests__/ingestPipeline.test.ts',
    ],
    setupFiles: ['./src/test/setup.ts'],
    globals: false,
    // Neither CI nor fresh checkouts have a .env; src/lib/supabase.ts throws at
    // import time without these, crashing collection for every file whose
    // import graph reaches it. Dummy values keep module init happy — tests mock
    // the supabase seam and never hit the network.
    env: {
      VITE_SUPABASE_URL: 'https://dummy.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'dummy',
    },
  },
});
