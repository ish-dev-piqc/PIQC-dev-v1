// =============================================================================
// Vitest config — integration tests against a real Postgres database.
//
// Why integration over unit: every library function we test runs inside a
// `prisma.$transaction` and writes StateHistoryDelta rows. Mocking that out
// would test the mocks; tests with a real DB exercise transaction semantics,
// FK constraints, and delta tracking together.
//
// Test isolation: a global setup hook truncates every public table between
// each test (TRUNCATE … CASCADE). Tables are auto-discovered from
// information_schema so schema additions never break the harness.
//
// Concurrency: tests run sequentially (single fork) because they share one
// physical database. For parallelism we'd need per-worker schemas — keep it
// simple until volume demands otherwise.
// =============================================================================

import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    globals: false,
    setupFiles: ["./tests/setup.ts"],
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
    include: ["tests/**/*.test.ts"],
    testTimeout: 10_000,
    hookTimeout: 10_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
