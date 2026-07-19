import { useEffect, useState } from 'react';
import {
  Check,
  ClipboardCopy,
  Download,
  FileText,
  Gavel,
  X as XIcon,
} from 'lucide-react';
import { useTheme } from '../../../../../context/ThemeContext';
import { useAudit } from '../../../../../context/AuditContext';
import { AUDIT_TYPE_LABELS, ISA_DOMAIN_LABELS } from '../../../../../lib/audit/labels';
import { fetchIsaNotes } from '../../../../../lib/audit/isaNotesApi';
import { fetchIsaFindings } from '../../../../../lib/audit/isaFindingsApi';
import {
  fetchIsaReportDraft,
  upsertIsaReportDraft,
  type UpsertIsaReportDraftInput,
} from '../../../../../lib/audit/isaReportApi';
import {
  AUDITEE_BACKGROUND_PLACEHOLDER,
  CLOSING_MEETING_PLACEHOLDER,
  OPENING_MEETING_PLACEHOLDER,
  buildIsaReportPacket,
  type IsaReportMeta,
} from '../../../../../lib/audit/isaReportModel';
import {
  buildFindingHtml,
  buildFindingPlain,
  buildReportHtml,
  buildReportPlain,
} from '../../../../../lib/audit/isaReportClipboard';
import { buildIsaReportDocx } from '../../../../../lib/audit/isaReportDocx';
import PiqcMark from '../../PiqcMark';
import type {
  AuditNoteObject,
  IsaFindingObject,
  IsaReportDraftObject,
  IsaSiteVerdict,
} from '../../../../../types/audit';

// =============================================================================
// IsaReportWorkspace — ISA_REPORT stage center pane.
//
// The report is ~70% deterministic (metadata merge + constants + rollups from
// accepted findings); this workspace is the editor for the rest: four prose
// sections (NULL = templated, live-derived), the response clause parameters,
// and the SITE VERDICT — the one sentence PIQC never drafts. Export (docx +
// paste-ready clipboard) is gated on the verdict being set: a report whose
// most consequential sentence is a placeholder does not leave the building.
//
// Clipboard copies carry text/html + text/plain flavors so Word and Google
// Docs paste formatted; the DRAFT/provenance banner is inside the payload.
// =============================================================================

const VERDICT_OPTIONS: { value: IsaSiteVerdict; label: string }[] = [
  { value: 'CONTINUE', label: 'Continue — no increased monitoring' },
  { value: 'CONTINUE_INCREASED_MONITORING', label: 'Continue with increased monitoring' },
  { value: 'DO_NOT_CONTINUE', label: 'Do not continue pending resolution' },
];

async function copyRich(html: string, plain: string): Promise<boolean> {
  try {
    if (navigator.clipboard && 'write' in navigator.clipboard && typeof ClipboardItem !== 'undefined') {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([plain], { type: 'text/plain' }),
        }),
      ]);
      return true;
    }
  } catch {
    // fall through to the selection-based path
  }
  try {
    const container = document.createElement('div');
    container.innerHTML = html;
    container.style.position = 'fixed';
    container.style.left = '-9999px';
    document.body.appendChild(container);
    const range = document.createRange();
    range.selectNodeContents(container);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    const ok = document.execCommand('copy');
    sel?.removeAllRanges();
    container.remove();
    if (ok) return true;
  } catch {
    // fall through to plain text
  }
  try {
    await navigator.clipboard.writeText(plain);
    return true;
  } catch {
    return false;
  }
}

export default function IsaReportWorkspace() {
  const { theme } = useTheme();
  const { activeAudit } = useAudit();
  const isLight = theme === 'light';

  const [draft, setDraft] = useState<IsaReportDraftObject | null>(null);
  const [findings, setFindings] = useState<IsaFindingObject[]>([]);
  const [notes, setNotes] = useState<AuditNoteObject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Section editors — local text per section; Save persists.
  const [background, setBackground] = useState('');
  const [opening, setOpening] = useState('');
  const [closing, setClosing] = useState('');
  const [execEditing, setExecEditing] = useState(false);
  const [execText, setExecText] = useState('');

  // Verdict editor
  const [verdict, setVerdict] = useState<IsaSiteVerdict | ''>('');
  const [verdictText, setVerdictText] = useState('');

  const [savingField, setSavingField] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const auditId = activeAudit?.id;

  useEffect(() => {
    if (!auditId) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchIsaReportDraft(auditId),
      fetchIsaFindings(auditId),
      fetchIsaNotes(auditId),
    ]).then(([draftRes, findingsRes, notesRes]) => {
      if (cancelled) return;
      if (draftRes.ok) {
        setDraft(draftRes.data);
        setBackground(draftRes.data?.auditee_background ?? '');
        setOpening(draftRes.data?.opening_meeting ?? '');
        setClosing(draftRes.data?.closing_meeting ?? '');
        setVerdict(draftRes.data?.site_verdict ?? '');
        setVerdictText(draftRes.data?.site_verdict_text ?? '');
      }
      if (findingsRes.ok) setFindings(findingsRes.data);
      if (notesRes.ok) setNotes(notesRes.data);
      if (!draftRes.ok || !findingsRes.ok || !notesRes.ok) {
        setError('Some data could not be loaded. Retry by reopening the stage.');
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [auditId]);

  if (!activeAudit) return null;

  const cardBase = isLight ? 'bg-white border-[#E2E8F0]' : 'bg-white/[0.02] border-white/10';
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

  const positiveNotes = notes.filter((n) => n.is_positive && !n.deleted_at);

  const meta: IsaReportMeta = {
    auditeeName: activeAudit.auditee_name || 'Investigator site',
    siteNumber: activeAudit.site_number,
    principalInvestigator: activeAudit.principal_investigator,
    siteCountry: activeAudit.site_country,
    protocolCode: activeAudit.protocol_code || null,
    protocolTitle: activeAudit.protocol_title || null,
    auditTypeLabel: AUDIT_TYPE_LABELS[activeAudit.audit_type],
    auditDate: activeAudit.scheduled_date,
    generatedAt: new Date(),
  };
  const packet = buildIsaReportPacket(meta, draft, findings, positiveNotes);
  const verdictSet = !!draft?.site_verdict;

  const save = async (field: string, input: UpsertIsaReportDraftInput) => {
    setSavingField(field);
    const res = await upsertIsaReportDraft(activeAudit.id, input);
    setSavingField(null);
    if (res.ok) {
      setDraft(res.data);
      setError(null);
      return true;
    }
    setError('The change was not saved. Retry.');
    return false;
  };

  const flashCopied = (key: string) => {
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 2000);
  };

  const copyReport = async () => {
    if (await copyRich(buildReportHtml(packet), buildReportPlain(packet))) {
      flashCopied('report');
    } else {
      setError('Copy failed — your browser blocked clipboard access.');
    }
  };

  const copyFinding = async (f: IsaFindingObject) => {
    if (await copyRich(buildFindingHtml(f, meta.generatedAt), buildFindingPlain(f, meta.generatedAt))) {
      flashCopied(f.id);
    } else {
      setError('Copy failed — your browser blocked clipboard access.');
    }
  };

  const downloadDocx = async () => {
    const blob = await buildIsaReportDocx(packet);
    const stamp = new Date().toISOString().slice(0, 10);
    const name = `${meta.protocolCode ?? 'isa'}_site_audit_report_draft_${stamp}.docx`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const sectionCard = (
    title: string,
    field: 'auditee_background' | 'opening_meeting' | 'closing_meeting',
    value: string,
    setValue: (v: string) => void,
    placeholder: string,
    inputKey: keyof UpsertIsaReportDraftInput,
    clearKey: keyof UpsertIsaReportDraftInput,
  ) => {
    const stored = draft?.[field] ?? null;
    const dirty = value !== (stored ?? '');
    return (
      <section className={`rounded-lg border ${cardBase}`}>
        <div className={`flex items-center justify-between px-4 py-3 border-b ${rowBorder}`}>
          <h3 className="text-fg-heading text-sm font-semibold">{title}</h3>
          <span className={`rounded border px-1.5 py-0.5 text-[10px] ${stored ? chipBase : `text-fg-muted ${isLight ? 'border-[#CBD5E1]' : 'border-white/15'}`}`}>
            {stored ? 'Auditor written' : 'Awaiting prose'}
          </span>
        </div>
        <div className="p-4 space-y-2">
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={3}
            placeholder={placeholder}
            className={`w-full rounded-md border px-3 py-2 text-sm text-fg-body placeholder:text-fg-muted outline-none resize-y ${inputBase}`}
          />
          <div className="flex items-center justify-end gap-2">
            {stored && (
              <button
                type="button"
                onClick={() => {
                  void save(field, { [clearKey]: true } as UpsertIsaReportDraftInput).then(
                    (ok) => ok && setValue(''),
                  );
                }}
                className="text-fg-muted text-xs hover:text-fg-body"
              >
                Clear
              </button>
            )}
            <button
              type="button"
              onClick={() => void save(field, { [inputKey]: value } as UpsertIsaReportDraftInput)}
              disabled={!dirty || !value.trim() || savingField === field}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-40 ${primaryBtn}`}
            >
              {savingField === field ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </section>
    );
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header + export bar */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-fg-label text-[10px] uppercase tracking-wider font-semibold">
            Stage 6 · Report drafting
          </p>
          <h2 className="text-fg-heading text-xl font-semibold mt-1">Audit report</h2>
          <p className="text-fg-sub text-sm mt-1.5 leading-relaxed max-w-2xl">
            Most of this report assembles itself from your findings. Write the prose
            sections, rule on site continuation, and take the report to Word or Google
            Docs formatted.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void copyReport()}
            disabled={!verdictSet}
            title={verdictSet ? 'Copy the full report — paste into Word or Google Docs' : 'Set the site continuation verdict first'}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-40 ${primaryBtn}`}
          >
            {copied === 'report' ? <Check size={13} /> : <ClipboardCopy size={13} />}
            {copied === 'report' ? 'Copied' : 'Copy for Word / Docs'}
          </button>
          <button
            type="button"
            onClick={() => void downloadDocx()}
            disabled={!verdictSet}
            title={verdictSet ? 'Download .docx' : 'Set the site continuation verdict first'}
            className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold text-fg-body disabled:opacity-40 ${inputBase}`}
          >
            <Download size={13} />
            .docx
          </button>
        </div>
      </div>

      {error && (
        <div className={`flex items-center justify-between gap-3 rounded-md border px-4 py-2.5 text-sm ${
          isLight ? 'bg-red-50 border-red-200 text-red-700' : 'bg-red-500/10 border-red-500/25 text-red-300'
        }`}>
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="flex-shrink-0 opacity-70 hover:opacity-100" aria-label="Dismiss error">
            <XIcon size={14} />
          </button>
        </div>
      )}

      {loading ? (
        <p className="text-fg-muted text-sm">Loading report…</p>
      ) : (
        <>
          {/* Site verdict — the gate */}
          <section className={`rounded-lg border ${cardBase}`}>
            <div className={`flex items-center gap-2 px-4 py-3 border-b ${rowBorder}`}>
              <Gavel size={15} className={brandText} />
              <h3 className="text-fg-heading text-sm font-semibold">Site continuation verdict</h3>
              {!verdictSet && (
                <span className={`ml-auto rounded border px-1.5 py-0.5 text-[10px] ${
                  isLight ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-amber-500/10 text-amber-300 border-amber-500/25'
                }`}>
                  Required before export
                </span>
              )}
            </div>
            <div className="p-4 space-y-2">
              <p className="text-fg-muted text-xs">
                The most consequential sentence in the report. PIQC never drafts it — you rule,
                the report renders your ruling.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={verdict}
                  onChange={(e) => setVerdict(e.target.value as IsaSiteVerdict | '')}
                  className={`rounded-md border px-2 py-1.5 text-xs text-fg-body outline-none ${inputBase}`}
                  aria-label="Site continuation verdict"
                >
                  <option value="">— Not yet ruled —</option>
                  {VERDICT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <input
                  value={verdictText}
                  onChange={(e) => setVerdictText(e.target.value)}
                  placeholder="Optional nuance appended to the verdict sentence"
                  className={`flex-1 min-w-[220px] rounded-md border px-3 py-1.5 text-xs text-fg-body placeholder:text-fg-muted outline-none ${inputBase}`}
                />
                <button
                  type="button"
                  onClick={() => {
                    if (!verdict) return;
                    void save('verdict', {
                      siteVerdict: verdict,
                      ...(verdictText.trim()
                        ? { siteVerdictText: verdictText.trim() }
                        : { clearSiteVerdictText: true }),
                    });
                  }}
                  disabled={!verdict || savingField === 'verdict'}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-40 ${primaryBtn}`}
                >
                  {savingField === 'verdict' ? 'Saving…' : 'Save verdict'}
                </button>
              </div>
            </div>
          </section>

          {/* Executive summary */}
          <section className={`rounded-lg border ${cardBase}`}>
            <div className={`flex items-center gap-2 px-4 py-3 border-b ${rowBorder}`}>
              <FileText size={15} className={brandText} />
              <h3 className="text-fg-heading text-sm font-semibold">Executive summary</h3>
              <span className={`ml-auto flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] ${chipBase}`}>
                {packet.execSummary.source === 'templated' ? (
                  <>
                    <PiqcMark size={9} />
                    Derives live from findings
                  </>
                ) : (
                  'Auditor edited'
                )}
              </span>
            </div>
            <div className="p-4 space-y-2">
              {execEditing ? (
                <>
                  <textarea
                    value={execText}
                    onChange={(e) => setExecText(e.target.value)}
                    rows={8}
                    className={`w-full rounded-md border px-3 py-2 text-sm text-fg-body outline-none resize-y ${inputBase}`}
                    aria-label="Executive summary"
                  />
                  <div className="flex items-center justify-end gap-2">
                    <button type="button" onClick={() => setExecEditing(false)} className="text-fg-muted text-xs hover:text-fg-body">
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void save('exec', { execSummary: execText }).then((ok) => ok && setExecEditing(false));
                      }}
                      disabled={!execText.trim() || savingField === 'exec'}
                      className={`rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-40 ${primaryBtn}`}
                    >
                      {savingField === 'exec' ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-fg-body text-sm whitespace-pre-wrap">{packet.execSummary.text}</p>
                  <div className="flex items-center justify-end gap-2">
                    {packet.execSummary.source === 'auditor_edited' && (
                      <button
                        type="button"
                        onClick={() => void save('exec', { clearExecSummary: true })}
                        className="text-fg-muted text-xs hover:text-fg-body"
                        title="Discard your edit and derive from findings again"
                      >
                        Return to template
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setExecText(packet.execSummary.text);
                        setExecEditing(true);
                      }}
                      className={`rounded-md border px-3 py-1.5 text-xs text-fg-body ${inputBase}`}
                    >
                      Edit
                    </button>
                  </div>
                </>
              )}
            </div>
          </section>

          {/* Prose sections */}
          {sectionCard('Auditee background', 'auditee_background', background, setBackground, AUDITEE_BACKGROUND_PLACEHOLDER, 'auditeeBackground', 'clearAuditeeBackground')}
          {sectionCard('Opening meeting', 'opening_meeting', opening, setOpening, OPENING_MEETING_PLACEHOLDER, 'openingMeeting', 'clearOpeningMeeting')}
          {sectionCard('Closing meeting', 'closing_meeting', closing, setClosing, CLOSING_MEETING_PLACEHOLDER, 'closingMeeting', 'clearClosingMeeting')}

          {/* Response clause */}
          <section className={`rounded-lg border ${cardBase} px-4 py-3`}>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-fg-heading text-sm font-semibold">Response window</h3>
              <div className="ml-auto flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={draft?.response_due_days ?? 30}
                  onChange={(e) => {
                    const days = parseInt(e.target.value, 10);
                    if (Number.isFinite(days) && days >= 1 && days <= 365) {
                      void save('response', { responseDueDays: days });
                    }
                  }}
                  className={`w-16 rounded-md border px-2 py-1 text-xs text-fg-body outline-none ${inputBase}`}
                  aria-label="Response due days"
                />
                <select
                  value={draft?.response_due_basis ?? 'CALENDAR'}
                  onChange={(e) => void save('response', { responseDueBasis: e.target.value as 'CALENDAR' | 'BUSINESS' })}
                  className={`rounded-md border px-2 py-1 text-xs text-fg-body outline-none ${inputBase}`}
                  aria-label="Response due basis"
                >
                  <option value="CALENDAR">calendar days</option>
                  <option value="BUSINESS">business days</option>
                </select>
              </div>
            </div>
            <p className="text-fg-muted text-xs mt-1.5">{packet.responseClause}</p>
          </section>

          {/* Observations preview + per-finding copy */}
          <section className={`rounded-lg border ${cardBase}`}>
            <div className={`flex items-center justify-between px-4 py-3 border-b ${rowBorder}`}>
              <h3 className="text-fg-heading text-sm font-semibold">Observations in this report</h3>
              <span className="text-fg-muted text-xs">
                {findings.length === 0
                  ? 'none yet — accept findings in Audit conduct'
                  : `${packet.counts.CRITICAL} critical · ${packet.counts.MAJOR} major · ${packet.counts.MINOR} minor · ${packet.counts.RECOMMENDATION} rec`}
              </span>
            </div>
            {findings.length > 0 && (
              <ul>
                {packet.groups.flatMap((g) =>
                  g.findings.map((f) => (
                    <li key={f.id} className={`flex items-start gap-2 px-4 py-2.5 border-t ${rowBorder} first:border-t-0`}>
                      <div className="min-w-0 flex-1">
                        <p className="text-fg-body text-sm">
                          <span className="font-semibold">[{g.heading.replace(' observations', '').replace('Recommendations', 'Recommendation')}]</span>{' '}
                          {f.title}
                          <span className="text-fg-muted text-xs"> · {ISA_DOMAIN_LABELS[f.isa_domain]}</span>
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void copyFinding(f)}
                        title="Copy this finding formatted — paste into an email or CAPA form"
                        className="text-fg-muted hover:text-fg-body p-1 flex-shrink-0"
                        aria-label={`Copy finding: ${f.title}`}
                      >
                        {copied === f.id ? <Check size={13} /> : <ClipboardCopy size={13} />}
                      </button>
                    </li>
                  )),
                )}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
