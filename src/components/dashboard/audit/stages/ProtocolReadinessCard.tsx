import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileText, Loader, RefreshCw, Upload } from 'lucide-react';
import { useTheme } from '../../../../context/ThemeContext';
import { useAudit } from '../../../../context/AuditContext';
import { useOpenProtocolSource } from '../protocolSourceDrawerContext';
import { uploadProtocolPdf } from '../../../../lib/audit/auditCreationApi';
import {
  checkIngestStatus,
  deriveProtocolReadiness,
  fetchProtocolDocumentStatus,
  type ProtocolReadiness,
} from '../../../../lib/audit/protocolReadinessApi';

// =============================================================================
// ProtocolReadinessCard — Stage 1 (both workflows): is this audit's protocol
// parsed, and if not, what is true right now?
//
// A read model over audit_mode_protocol_document_status plus one guarded
// action. It never writes protocol content itself: the upload goes through
// /ingest with the audit's protocol pinned, and only where nothing usable
// exists (none / failed / parsed-without-items) — a pinned re-upload regenerates
// the protocol's cohorts and visit templates (Site Mode data), so it is never
// offered over a good parse and always sits behind a confirm that says so.
//
// Polling (10 s) runs only while the caller's own upload is pending, with an
// in-flight guard (ingest-status runs the 60–120 s completion while still
// answering "pending"), stops after 3 consecutive failures, and caps at 15
// minutes (server-side recovery: webhook or the 5-minute ingest-recover cron).
// The loop is a port of KnowledgeBase's, not an import (mode isolation).
//
// Honest-degradation: { available: false } (RPC not applied yet) renders a
// neutral line with no counts and no upload control — never "no protocol".
// =============================================================================

const POLL_INTERVAL_MS = 10_000;
const POLL_MAX_FAILURES = 3;
const POLL_CAP_MS = 15 * 60_000;

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error'; error: string }
  | { phase: 'loaded'; readiness: ProtocolReadiness };

type PollNote = null | 'unreachable' | 'stalled';

export default function ProtocolReadinessCard() {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const { activeAudit } = useAudit();
  const openProtocolSource = useOpenProtocolSource();

  const auditId = activeAudit?.id ?? null;
  const protocolId = activeAudit?.protocol_id ?? null;

  const [load, setLoad] = useState<LoadState>({ phase: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);
  const [pollDocId, setPollDocId] = useState<string | null>(null);
  const [pollEpoch, setPollEpoch] = useState(0);
  const [pollNote, setPollNote] = useState<PollNote>(null);
  // A failure the poll saw happen. Kept until the next upload so the refetch
  // (which may resolve to "parsed without items" from an older document) can't
  // hide what the auditor just watched fail.
  const [liveFailure, setLiveFailure] = useState<string | null>(null);
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dedupeNotice, setDedupeNotice] = useState<string | null>(null);

  // Audit switch: every piece of per-audit UI state goes, in one place.
  useEffect(() => {
    setPollDocId(null);
    setPollNote(null);
    setLiveFailure(null);
    setPickedFile(null);
    setUploadError(null);
    setDedupeNotice(null);
  }, [auditId]);

  // Status read — on mount, audit switch, and every explicit reload.
  useEffect(() => {
    if (!auditId) return;
    let cancelled = false;
    setLoad({ phase: 'loading' });
    void fetchProtocolDocumentStatus(auditId).then((res) => {
      if (cancelled) return;
      if (!res.ok) {
        setLoad({ phase: 'error', error: res.error });
        return;
      }
      setLoad({ phase: 'loaded', readiness: res.data });
      // Resume a parse started elsewhere (new-audit drawer) or left mid-way.
      if (res.data.available && res.data.own_pending_document_id) {
        setPollDocId(res.data.own_pending_document_id);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [auditId, reloadToken]);

  // Poll loop — one effect keyed on the document being parsed.
  useEffect(() => {
    if (!pollDocId) return;
    let cancelled = false;
    let inFlight = false;
    let failures = 0;
    let intervalId = 0;
    const startedAt = Date.now();
    setPollNote(null);

    const stop = () => {
      window.clearInterval(intervalId);
    };

    const tick = async () => {
      if (cancelled || inFlight) return;
      if (Date.now() - startedAt > POLL_CAP_MS) {
        setPollNote('stalled');
        stop();
        return;
      }
      inFlight = true;
      const res = await checkIngestStatus(pollDocId);
      inFlight = false;
      if (cancelled) return;
      if (!res.ok) {
        failures += 1;
        if (failures >= POLL_MAX_FAILURES) {
          setPollNote('unreachable');
          stop();
        }
        return;
      }
      failures = 0;
      if (res.data.status === 'pending') return;
      if (res.data.status === 'failed') {
        setLiveFailure(res.data.error_message ?? 'Parse failed');
      }
      stop();
      setPollDocId(null);
      setReloadToken((t) => t + 1);
    };

    void tick();
    intervalId = window.setInterval(() => {
      void tick();
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      stop();
    };
  }, [pollDocId, pollEpoch]);

  const reload = () => setReloadToken((t) => t + 1);

  const handleUpload = async () => {
    if (!pickedFile || !protocolId) return;
    setUploading(true);
    setUploadError(null);
    setDedupeNotice(null);
    setLiveFailure(null);
    try {
      const res = await uploadProtocolPdf(pickedFile, undefined, protocolId);
      setPickedFile(null);
      if (res.deduped && res.protocol_id !== protocolId) {
        // /ingest returned the EXISTING document (same bytes, same user) with
        // its original pin — another protocol, or none (no client path can
        // set the pin; ledgered). Nothing to poll: no new parse was started.
        setDedupeNotice(
          res.protocol_id
            ? "This PDF is already in your library under another protocol. PIQC won't parse it twice."
            : "This PDF is already in your library but isn't linked to a protocol. PIQC won't parse it twice.",
        );
      } else if (res.status === 'ready') {
        reload();
      } else {
        setPollDocId(res.document_id);
        setPollEpoch((e) => e + 1);
      }
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Protocol upload failed');
    } finally {
      setUploading(false);
    }
  };

  if (!activeAudit) return null;

  const readiness = load.phase === 'loaded' ? load.readiness : null;
  const status = readiness && readiness.available ? readiness : null;
  const state = status ? deriveProtocolReadiness(status) : null;
  const parsing = pollDocId !== null;
  const failure = liveFailure ?? (state?.kind === 'failed' ? state.error : null);
  const uploadAllowed =
    !parsing &&
    !!state &&
    (failure !== null || state.kind === 'none' || state.kind === 'ready_no_items');

  const cardBase = isLight ? 'bg-white border-[#E2E8F0]' : 'bg-white/[0.02] border-white/10';
  const rowBorder = isLight ? 'border-[#EEF2F6]' : 'border-white/5';
  const accent = isLight ? 'text-brand-600' : 'text-brand-300';
  const buttonPrimary = isLight
    ? 'bg-brand-600 text-white hover:bg-brand-800 disabled:bg-[#CBD5E1]'
    : 'bg-brand-300 text-[#0F172A] hover:bg-brand-700 disabled:bg-white/10 disabled:text-white/35';
  const buttonSecondary = isLight
    ? 'bg-white border border-[#E2E8F0] text-[#334155] hover:bg-[#F8FAFC]'
    : 'bg-[#0F172A] border border-white/10 text-[#CBD5E1] hover:bg-white/[0.04]';
  const dashedLabel = isLight
    ? 'border-[#CBD5E1] hover:border-brand-600/40 hover:bg-white text-[#334155]/75'
    : 'border-white/15 hover:border-brand-300/40 hover:bg-white/[0.03] text-[#CBD5E1]/70';

  const uploadLabel =
    failure !== null
      ? 'Upload again'
      : state?.kind === 'ready_no_items'
        ? 'Upload a different PDF'
        : 'Upload protocol PDF';

  const renderBody = () => {
    if (load.phase === 'loading') {
      return <p className="text-fg-sub text-sm">Checking parsed protocol…</p>;
    }
    if (load.phase === 'error') {
      return (
        <div className="flex items-start justify-between gap-3">
          <p role="alert" className="text-fg-sub text-sm">
            Couldn't load protocol status: {load.error}
          </p>
          <button
            type="button"
            onClick={reload}
            className={`shrink-0 text-xs font-semibold px-3 py-1.5 rounded-md transition-colors ${buttonSecondary}`}
          >
            Retry
          </button>
        </div>
      );
    }
    if (!status) {
      return (
        <p className="text-fg-sub text-sm">
          Parse status isn't available in this environment yet.
        </p>
      );
    }
    if (parsing) {
      return (
        <div className="space-y-2">
          <p className="text-fg-body text-sm inline-flex items-center gap-2">
            <Loader size={14} className={`animate-spin ${accent}`} />
            Parsing {activeAudit.protocol_title}… PIQC checks every 10 seconds while this
            stage is open; usually 1–3 minutes.
          </p>
          {pollNote === 'stalled' && (
            <p className="text-fg-muted text-xs inline-flex items-center gap-2">
              Still parsing — taking longer than usual.
              <button
                type="button"
                onClick={() => setPollEpoch((e) => e + 1)}
                className={`text-xs font-semibold px-2.5 py-1 rounded-md transition-colors ${buttonSecondary}`}
              >
                Check again
              </button>
            </p>
          )}
          {pollNote === 'unreachable' && (
            <p role="alert" className="text-fg-muted text-xs inline-flex items-center gap-2">
              Couldn't check parse status.
              <button
                type="button"
                onClick={() => setPollEpoch((e) => e + 1)}
                className={`text-xs font-semibold px-2.5 py-1 rounded-md transition-colors ${buttonSecondary}`}
              >
                Retry
              </button>
            </p>
          )}
        </div>
      );
    }
    if (failure !== null) {
      return (
        <p role="alert" className="text-fg-body text-sm inline-flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-red-500" />
          <span>Parse failed: {failure}.</span>
        </p>
      );
    }
    if (state?.kind === 'ready') {
      return (
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <p className="text-fg-body text-sm inline-flex items-center gap-2">
              <CheckCircle2 size={14} className={accent} />
              Parsed · {state.itemCount} worksheet item{state.itemCount === 1 ? '' : 's'} visible.
            </p>
            {openProtocolSource && (
              <button
                type="button"
                onClick={openProtocolSource}
                className={`shrink-0 text-xs font-semibold px-3 py-1.5 rounded-md transition-colors ${buttonSecondary}`}
              >
                Open protocol source
              </button>
            )}
          </div>
      );
    }
    if (state?.kind === 'ready_no_items') {
      return (
        <p className="text-fg-body text-sm">
          Parsed, but no worksheet items were extracted. Re-uploading the same file
          returns the same result — use a text-based, not scanned, PDF.
        </p>
      );
    }
    if (state?.kind === 'parsing_elsewhere') {
      return (
          <div className="flex items-start justify-between gap-3">
            <p className="text-fg-body text-sm">
              A copy is being parsed under another account. Items appear here when it
              finishes.
            </p>
            <button
              type="button"
              onClick={reload}
              className={`shrink-0 inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-md transition-colors ${buttonSecondary}`}
            >
              <RefreshCw size={12} />
              Check again
            </button>
          </div>
      );
    }
    return (
      <p className="text-fg-body text-sm">
        No protocol PDF has been parsed for {activeAudit.protocol_code}. Upload it to
        extract worksheet items and unlock protocol citations in PIQC drafts.
      </p>
    );
  };

  return (
    <section className={`rounded-lg border ${cardBase}`} aria-label="Parsed protocol">
      <div className={`flex items-center gap-2 px-4 py-3 border-b ${rowBorder}`}>
        <FileText size={15} className={accent} />
        <h3 className="text-fg-heading text-sm font-semibold">Parsed protocol</h3>
        <span className="text-fg-muted text-xs truncate">
          {activeAudit.protocol_code} · {activeAudit.protocol_title}
        </span>
      </div>
      <div className="px-4 py-3 space-y-3">
        {renderBody()}

        {dedupeNotice && <p className="text-fg-muted text-xs">{dedupeNotice}</p>}
        {uploadError && (
          <p role="alert" className="text-xs text-red-500">
            Couldn't upload: {uploadError}
          </p>
        )}

        {uploadAllowed && !pickedFile && (
          <label
            className={`flex items-center justify-center gap-2 w-full px-3 py-3 rounded-md border border-dashed cursor-pointer transition-colors ${dashedLabel}`}
          >
            <Upload size={14} className="text-fg-muted" />
            <span className="text-sm">{uploadLabel}</span>
            <input
              type="file"
              accept="application/pdf,.pdf"
              className="sr-only"
              onChange={(e) => {
                setPickedFile(e.target.files?.[0] ?? null);
                e.target.value = '';
              }}
            />
          </label>
        )}

        {pickedFile && (
          <div className={`rounded-md border px-3 py-3 space-y-2 ${cardBase}`}>
            <p className="text-fg-heading text-sm font-medium">
              Parse {pickedFile.name} as {activeAudit.protocol_code} — {activeAudit.protocol_title}?
            </p>
            <p className="text-fg-sub text-xs">
              Parsing regenerates this protocol's extracted schedule data (cohorts, visit
              templates).
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPickedFile(null)}
                disabled={uploading}
                className={`text-xs font-medium px-2.5 py-1.5 rounded-md ${buttonSecondary} disabled:opacity-50`}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleUpload()}
                disabled={uploading}
                className={`text-xs font-semibold px-2.5 py-1.5 rounded-md transition-colors disabled:opacity-50 ${buttonPrimary}`}
              >
                {uploading ? 'Uploading…' : 'Upload'}
              </button>
            </div>
          </div>
        )}

        {status && (
          <p className="text-fg-muted text-[11px]">
            PIQC drafts can cite this protocol: {status.any_ready > 0 ? 'yes' : 'no'}
          </p>
        )}
      </div>
    </section>
  );
}
