import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node', // worksheet compiler is pure — no DOM needed
    include: ['src/**/*.test.ts'],
  },
});
