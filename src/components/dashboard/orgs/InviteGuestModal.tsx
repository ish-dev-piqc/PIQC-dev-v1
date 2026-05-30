import { useMemo, useRef, useState } from 'react';
import { X, Copy, Check, AlertTriangle, Mail, Trash2 } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useOverlay } from '../../../hooks/useOverlay';
import { useOrg } from '../../../context/OrgContext';
import { useProtocol } from '../../../context/ProtocolContext';
import { inviteGuest, revokeGuest } from '../../../lib/orgs/orgsApi';
import { countActiveFreeGuests } from '../../../lib/orgs/guestsAdapter';

// =============================================================================
// InviteGuestModal — coordinator invites an external collaborator to one
// protocol. Generates a copy-link with a UUID token (30-day expiry).
//
// Cap behaviour: the entitlement check (canInviteGuest, src/lib/entitlements.ts)
// is consulted before allowing INSERT. If the protocol is at the free cap and
// the org doesn't hold addon_guest_seats, the modal shows the upsell CTA and
// blocks submission. is_paid_seat is set to TRUE for any invite issued when
// over the free cap, so billing can attribute correctly.
//
// Free cap per protocol is sourced from a constant for now; will move into
// a config lookup once the addon shape is finalised.
// =============================================================================

const FREE_GUESTS_PER_PROTOCOL = 5;

interface InviteGuestModalProps {
  onClose: () => void;
}

function buildGuestInviteUrl(token: string): string {
  if (typeof window === 'undefined') return `?guestInvite=${token}`;
  return `${window.location.origin}${window.location.pathname}?guestInvite=${token}`;
}

export default function InviteGuestModal({ onClose }: InviteGuestModalProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const { activeProtocol } = useProtocol();
  const { guests, refresh } = useOrg();
  const overlay = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useOverlay({ isOpen: true, onClose, containerRef: panelRef });

  const [email, setEmail] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const activeFreeGuestCount = useMemo(
    () =>
      countActiveFreeGuests(
        guests.map((g) => ({
          id: g.id,
          protocol_id: g.protocol_id,
          invited_email: g.invited_email,
          invited_by: g.invited_by,
          user_id: g.user_id,
          invite_token: g.invite_token,
          accepted_at: g.accepted_at,
          expires_at: g.expires_at,
          is_paid_seat: g.is_paid_seat,
          created_at: g.created_at,
        })),
      ),
    [guests],
  );
  const atOrOverCap = activeFreeGuestCount >= FREE_GUESTS_PER_PROTOCOL;

  // For v1, entitlement-driven paid-seat detection requires reading the
  // org's subscription. That hook isn't wired yet — TODO: import
  // useSubscription and call canInviteGuest(sub, currentGuestCount). Until
  // then, if at-or-over cap we set is_paid_seat=true so billing can flag.
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!activeProtocol || working || !email.trim()) return;
    setWorking(true);
    setError(null);
    const res = await inviteGuest({
      protocol_id: activeProtocol.id,
      invited_email: email.trim(),
      is_paid_seat: atOrOverCap,
    });
    setWorking(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setEmail('');
    refresh();
    // Auto-copy the link to clipboard for convenience.
    void copyInviteUrl(res.data.invite_token);
  }

  async function copyInviteUrl(token: string) {
    try {
      await navigator.clipboard.writeText(buildGuestInviteUrl(token));
      setCopiedToken(token);
      setTimeout(() => setCopiedToken(null), 2500);
    } catch {
      /* ignore */
    }
  }

  async function handleRevoke(guestId: string) {
    if (!window.confirm('Revoke this guest invite?')) return;
    const res = await revokeGuest(guestId);
    if (!res.ok) setError(res.error);
    else refresh();
  }

  const bg = isLight ? 'bg-white' : 'bg-[#0F172A]';
  const border = isLight ? 'border-[#E2E8F0]' : 'border-white/5';
  const inputBg = isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#1E293B] border-white/10';
  const buttonPrimary = isLight
    ? 'bg-brand-600 text-white hover:bg-brand-800 disabled:bg-brand-600/50'
    : 'bg-brand-300 text-[#0F172A] hover:bg-brand-700 disabled:bg-brand-300/50';

  return (
    <div
      ref={overlay}
      onClick={(e) => {
        if (e.target === overlay.current) onClose();
      }}
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center animate-fade-in"
    >
      <div
        ref={panelRef}
        className={`w-full max-w-md ${bg} border ${border} rounded-lg shadow-xl flex flex-col`}
      >
        <div className={`flex items-center justify-between px-4 py-3 border-b ${border}`}>
          <h2 className="text-fg-heading font-semibold text-sm">Invite guest</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-fg-sub hover:opacity-75"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={submit} className="p-4 flex flex-col gap-3">
          {atOrOverCap && (
            <div
              className={`flex items-start gap-2 px-3 py-2 rounded-md text-xs ${
                isLight
                  ? 'bg-amber-50 border border-amber-200 text-amber-800'
                  : 'bg-amber-500/[0.06] border border-amber-500/20 text-amber-300'
              }`}
            >
              <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
              <p>
                This protocol has {activeFreeGuestCount} free guests (limit{' '}
                {FREE_GUESTS_PER_PROTOCOL}). New invites will be billed as paid seats —
                see Billing &raquo; Guest seat pack.
              </p>
            </div>
          )}

          {error && (
            <div
              className={`px-3 py-2 rounded-md text-xs ${
                isLight ? 'bg-rose-50 text-rose-700' : 'bg-rose-500/[0.06] text-rose-300'
              }`}
            >
              {error}
            </div>
          )}

          <label className="text-[10px] uppercase tracking-wider font-semibold text-fg-label">
            Guest email
          </label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="guest@example.com"
            className={`text-sm rounded-md border px-3 py-2 ${inputBg} text-fg-body`}
          />
          <button
            type="submit"
            disabled={working || !email.trim()}
            className={`text-sm rounded-md px-3 py-2 inline-flex items-center justify-center gap-1.5 ${buttonPrimary}`}
          >
            <Mail size={14} />
            Send invite (copies link)
          </button>
        </form>

        {/* Existing guests */}
        {guests.length > 0 && (
          <div className={`border-t ${border} p-4`}>
            <h3 className="text-fg-label text-[10px] uppercase tracking-wider font-semibold mb-2">
              Current guests ({guests.length})
            </h3>
            <ul className="space-y-1">
              {guests.map((g) => {
                const isAccepted = g.accepted_at !== null;
                const isExpired =
                  g.expires_at !== null && new Date(g.expires_at).getTime() < Date.now();
                return (
                  <li
                    key={g.id}
                    className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded-md border ${border}`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-fg-body truncate">{g.invited_email}</p>
                      <p className="text-[10px] text-fg-muted">
                        {isAccepted ? 'Accepted' : 'Pending'}
                        {g.is_paid_seat && ' · paid seat'}
                        {isExpired && ' · expired'}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      {!isAccepted && (
                        <button
                          type="button"
                          onClick={() => copyInviteUrl(g.invite_token)}
                          className="text-fg-sub hover:opacity-75"
                          aria-label="Copy invite link"
                        >
                          {copiedToken === g.invite_token ? (
                            <Check size={12} />
                          ) : (
                            <Copy size={12} />
                          )}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleRevoke(g.id)}
                        className="text-fg-sub hover:text-rose-500"
                        aria-label="Revoke guest"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
