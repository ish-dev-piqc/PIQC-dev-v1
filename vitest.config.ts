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
  },
});
