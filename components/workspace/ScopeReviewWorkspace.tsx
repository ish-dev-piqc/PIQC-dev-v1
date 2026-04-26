"use client";

// =============================================================================
// ScopeReviewWorkspace (SCOPE_AND_RISK_REVIEW stage center pane)
//
// A read-only structured review of everything captured in INTAKE and
// VENDOR_ENRICHMENT: protocol sections, vendor service mappings with derived
// criticality, and trust posture. The auditor reads, confirms the right panel
// risk summary is approved, then advances.
//
// Gate enforcement:
//   - questionnaire approved  → readout.questionnaireApproved
//   - risk summary approved   → readout.riskSummaryApproved
//   - both required           → readout.canAdvance (checked server-side in lib)
//   - advance action          → advanceStage(PRE_AUDIT_DRAFTING) via context
//
// The risk summary is edited and approved in the right panel (RiskSummaryPanel).
// This center pane does not duplicate that surface.
// =============================================================================

import { AuditStage, DerivedCriticality, EndpointTier, ImpactSurface } from "@prisma/client";
import { Button } from "@/components/ui/Button";
import { useStageActions } from "@/components/workspace/AuditWorkspaceShell";
import { color, radius, space, type as typeScale } from "@/lib/ui/tokens";

// ── Prop types (server-shaped before passing to client) ──────────────────────

export interface ScopeRiskObject {
  id: string;
  sectionIdentifier: string;
  sectionTitle: string;
  endpointTier: EndpointTier;
  impactSurface: ImpactSurface;
  timeSensitivity: boolean;
  operationalDomainTag: string;
}

export interface ScopeMapping {
  mappingId: string;
  derivedCriticality: DerivedCriticality;
  criticalityRationale: string | null;
  riskObject: ScopeRiskObject;
}

export interface ScopeVendorService {
  id: string;
  serviceName: string;
  serviceType: string;
  serviceDescription: string | null;
  mappings: ScopeMapping[];
}

export interface ScopeTrustSummary {
  compliancePosture: string;
  maturityPosture: string;
  provisionalTrustPosture: string;
  certificationsClaimed: string[];
  riskHypotheses: string[];
}

interface Props {
  riskObjects: ScopeRiskObject[];
  vendorService: ScopeVendorService | null;
  trustAssessment: ScopeTrustSummary | null;
}

export function ScopeReviewWorkspace({ riskObjects, vendorService, trustAssessment }: Props) {
  const actions = useStageActions();
  const readout = actions?.readout;
  const canAdvance =
    readout?.currentStage === AuditStage.SCOPE_AND_RISK_REVIEW &&
    readout?.canAdvance === true;
  const blockedReason = readout?.blockedReason ?? null;
  const questionnaireApproved = readout?.questionnaireApproved ?? false;
  const riskSummaryApproved = readout?.riskSummaryApproved ?? false;

  async function advance() {
    await actions?.advanceStage(AuditStage.PRE_AUDIT_DRAFTING);
  }

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div>
        <div style={typeScale.eyebrow}>SCOPE &amp; RISK REVIEW</div>
        <h2 style={{ ...typeScale.title, margin: `${space[1]}px 0 ${space[1]}px` }}>
          Scope confirmation
        </h2>
        <p style={{ ...typeScale.body, color: color.fgMuted, margin: 0 }}>
          Review the risk scope captured in prior stages. When the questionnaire and
          risk summary are both approved, advance to pre-audit drafting.
        </p>
      </div>

      {/* Approval gates */}
      <Section title="Approval gates">
        <div style={{ display: "flex", gap: space[3], flexWrap: "wrap" }}>
          <GateChip
            label="Questionnaire"
            approved={questionnaireApproved}
            hint={questionnaireApproved ? undefined : "Approve the questionnaire in QUESTIONNAIRE REVIEW"}
          />
          <GateChip
            label="Risk summary"
            approved={riskSummaryApproved}
            hint={riskSummaryApproved ? undefined : "Approve the risk summary in the right panel"}
          />
        </div>
      </Section>

      {/* Protocol risk scope */}
      <Section title={`Protocol risk scope — ${riskObjects.length} section${riskObjects.length !== 1 ? "s" : ""} tagged`}>
        {riskObjects.length === 0 ? (
          <EmptyHint>No protocol sections tagged. Go back to INTAKE to tag sections.</EmptyHint>
        ) : (
          <div style={tableStyle}>
            {riskObjects.map((r) => (
              <div key={r.id} style={tableRowStyle}>
                <span style={{ ...typeScale.eyebrow, minWidth: 60 }}>{r.sectionIdentifier}</span>
                <span style={{ ...typeScale.body, flex: 1, color: color.fg }}>{r.sectionTitle}</span>
                <div style={{ display: "flex", gap: space[1] + 2, flexShrink: 0 }}>
                  <TierChip tier={r.endpointTier} />
                  <SurfaceChip surface={r.impactSurface} />
                  <DomainChip domain={r.operationalDomainTag} />
                  {r.timeSensitivity && <TimeSensChip />}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Vendor service + criticality mappings */}
      <Section title="Vendor service mappings">
        {!vendorService ? (
          <EmptyHint>No vendor service defined. Go back to VENDOR ENRICHMENT to define the service.</EmptyHint>
        ) : (
          <div>
            <div style={{ ...typeScale.bodyStrong, marginBottom: space[2] }}>
              {vendorService.serviceName}
              <span style={{ ...typeScale.caption, color: color.fgMuted, marginLeft: space[2] }}>
                {vendorService.serviceType.replace(/_/g, " ")}
              </span>
            </div>
            {vendorService.mappings.length === 0 ? (
              <EmptyHint>No protocol sections mapped yet. Go back to VENDOR ENRICHMENT to map sections.</EmptyHint>
            ) : (
              <div style={tableStyle}>
                {vendorService.mappings.map((m) => (
                  <div key={m.mappingId} style={tableRowStyle}>
                    <span style={{ ...typeScale.eyebrow, minWidth: 60 }}>{m.riskObject.sectionIdentifier}</span>
                    <span style={{ ...typeScale.body, flex: 1, color: color.fg }}>{m.riskObject.sectionTitle}</span>
                    <CriticalityChip criticality={m.derivedCriticality} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Section>

      {/* Trust intelligence */}
      <Section title="Trust intelligence">
        {!trustAssessment ? (
          <EmptyHint>No trust assessment recorded. Go back to VENDOR ENRICHMENT to complete it.</EmptyHint>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: space[3] }}>
            <div style={{ display: "flex", gap: space[5], flexWrap: "wrap" }}>
              <PostureRow label="Compliance" value={trustAssessment.compliancePosture} />
              <PostureRow label="Maturity" value={trustAssessment.maturityPosture} />
              <PostureRow label="Trust posture" value={trustAssessment.provisionalTrustPosture} />
            </div>
            {trustAssessment.certificationsClaimed.length > 0 && (
              <div>
                <div style={{ ...typeScale.caption, color: color.fgMuted, marginBottom: space[1] }}>
                  Certifications claimed
                </div>
                <div style={{ display: "flex", gap: space[1] + 2, flexWrap: "wrap" }}>
                  {trustAssessment.certificationsClaimed.map((c) => (
                    <span key={c} style={certChipStyle}>{c}</span>
                  ))}
                </div>
              </div>
            )}
            {trustAssessment.riskHypotheses.length > 0 && (
              <div>
                <div style={{ ...typeScale.caption, color: color.fgMuted, marginBottom: space[1] }}>
                  Risk hypotheses
                </div>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {trustAssessment.riskHypotheses.map((h) => (
                    <li key={h} style={{ ...typeScale.body, color: color.fg }}>{h}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Section>

      {/* Advance */}
      <div style={{ paddingTop: space[2], borderTop: `1px solid ${color.border}` }}>
        <Button
          variant="approve"
          onClick={advance}
          disabled={!canAdvance || actions?.busy}
        >
          {actions?.busy ? "Advancing…" : "Advance to Pre-Audit Drafting"}
        </Button>
        {blockedReason && (
          <p style={{ ...typeScale.caption, color: color.fgMuted, margin: `${space[2]}px 0 0` }}>
            {blockedReason}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 style={{ ...typeScale.eyebrow, margin: `0 0 ${space[2]}px` }}>{title}</h3>
      {children}
    </section>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ ...typeScale.body, color: color.fgSubtle, margin: 0 }}>{children}</p>
  );
}

function GateChip({ label, approved, hint }: { label: string; approved: boolean; hint?: string }) {
  return (
    <div style={approved ? gateApprovedStyle : gatePendingStyle}>
      <span style={{ ...typeScale.bodyStrong, color: approved ? color.successFgSoft : color.fgMuted }}>
        {approved ? "✓" : "○"} {label}
      </span>
      {hint && (
        <span style={{ ...typeScale.caption, color: color.fgSubtle, display: "block", marginTop: 2 }}>
          {hint}
        </span>
      )}
    </div>
  );
}

function TierChip({ tier }: { tier: EndpointTier }) {
  const map: Record<EndpointTier, { bg: string; fg: string; label: string }> = {
    PRIMARY:   { bg: color.dangerBgSoft,  fg: color.dangerFgSoft,  label: "Primary" },
    SAFETY:    { bg: color.warningBgSoft, fg: color.warningFgSoft, label: "Safety" },
    SECONDARY: { bg: color.primaryBgSoft, fg: color.primaryFgSoft, label: "Secondary" },
    SUPPORTIVE:{ bg: color.bgSubtle,      fg: color.fgMuted,       label: "Supportive" },
  };
  const { bg, fg, label } = map[tier];
  return <span style={{ ...chipBase, background: bg, color: fg }}>{label}</span>;
}

function SurfaceChip({ surface }: { surface: ImpactSurface }) {
  const map: Record<ImpactSurface, { bg: string; fg: string; label: string }> = {
    BOTH:           { bg: color.dangerBgSoft,  fg: color.dangerFgSoft,  label: "Both" },
    PATIENT_SAFETY: { bg: color.warningBgSoft, fg: color.warningFgSoft, label: "Patient safety" },
    DATA_INTEGRITY: { bg: color.primaryBgSoft, fg: color.primaryFgSoft, label: "Data integrity" },
  };
  const { bg, fg, label } = map[surface];
  return <span style={{ ...chipBase, background: bg, color: fg }}>{label}</span>;
}

function DomainChip({ domain }: { domain: string }) {
  return (
    <span style={{ ...chipBase, background: color.bgSubtle, color: color.fgMuted }}>
      {domain.replace(/_/g, " ")}
    </span>
  );
}

function TimeSensChip() {
  return (
    <span style={{ ...chipBase, background: color.warningBgSoft, color: color.warningFgSoft }}>
      Time-sensitive
    </span>
  );
}

function CriticalityChip({ criticality }: { criticality: DerivedCriticality }) {
  const map: Record<DerivedCriticality, { bg: string; fg: string }> = {
    CRITICAL: { bg: color.dangerBgSoft,  fg: color.dangerFgSoft },
    HIGH:     { bg: color.warningBgSoft, fg: color.warningFgSoft },
    MODERATE: { bg: "#fef9c3",           fg: "#713f12" },
    LOW:      { bg: color.successBgSoft, fg: color.successFgSoft },
  };
  const { bg, fg } = map[criticality];
  return (
    <span style={{ ...chipBase, background: bg, color: fg }}>
      {criticality.charAt(0) + criticality.slice(1).toLowerCase()}
    </span>
  );
}

function PostureRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ ...typeScale.caption, color: color.fgMuted }}>{label}</div>
      <div style={{ ...typeScale.bodyStrong, color: color.fg, marginTop: 2 }}>
        {value.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const containerStyle: React.CSSProperties = {
  padding: space[5],
  display: "flex",
  flexDirection: "column",
  gap: space[5],
  overflowY: "auto",
  flex: 1,
};

const tableStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: space[1] + 2,
};

const tableRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: space[3],
  background: color.bg,
  border: `1px solid ${color.border}`,
  borderRadius: radius.md,
  padding: `${space[2]}px ${space[3]}px`,
  flexWrap: "wrap",
};

const chipBase: React.CSSProperties = {
  ...typeScale.micro,
  borderRadius: radius.sm,
  padding: "2px 6px",
  fontWeight: 600,
  whiteSpace: "nowrap",
};

const gateApprovedStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 160,
  background: color.successBgSoft,
  border: `1px solid ${color.success}`,
  borderRadius: radius.md,
  padding: `${space[2]}px ${space[3]}px`,
};

const gatePendingStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 160,
  background: color.bgSubtle,
  border: `1px solid ${color.border}`,
  borderRadius: radius.md,
  padding: `${space[2]}px ${space[3]}px`,
};

const certChipStyle: React.CSSProperties = {
  ...typeScale.caption,
  background: color.statusInfoBgSoft,
  color: color.statusInfoFgSoft,
  borderRadius: radius.sm,
  padding: "2px 6px",
};
