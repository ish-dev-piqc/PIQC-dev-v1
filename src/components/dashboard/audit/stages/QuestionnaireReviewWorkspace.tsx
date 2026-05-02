import { useEffect, useMemo, useState } from 'react';
import {
  Sparkles,
  Send,
  CheckCircle2,
  RotateCcw,
  Globe,
  PenLine,
  X,
  Download,
  History as HistoryIcon,
} from 'lucide-react';
import { useTheme } from '../../../../context/ThemeContext';
import { useAudit } from '../../../../context/AuditContext';
import { useAuditData } from '../../../../context/AuditDataContext';
import {
  TEMPLATE_QUESTIONS,
  type MockQuestion,
  type MockQuestionnaireBundle,
  type MockResponse,
} from '../../../../lib/audit/mockQuestionnaire';
import {
  QUESTIONNAIRE_INSTANCE_STATUS_LABELS,
  QUESTIONNAIRE_INSTANCE_STATUS_ORDER,
  QUESTION_ANSWER_TYPE_LABELS,
} from '../../../../lib/audit/labels';
import type {
  QuestionAnswerType,
  QuestionnaireInstanceStatus,
  ResponseSource,
} from '../../../../types/audit';
import HistoryDrawer from '../HistoryDrawer';

// =============================================================================
// QuestionnaireReviewWorkspace — QUESTIONNAIRE_REVIEW stage center pane.
//
// Phase B mock-backed port. Auditor flows:
//   1. Pre-fill responses from public web research (per question)
//   2. Generate addenda (5.3.x) from vendor service mappings
//   3. Mark ready → Sent → Vendor responded → Complete (linear lifecycle)
//   4. Approve at the end (gates downstream stages per D-010)
// =============================================================================

const SOURCE_TONES: Record<
  ResponseSource,
  { light: string; dark: string; label: string }
> = {
  PENDING: {
    light: 'bg-[#eef2f6] border-[#cbd2db] text-[#374152]/65',
    dark: 'bg-white/[0.06] border-white/10 text-[#d2d7e0]/55',
    label: 'Pending',
  },
  AUDITOR_PREFILL_WEB: {
    light: 'bg-[#4a6fa5]/10 border-[#4a6fa5]/25 text-[#4a6fa5]',
    dark: 'bg-[#6e8fb5]/15 border-[#6e8fb5]/30 text-[#6e8fb5]',
    label: 'Web pre-fill',
  },
  AUDITOR_PREFILL_PRIOR_AUDIT: {
    light: 'bg-[#4a6fa5]/10 border-[#4a6fa5]/25 text-[#4a6fa5]',
    dark: 'bg-[#6e8fb5]/15 border-[#6e8fb5]/30 text-[#6e8fb5]',
    label: 'Prior audit',
  },
  AUDITOR_AUTHORED: {
    light: 'bg-amber-50 border-amber-200 text-amber-700',
    dark: 'bg-amber-500/15 border-amber-500/30 text-amber-300',
    label: 'Auditor',
  },
  VENDOR: {
    light: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    dark: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300',
    label: 'Vendor',
  },
  NOT_APPLICABLE: {
    light: 'bg-[#eef2f6] border-[#cbd2db] text-[#374152]/55',
    dark: 'bg-white/[0.06] border-white/10 text-[#d2d7e0]/45',
    label: 'N/A',
  },
};

export default function QuestionnaireReviewWorkspace() {
  const { theme } = useTheme();
  const { activeAudit } = useAudit();
  const isLight = theme === 'light';

  // Shared store across stages — Scope Review's gate reads from here.
  const { questionnaires: bundles, setQuestionnaires: setBundles } = useAuditData();
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    // No-op for now; would reset edit state if any local-only flags existed.
  }, [activeAudit?.id]);

  // Derived values — computed before early returns so hooks below stay unconditional.
  const auditId = activeAudit?.id ?? null;
  const bundle = auditId ? bundles[auditId] ?? null : null;

  // ---------------------------------------------------------------------------
  // Counts + grouping (must run unconditionally — hooks rules)
  // ---------------------------------------------------------------------------
  const counts = useMemo(() => {
    if (!bundle) return { pending: 0, prefilled: 0, vendor: 0, na: 0, total: 0 };
    let pending = 0;
    let prefilled = 0;
    let vendor = 0;
    let na = 0;
    for (const q of bundle.questions) {
      const r = bundle.responses[q.id];
      const s = r?.source ?? 'PENDING';
      if (s === 'PENDING') pending++;
      else if (s === 'VENDOR') vendor++;
      else if (s === 'NOT_APPLICABLE') na++;
      else prefilled++;
    }
    return { pending, prefilled, vendor, na, total: bundle.questions.length };
  }, [bundle]);

  const grouped = useMemo(() => {
    if (!bundle) return [] as { code: string; title: string; items: MockQuestion[] }[];
    const map = new Map<string, { code: string; title: string; items: MockQuestion[] }>();
    const sorted = [...bundle.questions].sort((a, b) => a.ordinal - b.ordinal);
    for (const q of sorted) {
      const key = `${q.section_code}|${q.section_title}`;
      if (!map.has(key)) map.set(key, { code: q.section_code, title: q.section_title, items: [] });
      map.get(key)!.items.push(q);
    }
    return Array.from(map.values());
  }, [bundle]);

  if (!activeAudit || !auditId) return null;

  // ---------------------------------------------------------------------------
  // Theme tokens
  // ---------------------------------------------------------------------------
  const headingColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';
  const mutedColor = 'text-fg-muted';
  const sectionHeader = 'text-fg-label';
  const cardBg = isLight ? 'bg-white border-[#e2e8ee]' : 'bg-[#131a22] border-white/5';
  const buttonPrimary = isLight
    ? 'bg-[#4a6fa5] text-white hover:bg-[#3d5e8f]'
    : 'bg-[#6e8fb5] text-[#1a1f28] hover:bg-[#5e7fa5]';
  const buttonSecondary = isLight
    ? 'bg-white border border-[#e2e8ee] text-[#374152] hover:bg-[#f5f7fa]'
    : 'bg-[#131a22] border border-white/10 text-[#d2d7e0] hover:bg-white/[0.04]';

  // ---------------------------------------------------------------------------
  // Empty state — create instance
  // ---------------------------------------------------------------------------
  const createInstance = () => {
    const newBundle: MockQuestionnaireBundle = {
      instance: {
        id: `qi-${auditId}-${Date.now()}`,
        audit_id: auditId,
        status: 'DRAFT',
        vendor_contact_name: null,
        vendor_contact_email: null,
        vendor_contact_title: null,
        addenda_generated_at: null,
        sent_to_vendor_at: null,
        vendor_responded_at: null,
        completed_at: null,
        approved_at: null,
        approved_by_name: null,
      },
      questions: [...TEMPLATE_QUESTIONS],
      responses: {},
    };
    setBundles((prev) => ({ ...prev, [auditId]: newBundle }));
  };

  if (!bundle) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div>
          <p className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold`}>
            Stage 3 · Questionnaire review
          </p>
          <h2 className={`${headingColor} text-xl font-semibold mt-1`}>
            No questionnaire yet
          </h2>
          <p className={`${subColor} text-sm mt-1.5 leading-relaxed max-w-2xl`}>
            Create the questionnaire instance for this audit to begin pre-fill from public
            sources. Service-specific addenda (section 5.3) generate from your vendor service
            mappings — make sure those are in place first.
          </p>
        </div>
        <button
          type="button"
          onClick={createInstance}
          className={`mt-5 inline-flex items-center gap-2 text-sm font-semibold px-3.5 py-2 rounded-md transition-colors ${buttonPrimary}`}
        >
          <Sparkles size={14} />
          Create questionnaire instance
        </button>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Lifecycle transition (only Phase B mock — no validation)
  // ---------------------------------------------------------------------------
  const transitionStatus = (toStatus: QuestionnaireInstanceStatus) => {
    setBundles((prev) => {
      const cur = prev[auditId];
      if (!cur) return prev;
      const now = new Date().toISOString();
      const updated: MockQuestionnaireBundle = {
        ...cur,
        instance: {
          ...cur.instance,
          status: toStatus,
          sent_to_vendor_at:
            toStatus === 'SENT_TO_VENDOR' ? now : cur.instance.sent_to_vendor_at,
          vendor_responded_at:
            toStatus === 'VENDOR_RESPONDED' ? now : cur.instance.vendor_responded_at,
          completed_at: toStatus === 'COMPLETE' ? now : cur.instance.completed_at,
        },
      };
      return { ...prev, [auditId]: updated };
    });
  };

  const approve = () => {
    setBundles((prev) => {
      const cur = prev[auditId];
      if (!cur) return prev;
      const updated: MockQuestionnaireBundle = {
        ...cur,
        instance: {
          ...cur.instance,
          approved_at: new Date().toISOString(),
          approved_by_name: 'You',
        },
      };
      return { ...prev, [auditId]: updated };
    });
  };

  const generateAddenda = () => {
    // Mock — in real wire, this calls an RPC that reads vendor_service_mapping_objects.
    setBundles((prev) => {
      const cur = prev[auditId];
      if (!cur) return prev;
      // If addenda were already generated, no-op the question list change.
      const hasAddenda = cur.questions.some((q) => q.origin === 'ADDENDUM');
      const updated: MockQuestionnaireBundle = {
        ...cur,
        instance: { ...cur.instance, addenda_generated_at: new Date().toISOString() },
        questions: hasAddenda
          ? cur.questions
          : [
              ...cur.questions,
              {
                id: `aq-${auditId}-mock-1`,
                origin: 'ADDENDUM',
                question_number: '5.3.1',
                section_code: '5.3',
                section_title: 'Service-specific addenda',
                prompt:
                  'Generated from vendor service mappings. Edit this with content specific to your contracted services.',
                answer_type: 'NARRATIVE',
                evidence_expected: false,
                domain_tag: null,
                ordinal: 100,
              },
            ],
      };
      return { ...prev, [auditId]: updated };
    });
  };

  // ---------------------------------------------------------------------------
  // Per-question response mutation
  // ---------------------------------------------------------------------------
  const updateResponse = (questionId: string, patch: Partial<MockResponse>) => {
    setBundles((prev) => {
      const cur = prev[auditId];
      if (!cur) return prev;
      const existing = cur.responses[questionId];
      const next: MockResponse = existing
        ? { ...existing, ...patch }
        : {
            id: `qr-${auditId}-${Date.now()}`,
            instance_id: cur.instance.id,
            question_id: questionId,
            response_text: patch.response_text ?? null,
            response_status: patch.response_status ?? 'UNANSWERED',
            source: patch.source ?? 'PENDING',
            source_reference: patch.source_reference ?? null,
            inconsistency_flag: patch.inconsistency_flag ?? false,
            inconsistency_note: patch.inconsistency_note ?? null,
          };
      return {
        ...prev,
        [auditId]: { ...cur, responses: { ...cur.responses, [questionId]: next } },
      };
    });
  };

  const approved = !!bundle.instance.approved_at;
  const isComplete = bundle.instance.status === 'COMPLETE';
  const readOnly = approved;
  const currentStatusIdx = QUESTIONNAIRE_INSTANCE_STATUS_ORDER.indexOf(bundle.instance.status);
  const nextStatus = QUESTIONNAIRE_INSTANCE_STATUS_ORDER[currentStatusIdx + 1];

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <p className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold`}>
          Stage 3 · Questionnaire review
        </p>
        <h2 className={`${headingColor} text-xl font-semibold mt-1`}>
          Vendor questionnaire
        </h2>
        <p className={`${subColor} text-sm mt-1.5 leading-relaxed max-w-2xl`}>
          Pre-fill from public research, generate service-specific addenda, send to vendor for
          the remaining items, then review and approve.
        </p>
      </div>

      {/* Lifecycle stepper + counts */}
      <div className={`${cardBg} border rounded-xl p-5 space-y-4`}>
        <LifecycleStepper status={bundle.instance.status} isLight={isLight} />

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 text-xs flex-wrap">
            <span className={`${headingColor} font-semibold`}>{counts.total} questions</span>
            <span className={mutedColor}>·</span>
            <span className={mutedColor}>Pending: <span className={headingColor}>{counts.pending}</span></span>
            <span className={mutedColor}>·</span>
            <span className={mutedColor}>Pre-filled: <span className={headingColor}>{counts.prefilled}</span></span>
            <span className={mutedColor}>·</span>
            <span className={mutedColor}>Vendor: <span className={headingColor}>{counts.vendor}</span></span>
            <span className={mutedColor}>·</span>
            <span className={mutedColor}>N/A: <span className={headingColor}>{counts.na}</span></span>
          </div>
          <div className="flex items-center gap-2">
            {nextStatus && !readOnly && (
              <button
                type="button"
                onClick={() => transitionStatus(nextStatus)}
                className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md transition-colors ${buttonPrimary}`}
                title={`Advance to ${QUESTIONNAIRE_INSTANCE_STATUS_LABELS[nextStatus]}`}
              >
                <Send size={12} />
                Advance to {QUESTIONNAIRE_INSTANCE_STATUS_LABELS[nextStatus]}
              </button>
            )}
            <button
              type="button"
              className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors ${buttonSecondary}`}
              title="Export draft (Phase B wires real markdown export)"
            >
              <Download size={12} />
              Export draft
            </button>
            <button
              type="button"
              className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors ${buttonSecondary}`}
              title="Change history"
              onClick={() => setHistoryOpen(true)}
            >
              <HistoryIcon size={12} />
              History
            </button>
          </div>
        </div>

        {/* Vendor contact info — informational */}
        {bundle.instance.vendor_contact_name && (
          <div className={`text-xs ${subColor} flex items-center gap-2 flex-wrap`}>
            <span className={`${mutedColor} uppercase tracking-wider font-semibold text-[10px]`}>
              Vendor contact
            </span>
            <span className={headingColor}>{bundle.instance.vendor_contact_name}</span>
            {bundle.instance.vendor_contact_title && <span>· {bundle.instance.vendor_contact_title}</span>}
            {bundle.instance.vendor_contact_email && (
              <span className={mutedColor}>· {bundle.instance.vendor_contact_email}</span>
            )}
          </div>
        )}
      </div>

      {/* Addenda generation */}
      <div className={`${cardBg} border rounded-xl p-5`}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <p className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold`}>
              Section 5.3 — Service-specific addenda
            </p>
            <p className={`${subColor} text-xs mt-1 leading-relaxed`}>
              Generates from this audit's vendor service mappings. Add or update mappings in
              Vendor Enrichment first, then generate here.
            </p>
            {bundle.instance.addenda_generated_at && (
              <p className={`${mutedColor} text-[11px] mt-1`}>
                Last generated {formatTimestamp(bundle.instance.addenda_generated_at)}
              </p>
            )}
          </div>
          {!readOnly && (
            <button
              type="button"
              onClick={generateAddenda}
              className={`flex-shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md transition-colors ${buttonPrimary}`}
            >
              <Sparkles size={12} />
              {bundle.instance.addenda_generated_at ? 'Regenerate' : 'Generate addenda'}
            </button>
          )}
        </div>
      </div>

      {/* Questions, grouped by section */}
      {grouped.map((group) => (
        <section key={group.code} className="space-y-3">
          <h3 className={`${headingColor} text-sm font-semibold border-b ${isLight ? 'border-[#e2e8ee]' : 'border-white/5'} pb-1.5`}>
            <span className={mutedColor}>{group.code}</span>{' '}— {group.title}
          </h3>
          <div className="space-y-2">
            {group.items.map((q) => (
              <QuestionRow
                key={q.id}
                question={q}
                response={bundle.responses[q.id]}
                onUpdate={(patch) => updateResponse(q.id, patch)}
                isLight={isLight}
                readOnly={readOnly}
              />
            ))}
          </div>
        </section>
      ))}

      {/* Footer — approval gate */}
      <div className={`${cardBg} border rounded-xl p-5`}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <p className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold`}>
              Approval
            </p>
            <p className={`${headingColor} text-sm font-semibold mt-1`}>
              {approved ? 'Approved' : 'Awaiting approval'}
            </p>
            {approved && bundle.instance.approved_at && (
              <p className={`${subColor} text-xs mt-1`}>
                Approved {formatTimestamp(bundle.instance.approved_at)}
                {bundle.instance.approved_by_name ? ` · ${bundle.instance.approved_by_name}` : ''}
              </p>
            )}
            {!approved && (
              <p className={`${subColor} text-xs mt-1 leading-relaxed`}>
                Approving the questionnaire seals it as the source of truth for downstream
                drafting. Editing after approval reverts to Draft.
              </p>
            )}
          </div>
          {!approved && isComplete && (
            <button
              type="button"
              onClick={approve}
              className={`inline-flex items-center gap-1.5 text-sm font-semibold px-3.5 py-2 rounded-md transition-colors ${
                isLight ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-emerald-500 text-[#0d1118] hover:bg-emerald-400'
              }`}
            >
              <CheckCircle2 size={14} />
              Approve questionnaire
            </button>
          )}
          {!approved && !isComplete && (
            <span className={`${mutedColor} text-xs italic`}>
              Approval available once status reaches Complete.
            </span>
          )}
        </div>
      </div>

      {historyOpen && bundle && (
        <HistoryDrawer
          objectType="QUESTIONNAIRE_INSTANCE"
          objectId={bundle.instance.id}
          title="Questionnaire"
          onClose={() => setHistoryOpen(false)}
        />
      )}
    </div>
  );
}

// ============================================================================
// Lifecycle stepper
// ============================================================================

interface LifecycleStepperProps {
  status: QuestionnaireInstanceStatus;
  isLight: boolean;
}

function LifecycleStepper({ status, isLight }: LifecycleStepperProps) {
  const idx = QUESTIONNAIRE_INSTANCE_STATUS_ORDER.indexOf(status);
  const sectionHeader = 'text-fg-label';
  return (
    <div>
      <p className={`text-[10px] uppercase tracking-wider font-semibold mb-2 ${sectionHeader}`}>
        Lifecycle
      </p>
      <div className="flex items-center gap-1.5 flex-wrap">
        {QUESTIONNAIRE_INSTANCE_STATUS_ORDER.map((s, i) => {
          const isCurrent = i === idx;
          const isDone = i < idx;
          const isFuture = i > idx;
          const tone = isCurrent
            ? isLight
              ? 'bg-[#4a6fa5] text-white border-[#4a6fa5]'
              : 'bg-[#6e8fb5] text-[#1a1f28] border-[#6e8fb5]'
            : isDone
            ? isLight
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
              : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
            : isFuture
            ? isLight
              ? 'bg-white text-[#374152]/45 border-[#e2e8ee]'
              : 'bg-[#131a22] text-[#d2d7e0]/35 border-white/10'
            : '';
          return (
            <span
              key={s}
              className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-1 rounded-md border ${tone}`}
            >
              {isDone && <CheckCircle2 size={10} />}
              {QUESTIONNAIRE_INSTANCE_STATUS_LABELS[s]}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// QuestionRow
// ============================================================================

interface QuestionRowProps {
  question: MockQuestion;
  response: MockResponse | undefined;
  onUpdate: (patch: Partial<MockResponse>) => void;
  isLight: boolean;
  readOnly: boolean;
}

function QuestionRow({ question, response, onUpdate, isLight, readOnly }: QuestionRowProps) {
  const source: ResponseSource = response?.source ?? 'PENDING';
  const [draft, setDraft] = useState(response?.response_text ?? '');
  const [sourceRef, setSourceRef] = useState(response?.source_reference ?? '');
  const [editing, setEditing] = useState(false);

  // Reset draft if the underlying response changes and we're not actively editing
  useEffect(() => {
    if (!editing) {
      setDraft(response?.response_text ?? '');
      setSourceRef(response?.source_reference ?? '');
    }
  }, [response?.response_text, response?.source_reference, editing]);

  const headingColor = 'text-fg-heading';
  const mutedColor = 'text-fg-muted';
  const cardBg = isLight ? 'bg-white border-[#e2e8ee]' : 'bg-[#131a22] border-white/5';
  const inputBg = isLight ? 'bg-white' : 'bg-[#131a22]';
  const inputBorder = isLight
    ? 'border-[#cbd2db] focus:border-[#4a6fa5] focus:ring-1 focus:ring-[#4a6fa5]/30'
    : 'border-white/15 focus:border-[#6e8fb5] focus:ring-1 focus:ring-[#6e8fb5]/30';
  const buttonSecondary = isLight
    ? 'bg-white border border-[#e2e8ee] text-[#374152] hover:bg-[#f5f7fa]'
    : 'bg-[#131a22] border border-white/10 text-[#d2d7e0] hover:bg-white/[0.04]';
  const buttonGhost = isLight
    ? 'text-[#374152]/55 hover:text-[#1a1f28]'
    : 'text-[#d2d7e0]/55 hover:text-white';

  const sourceTone = SOURCE_TONES[source];
  const sourceClass = isLight ? sourceTone.light : sourceTone.dark;

  const saveAs = (s: ResponseSource) => {
    onUpdate({
      source: s,
      response_text: s === 'NOT_APPLICABLE' ? 'N/A' : draft.trim() || null,
      source_reference: sourceRef.trim() || null,
      response_status:
        s === 'NOT_APPLICABLE'
          ? 'DEFERRED'
          : draft.trim()
          ? 'ANSWERED'
          : 'UNANSWERED',
    });
    setEditing(false);
  };

  const reset = () => {
    onUpdate({
      source: 'PENDING',
      response_text: null,
      source_reference: null,
      response_status: 'UNANSWERED',
    });
    setDraft('');
    setSourceRef('');
    setEditing(false);
  };

  return (
    <div className={`${cardBg} border rounded-lg p-4`}>
      <div className="flex items-start justify-between gap-3 flex-wrap mb-1.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`${mutedColor} text-[11px] font-semibold`}>{question.question_number}</span>
          {question.origin === 'ADDENDUM' && <Tag tone="amber" isLight={isLight}>Addendum</Tag>}
          {question.evidence_expected && <Tag tone="blue" isLight={isLight}>Evidence requested</Tag>}
          <Tag tone="neutral" isLight={isLight}>{labelForType(question.answer_type)}</Tag>
        </div>
        <span
          className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded border ${sourceClass}`}
        >
          {sourceTone.label}
        </span>
      </div>
      <p className={`${headingColor} text-sm mt-1 leading-snug`}>{question.prompt}</p>

      {/* Existing response (read view) */}
      {!editing && response?.response_text && (
        <div className={`mt-3 p-3 rounded-md border ${isLight ? 'bg-[#f9fafc] border-[#eef2f6]' : 'bg-white/[0.02] border-white/[0.04]'}`}>
          <p className={`${headingColor} text-sm whitespace-pre-wrap leading-relaxed`}>
            {response.response_text}
          </p>
          {response.source_reference && (
            <p className={`${mutedColor} text-[11px] mt-2`}>
              Source: {response.source_reference}
            </p>
          )}
        </div>
      )}

      {/* Edit form */}
      {!readOnly && editing && (
        <div className="mt-3 space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Pre-fill from public research, or vendor response"
            rows={3}
            className={`w-full rounded-md border px-2.5 py-1.5 text-sm ${inputBg} ${inputBorder} ${headingColor} focus:outline-none transition-colors`}
          />
          <input
            type="text"
            value={sourceRef}
            onChange={(e) => setSourceRef(e.target.value)}
            placeholder="Source URL or citation (optional)"
            className={`w-full rounded-md border px-2.5 py-1.5 text-xs ${inputBg} ${inputBorder} ${headingColor} focus:outline-none transition-colors`}
          />
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => saveAs('AUDITOR_PREFILL_WEB')}
              disabled={!draft.trim()}
              className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-md transition-colors ${buttonSecondary} disabled:opacity-50`}
            >
              <Globe size={11} />
              Save as web pre-fill
            </button>
            <button
              type="button"
              onClick={() => saveAs('AUDITOR_AUTHORED')}
              disabled={!draft.trim()}
              className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-md transition-colors ${buttonSecondary} disabled:opacity-50`}
            >
              <PenLine size={11} />
              Save as auditor-authored
            </button>
            <button
              type="button"
              onClick={() => saveAs('VENDOR')}
              disabled={!draft.trim()}
              className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-md transition-colors ${buttonSecondary} disabled:opacity-50`}
            >
              Vendor response
            </button>
            <button
              type="button"
              onClick={() => saveAs('NOT_APPLICABLE')}
              className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors ${buttonSecondary}`}
            >
              <X size={11} />
              N/A
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setDraft(response?.response_text ?? '');
                setSourceRef(response?.source_reference ?? '');
              }}
              className={`text-xs font-medium px-2.5 py-1.5 ${buttonGhost}`}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Footer actions when not editing */}
      {!readOnly && !editing && (
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors ${buttonSecondary}`}
          >
            {response?.response_text ? 'Edit response' : 'Add response'}
          </button>
          {response?.response_text && (
            <button
              type="button"
              onClick={reset}
              className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 ${buttonGhost}`}
              title="Reset to pending"
            >
              <RotateCcw size={11} />
              Reset
            </button>
          )}
        </div>
      )}
      {readOnly && !response?.response_text && (
        <p className={`${mutedColor} text-xs italic mt-2`}>No response captured.</p>
      )}
    </div>
  );
}

// ============================================================================
// Tag chip
// ============================================================================

function Tag({
  children,
  tone,
  isLight,
}: {
  children: React.ReactNode;
  tone: 'amber' | 'blue' | 'neutral';
  isLight: boolean;
}) {
  const tones = {
    amber: isLight
      ? 'bg-amber-50 border-amber-200 text-amber-700'
      : 'bg-amber-500/15 border-amber-500/30 text-amber-300',
    blue: isLight
      ? 'bg-[#4a6fa5]/10 border-[#4a6fa5]/25 text-[#4a6fa5]'
      : 'bg-[#6e8fb5]/15 border-[#6e8fb5]/30 text-[#6e8fb5]',
    neutral: isLight
      ? 'bg-[#eef2f6] border-[#cbd2db] text-[#374152]/65'
      : 'bg-white/[0.06] border-white/10 text-[#d2d7e0]/55',
  };
  return (
    <span
      className={`inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded border ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function labelForType(t: QuestionAnswerType): string {
  return QUESTION_ANSWER_TYPE_LABELS[t];
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
