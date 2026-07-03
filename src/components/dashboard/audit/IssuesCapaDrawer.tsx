import { useCallback, useEffect, useRef, useState } from 'react';
import { X, AlertOctagon, Plus, Sparkles, Upload } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import type { AuditWithContext } from '../../../context/AuditContext';
import { useOverlay } from '../../../hooks/useOverlay';
import type { CapaObject, IssueObject, ProvisionalImpact } from '../../../types/audit';
import {
  buildCapaPrefillFromFinding,
  createCapa,
  createIssue,
  fetchIssuesWithCapas,
  markCapaExported,
  setCapaStatus,
  updateCapa,
} from '../../../lib/audit/capaApi';
import { fetchWorkspaceEntries } from '../../../lib/audit/workspaceEntriesApi';
import type { MockWorkspaceEntry } from '../../../lib/audit/mockWorkspaceEntries';
import { CAPA_STATUS_LABELS, PROVISIONAL_IMPACT_LABELS } from '../../../lib/audit/labels';

// =============================================================================
// IssuesCapaDrawer — triage findings into Issues, draft the CAPA, review, export.
//
// The draft-only boundary is load-bearing here: a CAPA moves DRAFT →
// NEEDS_REVISION → ACCEPTED, where "Accepted" means READY TO EXPORT — there is
// deliberately no approve/final action; formal CAPA finalization happens in
// the QMS after export. Editing an accepted CAPA demotes it to Draft
// (enforced server-side; mirrored in copy here).
//
// CAPA drafts prefill from the triaged finding's context with the "PIQC
// drafted" attribution (templated — same agentic pattern as Stage 5 prefill).
//
// Cross-stage drawer (peer of Traceability): issues surface during conduct
// (Stage 6) but CAPAs are accepted/exported around Stages 7–8.
// =============================================================================

interface Props {
  audit: AuditWithContext;
  onClose: () => void;
}

// The UI constrains issue severity to the three real triage grades.
const SEVERITY_CHOICES: ProvisionalImpact[] = ['CRITICAL', 'MAJOR', 'MINOR'];

export default function IssuesCapaDrawer({ audit, onClose }: Props) {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const panelRef = useRef<HTMLDivElement>(null);
  useOverlay({ isOpen: true, onClose, containerRef: panelRef });

  const [issues, setIssues] = useState<IssueObject[]>([]);
  const [capasByIssue, setCapasByIssue] = useState<Record<string, CapaObject>>({});
  const [entries, setEntries] = useState<MockWorkspaceEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [raiseOpen, setRaiseOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Silent-with-signal: mutations degrade to null in capaApi (console.error'd
  // for the dev team); the auditor still gets one visible line, not a mystery.
  const [raiseError, setRaiseError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [issuesRes, entriesRes] = await Promise.all([
      fetchIssuesWithCapas(audit.id),
      fetchWorkspaceEntries(audit.id),
    ]);
    setIssues(issuesRes.issues);
    setCapasByIssue(issuesRes.capasByIssue);
    setEntries(entriesRes);
    setLoading(false);
  }, [audit.id]);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, [reload]);

  const entriesById = new Map(entries.map((e) => [e.id, e]));
  const findings = entries.filter((e) => e.provisional_classification === 'FINDING');

  const headingColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';
  const mutedColor = 'text-fg-muted';
  const sectionHeader = 'text-fg-label';
  const cardBg = isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/5';
  const inputStyles = isLight
    ? 'bg-white border-[#CBD5E1] focus:border-brand-600 focus:ring-1 focus:ring-brand-600/30'
    : 'bg-[#0F172A] border-white/15 focus:border-brand-300 focus:ring-1 focus:ring-brand-300/30';
  const buttonPrimary = isLight
    ? 'bg-brand-600 text-white hover:bg-brand-800 disabled:bg-[#CBD5E1]'
    : 'bg-brand-300 text-[#0F172A] hover:bg-brand-700 disabled:bg-white/10 disabled:text-white/35';
  const buttonSecondary = isLight
    ? 'bg-white border border-[#E2E8F0] text-[#334155] hover:bg-[#F8FAFC]'
    : 'bg-[#0F172A] border border-white/10 text-[#CBD5E1] hover:bg-white/[0.04]';

  const severityTone = (s: ProvisionalImpact): string =>
    s === 'CRITICAL'
      ? isLight
        ? 'bg-rose-50 border-rose-200 text-rose-700'
        : 'bg-rose-500/15 border-rose-500/30 text-rose-300'
      : s === 'MAJOR'
        ? isLight
          ? 'bg-amber-50 border-amber-200 text-amber-700'
          : 'bg-amber-500/15 border-amber-500/30 text-amber-300'
        : isLight
          ? 'bg-[#F2F2F2] border-[#CBD5E1] text-[#334155]/65'
          : 'bg-white/[0.06] border-white/10 text-[#CBD5E1]/55';

  return (
    <div
      data-testid="issues-capa-drawer"
      className="fixed inset-0 z-40 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="Issues and CAPA"
    >
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div
        ref={panelRef}
        className={`relative w-full max-w-2xl h-full overflow-y-auto shadow-xl border-l ${
          isLight ? 'bg-[#F8FAFC] border-[#E2E8F0]' : 'bg-[#020617] border-white/5'
        }`}
      >
        {/* Header */}
        <div
          className={`sticky top-0 z-10 px-5 py-3.5 border-b backdrop-blur ${
            isLight ? 'bg-[#F8FAFC]/95 border-[#E2E8F0]' : 'bg-[#020617]/95 border-white/5'
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold`}>
                Issues &amp; CAPA
              </p>
              <h2 className={`${headingColor} text-sm font-semibold mt-0.5 truncate`}>
                {audit.audit_name}
              </h2>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {/* Open-only (never a toggle): a second click must not silently
                  unmount a half-filled form — the form's own Cancel closes it. */}
              <button
                type="button"
                onClick={() => setRaiseOpen(true)}
                aria-expanded={raiseOpen}
                className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md transition-colors ${buttonPrimary}`}
              >
                <Plus size={12} />
                Raise issue
              </button>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className={`inline-flex items-center justify-center w-7 h-7 rounded-md ${mutedColor} hover:bg-[#E2E8F0] dark:hover:bg-white/[0.06]`}
              >
                <X size={14} />
              </button>
            </div>
          </div>
        </div>

        <div className="px-5 py-4 space-y-4">
          <p className={`${subColor} text-xs`}>
            Triage findings into issues and draft each CAPA for review.{' '}
            <span className={headingColor}>Accepted means ready to export</span> — formal CAPA
            finalization happens in your QMS, never here.
          </p>

          {raiseOpen && (
            <RaiseIssueForm
              findings={findings}
              busy={busy}
              isLight={isLight}
              inputStyles={inputStyles}
              buttonPrimary={buttonPrimary}
              buttonSecondary={buttonSecondary}
              onCancel={() => {
                setRaiseOpen(false);
                setRaiseError(null);
              }}
              error={raiseError}
              onSubmit={async (input) => {
                setBusy(true);
                const created = await createIssue(audit.id, input);
                setBusy(false);
                if (created) {
                  setRaiseOpen(false);
                  setRaiseError(null);
                  await reload();
                } else {
                  setRaiseError('The issue didn’t save. Try again — your entries are kept.');
                }
              }}
            />
          )}

          {loading && (
            <div className="flex items-center justify-center py-16">
              <div className="w-5 h-5 border-2 border-brand-600 border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {!loading && issues.length === 0 && !raiseOpen && (
            <div className={`${cardBg} border border-dashed rounded-xl px-6 py-10 text-center`}>
              <div className={`inline-flex items-center justify-center w-11 h-11 rounded-2xl border mb-3 ${isLight ? 'bg-brand-600/10 border-brand-600/20 text-brand-600' : 'bg-brand-600/15 border-brand-600/30 text-brand-300'}`}>
                <AlertOctagon size={18} />
              </div>
              <h3 className={`${headingColor} font-semibold text-sm mb-1`}>No issues yet</h3>
              <p className={`${subColor} text-xs max-w-sm mx-auto`}>
                Raise an issue from a Stage 6 finding (pick it in the form) or record one directly.
                Each issue carries one CAPA through draft → review → export.
              </p>
            </div>
          )}

          {!loading &&
            issues.map((issue) => (
              <IssueCard
                key={issue.id}
                issue={issue}
                capa={capasByIssue[issue.id] ?? null}
                sourceEntry={
                  issue.workspace_entry_id
                    ? (entriesById.get(issue.workspace_entry_id) ?? null)
                    : null
                }
                busy={busy}
                isLight={isLight}
                cardBg={cardBg}
                inputStyles={inputStyles}
                buttonPrimary={buttonPrimary}
                buttonSecondary={buttonSecondary}
                severityTone={severityTone}
                setBusy={setBusy}
                reload={reload}
              />
            ))}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// RaiseIssueForm
// =============================================================================
interface RaiseIssueFormProps {
  findings: MockWorkspaceEntry[];
  busy: boolean;
  isLight: boolean;
  inputStyles: string;
  buttonPrimary: string;
  buttonSecondary: string;
  error: string | null;
  onCancel: () => void;
  onSubmit: (input: {
    title: string;
    severity: ProvisionalImpact;
    description?: string;
    workspaceEntryId?: string | null;
    regulatoryReportable?: boolean;
    sponsorReportable?: boolean;
  }) => Promise<void>;
}

function RaiseIssueForm({
  findings, busy, isLight, inputStyles, buttonPrimary, buttonSecondary, error, onCancel, onSubmit,
}: RaiseIssueFormProps) {
  const [title, setTitle] = useState('');
  const [severity, setSeverity] = useState<ProvisionalImpact>('MAJOR');
  const [description, setDescription] = useState('');
  const [entryId, setEntryId] = useState('');
  const [regulatory, setRegulatory] = useState(false);
  const [sponsor, setSponsor] = useState(false);
  // The last title WE auto-filled from a finding pick. If the auditor hasn't
  // touched it, re-picking a different finding replaces it — otherwise a
  // stale auto-title would misdescribe the newly linked finding.
  const autoTitleRef = useRef<string | null>(null);

  const headingColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';

  return (
    <div className={`border rounded-xl p-4 space-y-3 ${isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/5'}`}>
      <p className="text-fg-label text-[10px] uppercase tracking-wider font-semibold">
        Raise an issue
      </p>
      {/* Triage source FIRST (value-first ordering): picking a finding
          auto-fills the title + severity and threads its context into the
          CAPA prefill — don't make the auditor type what PIQC already knows. */}
      <select
        value={entryId}
        onChange={(e) => {
          setEntryId(e.target.value);
          const entry = findings.find((f) => f.id === e.target.value);
          // Auto-fill the title only when it's empty OR still our own previous
          // auto-fill — never clobber text the auditor typed themselves.
          const titleUntouched = !title || title === autoTitleRef.current;
          if (entry && titleUntouched) {
            const auto =
              entry.observation_text.length > 80
                ? `${entry.observation_text.slice(0, 80)}…`
                : entry.observation_text;
            setTitle(auto);
            autoTitleRef.current = auto;
          }
          if (!entry && titleUntouched) {
            // Cleared the pick — clear the auto-title too.
            setTitle('');
            autoTitleRef.current = null;
          }
          if (entry && (entry.provisional_impact === 'CRITICAL' || entry.provisional_impact === 'MAJOR' || entry.provisional_impact === 'MINOR')) {
            setSeverity(entry.provisional_impact);
          }
        }}
        aria-label="Triage from finding"
        className={`w-full rounded-md border px-3 py-2 text-sm ${inputStyles} ${headingColor} focus:outline-none`}
        disabled={busy}
      >
        <option value="">
          {findings.length === 0
            ? 'No Stage 6 findings yet — raise directly'
            : 'Triage from a Stage 6 finding (optional)…'}
        </option>
        {findings.map((f) => (
          <option key={f.id} value={f.id}>
            {f.vendor_domain}: {f.observation_text.slice(0, 70)}
          </option>
        ))}
      </select>
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Issue title — what is wrong, in one line"
        aria-label="Issue title"
        className={`w-full rounded-md border px-3 py-2 text-sm ${inputStyles} ${headingColor} focus:outline-none`}
        disabled={busy}
      />
      <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Severity">
        {SEVERITY_CHOICES.map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={severity === s}
            onClick={() => setSeverity(s)}
            disabled={busy}
            className={`text-xs font-semibold px-2.5 py-1.5 rounded-md border transition-colors ${
              severity === s
                ? isLight
                  ? 'bg-brand-600/10 border-brand-600 text-brand-600'
                  : 'bg-brand-600/15 border-brand-300 text-brand-300'
                : isLight
                  ? 'bg-white border-[#E2E8F0] text-[#334155]/65 hover:border-[#CBD5E1]'
                  : 'bg-[#0F172A] border-white/10 text-[#CBD5E1]/55 hover:border-white/20'
            }`}
          >
            {PROVISIONAL_IMPACT_LABELS[s]}
          </button>
        ))}
      </div>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Context for the reviewer (optional)"
        aria-label="Issue description"
        rows={2}
        className={`w-full rounded-md border px-3 py-2 text-sm ${inputStyles} ${headingColor} focus:outline-none`}
        disabled={busy}
      />
      <div>
        <div className="flex items-center gap-4 flex-wrap">
          <label className={`flex items-center gap-1.5 text-xs ${subColor} cursor-pointer`}>
            <input
              type="checkbox"
              checked={regulatory}
              onChange={(e) => setRegulatory(e.target.checked)}
              disabled={busy}
            />
            Regulatory-reportable
          </label>
          <label className={`flex items-center gap-1.5 text-xs ${subColor} cursor-pointer`}>
            <input
              type="checkbox"
              checked={sponsor}
              onChange={(e) => setSponsor(e.target.checked)}
              disabled={busy}
            />
            Sponsor-reportable
          </label>
        </div>
        <p className="text-fg-muted text-[11px] mt-1">
          Flags travel with the issue record and traceability — the reporting itself happens
          outside PIQC.
        </p>
      </div>
      {error && (
        <p role="alert" className={`text-[11px] ${isLight ? 'text-rose-700' : 'text-rose-300'}`}>
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} disabled={busy} className={`text-xs font-medium px-2.5 py-1.5 rounded-md ${buttonSecondary} disabled:opacity-40`}>
          Cancel
        </button>
        <button
          type="button"
          disabled={!title.trim() || busy}
          onClick={() =>
            onSubmit({
              title: title.trim(),
              severity,
              description: description.trim() || undefined,
              workspaceEntryId: entryId || null,
              regulatoryReportable: regulatory,
              sponsorReportable: sponsor,
            })
          }
          className={`text-xs font-semibold px-2.5 py-1.5 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${buttonPrimary}`}
        >
          {busy ? 'Saving…' : 'Raise issue'}
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// IssueCard — one issue + its (at most one) CAPA with the review loop.
// =============================================================================
interface IssueCardProps {
  issue: IssueObject;
  capa: CapaObject | null;
  sourceEntry: MockWorkspaceEntry | null;
  busy: boolean;
  isLight: boolean;
  cardBg: string;
  inputStyles: string;
  buttonPrimary: string;
  buttonSecondary: string;
  severityTone: (s: ProvisionalImpact) => string;
  setBusy: (b: boolean) => void;
  reload: () => Promise<void>;
}

function IssueCard({
  issue, capa, sourceEntry, busy, isLight, cardBg, inputStyles,
  buttonPrimary, buttonSecondary, severityTone, setBusy, reload,
}: IssueCardProps) {
  const headingColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';

  // Local CAPA draft state — committed on "Save changes".
  const [rootCause, setRootCause] = useState(capa?.root_cause_text ?? '');
  const [corrective, setCorrective] = useState(capa?.corrective_action_text ?? '');
  const [preventive, setPreventive] = useState(capa?.preventive_action_text ?? '');
  // Re-sync local fields when a fresh CAPA row arrives (create/refetch).
  const capaKey = `${capa?.id ?? 'none'}:${capa?.updated_at ?? ''}`;
  const lastKeyRef = useRef(capaKey);
  useEffect(() => {
    if (lastKeyRef.current !== capaKey) {
      lastKeyRef.current = capaKey;
      setRootCause(capa?.root_cause_text ?? '');
      setCorrective(capa?.corrective_action_text ?? '');
      setPreventive(capa?.preventive_action_text ?? '');
    }
  }, [capaKey, capa]);

  const dirty =
    capa !== null &&
    (rootCause !== capa.root_cause_text ||
      corrective !== capa.corrective_action_text ||
      preventive !== capa.preventive_action_text);

  const exported = Boolean(capa?.exported_at);

  // Silent-with-signal: a null result from any RPC wrapper gets one visible
  // line here (the console.error upstream carries the detail for the dev team).
  const [actionError, setActionError] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    const result = await fn();
    setActionError(result === null ? 'That didn’t save — try again.' : null);
    await reload();
    setBusy(false);
  };

  const capaStatusChip = !capa
    ? null
    : exported
      ? isLight
        ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
        : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
      : capa.status === 'ACCEPTED'
        ? isLight
          ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
          : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
        : capa.status === 'NEEDS_REVISION'
          ? isLight
            ? 'bg-amber-50 border-amber-200 text-amber-700'
            : 'bg-amber-500/15 border-amber-500/30 text-amber-300'
          : isLight
            ? 'bg-[#F2F2F2] border-[#CBD5E1] text-[#334155]/65'
            : 'bg-white/[0.06] border-white/10 text-[#CBD5E1]/55';

  return (
    <div className={`${cardBg} border rounded-xl p-4 space-y-3`}>
      {/* Issue header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={`${headingColor} text-sm font-semibold`}>{issue.title}</p>
          {issue.description && (
            <p className={`${subColor} text-xs mt-0.5`}>{issue.description}</p>
          )}
          <div className={`flex items-center gap-2 mt-1.5 flex-wrap text-[11px] ${subColor}`}>
            {sourceEntry && (
              <span>Triaged from Stage 6 · {sourceEntry.vendor_domain}</span>
            )}
            {/* Reportable flags are a DIFFERENT fact from severity — neutral
                tone so they never read as a second severity chip. */}
            {issue.regulatory_reportable && (
              <span className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded border ${severityTone('MINOR')}`}>
                Regulatory-reportable
              </span>
            )}
            {issue.sponsor_reportable && (
              <span className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded border ${severityTone('MINOR')}`}>
                Sponsor-reportable
              </span>
            )}
          </div>
        </div>
        <span className={`inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded border flex-shrink-0 ${severityTone(issue.severity)}`}>
          {PROVISIONAL_IMPACT_LABELS[issue.severity]}
        </span>
      </div>

      {/* CAPA section */}
      {!capa ? (
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            run(() => {
              const prefill = buildCapaPrefillFromFinding(issue.title, sourceEntry);
              // Return the result so run()'s null-check can surface a failure.
              return createCapa(issue.id, {
                rootCauseText: prefill.rootCauseText,
                correctiveActionText: prefill.correctiveActionText,
                preventiveActionText: prefill.preventiveActionText,
                piqcPrefilled: true,
              });
            })
          }
          className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md transition-colors disabled:opacity-50 ${buttonPrimary}`}
        >
          <Sparkles size={12} />
          Draft CAPA
        </button>
      ) : (
        <div className={`border rounded-lg p-3 space-y-2.5 ${isLight ? 'bg-[#F8FAFC] border-[#F2F2F2]' : 'bg-white/[0.02] border-white/[0.04]'}`}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-fg-label text-[10px] uppercase tracking-wider font-semibold">
              CAPA
            </span>
            <div className="flex items-center gap-2">
              {capa.piqc_prefilled && (
                <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded border ${isLight ? 'bg-brand-600/10 border-brand-600/25 text-brand-600' : 'bg-brand-600/15 border-brand-300/30 text-brand-300'}`}>
                  <Sparkles size={9} />
                  PIQC drafted
                </span>
              )}
              <span className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded border ${capaStatusChip}`}>
                {exported ? 'Exported' : CAPA_STATUS_LABELS[capa.status]}
              </span>
            </div>
          </div>

          {(
            [
              ['Root cause', rootCause, setRootCause],
              ['Corrective action', corrective, setCorrective],
              ['Preventive action', preventive, setPreventive],
            ] as const
          ).map(([label, value, set]) => (
            <label key={label} className="block">
              <span className={`${subColor} text-[11px] font-medium`}>{label}</span>
              <textarea
                value={value}
                onChange={(e) => set(e.target.value)}
                rows={2}
                disabled={busy || exported}
                className={`mt-1 w-full rounded-md border px-2.5 py-1.5 text-xs ${inputStyles} ${headingColor} focus:outline-none disabled:opacity-60`}
              />
            </label>
          ))}

          {/* Review-loop actions. No approve/final — Accepted = ready to export. */}
          {!exported && (
            <div className="flex items-center gap-2 flex-wrap pt-0.5">
              {dirty && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    run(() =>
                      updateCapa(capa.id, {
                        rootCauseText: rootCause,
                        correctiveActionText: corrective,
                        preventiveActionText: preventive,
                      }),
                    )
                  }
                  className={`text-xs font-semibold px-2.5 py-1.5 rounded-md transition-colors disabled:opacity-50 ${buttonPrimary}`}
                >
                  Save changes
                </button>
              )}
              {!dirty && capa.status !== 'ACCEPTED' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => setCapaStatus(capa.id, 'ACCEPTED'))}
                  className={`text-xs font-semibold px-2.5 py-1.5 rounded-md border transition-colors disabled:opacity-50 ${
                    isLight
                      ? 'bg-emerald-600 border-emerald-600 text-white hover:bg-emerald-700'
                      : 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/30'
                  }`}
                >
                  Accept (ready to export)
                </button>
              )}
              {!dirty && capa.status !== 'NEEDS_REVISION' && capa.status !== 'ACCEPTED' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => setCapaStatus(capa.id, 'NEEDS_REVISION'))}
                  className={`text-xs font-medium px-2.5 py-1.5 rounded-md border transition-colors disabled:opacity-50 ${
                    isLight
                      ? 'bg-white border-amber-300 text-amber-700 hover:bg-amber-50'
                      : 'bg-transparent border-amber-500/40 text-amber-300 hover:bg-amber-500/10'
                  }`}
                >
                  Needs revision
                </button>
              )}
              {!dirty && capa.status === 'ACCEPTED' && (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => run(() => markCapaExported(capa.id))}
                    className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors disabled:opacity-50 ${buttonSecondary}`}
                  >
                    <Upload size={11} />
                    Export → QMS
                  </button>
                  {/* Status-only undo for a mis-clicked Accept — reversing a
                      verdict shouldn't require mutating the CAPA's content. */}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => run(() => setCapaStatus(capa.id, 'DRAFT'))}
                    className={`text-xs font-medium px-2.5 py-1.5 rounded-md border transition-colors disabled:opacity-50 ${
                      isLight
                        ? 'bg-white border-[#E2E8F0] text-[#334155]/70 hover:bg-[#F8FAFC]'
                        : 'bg-transparent border-white/10 text-[#CBD5E1]/60 hover:bg-white/[0.04]'
                    }`}
                  >
                    Reopen draft
                  </button>
                </>
              )}
              {dirty && (
                <span className={`${subColor} text-[11px]`}>
                  {capa.status === 'ACCEPTED'
                    ? 'Saving edits returns this CAPA to Draft for re-review.'
                    : 'Save to continue the review.'}
                </span>
              )}
            </div>
          )}
          {exported && capa.exported_at && (
            <p className={`${subColor} text-[11px]`}>
              Exported {new Date(capa.exported_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} — finalize in the QMS.
            </p>
          )}
        </div>
      )}
      {/* Card-level failure signal — rendered in BOTH branches (Draft CAPA
          button and the CAPA panel) so no mutation can fail invisibly. */}
      {actionError && (
        <p role="alert" className={`text-[11px] ${isLight ? 'text-rose-700' : 'text-rose-300'}`}>
          {actionError}
        </p>
      )}
    </div>
  );
}
