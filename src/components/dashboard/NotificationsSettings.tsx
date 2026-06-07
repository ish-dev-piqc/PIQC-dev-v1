import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Bell, Loader2 } from 'lucide-react';
import {
  getMyNotificationPreferences,
  upsertMyNotificationPreferences,
} from '../../lib/orgs/orgsApi';
import type {
  NotificationPreferences,
  NotificationPreferencesPatch,
} from '../../types/orgs';

// =============================================================================
// NotificationsSettings — settings sub-tab with three toggles for email
// notification preferences.
//
// Save-on-change. Failure reverts the toggle visual and surfaces a small
// inline error. A banner notes that email sending isn't live yet (it lands
// in the follow-up PR).
// =============================================================================

type ToggleKey = keyof NotificationPreferencesPatch;

interface NotificationsSettingsProps {
  isLight: boolean;
  cardClass: string;
}

const TOGGLES: Array<{
  key: ToggleKey;
  title: string;
  description: string;
}> = [
  {
    key: 'notify_mentions_email',
    title: 'Mention emails',
    description: 'Email me when someone @-mentions me in chat.',
  },
  {
    key: 'notify_decisions_email',
    title: 'Decision acknowledgment emails',
    description: 'Email me when a decision needs my acknowledgment.',
  },
  {
    key: 'daily_digest',
    title: 'Daily digest',
    description: 'Daily 9am roundup of unread mentions and open decisions.',
  },
];

export default function NotificationsSettings({
  isLight,
  cardClass,
}: NotificationsSettingsProps) {
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<ToggleKey | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await getMyNotificationPreferences();
      if (cancelled) return;
      setLoading(false);
      if (res.ok) setPrefs(res.data);
      else setError(res.error);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleToggle = useCallback(
    async (key: ToggleKey) => {
      if (!prefs || saving) return;
      const next = !prefs[key];
      // Optimistic update — revert on failure.
      setPrefs({ ...prefs, [key]: next });
      setSaving(key);
      setError(null);
      const res = await upsertMyNotificationPreferences({ [key]: next });
      setSaving(null);
      if (res.ok) {
        setPrefs(res.data);
      } else {
        // Revert.
        setPrefs((p) => (p ? { ...p, [key]: !next } : p));
        setError(res.error);
      }
    },
    [prefs, saving],
  );

  const headingColor = isLight ? 'text-[#0F172A]' : 'text-white';
  const subColor = isLight ? 'text-[#334155]/70' : 'text-[#CBD5E1]/55';
  const labelColor = isLight ? 'text-[#334155]/55' : 'text-[#CBD5E1]/45';
  const dividerColor = isLight ? 'border-[#E2E8F0]' : 'border-white/10';

  return (
    <div className="space-y-6">
      <section className={`${cardClass} border rounded-xl p-5`}>
        <div className="flex items-center gap-2 mb-4">
          <Bell size={16} className="text-brand-300" />
          <h3 className={`${headingColor} font-medium text-sm`}>
            Email notifications
          </h3>
        </div>

        {/* Coming-soon banner — sets honest expectations until the
            follow-up PR wires the actual sending paths. */}
        <div
          className={`flex items-start gap-2 px-3 py-2 mb-4 rounded-md text-xs ${
            isLight
              ? 'bg-amber-50 border border-amber-200 text-amber-800'
              : 'bg-amber-500/[0.08] border border-amber-500/25 text-amber-300'
          }`}
        >
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
          <p>
            Email sending isn't live yet. Your preferences are saved here and
            will take effect when the email pipeline lands in the next release.
          </p>
        </div>

        {loading ? (
          <p className={`${subColor} text-sm inline-flex items-center gap-1.5`}>
            <Loader2 size={13} className="animate-spin" />
            Loading…
          </p>
        ) : !prefs ? (
          <p className={`${subColor} text-sm`}>
            Couldn't load preferences.{error ? ` ${error}` : ''}
          </p>
        ) : (
          <>
            {error && (
              <div
                className={`px-3 py-2 mb-3 rounded-md text-xs ${
                  isLight
                    ? 'bg-rose-50 text-rose-700'
                    : 'bg-rose-500/[0.06] text-rose-300'
                }`}
              >
                {error}
              </div>
            )}
            <ul className={`divide-y ${dividerColor}`}>
              {TOGGLES.map((toggle) => {
                const value = prefs[toggle.key];
                const isSavingThis = saving === toggle.key;
                return (
                  <li
                    key={toggle.key}
                    className="flex items-start justify-between gap-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className={`${headingColor} text-sm font-medium`}>
                        {toggle.title}
                      </p>
                      <p className={`${labelColor} text-xs mt-0.5`}>
                        {toggle.description}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleToggle(toggle.key)}
                      disabled={!!saving}
                      aria-pressed={value}
                      aria-label={`${toggle.title} ${value ? 'enabled' : 'disabled'}`}
                      className={`relative flex-shrink-0 inline-flex items-center w-10 h-5 rounded-full transition-colors disabled:opacity-50 ${
                        value
                          ? isLight
                            ? 'bg-brand-600'
                            : 'bg-brand-500'
                          : isLight
                            ? 'bg-[#E2E8F0]'
                            : 'bg-white/20'
                      }`}
                    >
                      <span
                        className={`inline-block w-4 h-4 rounded-full bg-white shadow transform transition-transform ${
                          value ? 'translate-x-5' : 'translate-x-0.5'
                        }`}
                      />
                      {isSavingThis && (
                        <span className="absolute inset-0 flex items-center justify-center">
                          <Loader2
                            size={10}
                            className={`animate-spin ${
                              value ? 'text-white' : isLight ? 'text-[#334155]' : 'text-white'
                            }`}
                          />
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
