import { PrismaClient } from "@prisma/client";

// Singleton pattern required for Next.js dev mode.
// Hot reloads re-execute module-level code, which would create a new PrismaClient
// on every reload and exhaust the database connection pool.
// Storing the instance on globalThis persists it across hot reloads in development.

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
