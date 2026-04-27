// =============================================================================
// Audit Intake (Screen 2, D-010)
//
// Server component — pre-loads the lookup lists the form needs (vendors,
// protocol versions, lead auditors). The form itself is a client component.
//
// The form's only novel inputs are audit name + type + scheduled date.
// Vendor / protocol version / lead auditor are chosen from existing rows so
// nothing is re-typed (cognitive-load discipline).
// =============================================================================

import { prisma } from "@/lib/prisma";
import { UserRole } from "@prisma/client";
import { AuditIntakeForm } from "@/components/audits/AuditIntakeForm";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { color, layout, space, type as typeScale } from "@/lib/ui/tokens";

export default async function AuditIntakePage() {
  const [vendors, protocolVersions, leadAuditors] = await Promise.all([
    prisma.vendor.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    // Prefer ACTIVE versions; fall back to all so DRAFT/SUPERSEDED are still selectable.
    prisma.protocolVersion.findMany({
      orderBy: [
        { status: "asc" }, // ACTIVE before DRAFT before SUPERSEDED (lexical works)
        { versionNumber: "desc" },
      ],
      include: { protocol: { select: { studyNumber: true, title: true } } },
    }),
    prisma.user.findMany({
      where: { role: { in: [UserRole.LEAD_AUDITOR, UserRole.AUDITOR] } },
      orderBy: [{ role: "asc" }, { name: "asc" }],
      select: { id: true, name: true, role: true },
    }),
  ]);

  const protocolOptions = protocolVersions.map((pv) => ({
    id: pv.id,
    label: `${pv.protocol.studyNumber ?? "—"} v${pv.versionNumber}${pv.amendmentLabel ? ` (${pv.amendmentLabel})` : ""}`,
    sublabel: `${pv.protocol.title} · ${pv.status}`,
  }));

  // Default to first LEAD_AUDITOR if any, else first AUDITOR. The auth layer
  // (when added) will replace this with session.user.id.
  const defaultActor =
    leadAuditors.find((u) => u.role === UserRole.LEAD_AUDITOR)?.id ??
    leadAuditors[0]?.id ??
    "";

  return (
    <main style={pageStyle}>
      <Breadcrumb items={[{ label: "Audits", href: "/audits" }, { label: "New audit" }]} />
      <h1 style={{ ...typeScale.display, margin: `${space[3]}px 0 ${space[1]}px` }}>New audit</h1>
      <p style={{ ...typeScale.body, margin: `0 0 ${space[5]}px`, color: color.fgMuted }}>
        Vendor, protocol version, and lead auditor are inherited from upstream records — choose, don&apos;t re-type.
      </p>

      <AuditIntakeForm
        vendors={vendors}
        protocolVersions={protocolOptions}
        leadAuditors={leadAuditors}
        defaultActorId={defaultActor}
      />
    </main>
  );
}

const pageStyle: React.CSSProperties = {
  maxWidth: layout.pageMaxWidth.narrow,
  width: "100%",
  margin: "0 auto",
  padding: `${space[6]}px ${space[5]}px`,
};
