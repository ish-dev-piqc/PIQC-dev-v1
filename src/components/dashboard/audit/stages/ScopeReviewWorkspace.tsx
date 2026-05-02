import { CheckCircle2, Circle, ArrowRight, AlertCircle } from 'lucide-react';
import { useTheme } from '../../../../context/ThemeContext';
import { useAudit } from '../../../../context/AuditContext';
import { useAuditData } from '../../../../context/AuditDataContext';
import {
  ENDPOINT_TIER_LABELS,
  IMPACT_SURFACE_LABELS,
  DERIVED_CRITICALITY_LABELS,
  COMPLIANCE_POSTURE_LABELS,
  MATURITY_POSTURE_LABELS,
  TRUST_POSTURE_LABELS,
  OPERATIONAL_DOMAIN_OPTIONS,
  SERVICE_TYPE_OPTIONS,
} from '../../../../lib/audit/labels';
import type { DerivedCriticality, EndpointTier, ImpactSurface } from '../../../../types/audit';

// =============================================================================
// ScopeReviewWorkspace — SCOPE_AND_RISK_REVIEW stage center pane.
//
// Read-only structured review of everything captured upstream:
//   - Protocol risk scope (from INTAKE)
//   - Vendor service + mappings (from VENDOR_ENRICHMENT)
//   - Trust intelligence (from VENDOR_ENRICHMENT)
// Plus two approval gates (questionnaire + risk summary) that, together,
// unlock the advance to PRE_AUDIT_DRAFTING.
//
// This pane does not duplicate the risk-summary surface — that lives in the
// right-rail RiskSummaryPanel. The left two gates simply mirror the upstream
// approval signals.
//
// Phase B caveat: gates read from the seeded mock data. Approvals you make
// inside QuestionnaireReviewWorkspace or RiskSummaryPanel are component-local
// state and don't propagate here yet — that lands when we lift mock stores
// into shared contexts (or when real Supabase wires up).
// =============================================================================

export default function ScopeReviewWorkspace() {
  const { theme } = useTheme();
  const { activeAudit, advanceStage } = useAudit();
  const data = useAuditData();
  const isLight = theme === 'light';

  if (!activeAudit) return null;

  const auditId = activeAudit.id;
  const protocolRisks = data.protocolRisks[auditId] ?? [];
  const vendorService = data.vendorServices[auditId] ?? null;
  const mappings = data.serviceMappings[auditId] ?? [];
  const trustAssessment = data.trustAssessments[auditId] ?? null;
  const questionnaire = data.questionnaires[auditId] ?? null;
  const riskSummary = data.riskSummaries[auditId] ?? null;

  // Gate signals
  const questionnaireApproved = !!questionnaire?.instance.approved_at;
  const riskSummaryApproved = riskSummary?.approval_status === 'APPROVED';
  const canAdvance = questionnaireApproved && riskSummaryApproved;
  const blockedReason = !questionnaireApproved && !riskSummaryApproved
    ? 'Approve the questionnaire and risk summary before advancing.'
    : !questionnaireApproved
    ? 'Approve the questionnaire in Stage 3 before advancing.'
    : !riskSummaryApproved
    ? 'Approve the risk summary in the right-hand panel before advancing.'
    : null;

  const alreadyAdvanced = activeAudit.current_stage !== 'SCOPE_AND_RISK_REVIEW' &&
    ['PRE_AUDIT_DRAFTING', 'AUDIT_CONDUCT', 'REPORT_DRAFTING', 'FINAL_REVIEW_EXPORT'].includes(activeAudit.current_stage);

  // ---------------------------------------------------------------------------
  // Theme tokens
  // ---------------------------------------------------------------------------
  const headingColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';
  const mutedColor = 'text-fg-muted';
  const sectionHeader = 'text-fg-label';
  const cardBg = isLight ? 'bg-white border-[#e2e8ee]' : 'bg-[#131a22] border-white/5';
  const rowBg = isLight ? 'bg-white border-[#e2e8ee]' : 'bg-white/[0.02] border-white/[0.04]';
  const buttonApprove = isLight
    ? 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-[#cbd2db] disabled:hover:bg-[#cbd2db]'
    : 'bg-emerald-500 text-[#0d1118] hover:bg-emerald-400 disabled:bg-white/10 disabled:hover:bg-white/10 disabled:text-white/35';

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <p className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold`}>
          Stage 4 · Scope & risk review
        </p>
        <h2 className={`${headingColor} text-xl font-semibold mt-1`}>
          Scope confirmation
        </h2>
        <p className={`${subColor} text-sm mt-1.5 leading-relaxed max-w-2xl`}>
          Review the risk scope captured in prior stages. When the questionnaire and risk
          summary are both approved, advance to pre-audit drafting.
        </p>
      </div>

      {/* Approval gates */}
      <div className={`${cardBg} border rounded-xl p-5`}>
        <p className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold mb-3`}>
          Approval gates
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <GateCard
            label="Questionnaire"
            approved={questionnaireApproved}
            hint={
              questionnaireApproved
                ? null
                : 'Approve the questionnaire in Stage 3 (Questionnaire review).'
            }
            isLight={isLight}
          />
          <GateCard
            label="Risk summary"
            approved={riskSummaryApproved}
            hint={
              riskSummaryApproved
                ? null
                : 'Approve the risk summary in the right-hand panel.'
            }
            isLight={isLight}
          />
        </div>
      </div>

      {/* Protocol risk scope */}
      <Section
        title={`Protocol risk scope — ${protocolRisks.length} section${protocolRisks.length === 1 ? '' : 's'} tagged`}
        sectionHeader={sectionHeader}
      >
        {protocolRisks.length === 0 ? (
          <EmptyHint subColor={subColor}>
            No protocol sections tagged. Go back to Intake (Stage 1) to tag sections.
          </EmptyHint>
        ) : (
          <div className="space-y-1.5">
            {protocolRisks.map((r) => (
              <div
                key={r.id}
                className={`${rowBg} border rounded-md px-3 py-2 flex items-center gap-3 flex-wrap`}
              >
                <span
                  className={`text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded flex-shrink-0 ${
                    isLight ? 'bg-[#eef2f6] text-[#4a6fa5]' : 'bg-white/[0.06] text-[#6e8fb5]'
                  }`}
                >
                  {r.section_identifier}
                </span>
                <span className={`${headingColor} text-sm font-medium flex-1 min-w-[140px]`}>
                  {r.section_title}
                </span>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <TierChip tier={r.endpoint_tier} isLight={isLight} />
                  <SurfaceChip surface={r.impact_surface} isLight={isLight} />
                  <DomainChip
                    label={
                      OPERATIONAL_DOMAIN_OPTIONS.find((o) => o.value === r.operational_domain_tag)?.label ??
                      r.operational_domain_tag
                    }
                    isLight={isLight}
                  />
                  {r.time_sensitivity && <TimeSensitiveChip isLight={isLight} />}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Vendor service + mappings */}
      <Section title="Vendor service mappings" sectionHeader={sectionHeader}>
        {!vendorService ? (
          <EmptyHint subColor={subColor}>
            No vendor service defined. Go back to Vendor Enrichment (Stage 2) to define it.
          </EmptyHint>
        ) : (
          <div className="space-y-3">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className={`${headingColor} text-base font-semibold`}>
                {vendorService.service_name}
              </span>
              <span className={`${mutedColor} text-xs`}>·</span>
              <span className={`${subColor} text-xs`}>
                {SERVICE_TYPE_OPTIONS.find((o) => o.value === vendorService.service_type)?.label ??
                  vendorService.service_type}
              </span>
            </div>
            {mappings.length === 0 ? (
              <EmptyHint subColor={subColor}>
                No protocol sections mapped to this service. Go back to Vendor Enrichment to map.
              </EmptyHint>
            ) : (
              <div className="space-y-1.5">
                {mappings.map((m) => {
                  const risk = protocolRisks.find((r) => r.id === m.protocol_risk_id);
                  return (
                    <div
                      key={m.id}
                      className={`${rowBg} border rounded-md px-3 py-2 flex items-start gap-3 flex-wrap`}
                    >
                      <span
                        className={`text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded flex-shrink-0 ${
                          isLight ? 'bg-[#eef2f6] text-[#4a6fa5]' : 'bg-white/[0.06] text-[#6e8fb5]'
                        }`}
                      >
                        {risk?.section_identifier ?? '—'}
                      </span>
                      <div className="flex-1 min-w-[140px]">
                        <p className={`${headingColor} text-sm font-medium`}>
                          {risk?.section_title ?? 'Section not found'}
                        </p>
                        {m.criticality_rationale && (
                          <p className={`${subColor} text-xs mt-1 leading-relaxed`}>
                            {m.criticality_rationale}
                          </p>
                        )}
                      </div>
                      <CriticalityChip criticality={m.derived_criticality} isLight={isLight} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </Section>

      {/* Trust intelligence */}
      <Section title="Trust intelligence" sectionHeader={sectionHeader}>
        {!trustAssessment ? (
          <EmptyHint subColor={subColor}>
            No trust assessment recorded. Go back to Vendor Enrichment to complete it.
          </EmptyHint>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <PostureSummary
                label="Compliance"
                value={COMPLIANCE_POSTURE_LABELS[trustAssessment.compliance_posture]}
                isUnknown={trustAssessment.compliance_posture === 'UNKNOWN'}
                isLight={isLight}
              />
              <PostureSummary
                label="Maturity"
                value={MATURITY_POSTURE_LABELS[trustAssessment.maturity_posture]}
                isUnknown={trustAssessment.maturity_posture === 'UNKNOWN'}
                isLight={isLight}
              />
              <PostureSummary
                label="Provisional trust"
                value={TRUST_POSTURE_LABELS[trustAssessment.provisional_trust_posture]}
                isUnknown={trustAssessment.provisional_trust_posture === 'UNKNOWN'}
                isLight={isLight}
              />
            </div>
            {trustAssessment.certifications_claimed.length > 0 && (
              <div>
                <p className={`text-[10px] uppercase tracking-wider font-semibold mb-1.5 ${sectionHeader}`}>
                  Certifications claimed
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {trustAssessment.certifications_claimed.map((c, i) => (
                    <span
                      key={i}
                      className={`inline-flex items-center text-xs px-2 py-1 rounded border ${
                        isLight
                          ? 'bg-[#eef2f6] border-[#cbd2db] text-[#1a1f28]'
                          : 'bg-white/[0.06] border-white/10 text-[#d2d7e0]'
                      }`}
                    >
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {trustAssessment.risk_hypotheses.length > 0 && (
              <div>
                <p className={`text-[10px] uppercase tracking-wider font-semibold mb-1.5 ${sectionHeader}`}>
                  Risk hypotheses
                </p>
                <ul className="space-y-1.5">
                  {trustAssessment.risk_hypotheses.map((h, i) => (
                    <li key={i} className={`text-sm flex items-start gap-2 ${headingColor}`}>
                      <span
                        className={`mt-1.5 w-1 h-1 rounded-full flex-shrink-0 ${
                          isLight ? 'bg-[#4a6fa5]/55' : 'bg-[#6e8fb5]/55'
                        }`}
                      />
                      {h}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Section>

      {/* Advance */}
      <div className={`${cardBg} border rounded-xl p-5`}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <p className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold`}>
              Stage transition
            </p>
            <p className={`${headingColor} text-sm font-semibold mt-1`}>
              {alreadyAdvanced
                ? 'Audit has already advanced past this stage'
                : canAdvance
                ? 'Both gates clear — ready to advance'
                : 'Gates blocking advance'}
            </p>
            {blockedReason && !alreadyAdvanced && (
              <p className={`${subColor} text-xs mt-1`}>{blockedReason}</p>
            )}
            {alreadyAdvanced && (
              <p className={`${subColor} text-xs mt-1`}>
                Current stage: {activeAudit.current_stage.replace(/_/g, ' ').toLowerCase()}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => advanceStage('PRE_AUDIT_DRAFTING')}
            disabled={!canAdvance || alreadyAdvanced}
            className={`inline-flex items-center gap-1.5 text-sm font-semibold px-3.5 py-2 rounded-md transition-colors ${buttonApprove}`}
          >
            Advance to Pre-audit drafting
            <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

function Section({
  title,
  sectionHeader,
  children,
}: {
  title: string;
  sectionHeader: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <p className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold mb-2`}>
        {title}
      </p>
      {children}
    </section>
  );
}

function EmptyHint({ children, subColor }: { children: React.ReactNode; subColor: string }) {
  return <p className={`${subColor} text-sm italic`}>{children}</p>;
}

function GateCard({
  label,
  approved,
  hint,
  isLight,
}: {
  label: string;
  approved: boolean;
  hint: string | null;
  isLight: boolean;
}) {
  const headingColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';
  const cardBg = approved
    ? isLight
      ? 'bg-emerald-50 border-emerald-200/80'
      : 'bg-emerald-500/[0.06] border-emerald-500/20'
    : isLight
    ? 'bg-amber-50/40 border-amber-200/60'
    : 'bg-amber-500/[0.04] border-amber-500/15';
  const iconColor = approved ? 'text-emerald-600' : 'text-amber-600';

  return (
    <div className={`${cardBg} border rounded-md px-3 py-2.5`}>
      <div className="flex items-center gap-2 mb-0.5">
        {approved ? (
          <CheckCircle2 size={14} className={iconColor} />
        ) : (
          <Circle size={14} className={iconColor} />
        )}
        <span className={`${headingColor} text-sm font-semibold`}>{label}</span>
        <span
          className={`ml-auto text-[10px] font-semibold uppercase tracking-wider ${
            approved
              ? isLight
                ? 'text-emerald-700'
                : 'text-emerald-400'
              : isLight
              ? 'text-amber-700'
              : 'text-amber-400'
          }`}
        >
          {approved ? 'Approved' : 'Pending'}
        </span>
      </div>
      {hint && (
        <p className={`${subColor} text-[11px] leading-relaxed mt-1 flex items-start gap-1.5`}>
          <AlertCircle size={11} className="flex-shrink-0 mt-0.5" />
          {hint}
        </p>
      )}
    </div>
  );
}

function TierChip({ tier, isLight }: { tier: EndpointTier; isLight: boolean }) {
  const tones: Record<EndpointTier, string> = {
    PRIMARY: isLight
      ? 'bg-red-50 border-red-200 text-red-700'
      : 'bg-red-500/15 border-red-500/30 text-red-300',
    SAFETY: isLight
      ? 'bg-amber-50 border-amber-200 text-amber-700'
      : 'bg-amber-500/15 border-amber-500/30 text-amber-300',
    SECONDARY: isLight
      ? 'bg-[#4a6fa5]/10 border-[#4a6fa5]/25 text-[#4a6fa5]'
      : 'bg-[#6e8fb5]/15 border-[#6e8fb5]/30 text-[#6e8fb5]',
    SUPPORTIVE: isLight
      ? 'bg-[#eef2f6] border-[#cbd2db] text-[#374152]/65'
      : 'bg-white/[0.06] border-white/10 text-[#d2d7e0]/55',
  };
  return (
    <span
      className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded border ${tones[tier]}`}
    >
      {ENDPOINT_TIER_LABELS[tier]}
    </span>
  );
}

function SurfaceChip({ surface, isLight }: { surface: ImpactSurface; isLight: boolean }) {
  const tones: Record<ImpactSurface, string> = {
    BOTH: isLight
      ? 'bg-red-50 border-red-200 text-red-700'
      : 'bg-red-500/15 border-red-500/30 text-red-300',
    PATIENT_SAFETY: isLight
      ? 'bg-amber-50 border-amber-200 text-amber-700'
      : 'bg-amber-500/15 border-amber-500/30 text-amber-300',
    DATA_INTEGRITY: isLight
      ? 'bg-[#4a6fa5]/10 border-[#4a6fa5]/25 text-[#4a6fa5]'
      : 'bg-[#6e8fb5]/15 border-[#6e8fb5]/30 text-[#6e8fb5]',
  };
  return (
    <span
      className={`inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded border ${tones[surface]}`}
    >
      {IMPACT_SURFACE_LABELS[surface]}
    </span>
  );
}

function DomainChip({ label, isLight }: { label: string; isLight: boolean }) {
  return (
    <span
      className={`inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded border ${
        isLight
          ? 'bg-[#eef2f6] border-[#cbd2db] text-[#374152]/70'
          : 'bg-white/[0.06] border-white/10 text-[#d2d7e0]/65'
      }`}
    >
      {label}
    </span>
  );
}

function TimeSensitiveChip({ isLight }: { isLight: boolean }) {
  return (
    <span
      className={`inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded border ${
        isLight
          ? 'bg-amber-50/60 border-amber-200/80 text-amber-700'
          : 'bg-amber-500/[0.08] border-amber-500/20 text-amber-300'
      }`}
    >
      Time-sensitive
    </span>
  );
}

function CriticalityChip({
  criticality,
  isLight,
}: {
  criticality: DerivedCriticality;
  isLight: boolean;
}) {
  const tones: Record<DerivedCriticality, string> = {
    CRITICAL: isLight
      ? 'bg-red-50 border-red-200 text-red-700'
      : 'bg-red-500/15 border-red-500/30 text-red-300',
    HIGH: isLight
      ? 'bg-amber-50 border-amber-200 text-amber-700'
      : 'bg-amber-500/15 border-amber-500/30 text-amber-300',
    MODERATE: isLight
      ? 'bg-[#4a6fa5]/10 border-[#4a6fa5]/25 text-[#4a6fa5]'
      : 'bg-[#6e8fb5]/15 border-[#6e8fb5]/30 text-[#6e8fb5]',
    LOW: isLight
      ? 'bg-[#eef2f6] border-[#cbd2db] text-[#374152]/65'
      : 'bg-white/[0.06] border-white/10 text-[#d2d7e0]/55',
  };
  return (
    <span
      className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded border flex-shrink-0 ${tones[criticality]}`}
    >
      {DERIVED_CRITICALITY_LABELS[criticality]}
    </span>
  );
}

function PostureSummary({
  label,
  value,
  isUnknown,
  isLight,
}: {
  label: string;
  value: string;
  isUnknown: boolean;
  isLight: boolean;
}) {
  const cardBg = isUnknown
    ? isLight
      ? 'bg-[#f9fafc] border-[#e2e8ee]'
      : 'bg-white/[0.02] border-white/5'
    : isLight
    ? 'bg-[#4a6fa5]/[0.06] border-[#4a6fa5]/20'
    : 'bg-[#4a6fa5]/[0.10] border-[#6e8fb5]/30';
  const sectionHeader = 'text-fg-label';
  const valueColor = isUnknown
    ? isLight
      ? 'text-[#374152]/55'
      : 'text-[#d2d7e0]/45'
    : isLight
    ? 'text-[#1a1f28]'
    : 'text-white';
  return (
    <div className={`${cardBg} border rounded-md px-3 py-2.5`}>
      <p className={`text-[10px] uppercase tracking-wider font-semibold ${sectionHeader}`}>
        {label}
      </p>
      <p className={`text-sm font-semibold mt-0.5 ${valueColor}`}>{value}</p>
    </div>
  );
}
