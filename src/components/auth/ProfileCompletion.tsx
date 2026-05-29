import { useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';

const PHONE_PATTERN = /^[+0-9()\-\s]{7,}$/;

function getBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function getTimezoneOptions(): string[] {
  const fallback = [
    'UTC',
    'America/Los_Angeles',
    'America/Denver',
    'America/Chicago',
    'America/New_York',
    'Europe/London',
    'Europe/Berlin',
    'Asia/Kolkata',
    'Asia/Singapore',
    'Asia/Tokyo',
    'Australia/Sydney',
  ];
  const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
  if (typeof supported === 'function') {
    try {
      return supported('timeZone');
    } catch {
      return fallback;
    }
  }
  return fallback;
}

export default function ProfileCompletion() {
  const { user, profile, refreshProfile, signOut } = useAuth();
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const initialName =
    profile?.name?.trim() ||
    (user?.user_metadata?.full_name as string | undefined)?.trim() ||
    '';

  const [name, setName] = useState(initialName);
  const [title, setTitle] = useState(profile?.title ?? '');
  const [organization, setOrganization] = useState(profile?.organization ?? '');
  const [timezone, setTimezone] = useState(profile?.timezone || getBrowserTimezone());
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const timezoneOptions = useMemo(() => getTimezoneOptions(), []);

  const trimmed = {
    name: name.trim(),
    title: title.trim(),
    organization: organization.trim(),
    timezone: timezone.trim(),
    phone: phone.trim(),
  };

  const phoneValid = PHONE_PATTERN.test(trimmed.phone);
  const timezoneValid = timezoneOptions.includes(trimmed.timezone);
  const isValid =
    trimmed.name.length > 0 &&
    trimmed.title.length > 0 &&
    trimmed.organization.length > 0 &&
    timezoneValid &&
    phoneValid;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid || !user) return;
    setError('');
    setSubmitting(true);

    const { error: updateError } = await supabase
      .from('user_profiles')
      .update({
        name: trimmed.name,
        title: trimmed.title,
        organization: trimmed.organization,
        timezone: trimmed.timezone,
        phone: trimmed.phone,
        profile_completed_at: new Date().toISOString(),
      })
      .eq('id', user.id);

    if (updateError) {
      setError(updateError.message);
      setSubmitting(false);
      return;
    }

    await refreshProfile();
    setSubmitting(false);
  };

  const pageBg = isLight ? 'bg-[#F8FAFC]' : 'bg-[#020617]';
  const labelColor = isLight ? 'text-[#334155]/70' : 'text-[#CBD5E1]/70';
  const inputBg = isLight
    ? 'bg-white border-[#E2E8F0] text-[#0F172A] placeholder-[#334155]/20 focus:border-[#017BC8]/60 focus:ring-[#017BC8]/30'
    : 'bg-[#0F172A] border-white/[0.08] text-white placeholder-[#CBD5E1]/20 focus:border-[#017BC8]/60 focus:ring-[#017BC8]/30';
  const subColor = isLight ? 'text-[#334155]/60' : 'text-[#CBD5E1]/60';
  const backColor = isLight ? 'text-[#334155]/40 hover:text-[#334155]/70' : 'text-[#CBD5E1]/40 hover:text-[#CBD5E1]/70';

  return (
    <div className={`min-h-screen ${pageBg} flex flex-col items-center justify-center px-4 py-10 relative overflow-hidden`}>
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: isLight
            ? 'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(1,123,200,0.10) 0%, transparent 65%)'
            : 'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(1,123,200,0.18) 0%, transparent 65%)',
        }}
      />

      <div className="relative z-10 w-full max-w-md">
        <button
          type="button"
          onClick={signOut}
          className={`flex items-center gap-1.5 text-sm ${backColor} transition-colors mb-8 group`}
        >
          <ArrowLeft size={14} className="group-hover:-translate-x-0.5 transition-transform" />
          Back to sign in
        </button>

        <div className="flex items-center gap-2.5 mb-8">
          <img src="/PIQC_Logo.png" alt="" className="w-8 h-8 object-contain" />
          <span className="text-[15px] font-semibold text-fg-heading tracking-tight">
            <span className="text-[#017BC8]">PIQC</span>linical
          </span>
        </div>

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-fg-heading mb-1.5">Complete your profile</h1>
          <p className={`text-sm ${subColor}`}>
            We need a few details before you can access the dashboard. All fields are required.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className={`block text-sm font-medium ${labelColor} mb-1.5`}>Full name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Alice Chen"
              className={`w-full px-3.5 py-2.5 ${inputBg} border rounded-lg text-sm focus:outline-none focus:ring-1 transition-all`}
            />
          </div>

          <div>
            <label className={`block text-sm font-medium ${labelColor} mb-1.5`}>Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Senior Clinical Auditor"
              className={`w-full px-3.5 py-2.5 ${inputBg} border rounded-lg text-sm focus:outline-none focus:ring-1 transition-all`}
            />
          </div>

          <div>
            <label className={`block text-sm font-medium ${labelColor} mb-1.5`}>Organization</label>
            <input
              type="text"
              value={organization}
              onChange={(e) => setOrganization(e.target.value)}
              placeholder="Pacific Clinical Group"
              className={`w-full px-3.5 py-2.5 ${inputBg} border rounded-lg text-sm focus:outline-none focus:ring-1 transition-all`}
            />
          </div>

          <div>
            <label className={`block text-sm font-medium ${labelColor} mb-1.5`}>Timezone</label>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className={`w-full px-3.5 py-2.5 ${inputBg} border rounded-lg text-sm focus:outline-none focus:ring-1 transition-all`}
            >
              {timezoneOptions.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={`block text-sm font-medium ${labelColor} mb-1.5`}>Phone</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+1 555 123 4567"
              className={`w-full px-3.5 py-2.5 ${inputBg} border rounded-lg text-sm focus:outline-none focus:ring-1 transition-all`}
            />
            {phone.length > 0 && !phoneValid && (
              <p className="mt-1 text-xs text-red-500">
                Use digits, spaces, parentheses, hyphens, or a leading + (min 7 characters).
              </p>
            )}
          </div>

          {error && (
            <div className="px-3.5 py-2.5 bg-red-500/10 border border-red-500/20 rounded-lg">
              <p className="text-red-500 text-sm">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={!isValid || submitting}
            className="w-full px-4 py-2.5 text-sm font-semibold text-white bg-[#017BC8] rounded-lg hover:bg-[#1595D1] transition-all duration-150 shadow-btn hover:shadow-btn-hover disabled:opacity-50 disabled:cursor-not-allowed mt-2"
          >
            {submitting ? 'Saving...' : 'Continue to dashboard'}
          </button>
        </form>
      </div>
    </div>
  );
}
