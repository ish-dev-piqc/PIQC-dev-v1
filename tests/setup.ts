// =============================================================================
// Vitest global setup — wires the test database + truncates between tests.
//
// Reads DATABASE_URL_TEST and rewrites DATABASE_URL before any module imports
// the Prisma client. Tests that import `@/lib/prisma` will then hit the test
// database, not the dev database.
//
// `truncateAll` (called in beforeEach) wipes all user tables. The state
// history delta table is included so each test starts with a clean log.
// =============================================================================

import { afterAll, beforeAll, beforeEach } from "vitest";

const testUrl = process.env.DATABASE_URL_TEST;
if (!testUrl) {
  throw new Error(
    "DATABASE_URL_TEST is not set. Tests refuse to run against the dev database. " +
      "See docs/dev-team-notes.md → 'Test database setup'."
  );
}
process.env.DATABASE_URL = testUrl;

// Importing prisma after we set DATABASE_URL ensures the client points at the
// test DB. Type-only would skip the side effect, so this is a real import.
import { prisma } from "@/lib/prisma";

beforeAll(async () => {
  // Sanity: refuse to run if DATABASE_URL_TEST and DATABASE_URL are equal —
  // would indicate a misconfigured shell that points tests at the dev DB.
  if (testUrl === process.env.DATABASE_URL_DEV) {
    throw new Error("DATABASE_URL_TEST must differ from DATABASE_URL_DEV.");
  }
});

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await prisma.$disconnect();
});

// Truncate every public table except Prisma's migrations log. Auto-discovers
// tables from information_schema so adding a new model doesn't require
// editing this list. CASCADE handles FK ordering.
async function truncateAll(): Promise<void> {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT IN ('_prisma_migrations')
  `;
  if (rows.length === 0) return;
  const list = rows.map((r) => `"${r.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}
