import { AuditStatus, AuditType } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export interface CreateAuditInput {
  vendorId: string;
  protocolVersionId: string;
  auditName: string;
  auditType: AuditType;
  leadAuditorId: string;
  scheduledDate?: string; // ISO date YYYY-MM-DD
}

export async function createAudit(input: CreateAuditInput) {
  // Resolve protocol_id from the version so Audit carries both FKs
  const version = await prisma.protocolVersion.findUniqueOrThrow({
    where: { id: input.protocolVersionId },
    select: { protocolId: true },
  });

  return prisma.audit.create({
    data: {
      vendorId: input.vendorId,
      protocolId: version.protocolId,
      protocolVersionId: input.protocolVersionId,
      auditName: input.auditName,
      auditType: input.auditType,
      status: AuditStatus.DRAFT,
      leadAuditorId: input.leadAuditorId,
      scheduledDate: input.scheduledDate ? new Date(input.scheduledDate) : null,
    },
  });
}

// Returns the audit with its current protocol version and vendor context.
// Used as the shell query for most per-audit pages.
export async function getAudit(auditId: string) {
  return prisma.audit.findUniqueOrThrow({
    where: { id: auditId },
    include: {
      vendor: true,
      protocol: true,
      protocolVersion: true,
      leadAuditor: { select: { id: true, name: true, role: true } },
      vendorService: {
        include: { mappings: { include: { protocolRisk: true } } },
      },
      amendmentAlerts: {
        where: { status: "PENDING" },
        include: { toVersion: true },
      },
    },
  });
}
