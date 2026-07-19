import { useState } from 'react';
import { Check, Copy, GitCompareArrows } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import {
  DIVERGENCE_CLASS_LABELS,
  DIVERGENCE_STATUS_LABELS,
  type DivergenceRecord,
  type DivergenceStatus,
} from '../../../types/divergence';
import { draftClarificationQuery } from '../../../lib/divergence/draftClarificationQuery';

// =============================================================================
// DivergencePanel — the coordinator surface for narrative↔grid divergences
// (narrative-first spec §5.5). Renders the divergences whose locus intersects
// the visit in view (plus protocol-wide cohort-scope records). Renders NOTHING
// when there are none — the no-wallpaper rule; a consistent protocol shows no
// panel.
//
// Voice: "PIQC flagged" (agentic attribution is product-bearing). PIQC shows
// BOTH readings and what it compared; it never says which is right. The human
// dispositions the record and carries it to the sponsor — the drafted
// clarification query is copy-only, human-owned, human-sent.
// =============================================================================

interface Props {
  divergences: DivergenceRecord[];
  protocolCode: string | null;
  /** Returns true on success (panel clears its note input); false → parent
   * surfaced the mutation error. */
  onSetStatus: (id: string, status: DivergenceStatus, note: string | null) => Promise<boolean>;
}

const STATUS_OPTIONS: DivergenceStatus[] = ['open', 'raised_with_sponsor', 'resolved', 'dismissed'];

export default function DivergencePanel({ divergences, protocolCode, onSetStatus }: Props) {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  if (divergences.length === 0) return null;

  const openCount = divergences.filter(
    (d) => d.status === 'open' || d.status === 'raised_with_sponsor',
  ).length;

  return (
    <section
      data-testid="vew-divergence-panel"
      aria-label="Protocol readings that disagree"
      className={`rounded-xl border overflow-hidden ${
        isLight ? 'bg-white border-amber-200' : 'bg-[#0F172A] border-amber-400/20'
      }`}
    >
      <div
        className={`flex items-center gap-2 px-4 py-3 border-b ${
          isLight ? 'border-amber-100 bg-amber-50/50' : 'border-amber-400/10 bg-amber-400/[0.04]'
        }`}
      >
        <GitCompareArrows size={14} className="text-amber-600 dark:text-amber-400 flex-shrink-0" aria-hidden />
        <p className="text-fg-heading text-sm font-semibold flex-1 min-w-0">
          PIQC flagged {divergences.length} place{divergences.length === 1 ? '' : 's'} where this
          protocol&apos;s two readings disagree
        </p>
        {openCount > 0 && (
          <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-400 tabular-nums flex-shrink-0">
            {openCount} open
          </span>
        )}
      </div>
      <p className={`px-4 pt-2.5 text-fg-sub text-[11px] leading-relaxed`}>
        PIQC compared the protocol&apos;s narrative against its Schedule of Assessments. It does not
        decide which reading is right — verify both, and clarify with the sponsor.
      </p>
      <ul className={`divide-y px-4 pb-2 ${isLight ? 'divide-[#F2F2F2]' : 'divide-white/[0.04]'}`}>
        {divergences.map((d) => (
          <DivergenceRow key={d.id} d={d} protocolCode={protocolCode} onSetStatus={onSetStatus} isLight={isLight} />
        ))}
      </ul>
    </section>
  );
}

function DivergenceRow({
  d,
  protocolCode,
  onSetStatus,
  isLight,
}: {
  d: DivergenceRecord;
  protocolCode: string | null;
  onSetStatus: Props['onSetStatus'];
  isLight: boolean;
}) {
  const [pendingStatus, setPendingStatus] = useState<DivergenceStatus>(d.status);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const noteRequired = pendingStatus === 'resolved' || pendingStatus === 'dismissed';
  const dirty = pendingStatus !== d.status;
  const closed = d.status === 'resolved' || d.status === 'dismissed';

  const apply = async () => {
    setBusy(true);
    const ok = await onSetStatus(d.id, pendingStatus, note.trim() ? note.trim() : null);
    setBusy(false);
    if (ok) setNote('');
  };

  const copyDraft = async () => {
    try {
      await navigator.clipboard.writeText(draftClarificationQuery(d, { protocolCode }));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — the button simply doesn't confirm */
    }
  };

  return (
    <li data-testid="vew-divergence-row" className={`py-3 ${closed ? 'opacity-60' : ''}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <span
          className={`inline-flex items-center text-[10px] font-semibold uppercase tracking-wider rounded-md border px-1.5 py-0.5 ${
            isLight
              ? 'text-amber-700 bg-amber-50 border-amber-200'
              : 'text-amber-400 bg-amber-400/10 border-amber-400/20'
          }`}
        >
          {DIVERGENCE_CLASS_LABELS[d.divergence_class]}
        </span>
        {d.visit_name && <span className="text-fg-sub text-xs">{d.visit_name}</span>}
        {d.procedure_label && (
          <span className="text-fg-body text-xs font-medium">{d.procedure_label}</span>
        )}
        <span className="flex-1" />
        <span className="text-fg-muted text-[10px] uppercase tracking-wider font-semibold">
          {DIVERGENCE_STATUS_LABELS[d.status]}
        </span>
      </div>

      <p className="text-fg-body text-xs mt-1.5 leading-relaxed">{d.detail}</p>

      <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
        {[
          { label: 'SoA reading', r: d.reading_a },
          { label: 'Narrative reading', r: d.reading_b },
        ].map(({ label, r }) => (
          <blockquote
            key={label}
            className={`text-[11px] leading-relaxed pl-2.5 border-l-2 ${
              isLight ? 'border-[#CBD5E1] text-fg-sub' : 'border-white/10 text-fg-sub'
            }`}
          >
            <span className="text-fg-label uppercase tracking-wider font-semibold text-[9px] block">
              {label}
              {!r.verbatim && ' · extracted value'}
            </span>
            {r.verbatim ? <>&ldquo;{r.quote}&rdquo;</> : r.quote}
          </blockquote>
        ))}
      </div>

      <div className="mt-2.5 flex items-center gap-2 flex-wrap">
        <select
          aria-label="Divergence status"
          value={pendingStatus}
          onChange={(e) => setPendingStatus(e.target.value as DivergenceStatus)}
          className={`text-xs rounded-md border px-2 py-1 ${
            isLight
              ? 'bg-white border-[#E2E8F0] text-fg-body'
              : 'bg-[#0F172A] border-white/10 text-fg-body'
          }`}
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {DIVERGENCE_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        {dirty && noteRequired && (
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Required: how was this dispositioned?"
            aria-label="Disposition note"
            className={`flex-1 min-w-[180px] text-xs rounded-md border px-2 py-1 ${
              isLight
                ? 'bg-white border-[#E2E8F0] text-fg-body placeholder:text-fg-muted'
                : 'bg-[#0F172A] border-white/10 text-fg-body placeholder:text-fg-muted'
            }`}
          />
        )}
        {dirty && (
          <button
            type="button"
            disabled={busy || (noteRequired && !note.trim())}
            onClick={apply}
            className={`text-xs font-medium rounded-md border px-2.5 py-1 disabled:opacity-40 ${
              isLight
                ? 'border-[#E2E8F0] text-fg-body hover:bg-[#F2F2F2]'
                : 'border-white/10 text-fg-body hover:bg-white/[0.04]'
            }`}
          >
            {busy ? 'Saving…' : 'Apply'}
          </button>
        )}
        <span className="flex-1" />
        <button
          type="button"
          onClick={copyDraft}
          data-testid="vew-divergence-copy-draft"
          title="Copy a sponsor clarification query drafted from both readings. You review and send it — PIQC never sends anything."
          className={`inline-flex items-center gap-1 text-[11px] font-medium rounded-md border px-2 py-1 ${
            isLight
              ? 'border-[#E2E8F0] text-fg-sub hover:bg-[#F2F2F2] hover:text-fg-body'
              : 'border-white/10 text-fg-sub hover:bg-white/[0.04] hover:text-fg-body'
          }`}
        >
          {copied ? <Check size={11} aria-hidden /> : <Copy size={11} aria-hidden />}
          {copied ? 'Copied' : 'Copy sponsor query draft'}
        </button>
      </div>
    </li>
  );
}
