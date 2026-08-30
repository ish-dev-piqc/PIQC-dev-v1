import { useState } from 'react';
import { Calendar, AlertTriangle, ChevronDown } from 'lucide-react';
import { rescheduleAudit } from '../../../lib/audit/auditApi';
import { formatAuditWindow } from '../../../lib/audit/dateWindow';
import type { AuditWithContext } from '../../../context/AuditContext';

// =============================================================================
// RescheduleAuditPopover — the workspace header's date line.
//
// Real audits get rescheduled; the date itself is the affordance (the header
// actions row is at its documented ceiling — no new always-on button). The
// trigger shows the scheduled window ("Sep 15 – 17, 2026") or "Not scheduled";
// clicking opens a small popover: start / optional end / optional reason /
// Save. Clearing both dates is allowed — every change is recorded as an
// 'AUDIT' delta by audit_mode_reschedule_audit, visible under Records →
// Audit history.
//
// Same lightweight local popover mechanics as the shell's Records menu:
// backdrop for outside click, wrapper Escape — deliberately NOT useOverlay
// (its scroll lock + focus trap are drawer semantics).
// =============================================================================

interface Props {
  audit: AuditWithContext;
  isLight: boolean;
  /** Usually AuditContext's refresh — the popover awaits it before closing. */
  onRescheduled: () => Promise<void> | void;
}

export default function RescheduleAuditPopover({ audit, isLight, onRescheduled }: Props) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const windowLabel = formatAuditWindow(audit.scheduled_date, audit.scheduled_end_date);

  const openPopover = () => {
    // Seed from the current audit each time — a stale draft from a previous
    // open would silently revert someone else's newer dates on Save.
    setStart(audit.scheduled_date ?? '');
    setEnd(audit.scheduled_end_date ?? '');
    setReason('');
    setError(null);
    setOpen(true);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    const result = await rescheduleAudit(
      audit.id,
      start || null,
      end || null,
      reason.trim() || undefined,
    );
    if (!result.ok) {
      setError(result.errorMessage ?? 'Could not reschedule the audit.');
      setSaving(false);
      return;
    }
    await onRescheduled();
    setSaving(false);
    setOpen(false);
  };

  const inputClass = `w-full rounded-md border px-2 py-1.5 text-xs focus:outline-none disabled:opacity-50 ${
    isLight
      ? 'bg-white border-[#E2E8F0] text-fg-heading'
      : 'bg-[#0F172A] border-white/10 text-fg-heading'
  }`;
  const fieldLabel = 'block text-[10px] uppercase tracking-wider font-semibold text-fg-label mb-1';

  return (
    <div
      className="relative"
      onKeyDown={(e) => {
        if (e.key === 'Escape') setOpen(false);
      }}
    >
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openPopover())}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Reschedule this audit"
        data-testid="audit-reschedule-trigger"
        className="mt-1 inline-flex items-center gap-1.5 text-xs transition-colors text-fg-sub hover:text-fg-heading"
      >
        <Calendar size={12} />
        {windowLabel ?? 'Not scheduled · set dates'}
        <ChevronDown size={12} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div
            role="dialog"
            aria-label="Reschedule audit"
            className={`absolute left-0 top-full mt-1 z-40 w-72 rounded-lg border shadow-lg p-3 ${
              isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/10'
            }`}
          >
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={fieldLabel}>From</label>
                <input
                  type="date"
                  aria-label="Start date"
                  value={start}
                  onChange={(e) => {
                    setStart(e.target.value);
                    // A window can't outlive its start — the RPC rejects
                    // end-without-start.
                    if (!e.target.value) setEnd('');
                  }}
                  className={inputClass}
                  disabled={saving}
                />
              </div>
              <div>
                <label className={fieldLabel}>To (optional)</label>
                <input
                  type="date"
                  aria-label="End date"
                  value={end}
                  min={start || undefined}
                  onChange={(e) => setEnd(e.target.value)}
                  className={inputClass}
                  disabled={saving || !start}
                />
              </div>
            </div>
            <input
              type="text"
              aria-label="Reason"
              placeholder="Reason (optional)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className={`mt-2 ${inputClass}`}
              disabled={saving}
            />
            {error && (
              <p role="alert" className={`mt-2 flex items-start gap-1.5 text-[11px] ${isLight ? 'text-red-700' : 'text-red-300'}`}>
                <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
                {error}
              </p>
            )}
            <div className="mt-3 flex items-center justify-between">
              {start ? (
                <button
                  type="button"
                  onClick={() => {
                    // Clears the inputs only — the auditor still presses Save,
                    // and the RPC records the cleared window as a delta.
                    setStart('');
                    setEnd('');
                  }}
                  disabled={saving}
                  className="text-[11px] text-fg-muted hover:text-fg-sub"
                >
                  Clear dates
                </button>
              ) : (
                <span />
              )}
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving}
                className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md border transition-colors disabled:opacity-50 ${
                  isLight
                    ? 'bg-brand-600/10 border-brand-600 text-brand-600 hover:bg-brand-600/15'
                    : 'bg-brand-600/15 border-brand-300 text-brand-300 hover:bg-brand-600/25'
                }`}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
