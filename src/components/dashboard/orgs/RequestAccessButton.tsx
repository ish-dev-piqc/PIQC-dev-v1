import { useEffect, useState } from 'react';
import { Lock, Clock, Check } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useOrg } from '../../../context/OrgContext';
import {
  createAccessRequest,
  listMyAccessRequests,
} from '../../../lib/orgs/orgsApi';
import type { ProtocolAccessRequest } from '../../../types/orgs';

// =============================================================================
// RequestAccessButton — surface for non-members who can see a protocol's
// metadata (org roster) but not its data.
//
// Three states:
//   idle      — "Request access" button + optional message input on click
//   pending   — request submitted, awaiting coordinator action
//   approved  — request was approved (caller now has data access; parent
//               component should rerender to show data instead of the button)
//   denied    — gentle re-request affordance, since denial may be temporary
//
// Reads the caller's own access requests once on mount; relies on
// OrgContext's realtime to refresh state when a coordinator resolves.
// =============================================================================

interface RequestAccessButtonProps {
  protocolId: string;
}

export default function RequestAccessButton({ protocolId }: RequestAccessButtonProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const { currentUserId, refresh } = useOrg();
  const [myRequests, setMyRequests] = useState<ProtocolAccessRequest[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [message, setMessage] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    listMyAccessRequests().then((res) => {
      if (mounted && res.ok) setMyRequests(res.data);
    });
    return () => {
      mounted = false;
    };
  }, [currentUserId, protocolId]);

  // Pick the most recent request for this protocol (descending order from API).
  const latest = myRequests.find((r) => r.protocol_id === protocolId);

  async function submit() {
    if (working) return;
    setWorking(true);
    setError(null);
    const res = await createAccessRequest(protocolId, message.trim() || undefined);
    setWorking(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setMyRequests((prev) => [res.data, ...prev]);
    setShowForm(false);
    setMessage('');
    refresh();
  }

  const baseBtn =
    'inline-flex items-center gap-1.5 text-xs rounded-md px-3 py-1.5 border';
  const buttonPrimary = isLight
    ? 'bg-brand-600 text-white border-brand-600 hover:bg-brand-800'
    : 'bg-brand-300 text-[#0F172A] border-brand-300 hover:bg-brand-700';
  const buttonNeutral = isLight
    ? 'bg-white text-fg-body border-[#E2E8F0] hover:bg-slate-50'
    : 'bg-[#1E293B] text-fg-body border-white/10 hover:bg-white/[0.04]';

  if (latest?.status === 'pending') {
    return (
      <span
        className={`${baseBtn} ${buttonNeutral} opacity-80 cursor-default`}
        title={`Requested ${new Date(latest.requested_at).toLocaleString()}`}
      >
        <Clock size={12} />
        Request pending
      </span>
    );
  }

  if (latest?.status === 'approved') {
    return (
      <span
        className={`${baseBtn} ${buttonNeutral} text-emerald-600`}
        title="Access granted — refresh to view"
      >
        <Check size={12} />
        Approved
      </span>
    );
  }

  if (showForm) {
    return (
      <div className="flex flex-col gap-2 max-w-sm">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Optional message to the coordinator…"
          rows={2}
          className={`text-xs rounded-md border px-2 py-1.5 ${
            isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#1E293B] border-white/10'
          } text-fg-body`}
        />
        {error && (
          <p className={`text-xs ${isLight ? 'text-rose-700' : 'text-rose-300'}`}>
            {error}
          </p>
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={submit}
            disabled={working}
            className={`${baseBtn} ${buttonPrimary} disabled:opacity-50`}
          >
            Send request
          </button>
          <button
            type="button"
            onClick={() => {
              setShowForm(false);
              setMessage('');
              setError(null);
            }}
            className={`${baseBtn} ${buttonNeutral}`}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setShowForm(true)}
      className={`${baseBtn} ${buttonPrimary}`}
      title={latest?.status === 'denied' ? 'Previous request was denied — try again' : undefined}
    >
      <Lock size={12} />
      {latest?.status === 'denied' ? 'Request access again' : 'Request access'}
    </button>
  );
}
