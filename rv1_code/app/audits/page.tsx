// =============================================================================
// Audit Index / Worklist (Screen 1, D-010)
//
// Flat table — no queue gymnastics. One row per Audit. Columns chosen to let
// the auditor scan their workload without opening anything.
//
// Click a row → audit workspace at /audits/[id]. "New audit" → /audits/new.
//
// Server component — reads directly via Prisma. CLOSED audits are still shown
// (auditors revisit them); sort puts active audits first.
// =============================================================================

import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { AuditStage, AuditStatus } from "@prisma/client";
import { STAGE_ORDER, stageIndex } from "@/lib/types/audit-stage";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { color, layout, radius, space, type as typeScale } from "@/lib/ui/tokens";

const STAGE_LABEL: Record<AuditStage, string> = {
  INTAKE: "Intake",
  VENDOR_ENRICHMENT: "Vendor Enrichment",
  QUESTIONNAIRE_REVIEW: "Questionnaire Review",
  SCOPE_AND_RISK_REVIEW: "Scope & Risk Review",
  PRE_AUDIT_DRAFTING: "Pre-Audit Drafting",
  AUDIT_CONDUCT: "Audit Conduct",
  REPORT_DRAFTING: "Report Drafting",
  FINAL_REVIEW_EXPORT: "Final Review & Export",
};

const STATUS_TONE: Record<AuditStatus, BadgeTone> = {
  DRAFT:       "neutral",
  IN_PROGRESS: "info",
  REVIEW:      "draft",
  CLOSED:      "muted",
};

// Worklist priority. Lower number = nearer the top. Active work first;
// CLOSED audits sink to the bottom but stay visible (auditors revisit).
// Lexical AuditStatus ordering would put CLOSED first ("C" < "D" < "I" < "R"),
// hence the explicit map.
const STATUS_PRIORITY: Record<AuditStatus, number> = {
  IN_PROGRESS: 0,
  DRAFT:       1,
  REVIEW:      2,
  CLOSED:      3,
};

export default async function AuditWorklistPage() {
  const rows = await prisma.audit.findMany({
    include: {
      vendor: { select: { name: true } },
      protocol: { select: { studyNumber: true, title: true } },
      vendorService: { select: { serviceName: true, serviceType: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  // Status sort done in JS — Prisma ORDER BY on the enum sorts lexically,
  // which puts CLOSED first. STATUS_PRIORITY encodes the desired order.
  const audits = [...rows].sort(
    (a, b) => STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status]
  );

  return (
    <main style={pageStyle}>
      <header style={headerStyle}>
        <div>
          <h1 style={{ ...typeScale.display, margin: 0 }}>Audits</h1>
          <p style={{ ...typeScale.body, margin: `${space[1]}px 0 0`, color: color.fgMuted }}>
            {audits.length} {audits.length === 1 ? "audit" : "audits"}
          </p>
        </div>
        <ButtonLink href="/audits/new">+ New audit</ButtonLink>
      </header>

      {audits.length === 0 ? (
        <div style={emptyState}>
          <p style={{ margin: 0, color: color.fgMuted }}>No audits yet.</p>
          <ButtonLink href="/audits/new" style={{ marginTop: space[3] }}>
            Create the first audit
          </ButtonLink>
        </div>
      ) : (
        <table style={tableStyle}>
          <caption className="visually-hidden">Audits worklist</caption>
          {/* Column order tuned to the auditor's primary scan question:
              "what needs me next?" — Stage in column 1. Type collapsed into
              the Vendor cell as a caption (de-noise, design rec 3). */}
          <thead>
            <tr>
              <Th>Stage</Th>
              <Th>Study</Th>
              <Th>Vendor</Th>
              <Th>Service</Th>
              <Th>Scheduled</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {audits.map((a) => (
              <tr key={a.id}>
                <Td>
                  <StageCell stage={a.currentStage} />
                </Td>
                <Td>
                  <Link href={`/audits/${a.id}`} style={studyLinkStyle}>
                    <div style={{ fontWeight: 500 }}>
                      {a.protocol.studyNumber ?? "—"}
                    </div>
                    <div style={{ ...typeScale.caption, color: color.fgMuted, marginTop: 2 }}>
                      {a.protocol.title}
                    </div>
                  </Link>
                </Td>
                <Td>
                  <div>{a.vendor.name}</div>
                  <div style={{ ...typeScale.micro, color: color.fgMuted, marginTop: 2 }}>
                    {a.auditType.charAt(0) + a.auditType.slice(1).toLowerCase()} audit
                  </div>
                </Td>
                <Td>
                  {a.vendorService ? (
                    <>
                      <div>{a.vendorService.serviceName}</div>
                      <div style={{ ...typeScale.micro, color: color.fgMuted }}>
                        {a.vendorService.serviceType}
                      </div>
                    </>
                  ) : (
                    <span style={{ color: color.fgSubtle, ...typeScale.caption }}>Not yet defined</span>
                  )}
                </Td>
                <Td>
                  {a.scheduledDate ? (
                    new Date(a.scheduledDate).toLocaleDateString()
                  ) : (
                    <span style={{ color: color.fgSubtle }}>—</span>
                  )}
                </Td>
                <Td>
                  <Badge tone={STATUS_TONE[a.status]}>{a.status.replace(/_/g, " ")}</Badge>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

function StageCell({ stage }: { stage: AuditStage }) {
  const idx = stageIndex(stage);
  const total = STAGE_ORDER.length;
  return (
    <div aria-label={`Stage ${idx + 1} of ${total}: ${STAGE_LABEL[stage]}`}>
      <div style={{ ...typeScale.body }}>{STAGE_LABEL[stage]}</div>
      <div style={{ display: "flex", gap: 2, marginTop: space[1] }} aria-hidden="true">
        {STAGE_ORDER.map((_, i) => (
          <span
            key={i}
            style={{
              flex: 1,
              height: 3,
              background: i <= idx ? color.primary : color.border,
              borderRadius: 1,
            }}
          />
        ))}
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      style={{
        textAlign: "left",
        padding: `${space[2]}px ${space[3]}px`,
        ...typeScale.eyebrow,
        borderBottom: `1px solid ${color.border}`,
      }}
    >
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return (
    <td
      style={{
        padding: space[3],
        borderBottom: `1px solid ${color.borderSubtle}`,
        verticalAlign: "top",
        ...typeScale.body,
      }}
    >
      {children}
    </td>
  );
}

const pageStyle: React.CSSProperties = {
  maxWidth: layout.pageMaxWidth.wide,
  width: "100%",
  margin: "0 auto",
  padding: `${space[6]}px ${space[5]}px`,
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-end",
  marginBottom: space[5],
  gap: space[4],
};

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  background: color.bg,
  border: `1px solid ${color.border}`,
  borderRadius: radius.md,
  overflow: "hidden",
};

const studyLinkStyle: React.CSSProperties = {
  color: color.fg,
  display: "block",
};

const emptyState: React.CSSProperties = {
  border: `1px dashed ${color.borderStrong}`,
  borderRadius: radius.md,
  padding: space[7],
  textAlign: "center",
  background: color.bgMuted,
};
