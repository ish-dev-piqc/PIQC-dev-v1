import { useEffect, useRef, useState } from 'react';
import { ArrowRight, BookOpen, NotebookPen, Pencil, Presentation, ThumbsUp, Trash2, X as XIcon } from 'lucide-react';
import { useTheme } from '../../../../../context/ThemeContext';
import { useAudit } from '../../../../../context/AuditContext';
import { ISA_DOMAIN_LABELS } from '../../../../../lib/audit/labels';
import {
  createIsaNote,
  deleteIsaNote,
  fetchIsaNotes,
  updateIsaNote,
} from '../../../../../lib/audit/isaNotesApi';
import {
  createIsaFinding,
  fetchIsaFindings,
  fetchIsaProtocolBridgeStatus,
  requestIsaFindingDrafts,
  searchIsaProtocolChunks,
  updateIsaFinding,
  type IsaFindingDraft,
  type IsaProtocolChunkHit,
} from '../../../../../lib/audit/isaFindingsApi';
import { coverageByDomain, escalationSignals } from '../../../../../lib/audit/isaInsights';
import { formatProtocolRefWhere } from '../../../../../lib/audit/isaReportModel';
import IsaClosingMeetingView from './IsaClosingMeetingView';
import { hasReachedStage } from '../../../../../lib/audit/workflowStages';
import PiqcMark from '../../PiqcMark';
import StagePreviewNotice from '../../StagePreviewNotice';
import type {
  AuditNoteObject,
  IsaDomain,
  IsaFindingObject,
  IsaProtocolRef,
  IsaSeverity,
} from '../../../../../types/audit';

// =============================================================================
// IsaConductWorkspace — ISA_CONDUCT stage center pane: notes pad + finding
// writer.
//
// S1: fast freeform capture (Enter appends; nothing required beyond text).
// S2: "Draft findings" — PIQC clusters the un-promoted notes into draft
// findings (one finding = one root cause) which the auditor reviews in cards
// that show each evidence line SIDE-BY-SIDE with the source notes it cites.
// Nothing persists until Accept (D-008); accepting stamps the cited notes as
// promoted so re-runs only propose new ground.
//
// Draft cards are stashed in localStorage (`piq-isa-drafts-v1:<audit>`) so a
// reload doesn't lose an evening of review to a nondeterministic re-run.
// PHI rule: the pad instructs subject numbers only — bodies go to an LLM.
// =============================================================================

const DOMAIN_OPTIONS = Object.entries(ISA_DOMAIN_LABELS) as [IsaDomain, string][];

const SEVERITY_OPTIONS: IsaSeverity[] = ['CRITICAL', 'MAJOR', 'MINOR', 'RECOMMENDATION'];
const SEVERITY_LABELS: Record<IsaSeverity, string> = {
  CRITICAL: 'Critical',
  MAJOR: 'Major',
  MINOR: 'Minor',
  RECOMMENDATION: 'Recommendation',
};

const DRAFT_STASH_PREFIX = 'piq-isa-drafts-v1:';

/** Draft plus client-side review state. */
interface ReviewDraft extends IsaFindingDraft {
  key: string;
  dirty: boolean;
}

interface DraftStash {
  drafts: ReviewDraft[];
  withheld_count: number;
  stripped_reference_count: number;
  /** Optional: stashes written before S4 don't carry it. */
  stripped_protocol_ref_count?: number;
}

/** Manual-attach quote: the hit's snippet, capped to the ref quote limit. */
function hitToRef(hit: IsaProtocolChunkHit): IsaProtocolRef {
  return {
    chunk_id: hit.chunk_id,
    document_id: hit.document_id,
    quote: hit.snippet.slice(0, 300),
    section_heading: hit.section_heading,
    page_start: hit.page_start,
    page_end: hit.page_end,
  };
}

function noteTimestamp(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return sameDay ? time : `${d.toLocaleDateString([], { day: '2-digit', month: 'short' })} ${time}`;
}

function readStash(auditId: string): DraftStash | null {
  try {
    const raw = localStorage.getItem(DRAFT_STASH_PREFIX + auditId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DraftStash;
    if (!Array.isArray(parsed.drafts)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStash(auditId: string, stash: DraftStash | null) {
  try {
    if (!stash || stash.drafts.length === 0) {
      localStorage.removeItem(DRAFT_STASH_PREFIX + auditId);
    } else {
      localStorage.setItem(DRAFT_STASH_PREFIX + auditId, JSON.stringify(stash));
    }
  } catch {
    // Stash is best-effort crash insurance; never let it break the flow.
  }
}

export default function IsaConductWorkspace() {
  const { theme } = useTheme();
  const { activeAudit } = useAudit();
  const isLight = theme === 'light';

  // One-ahead preview guard (UX2): ISA Stage 5 is viewable from ISA_PREP.
  // Fieldwork notes record what happened on site — capture, edits, agentic
  // drafting, and accepting findings wait until the stage is real.
  const hasReached =
    !!activeAudit &&
    hasReachedStage(activeAudit.workflow_type, activeAudit.current_stage, 'ISA_CONDUCT');

  const [notes, setNotes] = useState<AuditNoteObject[]>([]);
  const [findings, setFindings] = useState<IsaFindingObject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Capture form
  const [body, setBody] = useState('');
  const [domain, setDomain] = useState<IsaDomain | ''>('');
  const [positive, setPositive] = useState(false);
  const [saving, setSaving] = useState(false);
  const captureRef = useRef<HTMLTextAreaElement>(null);

  // Inline edit + two-tap delete (notes)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');
  const [editDomain, setEditDomain] = useState<IsaDomain | ''>('');
  const [editPositive, setEditPositive] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Finding drafts (S2)
  const [drafts, setDrafts] = useState<ReviewDraft[]>([]);
  const [withheldCount, setWithheldCount] = useState(0);
  const [strippedCount, setStrippedCount] = useState(0);
  const [strippedProtoCount, setStrippedProtoCount] = useState(0);
  const [drafting, setDrafting] = useState(false);
  const [draftScope, setDraftScope] = useState<IsaDomain | ''>('');
  const [draftNote, setDraftNote] = useState<string | null>(null);
  const [acceptingKey, setAcceptingKey] = useState<string | null>(null);

  // Protocol-citation bridge (S4). null = status unknown (hide everything,
  // including the nudge — silent until we know); false = no parsed protocol.
  const [bridgeReady, setBridgeReady] = useState<boolean | null>(null);
  const [pickerFor, setPickerFor] = useState<
    { kind: 'draft'; key: string } | { kind: 'finding'; id: string } | null
  >(null);
  const [pickerQuery, setPickerQuery] = useState('');
  const [pickerHits, setPickerHits] = useState<IsaProtocolChunkHit[] | null>(null);
  const [pickerBusy, setPickerBusy] = useState(false);

  // Insights (S2.5)
  const [showClosing, setShowClosing] = useState(false);

  const auditId = activeAudit?.id;

  useEffect(() => {
    if (!auditId) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([fetchIsaNotes(auditId), fetchIsaFindings(auditId)]).then(
      ([notesRes, findingsRes]) => {
        if (cancelled) return;
        if (notesRes.ok) setNotes(notesRes.data);
        if (findingsRes.ok) setFindings(findingsRes.data);
        if (!notesRes.ok || !findingsRes.ok) {
          setError('Some data could not be loaded. Retry by reopening the stage.');
        }
        setLoading(false);
      },
    );
    void fetchIsaProtocolBridgeStatus(auditId).then((res) => {
      if (!cancelled) setBridgeReady(res.ok ? res.data > 0 : false);
    });
    const stash = readStash(auditId);
    if (stash) {
      setDrafts(stash.drafts);
      setWithheldCount(stash.withheld_count);
      setStrippedCount(stash.stripped_reference_count);
      setStrippedProtoCount(stash.stripped_protocol_ref_count ?? 0);
    }
    return () => {
      cancelled = true;
    };
  }, [auditId]);

  // Drop stashed drafts whose cited notes are gone or already promoted — an
  // Accept on them would (rightly) fail the DB evidence gate.
  useEffect(() => {
    if (!auditId || drafts.length === 0 || loading) return;
    const citable = new Set(
      notes.filter((n) => !n.promoted_finding_id).map((n) => n.id),
    );
    const still = drafts.filter((d) =>
      d.evidence.every((e) => e.source_note_ids.every((id) => citable.has(id))),
    );
    if (still.length !== drafts.length) {
      setDrafts(still);
      writeStash(auditId, {
        drafts: still,
        withheld_count: withheldCount,
        stripped_reference_count: strippedCount,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auditId, notes, loading]);

  if (!activeAudit) return null;

  const cardBase = isLight
    ? 'bg-white border-[#E2E8F0]'
    : 'bg-white/[0.02] border-white/10';
  const rowBorder = isLight ? 'border-[#EEF2F6]' : 'border-white/5';
  const inputBase = isLight
    ? 'bg-white border-[#E2E8F0] focus:border-brand-600/50'
    : 'bg-white/[0.03] border-white/10 focus:border-brand-300/50';
  const chipBase = isLight
    ? 'bg-brand-600/[0.07] text-brand-700 border-brand-600/20'
    : 'bg-brand-300/[0.08] text-brand-300 border-brand-300/20';
  const brandText = isLight ? 'text-brand-600' : 'text-brand-300';
  const primaryBtn = isLight
    ? 'bg-brand-600 text-white hover:bg-brand-700'
    : 'bg-brand-300/20 text-brand-300 hover:bg-brand-300/30';

  const severityChip = (s: IsaSeverity) => {
    switch (s) {
      case 'CRITICAL':
        return isLight
          ? 'bg-red-50 text-red-700 border-red-200'
          : 'bg-red-500/10 text-red-300 border-red-500/25';
      case 'MAJOR':
        return isLight
          ? 'bg-amber-50 text-amber-700 border-amber-200'
          : 'bg-amber-500/10 text-amber-300 border-amber-500/25';
      case 'MINOR':
        return isLight
          ? 'bg-sky-50 text-sky-700 border-sky-200'
          : 'bg-sky-500/10 text-sky-300 border-sky-500/25';
      case 'RECOMMENDATION':
        return isLight
          ? 'bg-white text-fg-sub border-[#E2E8F0]'
          : 'bg-white/[0.04] text-fg-sub border-white/10';
    }
  };

  const notesById = new Map(notes.map((n) => [n.id, n]));
  const draftableNotes = notes.filter(
    (n) =>
      !n.is_positive &&
      !n.promoted_finding_id &&
      (draftScope === '' || n.isa_domain === draftScope),
  );

  // S2.5 derivations — pure, zero fetch (isaInsights.ts).
  const coverage = coverageByDomain(notes, findings, DOMAIN_OPTIONS.map(([v]) => v));
  const signals = escalationSignals(findings);

  // -------------------------------------------------------------------------
  // Notes (S1)
  // -------------------------------------------------------------------------

  const submitNote = async () => {
    const trimmed = body.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    const res = await createIsaNote(activeAudit.id, {
      body: trimmed,
      isaDomain: domain || null,
      isPositive: positive,
    });
    setSaving(false);
    if (res.ok) {
      setNotes((prev) => [res.data, ...prev]);
      setBody('');
      setPositive(false);
      // Domain tag is sticky on purpose: auditors review one binder at a
      // time, so consecutive notes usually share a domain.
      setError(null);
      captureRef.current?.focus();
    } else {
      setError('The note was not saved. Copy your text and retry.');
    }
  };

  const startEdit = (n: AuditNoteObject) => {
    setEditingId(n.id);
    setEditBody(n.body);
    setEditDomain(n.isa_domain ?? '');
    setEditPositive(n.is_positive);
    setConfirmDeleteId(null);
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const trimmed = editBody.trim();
    if (!trimmed) return;
    const res = await updateIsaNote(editingId, {
      body: trimmed,
      ...(editDomain ? { isaDomain: editDomain } : { clearIsaDomain: true }),
      isPositive: editPositive,
    });
    if (res.ok) {
      setNotes((prev) => prev.map((n) => (n.id === editingId ? res.data : n)));
      setEditingId(null);
      setError(null);
    } else {
      setError('The edit was not saved. Retry.');
    }
  };

  const removeNote = async (noteId: string) => {
    const res = await deleteIsaNote(noteId);
    if (res.ok) {
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
      setError(null);
    } else {
      setError('The note was not deleted. Retry.');
    }
    setConfirmDeleteId(null);
  };

  // -------------------------------------------------------------------------
  // Finding drafts (S2)
  // -------------------------------------------------------------------------

  const persistDrafts = (
    next: ReviewDraft[],
    withheld = withheldCount,
    stripped = strippedCount,
    strippedProto = strippedProtoCount,
  ) => {
    setDrafts(next);
    writeStash(activeAudit.id, {
      drafts: next,
      withheld_count: withheld,
      stripped_reference_count: stripped,
      stripped_protocol_ref_count: strippedProto,
    });
  };

  const runDrafting = async () => {
    if (drafting || draftableNotes.length === 0) return;
    setDrafting(true);
    setDraftNote(null);
    try {
      const res = await requestIsaFindingDrafts(
        activeAudit.id,
        draftScope === '' ? undefined : draftableNotes.map((n) => n.id),
      );
      const next: ReviewDraft[] = res.drafts.map((d, i) => ({
        ...d,
        key: `${Date.now()}-${i}`,
        dirty: false,
      }));
      setWithheldCount(res.withheld_count);
      setStrippedCount(res.stripped_reference_count);
      setStrippedProtoCount(res.stripped_protocol_ref_count ?? 0);
      persistDrafts(
        next,
        res.withheld_count,
        res.stripped_reference_count,
        res.stripped_protocol_ref_count ?? 0,
      );
      if (next.length === 0) {
        setDraftNote(
          res.withheld_count > 0
            ? 'Every proposal was withheld — none could be traced to your notes. Add detail to the notes and retry.'
            : 'PIQC found nothing to propose from these notes.',
        );
      }
    } catch {
      // Invitational framing — the auditor doesn't need the failure anatomy.
      setDraftNote('Drafting isn’t available right now — your notes are safe. Try again in a moment.');
    }
    setDrafting(false);
  };

  const patchDraft = (key: string, patch: Partial<IsaFindingDraft>) => {
    persistDrafts(
      drafts.map((d) => (d.key === key ? { ...d, ...patch, dirty: true } : d)),
    );
  };

  const dismissDraft = (key: string) => {
    persistDrafts(drafts.filter((d) => d.key !== key));
  };

  const acceptDraft = async (draft: ReviewDraft) => {
    if (acceptingKey) return;
    setAcceptingKey(draft.key);
    const res = await createIsaFinding(activeAudit.id, {
      title: draft.title,
      isaDomain: draft.isa_domain,
      severity: draft.severity,
      observation: draft.observation,
      evidence: draft.evidence,
      origin: draft.dirty ? 'PIQC_EDITED' : 'PIQC_DRAFTED',
      subcategory: draft.subcategory,
      severityRule: draft.severity_rule,
      reference: draft.reference,
      protocolRefs: draft.protocol_ref ? [draft.protocol_ref] : [],
    });
    setAcceptingKey(null);
    if (res.ok) {
      setFindings((prev) => [...prev, res.data]);
      const promoted = new Set(draft.evidence.flatMap((e) => e.source_note_ids));
      setNotes((prev) =>
        prev.map((n) =>
          promoted.has(n.id) ? { ...n, promoted_finding_id: res.data.id } : n,
        ),
      );
      persistDrafts(drafts.filter((d) => d.key !== draft.key));
      setError(null);
    } else {
      setError('The finding was not saved. Its notes may have changed — re-run drafting.');
    }
  };

  // -------------------------------------------------------------------------
  // Protocol-citation bridge (S4) — manual picker: the override affordance.
  // PIQC proposes during drafting; this is how the auditor replaces or adds a
  // citation by searching the protocol's own parsed text.
  // -------------------------------------------------------------------------

  const openPicker = (target: NonNullable<typeof pickerFor>) => {
    setPickerFor(target);
    setPickerQuery('');
    setPickerHits(null);
  };

  const closePicker = () => {
    setPickerFor(null);
    setPickerHits(null);
  };

  const runPickerSearch = async () => {
    if (pickerBusy || pickerQuery.trim().length === 0) return;
    setPickerBusy(true);
    const res = await searchIsaProtocolChunks(activeAudit.id, pickerQuery.trim());
    setPickerHits(res.ok ? res.data : []);
    setPickerBusy(false);
  };

  const attachRef = async (hit: IsaProtocolChunkHit) => {
    if (!pickerFor) return;
    const ref = hitToRef(hit);
    if (pickerFor.kind === 'draft') {
      patchDraft(pickerFor.key, { protocol_ref: ref });
      closePicker();
      return;
    }
    const res = await updateIsaFinding(pickerFor.id, { protocolRefs: [ref] });
    if (res.ok) {
      setFindings((prev) => prev.map((f) => (f.id === res.data.id ? res.data : f)));
      setError(null);
    } else {
      setError('The protocol citation was not saved. Retry.');
    }
    closePicker();
  };

  const removeFindingRef = async (findingId: string) => {
    const res = await updateIsaFinding(findingId, { protocolRefs: [] });
    if (res.ok) {
      setFindings((prev) => prev.map((f) => (f.id === res.data.id ? res.data : f)));
    } else {
      setError('The protocol citation was not removed. Retry.');
    }
  };

  const renderPicker = () => (
    <div
      className={`rounded-md border ${rowBorder} ${
        isLight ? 'bg-[#F8FAFC]' : 'bg-white/[0.02]'
      } p-2.5 space-y-2`}
    >
      <div className="flex items-center gap-2">
        <input
          value={pickerQuery}
          onChange={(e) => setPickerQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void runPickerSearch();
            }
          }}
          placeholder="Search the protocol text…"
          className={`flex-1 rounded-md border px-2.5 py-1.5 text-xs text-fg-body outline-none ${inputBase}`}
          aria-label="Search the protocol"
          autoFocus
        />
        <button
          type="button"
          onClick={() => void runPickerSearch()}
          disabled={pickerBusy || pickerQuery.trim().length === 0}
          className={`rounded-md px-2.5 py-1.5 text-xs font-semibold disabled:opacity-40 ${primaryBtn}`}
        >
          {pickerBusy ? 'Searching…' : 'Search'}
        </button>
        <button
          type="button"
          onClick={closePicker}
          className="text-fg-muted hover:text-fg-body p-1"
          aria-label="Close protocol search"
        >
          <XIcon size={13} />
        </button>
      </div>
      {pickerHits !== null &&
        (pickerHits.length === 0 ? (
          <p className="text-fg-muted text-xs">No protocol passages matched.</p>
        ) : (
          <ul className="space-y-1.5">
            {pickerHits.map((h) => (
              <li key={h.chunk_id}>
                <button
                  type="button"
                  onClick={() => void attachRef(h)}
                  className={`w-full rounded-md border px-2.5 py-2 text-left transition-colors ${rowBorder} ${
                    isLight ? 'bg-white hover:bg-brand-600/[0.04]' : 'bg-white/[0.02] hover:bg-white/[0.05]'
                  }`}
                >
                  <span className={`text-[10px] font-semibold ${brandText}`}>
                    {formatProtocolRefWhere(hitToRef(h))}
                  </span>
                  <p className="text-fg-sub text-[11px] mt-0.5 line-clamp-3">{h.snippet}</p>
                </button>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    // Container + type scale match the other stage workspaces (p-6 max-w-4xl,
    // text-xl heading) so the pipelines read as siblings in the same shell.
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {!hasReached && activeAudit && <StagePreviewNotice currentStage={activeAudit.current_stage} />}
      {/* Header */}
      <div>
        <p className="text-fg-label text-[10px] uppercase tracking-wider font-semibold">
          Stage 5 · Audit conduct
        </p>
        <h2 className="text-fg-heading text-xl font-semibold mt-1">Fieldwork notes</h2>
        <p className="text-fg-sub text-sm mt-1.5 leading-relaxed max-w-2xl">
          Capture what you see as you see it — shorthand is fine. PIQC drafts findings
          from these notes when you ask; you review every draft against your own words
          before anything becomes a finding.
        </p>
      </div>

      {error && (
        <div
          className={`flex items-center justify-between gap-3 rounded-md border px-4 py-2.5 text-sm ${
            isLight
              ? 'bg-red-50 border-red-200 text-red-700'
              : 'bg-red-500/10 border-red-500/25 text-red-300'
          }`}
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="flex-shrink-0 opacity-70 hover:opacity-100"
            aria-label="Dismiss error"
          >
            <XIcon size={14} />
          </button>
        </div>
      )}

      {/* Capture — pure mutation surface, hidden entirely in preview. */}
      {hasReached && (
      <section className={`rounded-lg border ${cardBase}`}>
        <div className={`flex items-center gap-2 px-4 py-3 border-b ${rowBorder}`}>
          <NotebookPen size={15} className={brandText} />
          <h3 className="text-fg-heading text-sm font-semibold">New note</h3>
        </div>
        <div className="p-4 space-y-3">
          <textarea
            ref={captureRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void submitNote();
              }
            }}
            rows={3}
            placeholder="e.g. Subj 003 ICF v2 signed 04 Mar but v3 was IRB-approved 20 Feb…"
            className={`w-full rounded-md border px-3 py-2 text-sm text-fg-body placeholder:text-fg-muted outline-none resize-y ${inputBase}`}
          />
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={domain}
              onChange={(e) => setDomain(e.target.value as IsaDomain | '')}
              className={`rounded-md border px-2 py-1.5 text-xs text-fg-body outline-none ${inputBase}`}
              aria-label="Observation domain"
            >
              <option value="">No domain tag</option>
              {DOMAIN_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setPositive((p) => !p)}
              aria-pressed={positive}
              className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs transition-colors ${
                positive ? chipBase : `text-fg-muted ${inputBase}`
              }`}
            >
              <ThumbsUp size={12} />
              Positive observation
            </button>
            <button
              type="button"
              onClick={() => void submitNote()}
              disabled={!body.trim() || saving}
              className={`ml-auto rounded-md px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-40 ${primaryBtn}`}
            >
              {saving ? 'Adding…' : 'Add note'}
            </button>
          </div>
          <p className="text-fg-muted text-xs">
            Enter adds · Shift+Enter for a new line ·{' '}
            <span className="font-medium">
              Subject numbers only — no names, initials, or dates of birth.
            </span>
          </p>
        </div>
      </section>
      )}

      {/* Coverage strip — which domains have fieldwork behind them. The
          auditor's worst failure mode is the blind spot the auditee finds
          first; gaps stay visible while there's still time to look. */}
      {!loading && (notes.length > 0 || findings.length > 0) && (
        <section className={`rounded-lg border ${cardBase} px-4 py-3`}>
          <div className="flex items-center justify-between">
            <p className="text-fg-label text-[10px] uppercase tracking-wider font-semibold">
              Coverage
            </p>
            <p className="text-fg-muted text-[11px]">
              {coverage.uncoveredCount > 0
                ? `${coverage.uncoveredCount} of ${coverage.rows.length} domains have no notes yet`
                : 'Every domain has fieldwork behind it'}
              {coverage.untaggedNoteCount > 0 &&
                ` · ${coverage.untaggedNoteCount} untagged ${coverage.untaggedNoteCount === 1 ? 'note' : 'notes'} not counted`}
            </p>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {coverage.rows.map((row) => {
              const label = ISA_DOMAIN_LABELS[row.domain];
              const state =
                row.findingCount > 0
                  ? `${chipBase} font-semibold`
                  : row.noteCount > 0
                    ? chipBase
                    : `border-dashed text-fg-muted ${isLight ? 'border-[#CBD5E1]' : 'border-white/15'}`;
              return (
                <button
                  key={row.domain}
                  type="button"
                  onClick={() => {
                    setDomain(row.domain);
                    captureRef.current?.focus();
                  }}
                  title={`${label}: ${row.noteCount} ${row.noteCount === 1 ? 'note' : 'notes'}, ${row.findingCount} ${row.findingCount === 1 ? 'finding' : 'findings'} — click to tag new notes with this domain`}
                  className={`rounded border px-1.5 py-0.5 text-[10px] transition-colors ${state}`}
                >
                  {label}
                  {row.noteCount > 0 && ` · ${row.noteCount}`}
                  {row.findingCount > 0 && ` · ${row.findingCount}F`}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Notes list */}
      <section className={`rounded-lg border ${cardBase}`}>
        <div className={`flex items-center justify-between px-4 py-3 border-b ${rowBorder}`}>
          <h3 className="text-fg-heading text-sm font-semibold">Notes</h3>
          <span className="text-fg-muted text-xs">
            {notes.length} {notes.length === 1 ? 'note' : 'notes'}
          </span>
        </div>

        {loading ? (
          <p className="text-fg-muted text-sm px-4 py-6">Loading notes…</p>
        ) : notes.length === 0 ? (
          <p className="text-fg-sub text-sm px-4 py-6">
            No notes yet. The first one takes five seconds — everything else in this
            arc builds from them.
          </p>
        ) : (
          <ul>
            {notes.map((n) => (
              <li key={n.id} className={`px-4 py-3 border-t ${rowBorder} first:border-t-0`}>
                {editingId === n.id ? (
                  <div className="space-y-2">
                    <textarea
                      value={editBody}
                      onChange={(e) => setEditBody(e.target.value)}
                      rows={3}
                      className={`w-full rounded-md border px-3 py-2 text-sm text-fg-body outline-none resize-y ${inputBase}`}
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={editDomain}
                        onChange={(e) => setEditDomain(e.target.value as IsaDomain | '')}
                        className={`rounded-md border px-2 py-1.5 text-xs text-fg-body outline-none ${inputBase}`}
                        aria-label="Observation domain"
                      >
                        <option value="">No domain tag</option>
                        {DOMAIN_OPTIONS.map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => setEditPositive((p) => !p)}
                        aria-pressed={editPositive}
                        className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs ${
                          editPositive ? chipBase : `text-fg-muted ${inputBase}`
                        }`}
                      >
                        <ThumbsUp size={12} />
                        Positive
                      </button>
                      <div className="ml-auto flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="text-fg-muted text-xs hover:text-fg-body"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => void saveEdit()}
                          disabled={!editBody.trim()}
                          className={`rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-40 ${primaryBtn}`}
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="group">
                    <p className="text-fg-body text-sm whitespace-pre-wrap">{n.body}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <span className="text-fg-muted text-xs">{noteTimestamp(n.created_at)}</span>
                      {n.isa_domain && (
                        <span className={`rounded border px-1.5 py-0.5 text-[10px] ${chipBase}`}>
                          {ISA_DOMAIN_LABELS[n.isa_domain]}
                        </span>
                      )}
                      {n.is_positive && (
                        <span
                          className={`flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] ${
                            isLight
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25'
                          }`}
                        >
                          <ThumbsUp size={10} />
                          Positive
                        </span>
                      )}
                      {n.promoted_finding_id && (
                        <span
                          className={`flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] ${chipBase}`}
                          title="Cited as evidence by an accepted finding"
                        >
                          <ArrowRight size={10} />
                          Finding
                        </span>
                      )}
                      {hasReached && (
                      <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                        {confirmDeleteId === n.id ? (
                          <>
                            <span className="text-fg-muted text-xs">Delete?</span>
                            <button
                              type="button"
                              onClick={() => void removeNote(n.id)}
                              className={`rounded px-2 py-0.5 text-xs font-semibold ${
                                isLight
                                  ? 'bg-red-600 text-white hover:bg-red-700'
                                  : 'bg-red-500/20 text-red-300 hover:bg-red-500/30'
                              }`}
                            >
                              Yes
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="text-fg-muted text-xs hover:text-fg-body px-1"
                            >
                              No
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => startEdit(n)}
                              className="text-fg-muted hover:text-fg-body p-1"
                              aria-label="Edit note"
                            >
                              <Pencil size={13} />
                            </button>
                            {/* Promoted notes are part of a finding's evidence
                                chain — the delete RPC refuses them anyway. */}
                            {!n.promoted_finding_id && (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(n.id)}
                                className="text-fg-muted hover:text-fg-body p-1"
                                aria-label="Delete note"
                              >
                                <Trash2 size={13} />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                      )}
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* PIQC finding drafts */}
      <section className={`rounded-lg border ${cardBase}`}>
        <div className={`flex flex-wrap items-center gap-2 px-4 py-3 border-b ${rowBorder}`}>
          <PiqcMark size={15} className={brandText} />
          <h3 className="text-fg-heading text-sm font-semibold">Draft findings</h3>
          <div className="ml-auto flex items-center gap-2">
            <select
              value={draftScope}
              onChange={(e) => setDraftScope(e.target.value as IsaDomain | '')}
              className={`rounded-md border px-2 py-1.5 text-xs text-fg-body outline-none ${inputBase}`}
              aria-label="Drafting scope"
            >
              <option value="">All un-promoted notes</option>
              {DOMAIN_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label} only
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void runDrafting()}
              disabled={drafting || draftableNotes.length === 0 || !hasReached}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-40 ${primaryBtn}`}
            >
              {drafting
                ? 'Drafting…'
                : `Draft from ${draftableNotes.length} ${draftableNotes.length === 1 ? 'note' : 'notes'}`}
            </button>
          </div>
        </div>

        <div className="px-4 py-3 space-y-3">
          <p className="text-fg-muted text-xs">
            PIQC groups notes that share one root cause into a single draft finding.
            Every evidence line cites the notes it came from — shown side by side so
            you verify against your own words. Drafts save nothing until you accept.
          </p>

          {draftNote && <p className="text-fg-sub text-sm">{draftNote}</p>}

          {(withheldCount > 0 || strippedCount > 0 || strippedProtoCount > 0) &&
            drafts.length > 0 && (
            <p className="text-fg-sub text-xs">
              {withheldCount > 0 &&
                `${withheldCount} ${withheldCount === 1 ? 'proposal was' : 'proposals were'} withheld — ${withheldCount === 1 ? 'it' : 'they'} couldn't be traced to your notes. `}
              {strippedCount > 0 &&
                `${strippedCount} regulatory ${strippedCount === 1 ? 'citation' : 'citations'} outside the verified map ${strippedCount === 1 ? 'was' : 'were'} removed. `}
              {strippedProtoCount > 0 &&
                `${strippedProtoCount} protocol ${strippedProtoCount === 1 ? 'citation' : 'citations'} that couldn't be verified against the protocol text ${strippedProtoCount === 1 ? 'was' : 'were'} removed.`}
            </p>
          )}

          {bridgeReady === false && (
            <p className="text-fg-muted text-xs">
              Parse this study's protocol in the library to unlock protocol
              citations — findings can then quote the protocol's own text.
            </p>
          )}

          {drafts.map((d) => (
            <div key={d.key} className={`rounded-lg border ${cardBase}`}>
              <div className={`flex flex-wrap items-center gap-2 px-3 py-2 border-b ${rowBorder}`}>
                <PiqcMark size={12} className={brandText} />
                <span className={`text-[10px] uppercase tracking-wider font-semibold ${brandText}`}>
                  {d.dirty ? 'PIQC drafted · edited' : 'PIQC drafted'}
                </span>
                <div className="ml-auto flex items-center gap-2">
                  <select
                    value={d.severity}
                    onChange={(e) => patchDraft(d.key, { severity: e.target.value as IsaSeverity })}
                    className={`rounded border px-1.5 py-1 text-[11px] outline-none ${severityChip(d.severity)}`}
                    aria-label="Severity"
                  >
                    {SEVERITY_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {SEVERITY_LABELS[s]}
                      </option>
                    ))}
                  </select>
                  <select
                    value={d.isa_domain}
                    onChange={(e) => patchDraft(d.key, { isa_domain: e.target.value as IsaDomain })}
                    className={`rounded-md border px-2 py-1 text-[11px] text-fg-body outline-none ${inputBase}`}
                    aria-label="Domain"
                  >
                    {DOMAIN_OPTIONS.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="p-3 space-y-2.5">
                <input
                  value={d.title}
                  onChange={(e) => patchDraft(d.key, { title: e.target.value })}
                  className={`w-full rounded-md border px-3 py-1.5 text-sm font-semibold text-fg-heading outline-none ${inputBase}`}
                  aria-label="Finding title"
                />
                <textarea
                  value={d.observation}
                  onChange={(e) => patchDraft(d.key, { observation: e.target.value })}
                  rows={3}
                  className={`w-full rounded-md border px-3 py-2 text-sm text-fg-body outline-none resize-y ${inputBase}`}
                  aria-label="Observation"
                />
                {d.severity_rule && (
                  <p className="text-fg-muted text-xs italic">
                    Severity rationale: {d.severity_rule}
                  </p>
                )}
                {d.reference && (
                  <div className="flex items-center gap-1.5">
                    <span className={`rounded border px-1.5 py-0.5 text-[10px] ${chipBase}`}>
                      {d.reference}
                    </span>
                    <button
                      type="button"
                      onClick={() => patchDraft(d.key, { reference: null })}
                      className="text-fg-muted hover:text-fg-body"
                      aria-label="Remove citation"
                    >
                      <XIcon size={11} />
                    </button>
                  </div>
                )}

                {/* Protocol citation (S4) — the site's own protocol, quoted.
                    Post-Gate-3: the quote is verified verbatim protocol text. */}
                {d.protocol_ref ? (
                  <div
                    className={`rounded-md border ${rowBorder} ${
                      isLight ? 'bg-brand-600/[0.04]' : 'bg-brand-300/[0.05]'
                    } px-3 py-2`}
                  >
                    <div className="flex items-center gap-1.5">
                      <BookOpen size={11} className={brandText} />
                      <span className={`text-[10px] font-semibold ${brandText}`}>
                        Protocol requirement · {formatProtocolRefWhere(d.protocol_ref)}
                      </span>
                      <button
                        type="button"
                        onClick={() => patchDraft(d.key, { protocol_ref: null })}
                        className="ml-auto text-fg-muted hover:text-fg-body"
                        aria-label="Remove protocol citation"
                      >
                        <XIcon size={11} />
                      </button>
                    </div>
                    <p className="text-fg-sub text-[11px] mt-1 italic">
                      “{d.protocol_ref.quote}”
                    </p>
                  </div>
                ) : (
                  bridgeReady === true && (
                    <button
                      type="button"
                      onClick={() => openPicker({ kind: 'draft', key: d.key })}
                      className={`flex items-center gap-1.5 text-[11px] ${brandText} hover:underline`}
                    >
                      <BookOpen size={11} />
                      Cite the protocol…
                    </button>
                  )
                )}
                {pickerFor?.kind === 'draft' && pickerFor.key === d.key && renderPicker()}

                {/* Evidence — side by side with the cited notes, default
                    visible: verifying the claim against the auditor's own
                    words IS the review act. */}
                <div className="space-y-2">
                  {d.evidence.map((ev, i) => (
                    <div
                      key={i}
                      className={`rounded-md border ${rowBorder} ${
                        isLight ? 'bg-[#F8FAFC]' : 'bg-white/[0.02]'
                      } px-3 py-2`}
                    >
                      <p className="text-fg-body text-xs">{ev.text}</p>
                      {ev.source_note_ids.map((id) => {
                        const src = notesById.get(id);
                        return src ? (
                          <p
                            key={id}
                            className={`text-fg-muted text-[11px] mt-1 pl-2 border-l-2 ${
                              isLight ? 'border-[#CBD5E1]' : 'border-white/15'
                            }`}
                          >
                            <span className="font-medium">
                              Your note ({noteTimestamp(src.created_at)}):
                            </span>{' '}
                            {src.body}
                          </p>
                        ) : null;
                      })}
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => dismissDraft(d.key)}
                    className="text-fg-muted text-xs hover:text-fg-body"
                  >
                    Dismiss
                  </button>
                  <button
                    type="button"
                    onClick={() => void acceptDraft(d)}
                    disabled={acceptingKey !== null || !d.title.trim() || !d.observation.trim() || !hasReached}
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-40 ${primaryBtn}`}
                  >
                    {acceptingKey === d.key ? 'Accepting…' : 'Accept as finding'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Findings */}
      <section className={`rounded-lg border ${cardBase}`}>
        <div className={`flex items-center justify-between gap-2 px-4 py-3 border-b ${rowBorder}`}>
          <h3 className="text-fg-heading text-sm font-semibold">Findings</h3>
          <div className="flex items-center gap-3">
            {findings.length > 0 && (
              <button
                type="button"
                onClick={() => setShowClosing(true)}
                className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs text-fg-body transition-colors ${inputBase}`}
              >
                <Presentation size={12} className={brandText} />
                Closing meeting view
              </button>
            )}
            <span className="text-fg-muted text-xs">
              {findings.length} {findings.length === 1 ? 'finding' : 'findings'}
            </span>
          </div>
        </div>

        {/* Escalation tripwire — the templates' accumulation rules, live.
            Advisory only (D-008): PIQC cites the rule; the auditor judges. */}
        {signals.length > 0 && (
          <div className={`px-4 py-2.5 border-b ${rowBorder} space-y-1`}>
            {signals.map((s) => (
              <p
                key={`${s.domain}-${s.severity}`}
                className="flex items-start gap-1.5 text-xs text-fg-sub"
              >
                <PiqcMark size={11} className={`${brandText} mt-0.5 flex-shrink-0`} />
                <span>
                  {s.count} {SEVERITY_LABELS[s.severity]} findings in{' '}
                  {ISA_DOMAIN_LABELS[s.domain]} — the accumulation rule suggests
                  evaluating for a systemic failure (consider{' '}
                  {SEVERITY_LABELS[s.suggests]}).
                </span>
              </p>
            ))}
          </div>
        )}

        {findings.length === 0 ? (
          <p className="text-fg-sub text-sm px-4 py-6">
            No findings yet. Accepted drafts collect here for the report stage.
          </p>
        ) : (
          <ul>
            {findings.map((f) => (
              <li key={f.id} className={`px-4 py-3 border-t ${rowBorder} first:border-t-0`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${severityChip(f.severity)}`}
                  >
                    {SEVERITY_LABELS[f.severity]}
                  </span>
                  <span className="text-fg-heading text-sm font-semibold">{f.title}</span>
                  <span className={`rounded border px-1.5 py-0.5 text-[10px] ${chipBase}`}>
                    {ISA_DOMAIN_LABELS[f.isa_domain]}
                  </span>
                  {f.origin !== 'AUDITOR' && (
                    <span className={`flex items-center gap-1 text-[10px] ${brandText}`}>
                      <PiqcMark size={10} />
                      {f.origin === 'PIQC_DRAFTED' ? 'PIQC drafted' : 'PIQC drafted · edited'}
                    </span>
                  )}
                </div>
                <p className="text-fg-body text-sm mt-1.5">{f.observation}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-fg-muted">
                  <span>
                    {f.evidence.length} evidence {f.evidence.length === 1 ? 'item' : 'items'}
                  </span>
                  {f.reference && <span>· {f.reference}</span>}
                  {(f.protocol_refs ?? []).map((ref, i) => (
                    <span key={i} className={`flex items-center gap-1 ${brandText}`}>
                      <BookOpen size={10} />
                      {formatProtocolRefWhere(ref)}
                      <button
                        type="button"
                        onClick={() => void removeFindingRef(f.id)}
                        className="text-fg-muted hover:text-fg-body"
                        aria-label="Remove protocol citation"
                      >
                        <XIcon size={10} />
                      </button>
                    </span>
                  ))}
                  {bridgeReady === true && (f.protocol_refs ?? []).length === 0 && (
                    <button
                      type="button"
                      onClick={() => openPicker({ kind: 'finding', id: f.id })}
                      className={`flex items-center gap-1 ${brandText} hover:underline`}
                    >
                      <BookOpen size={10} />
                      Cite the protocol…
                    </button>
                  )}
                </div>
                {pickerFor?.kind === 'finding' && pickerFor.id === f.id && (
                  <div className="mt-2">{renderPicker()}</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {showClosing && (
        <IsaClosingMeetingView
          findings={findings}
          positiveNotes={notes.filter((n) => n.is_positive)}
          onClose={() => setShowClosing(false)}
        />
      )}
    </div>
  );
}
