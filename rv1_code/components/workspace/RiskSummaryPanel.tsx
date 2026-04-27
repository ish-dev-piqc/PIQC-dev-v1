"use client";

// =============================================================================
// RiskSummaryPanel (D-010)
//
// Right pane of the audit workspace shell. Renders the VendorRiskSummaryObject:
// the secondary decision layer that tells the auditor *why this vendor matters*
// in the context of this study. Auditor edits the deterministic stub down,
// then approves — approval gates entry to PRE_AUDIT_DRAFTING.
//
// On first load with no summary, exposes a "Generate stub" button that POSTs
// to /api/audits/[auditId]/risk-summary to compose the deterministic narrative
// from study context + protocol risks + vendor service mappings.
//
// Sponsor-name-free by rule — narrative comes out generic; sponsor branding is
// added externally on export.
// =============================================================================

import { useState } from "react";
import { RiskSummaryApprovalStatus } from "@prisma/client";
import type { RenderedRiskSummary } from "@/lib/types/risk-summary";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { HistoryDrawer } from "@/components/workspace/HistoryDrawer";
import { color, layout, radius, space, type as typeScale } from "@/lib/ui/tokens";

interface Props {
  auditId: string;
  actorId: string;
  initialSummary: RenderedRiskSummary | null;
}

export function RiskSummaryPanel({ auditId, actorId, initialSummary }: Props) {
  const [summary, setSummary] = useState<RenderedRiskSummary | null>(initialSummary);
  const [draftNarrative, setDraftNarrative] = useState(initialSummary?.vendorRelevanceNarrative ?? "");
  const [draftFocusAreas, setDraftFocusAreas] = useState((initialSummary?.focusAreas ?? []).join(", "));
  const [editing, setEditing] = useState(false);
  const [confirmingApprove, setConfirmingApprove] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function generateStub() {
    setBusy("generate");
    setError(null);
    try {
      const res = await fetch(`/api/audits/${auditId}/risk-summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to generate stub");
      }
      const data: RenderedRiskSummary = await res.json();
      applySummary(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate stub");
    } finally {
      setBusy(null);
    }
  }

  async function saveEdits() {
    setBusy("save");
    setError(null);
    try {
      const res = await fetch(`/api/audits/${auditId}/risk-summary`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actorId,
          vendorRelevanceNarrative: draftNarrative,
          focusAreas: parseFocusAreas(draftFocusAreas),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to save");
      }
      const data: RenderedRiskSummary = await res.json();
      applySummary(data);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(null);
    }
  }

  async function approve() {
    setBusy("approve");
    setError(null);
    try {
      const res = await fetch(`/api/audits/${auditId}/risk-summary/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to approve");
      }
      const data: RenderedRiskSummary = await res.json();
      applySummary(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to approve");
    } finally {
      setBusy(null);
    }
  }

  function applySummary(data: RenderedRiskSummary) {
    setSummary(data);
    setDraftNarrative(data.vendorRelevanceNarrative);
    setDraftFocusAreas(data.focusAreas.join(", "));
  }

  const approved = summary?.approvalStatus === RiskSummaryApprovalStatus.APPROVED;

  return (
    <aside style={asideStyle} aria-label="Vendor risk summary">
      <header style={headerStyle}>
        <div style={typeScale.eyebrow}>Why this vendor matters</div>
        <div style={{ display: "flex", alignItems: "center", gap: space[2], marginTop: space[1] }}>
          <strong style={{ ...typeScale.bodyStrong, fontSize: 14 }}>Vendor Risk Summary</strong>
          {summary && <Badge tone={approved ? "approved" : "draft"}>{approved ? "Approved" : "Draft"}</Badge>}
        </div>
        {summary?.approvedAt && (
          <div style={{ ...typeScale.micro, color: color.fgMuted, marginTop: space[1] }}>
            Approved {new Date(summary.approvedAt).toLocaleString()}
          </div>
        )}
      </header>

      {error && (
        <div role="alert" style={errorStyle}>
          {error}
        </div>
      )}

      <div style={bodyStyle}>
        {!summary && (
          <div>
            <p style={{ ...typeScale.body, color: color.fgMuted, marginTop: 0 }}>
              No risk summary yet. Generate a stub from this audit&apos;s study context, protocol risks, and vendor service mappings — then edit it down.
            </p>
            <Button onClick={generateStub} disabled={!!busy}>
              {busy === "generate" ? "Generating…" : "Generate stub"}
            </Button>
          </div>
        )}

        {summary && (
          <>
            <StudyContext snapshot={summary.studyContext} />

            <Section title="Vendor relevance narrative">
              {editing ? (
                <textarea
                  value={draftNarrative}
                  onChange={(e) => setDraftNarrative(e.target.value)}
                  rows={10}
                  style={textareaStyle}
                  disabled={!!busy}
                />
              ) : (
                <p style={{ ...typeScale.body, whiteSpace: "pre-wrap", margin: 0 }}>
                  {summary.vendorRelevanceNarrative}
                </p>
              )}
            </Section>

            <Section title="Focus areas">
              {editing ? (
                <input
                  type="text"
                  value={draftFocusAreas}
                  onChange={(e) => setDraftFocusAreas(e.target.value)}
                  placeholder="Comma-separated (e.g. data integrity, GxP training)"
                  style={inputStyle}
                  disabled={!!busy}
                />
              ) : summary.focusAreas.length === 0 ? (
                <span style={{ ...typeScale.caption, color: color.fgSubtle }}>None specified</span>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 18, ...typeScale.body }}>
                  {summary.focusAreas.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Linked protocol risks">
              {summary.protocolRiskRefs.length === 0 ? (
                <span style={{ ...typeScale.caption, color: color.fgSubtle }}>No protocol risks linked yet</span>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 18, ...typeScale.caption }}>
                  {summary.protocolRiskRefs.map((r) => (
                    <li key={r.id}>
                      <strong>{r.sectionIdentifier}</strong>
                      {r.sectionTitle ? ` — ${r.sectionTitle}` : ""}
                      <span style={{ color: color.fgMuted }}>
                        {" "}· {r.operationalDomainTag.replace(/_/g, " ").toLowerCase()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <div style={{ display: "flex", flexDirection: "column", gap: space[2], marginTop: space[4] }}>
              {!editing && !approved && !confirmingApprove && (
                <div style={{ display: "flex", gap: space[2] }}>
                  <Button variant="secondary" onClick={() => setEditing(true)} disabled={!!busy}>
                    Edit
                  </Button>
                  <Button
                    variant="approve"
                    onClick={() => setConfirmingApprove(true)}
                    disabled={!!busy || !summary.vendorRelevanceNarrative.trim()}
                  >
                    Approve
                  </Button>
                </div>
              )}
              {confirmingApprove && (
                <div
                  style={{
                    background: color.successBgSoft,
                    border: `1px solid ${color.success}`,
                    borderRadius: radius.sm,
                    padding: space[3],
                    display: "flex",
                    flexDirection: "column",
                    gap: space[2],
                  }}
                >
                  <span style={{ ...typeScale.caption, color: color.successFgSoft }}>
                    Approve this risk summary? Once approved, any edit will revert it to Draft and require re-approval before advancing stages.
                  </span>
                  <div style={{ display: "flex", gap: space[2] }}>
                    <Button
                      variant="approve"
                      size="sm"
                      onClick={() => { setConfirmingApprove(false); approve(); }}
                      disabled={!!busy}
                    >
                      {busy === "approve" ? "Approving…" : "Confirm approval"}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setConfirmingApprove(false)}
                      disabled={!!busy}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
              {editing && (
                <div style={{ display: "flex", gap: space[2] }}>
                  <Button onClick={saveEdits} disabled={!!busy || !draftNarrative.trim()}>
                    {busy === "save" ? "Saving…" : "Save"}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setDraftNarrative(summary.vendorRelevanceNarrative);
                      setDraftFocusAreas(summary.focusAreas.join(", "));
                      setEditing(false);
                    }}
                    disabled={!!busy}
                  >
                    Cancel
                  </Button>
                </div>
              )}
              {approved && !editing && (
                <span style={{ ...typeScale.caption, color: color.successFgSoft }}>
                  Approved. Edits revert to Draft and require re-approval.
                </span>
              )}
            </div>
          </>
        )}
      </div>

      {summary && (
        <div style={{ padding: `0 ${space[4]}px ${space[4]}px` }}>
          <HistoryDrawer
            auditId={auditId}
            objectType="VENDOR_RISK_SUMMARY_OBJECT"
            objectId={summary.id}
            label="Risk summary history"
          />
        </div>
      )}
    </aside>
  );
}

function StudyContext({ snapshot }: { snapshot: RenderedRiskSummary["studyContext"] }) {
  return (
    <Section title="Study context">
      <dl style={{ margin: 0 }}>
        <Row label="Phase" value={snapshot.clinicalTrialPhase} />
        <Row label="Therapeutic space" value={snapshot.therapeuticSpace ?? "—"} />
        <Row
          label="Primary endpoints"
          value={snapshot.primaryEndpoints.length ? snapshot.primaryEndpoints.join("; ") : "—"}
        />
        <Row
          label="Secondary endpoints"
          value={snapshot.secondaryEndpoints.length ? snapshot.secondaryEndpoints.join("; ") : "—"}
        />
      </dl>
      <div style={{ ...typeScale.micro, color: color.fgSubtle, marginTop: space[1] + 2 }}>
        Snapshot taken {new Date(snapshot.capturedAt).toLocaleDateString()} — frozen against protocol amendments.
      </div>
    </Section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", gap: space[2], padding: "2px 0", ...typeScale.caption }}>
      <dt style={{ width: 110, color: color.fgMuted, flexShrink: 0, margin: 0 }}>{label}</dt>
      <dd style={{ margin: 0, color: color.fg }}>{value}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: space[4] + 2 }}>
      <h4 style={{ ...typeScale.eyebrow, margin: `0 0 ${space[1] + 2}px` }}>{title}</h4>
      {children}
    </section>
  );
}

function parseFocusAreas(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const asideStyle: React.CSSProperties = {
  width: layout.sidePaneWidth,
  borderLeft: `1px solid ${color.border}`,
  background: color.bg,
  display: "flex",
  flexDirection: "column",
  flexShrink: 0,
};

const headerStyle: React.CSSProperties = {
  padding: `${space[3]}px ${space[4]}px`,
  borderBottom: `1px solid ${color.border}`,
};

const bodyStyle: React.CSSProperties = {
  padding: space[4],
  overflowY: "auto",
  flex: 1,
};

const errorStyle: React.CSSProperties = {
  background: color.dangerBgSoft,
  color: color.dangerFgSoft,
  padding: space[2],
  margin: space[3],
  borderRadius: radius.sm,
  ...typeScale.caption,
};

const textareaStyle: React.CSSProperties = {
  width: "100%",
  padding: space[2],
  fontFamily: "inherit",
  fontSize: 13,
  boxSizing: "border-box",
  border: `1px solid ${color.borderStrong}`,
  borderRadius: radius.sm,
  background: color.bg,
  color: color.fg,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: `${space[1] + 2}px ${space[2]}px`,
  fontFamily: "inherit",
  fontSize: 13,
  boxSizing: "border-box",
  border: `1px solid ${color.borderStrong}`,
  borderRadius: radius.sm,
  background: color.bg,
  color: color.fg,
};
