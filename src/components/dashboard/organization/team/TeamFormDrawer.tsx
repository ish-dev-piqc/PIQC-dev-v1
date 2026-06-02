import { useEffect, useRef, useState } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import { useTheme } from '../../../../context/ThemeContext';
import { useOverlay } from '../../../../hooks/useOverlay';
import { useSwipeDismiss } from '../../../../hooks/useSwipeDismiss';
import { createTeamMember, updateTeamMember } from '../../../../lib/site/siteApi';
import type { SiteTeamMember, TeamRole, TeamMemberStatus } from '../../../../lib/site/types';
import { TEAM_ROLE_LABELS } from '../../../../lib/site/labels';

// =============================================================================
// TeamFormDrawer — add or edit a site_team_members row.
//
// Edit mode: pre-populates the form from `initial` and submits via
// updateTeamMember.
//
// Create mode: same form, submits via createTeamMember scoped to the
// passed-in protocolId. Used by the Organization → Team → "Add clinical
// staff" affordance to register clinical roles for people who may not be
// PIQC users (e.g. a pharmacist who never logs in). Email is optional —
// presence of the row is what powers the delegation log + cert tracking.
// =============================================================================

const ROLE_OPTIONS: TeamRole[] = ['PI', 'SUB_I', 'COORDINATOR', 'NURSE', 'PHARMACIST', 'MONITOR'];
const STATUS_OPTIONS: TeamMemberStatus[] = ['ACTIVE', 'INACTIVE'];

interface TeamFormDrawerProps {
  mode: 'create' | 'edit';
  protocolId: string;
  initial?: SiteTeamMember; // required when mode='edit'
  onClose: () => void;
}

export default function TeamFormDrawer({ mode, protocolId, initial, onClose }: TeamFormDrawerProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const overlay = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useOverlay({ isOpen: true, onClose, containerRef: panelRef });
  const swipe = useSwipeDismiss({ onClose });

  const [name, setName] = useState(initial?.name ?? '');
  const [role, setRole] = useState<TeamRole>(initial?.role ?? 'COORDINATOR');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [delegatedTasksText, setDelegatedTasksText] = useState(
    (initial?.delegated_tasks ?? []).join(', '),
  );
  const [certifiedThrough, setCertifiedThrough] = useState(initial?.certified_through ?? '');
  const [status, setStatus] = useState<TeamMemberStatus>(initial?.status ?? 'ACTIVE');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const validate = (): string | null => {
    if (!name.trim()) return 'Name is required.';
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      return 'Email address is not valid.';
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setSubmitting(true);
    setError(null);

    const delegated_tasks = delegatedTasksText
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    const payload = {
      name: name.trim(),
      role,
      email: email.trim() || null,
      delegated_tasks,
      certified_through: certifiedThrough || null,
      status,
      notes: notes.trim() || null,
    };

    const result =
      mode === 'edit'
        ? await updateTeamMember(initial!.id, payload)
        : await createTeamMember({ protocol_id: protocolId, ...payload });

    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onClose();
  };

  const bg = isLight ? 'bg-white' : 'bg-[#0F172A]';
  const border = isLight ? 'border-[#E2E8F0]' : 'border-white/5';
  const inputBg = isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#1E293B] border-white/10';
  const headingColor = 'text-fg-heading';
  const labelColor = 'text-fg-label';
  const subColor = 'text-fg-sub';
  const buttonPrimary = isLight
    ? 'bg-brand-600 text-white hover:bg-brand-800 disabled:bg-brand-600/50'
    : 'bg-brand-300 text-[#0F172A] hover:bg-brand-700 disabled:bg-brand-300/50';
  const buttonSecondary = isLight
    ? 'bg-white border border-[#E2E8F0] text-[#334155] hover:bg-[#F8FAFC]'
    : 'bg-[#0F172A] border border-white/5 text-[#CBD5E1] hover:bg-white/[0.04]';

  return (
    <div
      ref={overlay}
      onClick={(e) => {
        if (e.target === overlay.current) onClose();
      }}
      className="fixed inset-0 z-50 bg-black/30 flex justify-end animate-fade-in"
    >
      <div
        ref={panelRef}
        className={`w-full max-w-md h-full ${bg} border-l ${border} shadow-xl flex flex-col animate-slide-in-right`}
        {...swipe}
      >
        <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden">
          <div className={`flex items-center justify-between px-5 py-4 border-b ${border}`}>
            <h2 className={`${headingColor} font-semibold text-base`}>
              {mode === 'create' ? 'Add team member' : `Edit ${initial?.name ?? ''}`}
            </h2>
            <button type="button" onClick={onClose} className={`${subColor} hover:opacity-75`} aria-label="Close">
              <X size={18} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            <div>
              <label className={`block ${labelColor} text-xs font-semibold uppercase tracking-wider mb-1.5`}>
                Name *
              </label>
              <input
                ref={nameRef}
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Sarah Chen"
                className={`w-full px-3 py-2 text-sm rounded-md border ${inputBg} ${headingColor} placeholder:${subColor} focus:outline-none focus:ring-2 focus:ring-brand-600/30`}
                disabled={submitting}
              />
            </div>

            <div>
              <label className={`block ${labelColor} text-xs font-semibold uppercase tracking-wider mb-1.5`}>
                Role *
              </label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as TeamRole)}
                className={`w-full px-3 py-2 text-sm rounded-md border ${inputBg} ${headingColor} focus:outline-none focus:ring-2 focus:ring-brand-600/30`}
                disabled={submitting}
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {TEAM_ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={`block ${labelColor} text-xs font-semibold uppercase tracking-wider mb-1.5`}>
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                className={`w-full px-3 py-2 text-sm rounded-md border ${inputBg} ${headingColor} placeholder:${subColor} focus:outline-none focus:ring-2 focus:ring-brand-600/30`}
                disabled={submitting}
              />
            </div>

            <div>
              <label className={`block ${labelColor} text-xs font-semibold uppercase tracking-wider mb-1.5`}>
                Delegated tasks
              </label>
              <input
                type="text"
                value={delegatedTasksText}
                onChange={(e) => setDelegatedTasksText(e.target.value)}
                placeholder="Comma-separated, e.g. Informed consent, Vitals, ECG"
                className={`w-full px-3 py-2 text-sm rounded-md border ${inputBg} ${headingColor} placeholder:${subColor} focus:outline-none focus:ring-2 focus:ring-brand-600/30`}
                disabled={submitting}
              />
              <p className={`${subColor} text-[11px] mt-1`}>Split by commas. Trailing/leading spaces trimmed.</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={`block ${labelColor} text-xs font-semibold uppercase tracking-wider mb-1.5`}>
                  Certified through
                </label>
                <input
                  type="date"
                  value={certifiedThrough}
                  onChange={(e) => setCertifiedThrough(e.target.value)}
                  className={`w-full px-3 py-2 text-sm rounded-md border ${inputBg} ${headingColor} focus:outline-none focus:ring-2 focus:ring-brand-600/30`}
                  disabled={submitting}
                />
              </div>
              <div>
                <label className={`block ${labelColor} text-xs font-semibold uppercase tracking-wider mb-1.5`}>
                  Status
                </label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as TeamMemberStatus)}
                  className={`w-full px-3 py-2 text-sm rounded-md border ${inputBg} ${headingColor} focus:outline-none focus:ring-2 focus:ring-brand-600/30`}
                  disabled={submitting}
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s.charAt(0) + s.slice(1).toLowerCase()}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className={`block ${labelColor} text-xs font-semibold uppercase tracking-wider mb-1.5`}>
                Notes
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Optional context (e.g. on leave through Sept; GCP cert pending re-test)."
                className={`w-full px-3 py-2 text-sm rounded-md border ${inputBg} ${headingColor} placeholder:${subColor} focus:outline-none focus:ring-2 focus:ring-brand-600/30 resize-none`}
                disabled={submitting}
              />
            </div>

            {error && (
              <div
                className={`flex items-start gap-2 px-3 py-2 rounded-md text-xs ${
                  isLight
                    ? 'bg-rose-50 border border-rose-200 text-rose-700'
                    : 'bg-rose-500/[0.06] border border-rose-500/20 text-rose-300'
                }`}
              >
                <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>

          <div className={`flex items-center justify-end gap-2 px-5 py-3.5 border-t ${border}`}>
            <button type="button" onClick={onClose} disabled={submitting} className={`px-4 py-1.5 text-sm rounded-md transition-colors ${buttonSecondary} disabled:opacity-50`}>
              Cancel
            </button>
            <button type="submit" disabled={submitting} className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${buttonPrimary}`}>
              {submitting ? 'Saving…' : mode === 'create' ? 'Add team member' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
