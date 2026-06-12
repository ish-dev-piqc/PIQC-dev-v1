import { useState } from 'react';
import { Building2, Check, Loader2 } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { addSponsorInterest } from '../../lib/orgs/orgsApi';

// =============================================================================
// SponsorComingSoonPage — purple-themed marketing surface for the in-app
// Sponsor mode placeholder. Visible to any authenticated user when they
// click the Sponsor icon in the LeftRail.
//
// Captures interest via `addSponsorInterest` (sponsor_interest table).
// Email is pre-filled from the auth profile but editable so users can
// enter a team inbox if they want.
// =============================================================================

const CAPABILITIES: ReadonlyArray<string> = [
  'Real-time visit compliance across every site',
  'Cross-protocol enrollment dashboards',
  'Direct audit-finding visibility, no email chain',
  'Embedded chat with site coordinators',
];

const TARGET_DATE_LABEL = 'Targeting Q4 2026';

export default function SponsorComingSoonPage() {
  const { theme } = useTheme();
  const { user } = useAuth();
  const isLight = theme === 'light';

  const [email, setEmail] = useState<string>(user?.email ?? '');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    const res = await addSponsorInterest({ email, message: message || undefined });
    setSubmitting(false);
    if (res.ok) {
      setSubmitted(true);
    } else {
      setError(res.error);
    }
  };

  // --- Purple palette pulled from the brainstorm spec --------------------
  const pagePanelBg = isLight ? '#EEEDFE' : 'rgba(127, 119, 221, 0.10)';
  const accentBorder = '#7F77DD';
  const pillBg = isLight ? '#CECBF6' : 'rgba(127, 119, 221, 0.25)';
  const pillFg = isLight ? '#3C3489' : '#CECBF6';
  const headingFg = isLight ? '#26215C' : '#CECBF6';
  const leadFg = isLight ? '#3C3489' : '#AFA9EC';
  const bulletFg = isLight ? '#3C3489' : '#AFA9EC';
  const bulletMarker = '#7F77DD';
  const buttonBg = '#534AB7';

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto p-6 sm:p-8">
        <div
          className="rounded-lg p-6 sm:p-8"
          style={{
            background: pagePanelBg,
            borderLeft: `3px solid ${accentBorder}`,
          }}
        >
          {/* Roadmap pill */}
          <span
            className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full mb-4"
            style={{ background: pillBg, color: pillFg }}
          >
            <Building2 size={11} />
            {TARGET_DATE_LABEL}
          </span>

          <h2
            className="text-xl sm:text-2xl font-semibold mb-2 leading-tight"
            style={{ color: headingFg }}
          >
            Roll up site activity across protocols and orgs
          </h2>
          <p
            className="text-sm leading-relaxed mb-5"
            style={{ color: leadFg }}
          >
            Sponsor mode gives clinical-ops leads at sponsors and CROs a
            single view across every site they oversee — without asking
            each site for a status update.
          </p>

          <ul className="text-sm leading-7 mb-6 space-y-0.5">
            {CAPABILITIES.map((line) => (
              <li
                key={line}
                className="flex items-start gap-2"
                style={{ color: bulletFg }}
              >
                <span
                  className="inline-block flex-shrink-0 mt-2.5 w-1.5 h-1.5 rounded-full"
                  style={{ background: bulletMarker }}
                  aria-hidden="true"
                />
                {line}
              </li>
            ))}
          </ul>

          {submitted ? (
            <div
              className="flex items-start gap-2 p-3 rounded-md text-sm"
              style={{
                background: isLight ? '#E1F5EE' : 'rgba(29, 158, 117, 0.10)',
                color: isLight ? '#085041' : '#5DCAA5',
              }}
            >
              <Check size={16} className="flex-shrink-0 mt-0.5" />
              <span>
                Thanks — we'll email you when Sponsor mode ships.
              </span>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-2">
              <div className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: pillFg }}>
                Get notified
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@yourorg.com"
                  required
                  disabled={submitting}
                  className="flex-1 text-sm rounded-md px-3 py-2 focus:outline-none focus:ring-2"
                  style={{
                    background: isLight ? 'white' : '#1E293B',
                    border: `0.5px solid ${isLight ? '#AFA9EC' : 'rgba(174, 169, 236, 0.3)'}`,
                    color: isLight ? '#0F172A' : '#E2E8F0',
                  }}
                  aria-label="Email"
                />
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center justify-center gap-1.5 text-sm font-medium px-4 py-2 rounded-md text-white disabled:opacity-60"
                  style={{ background: buttonBg }}
                >
                  {submitting && <Loader2 size={14} className="animate-spin" />}
                  Notify me
                </button>
              </div>
              <input
                type="text"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Anything you'd want this to solve? (optional)"
                maxLength={2000}
                disabled={submitting}
                className="w-full text-sm rounded-md px-3 py-2 focus:outline-none focus:ring-2"
                style={{
                  background: isLight ? 'white' : '#1E293B',
                  border: `0.5px solid ${isLight ? '#AFA9EC' : 'rgba(174, 169, 236, 0.3)'}`,
                  color: isLight ? '#0F172A' : '#E2E8F0',
                }}
                aria-label="Optional message"
              />
              {error && (
                <p className="text-xs text-rose-500 mt-1">{error}</p>
              )}
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
