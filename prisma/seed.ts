import { PrismaClient } from "@prisma/client";
import { seedStandardGcpVendorTemplate } from "./seeds/standard-gcp-vendor-template";

const prisma = new PrismaClient();

async function main() {
  // Canonical questionnaire template (D-003).
  // Idempotent: skips publishing a new version if the version number already exists.
  await seedStandardGcpVendorTemplate(prisma);

  // Future seeds (test users, sample vendor, sample protocol, etc.) can be added here.
  // Keep them idempotent so `npm run db:seed` produces a consistent local state on re-run.

  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
