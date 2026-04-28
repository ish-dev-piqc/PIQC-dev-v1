import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Sparkles,
  Pencil,
  History as HistoryIcon,
  X,
} from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import {
  MOCK_RISK_SUMMARIES,
  type MockRiskSummary,
} from '../../../lib/audit/mockRiskSummary';
import type { ClinicalTrialPhase } from '../../../types/audit';

// =============================================================================
// RiskSummaryPanel — right rail of the audit workspace.
//
// Renders the VendorRiskSummaryObject for the active audit. Phase A is
// mock-backed: edits/approvals update local state only. Phase B replaces the
// mock store with Supabase reads + RPC calls.
//
// Three states:
//   - No summary yet → "Generate stub" empty state
//   - DRAFT          → edit + approve buttons
//   - APPROVED       → approved badge; editing demotes to DRAFT
//
// Sponsor-name-free by rule — narrative copy stays generic.
// =============================================================================

interface RiskSummaryPanelProps {
  auditId: string;
}

const PHASE_LABEL: Record<ClinicalTrialPhase, string> = {
  PHASE_1: 'Phase 1',
  PHASE_1_2: 'Phase 1/2',
  PHASE_2: 'Phase 2',
  PHASE_2_3: 'Phase 2/3',
  PHASE_3: 'Phase 3',
  PHASE_4: 'Phase 4',
  NOT_APPLICABLE: 'N/A',
};

export default function RiskSummaryPanel({ auditId }: RiskSummaryPanelProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  // Mock store — keyed by audit id, mutated locally on save/approve. Phase B
  // replaces with Supabase queries. We keep a single state tree across audit
  // switches so edits persist within a session.
  const [summaries, setSummaries] = useState<Record<string, MockRiskSummary | null>>(
    () => ({ ...MOCK_RISK_SUMMARIES }),
  );
  const summary = summaries[auditId] ?? null;

  const [editing, setEditing] = useState(false);
  const [draftNarrative, setDraftNarrative] = useState(summary?.vendor_relevance_narrative ?? '');
  const [draftFocusAreas, setDraftFocusAreas] = useState(
    (summary?.focus_areas ?? []).join(', '),
  );
  const [confirmingApprove, setConfirmingApprove] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Reset editing state when the active audit changes.
  useEffect(() => {
    setEditing(false);
    setConfirmingApprove(false);
    setDraftNarrative(summary?.vendor_relevance_narrative ?? '');
    setDraftFocusAreas((summary?.focus_areas ?? []).join(', '));
    // intentionally only reset on auditId change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auditId]);

  // ---------------------------------------------------------------------------
  // Theme tokens
  // ---------------------------------------------------------------------------
  const panelBg = isLight ? 'bg-[#f9fafc] border-[#e2e8ee]' : 'bg-[#0e141b] border-white/5';
  const cardBg = isLight ? 'bg-white border-[#e2e8ee]' : 'bg-[#131a22] border-white/5';
  const headingColor = isLight ? 'text-[#1a1f28]' : 'text-white';
  const subColor = isLight ? 'text-[#374152]/55' : 'text-[#d2d7e0]/45';
  const mutedColor = isLight ? 'text-[#374152]/40' : 'text-[#d2d7e0]/35';
  const sectionHeader = isLight ? 'text-[#374152]/45' : 'text-[#d2d7e0]/40';
  const inputBorder = isLight ? 'border-[#cbd2db] focus:border-[#4a6fa5]' : 'border-white/15 focus:border-[#6e8fb5]';
  const inputBg = isLight ? 'bg-white' : 'bg-[#131a22]';
  const buttonPrimary = isLight
    ? 'bg-[#4a6fa5] text-white hover:bg-[#3d5e8f]'
    : 'bg-[#6e8fb5] text-[#1a1f28] hover:bg-[#5e7fa5]';
  const buttonSecondary = isLight
    ? 'bg-white border border-[#e2e8ee] text-[#374152] hover:bg-[#f5f7fa]'
    : 'bg-[#131a22] border border-white/10 text-[#d2d7e0] hover:bg-white/[0.04]';
  const buttonApprove = isLight
    ? 'bg-emerald-600 text-white hover:bg-emerald-700'
    : 'bg-emerald-500 text-[#0d1118] hover:bg-emerald-400';

  // ---------------------------------------------------------------------------
  // Actions (mock — Phase B replaces with supabase.rpc calls)
  // ---------------------------------------------------------------------------
  const generateStub = () => {
    const stub: MockRiskSummary = {
      id: `rs-${auditId}-${Date.now()}`,
      audit_id: auditId,
      study_context: {
        therapeutic_space: 'TBD — capture from protocol',
        primary_endpoints: [],
        secondary_endpoints: [],
        clinical_trial_phase: 'NOT_APPLICABLE',
        captured_at: new Date().toISOString(),
      },
      vendor_relevance_narrative:
        'Stub generated from study context, mapped protocol risks, and vendor service category. Edit this paragraph down to your judgment of why this vendor matters in the context of this study.',
      focus_areas: [],
      approval_status: 'DRAFT',
      approved_at: null,
      approved_by_name: null,
      protocol_risk_refs: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    setSummaries((prev) => ({ ...prev, [auditId]: stub }));
    setDraftNarrative(stub.vendor_relevance_narrative);
    setDraftFocusAreas('');
  };

  const saveEdits = () => {
    if (!summary) return;
    const focusAreas = parseFocusAreas(draftFocusAreas);
    const updated: MockRiskSummary = {
      ...summary,
      vendor_relevance_narrative: draftNarrative,
      focus_areas: focusAreas,
      // Editing demotes to DRAFT — re-approval required.
      approval_status: 'DRAFT',
      approved_at: null,
      approved_by_name: null,
      updated_at: new Date().toISOString(),
    };
    setSummaries((prev) => ({ ...prev, [auditId]: updated }));
    setEditing(false);
  };

  const cancelEdit = () => {
    if (!summary) return;
    setDraftNarrative(summary.vendor_relevance_narrative);
    setDraftFocusAreas(summary.focus_areas.join(', '));
    setEditing(false);
  };

  const approve = () => {
    if (!summary) return;
    const updated: MockRiskSummary = {
      ...summary,
      approval_status: 'APPROVED',
      approved_at: new Date().toISOString(),
      approved_by_name: 'You', // Phase B reads user_profiles.name
      updated_at: new Date().toISOString(),
    };
    setSummaries((prev) => ({ ...prev, [auditId]: updated }));
    setConfirmingApprove(false);
  };

  const beginEdit = () => {
    if (!summary) return;
    setDraftNarrative(summary.vendor_relevance_narrative);
    setDraftFocusAreas(summary.focus_areas.join(', '));
    setEditing(true);
    setConfirmingApprove(false);
  };

  const approved = summary?.approval_status === 'APPROVED';

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <aside
      aria-label="Vendor risk summary"
      className={`${panelBg} border-l flex-shrink-0 w-80 hidden xl:flex flex-col overflow-hidden`}
    >
      {/* Header */}
      <div className={`px-5 pt-5 pb-3 border-b ${isLight ? 'border-[#e2e8ee]' : 'border-white/5'} flex-shrink-0`}>
        <p className={`text-[10px] uppercase tracking-wider font-semibold ${sectionHeader}`}>
          Vendor risk summary
        </p>
        <div className="flex items-center gap-2 mt-1">
          <p className={`${headingColor} text-sm font-semibold`}>Why this vendor matters</p>
          {summary && (
            <span
              className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-semibold uppercase tracking-wider ${
                approved
                  ? isLight
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                    : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                  : isLight
                  ? 'bg-amber-50 border-amber-200 text-amber-700'
                  : 'bg-amber-500/15 border-amber-500/30 text-amber-400'
              }`}
            >
              {approved ? 'Approved' : 'Draft'}
            </span>
          )}
        </div>
        {summary?.approved_at && (
          <p className={`${mutedColor} text-[11px] mt-1`}>
            Approved {formatTimestamp(summary.approved_at)}
            {summary.approved_by_name ? ` · ${summary.approved_by_name}` : ''}
          </p>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {!summary ? (
          <EmptyState
            isLight={isLight}
            cardBg={cardBg}
            subColor={subColor}
            buttonPrimary={buttonPrimary}
            onGenerate={generateStub}
          />
        ) : (
          <>
            {/* Study context snapshot */}
            <Section sectionHeader={sectionHeader} title="Study context">
              <dl className="space-y-1">
                <Row
                  label="Phase"
                  value={PHASE_LABEL[summary.study_context.clinical_trial_phase]}
                  subColor={subColor}
                  headingColor={headingColor}
                />
                <Row
                  label="Therapeutic"
                  value={summary.study_context.therapeutic_space || '—'}
                  subColor={subColor}
                  headingColor={headingColor}
                />
                <Row
                  label="Primary"
                  value={
                    summary.study_context.primary_endpoints.length > 0
                      ? summary.study_context.primary_endpoints.join('; ')
                      : '—'
                  }
                  subColor={subColor}
                  headingColor={headingColor}
                />
                <Row
                  label="Secondary"
                  value={
                    summary.study_context.secondary_endpoints.length > 0
                      ? summary.study_context.secondary_endpoints.join('; ')
                      : '—'
                  }
                  subColor={subColor}
                  headingColor={headingColor}
                />
              </dl>
              <p className={`${mutedColor} text-[10px] mt-2 leading-relaxed`}>
                Snapshot {formatDate(summary.study_context.captured_at)} — frozen across protocol amendments.
              </p>
            </Section>

            {/* Vendor relevance narrative */}
            <Section sectionHeader={sectionHeader} title="Vendor relevance narrative">
              {editing ? (
                <textarea
                  value={draftNarrative}
                  onChange={(e) => setDraftNarrative(e.target.value)}
                  rows={8}
                  className={`w-full rounded-md border px-2.5 py-2 text-xs ${inputBg} ${inputBorder} ${headingColor} focus:outline-none transition-colors`}
                  placeholder="Why does this vendor matter for this study?"
                />
              ) : (
                <p className={`text-xs leading-relaxed whitespace-pre-wrap ${headingColor}`}>
                  {summary.vendor_relevance_narrative}
                </p>
              )}
            </Section>

            {/* Focus areas */}
            <Section sectionHeader={sectionHeader} title="Focus areas">
              {editing ? (
                <input
                  type="text"
                  value={draftFocusAreas}
                  onChange={(e) => setDraftFocusAreas(e.target.value)}
                  placeholder="Comma-separated"
                  className={`w-full rounded-md border px-2.5 py-1.5 text-xs ${inputBg} ${inputBorder} ${headingColor} focus:outline-none transition-colors`}
                />
              ) : summary.focus_areas.length === 0 ? (
                <p className={`text-xs italic ${mutedColor}`}>None specified</p>
              ) : (
                <ul className="space-y-1">
                  {summary.focus_areas.map((f) => (
                    <li key={f} className={`text-xs flex items-start gap-2 ${headingColor}`}>
                      <span
                        className={`mt-1.5 w-1 h-1 rounded-full flex-shrink-0 ${
                          isLight ? 'bg-[#4a6fa5]/55' : 'bg-[#6e8fb5]/55'
                        }`}
                      />
                      {f}
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            {/* Linked protocol risks */}
            <Section sectionHeader={sectionHeader} title="Linked protocol risks">
              {summary.protocol_risk_refs.length === 0 ? (
                <p className={`text-xs italic ${mutedColor}`}>No protocol risks linked</p>
              ) : (
                <ul className="space-y-1.5">
                  {summary.protocol_risk_refs.map((r) => (
                    <li key={r.id} className="text-xs leading-relaxed">
                      <span className={`font-semibold ${headingColor}`}>{r.section_identifier}</span>
                      <span className={subColor}> — {r.section_title}</span>
                      <span className={`${mutedColor} block text-[10px] mt-0.5`}>
                        {r.operational_domain_tag.replace(/_/g, ' ')}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </>
        )}
      </div>

      {/* Footer actions */}
      {summary && (
        <div className={`px-5 py-3 border-t ${isLight ? 'border-[#e2e8ee]' : 'border-white/5'} flex-shrink-0 space-y-2`}>
          {confirmingApprove && (
            <div
              className={`rounded-md border px-2.5 py-2 ${
                isLight
                  ? 'bg-emerald-50 border-emerald-200/80'
                  : 'bg-emerald-500/[0.06] border-emerald-500/15'
              }`}
            >
              <p className={`text-[11px] mb-2 leading-relaxed ${isLight ? 'text-emerald-700' : 'text-emerald-300'}`}>
                Approve this risk summary? Edits after approval revert it to Draft and require re-approval before advancing.
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={approve}
                  className={`text-xs font-semibold px-2.5 py-1.5 rounded-md transition-colors ${buttonApprove}`}
                >
                  Confirm
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingApprove(false)}
                  className={`text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors ${buttonSecondary}`}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {!editing && !confirmingApprove && (
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={beginEdit}
                className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors ${buttonSecondary}`}
              >
                <Pencil size={12} />
                Edit
              </button>
              {!approved && (
                <button
                  type="button"
                  onClick={() => setConfirmingApprove(true)}
                  disabled={!summary.vendor_relevance_narrative.trim()}
                  className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md transition-colors ${buttonApprove} disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  <CheckCircle2 size={12} />
                  Approve
                </button>
              )}
              <button
                type="button"
                onClick={() => setHistoryOpen(true)}
                className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md ml-auto transition-colors ${buttonSecondary}`}
                title="View change history"
              >
                <HistoryIcon size={12} />
                History
              </button>
            </div>
          )}

          {editing && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={saveEdits}
                disabled={!draftNarrative.trim()}
                className={`text-xs font-semibold px-2.5 py-1.5 rounded-md transition-colors ${buttonPrimary} disabled:opacity-50`}
              >
                Save
              </button>
              <button
                type="button"
                onClick={cancelEdit}
                className={`text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors ${buttonSecondary}`}
              >
                Cancel
              </button>
              {approved && (
                <span className={`text-[10px] ${mutedColor}`}>Saving demotes to Draft.</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* History drawer (Phase A stub — Phase B wires getObjectHistory) */}
      {historyOpen && (
        <HistoryDrawerStub
          isLight={isLight}
          onClose={() => setHistoryOpen(false)}
        />
      )}
    </aside>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

interface EmptyStateProps {
  isLight: boolean;
  cardBg: string;
  subColor: string;
  buttonPrimary: string;
  onGenerate: () => void;
}

function EmptyState({ isLight, cardBg, subColor, buttonPrimary, onGenerate }: EmptyStateProps) {
  const iconBg = isLight
    ? 'bg-[#4a6fa5]/10 border-[#4a6fa5]/20 text-[#4a6fa5]'
    : 'bg-[#4a6fa5]/15 border-[#4a6fa5]/30 text-[#6e8fb5]';
  return (
    <div className={`${cardBg} border rounded-lg p-4`}>
      <div className={`inline-flex items-center justify-center w-9 h-9 rounded-xl border mb-3 ${iconBg}`}>
        <Sparkles size={14} />
      </div>
      <p className={`${subColor} text-xs leading-relaxed mb-3`}>
        No risk summary yet. Generate a stub from the audit's study context, mapped
        protocol risks, and vendor service category — then edit it down.
      </p>
      <button
        type="button"
        onClick={onGenerate}
        className={`text-xs font-semibold px-3 py-1.5 rounded-md transition-colors ${buttonPrimary}`}
      >
        Generate stub
      </button>
    </div>
  );
}

interface RowProps {
  label: string;
  value: string;
  subColor: string;
  headingColor: string;
}

function Row({ label, value, subColor, headingColor }: RowProps) {
  return (
    <div className="flex gap-2 text-xs leading-snug">
      <dt className={`${subColor} flex-shrink-0 w-20`}>{label}</dt>
      <dd className={`${headingColor} m-0 flex-1 break-words`}>{value}</dd>
    </div>
  );
}

interface SectionProps {
  title: string;
  sectionHeader: string;
  children: React.ReactNode;
}

function Section({ title, sectionHeader, children }: SectionProps) {
  return (
    <section className="mb-5">
      <h4 className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold mb-2`}>
        {title}
      </h4>
      {children}
    </section>
  );
}

function HistoryDrawerStub({ isLight, onClose }: { isLight: boolean; onClose: () => void }) {
  const overlay = isLight ? 'bg-black/30' : 'bg-black/50';
  const panelBg = isLight ? 'bg-white border-[#e2e8ee]' : 'bg-[#131a22] border-white/5';
  const headingColor = isLight ? 'text-[#1a1f28]' : 'text-white';
  const subColor = isLight ? 'text-[#374152]/55' : 'text-[#d2d7e0]/45';
  const mutedColor = isLight ? 'text-[#374152]/40' : 'text-[#d2d7e0]/35';

  return (
    <div className={`fixed inset-0 z-50 ${overlay} flex justify-end`} onClick={onClose}>
      <div
        className={`w-full max-w-md h-full ${panelBg} border-l shadow-xl flex flex-col`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`flex items-center justify-between px-5 py-4 border-b ${isLight ? 'border-[#e2e8ee]' : 'border-white/5'}`}>
          <div>
            <p className={`text-[11px] uppercase tracking-wider font-semibold ${subColor}`}>
              Change history
            </p>
            <h3 className={`${headingColor} font-semibold text-base mt-0.5`}>Risk summary</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={`${subColor} hover:opacity-75`}
            aria-label="Close history"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          <p className={`${mutedColor} text-sm italic`}>
            History panel will surface state-delta entries from{' '}
            <code className="font-mono">audit_mode_get_object_history</code> once Phase B
            wires it. For now, stage transitions, edits, and approvals will appear here
            with timestamps and actor names.
          </p>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function parseFocusAreas(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
