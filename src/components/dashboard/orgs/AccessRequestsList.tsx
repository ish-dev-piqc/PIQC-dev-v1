import { useState } from 'react';
import { Check, X as XIcon } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useOrg } from '../../../context/OrgContext';
import { approveAccessRequest, denyAccessRequest } from '../../../lib/orgs/orgsApi';

// =============================================================================
// AccessRequestsList — coordinator-visible queue of pending access requests
// for the active protocol. Rendered inside MembersDrawer.
//
// Approval routes through the SECURITY DEFINER RPC so the protocol_members
// insert + status flip are atomic. Denial is a plain UPDATE (status='denied').
// =============================================================================

export default function AccessRequestsList() {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const { accessRequests, refresh } = useOrg();
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pending = accessRequests.filter((r) => r.status === 'pending');

  if (pending.length === 0) {
    return (
      <div className="p-5">
        <h3 className="text-fg-label text-[10px] uppercase tracking-wider font-semibold mb-3">
          Access requests
        </h3>
        <p className="text-fg-muted text-xs">No pending requests.</p>
      </div>
    );
  }

  async function handleApprove(id: string) {
    setWorking(id);
    setError(null);
    const res = await approveAccessRequest(id);
    setWorking(null);
    if (!res.ok) setError(res.error);
    else refresh();
  }

  async function handleDeny(id: string) {
    setWorking(id);
    setError(null);
    const res = await denyAccessRequest(id);
    setWorking(null);
    if (!res.ok) setError(res.error);
    else refresh();
  }

  const border = isLight ? 'border-[#E2E8F0]' : 'border-white/5';

  return (
    <div className="p-5">
      <h3 className="text-fg-label text-[10px] uppercase tracking-wider font-semibold mb-3">
        Access requests ({pending.length})
      </h3>
      {error && (
        <div
          className={`mb-3 px-3 py-2 rounded-md text-xs ${
            isLight ? 'bg-rose-50 text-rose-700' : 'bg-rose-500/[0.06] text-rose-300'
          }`}
        >
          {error}
        </div>
      )}
      <ul className="space-y-1.5">
        {pending.map((r) => (
          <li
            key={r.id}
            className={`flex flex-col gap-2 px-3 py-2 rounded-md border ${border}`}
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-fg-body truncate" title={r.user_id}>
                {r.user_id}
              </p>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => handleApprove(r.id)}
                  disabled={working === r.id}
                  className="text-fg-sub hover:text-emerald-500 disabled:opacity-50"
                  aria-label="Approve request"
                >
                  <Check size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => handleDeny(r.id)}
                  disabled={working === r.id}
                  className="text-fg-sub hover:text-rose-500 disabled:opacity-50"
                  aria-label="Deny request"
                >
                  <XIcon size={14} />
                </button>
              </div>
            </div>
            {r.message && (
              <p className="text-fg-sub text-xs italic">&ldquo;{r.message}&rdquo;</p>
            )}
            <p className="text-fg-muted text-[10px]">
              Requested {new Date(r.requested_at).toLocaleString()}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
