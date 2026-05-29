import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, ArrowLeft, Mail } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useTheme } from '../../context/ThemeContext';
import type { AppView } from '../../App';

interface LoginProps {
  onViewChange: (view: AppView, anchor?: string) => void;
}

const RESEND_COOLDOWN_SECONDS = 30;

export default function Login({ onViewChange }: LoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [magicOpen, setMagicOpen] = useState(false);
  const [magicEmail, setMagicEmail] = useState('');
  const [magicLoading, setMagicLoading] = useState(false);
  const [magicSent, setMagicSent] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resending, setResending] = useState(false);
  const cooldownRef = useRef<number | null>(null);

  const { theme } = useTheme();
  const isLight = theme === 'light';

  const passwordInUse = email.length > 0 || password.length > 0;

  useEffect(() => {
    return () => {
      if (cooldownRef.current) window.clearInterval(cooldownRef.current);
    };
  }, []);

  const startCooldown = () => {
    setResendCooldown(RESEND_COOLDOWN_SECONDS);
    if (cooldownRef.current) window.clearInterval(cooldownRef.current);
    cooldownRef.current = window.setInterval(() => {
      setResendCooldown((prev) => {
        if (prev <= 1) {
          if (cooldownRef.current) window.clearInterval(cooldownRef.current);
          cooldownRef.current = null;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    onViewChange('dashboard');
  };

  const sendMagicLink = async (targetEmail: string) => {
    const { error: authError } = await supabase.auth.signInWithOtp({
      email: targetEmail,
      options: { emailRedirectTo: window.location.origin + import.meta.env.BASE_URL },
    });
    return authError;
  };

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMagicLoading(true);
    const authError = await sendMagicLink(magicEmail);
    if (authError) {
      setError(authError.message);
      setMagicLoading(false);
      return;
    }
    setMagicSent(true);
    setMagicLoading(false);
    startCooldown();
  };

  const handleResend = async () => {
    if (resendCooldown > 0 || resending) return;
    setError('');
    setResending(true);
    const authError = await sendMagicLink(magicEmail);
    setResending(false);
    if (authError) {
      setError(authError.message);
      return;
    }
    startCooldown();
  };

  const handleUseDifferentEmail = () => {
    setMagicSent(false);
    setMagicEmail('');
    setError('');
  };

  const pageBg = isLight ? 'bg-[#F8FAFC]' : 'bg-[#020617]';
  const logoText = 'text-fg-heading';
  const headingColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';
  const backColor = isLight ? 'text-[#334155]/40 hover:text-[#334155]/70' : 'text-[#CBD5E1]/40 hover:text-[#CBD5E1]/70';
  const labelColor = isLight ? 'text-[#334155]/70' : 'text-[#CBD5E1]/70';
  const inputBg = isLight
    ? 'bg-white border-[#E2E8F0] text-[#0F172A] placeholder-[#334155]/20 focus:border-brand-600/60 focus:ring-brand-600/30'
    : 'bg-[#0F172A] border-white/[0.08] text-white placeholder-[#CBD5E1]/20 focus:border-brand-600/60 focus:ring-brand-600/30';
  const eyeColor = isLight ? 'text-[#334155]/30 hover:text-[#334155]/60' : 'text-[#CBD5E1]/30 hover:text-[#CBD5E1]/60';
  const footerColor = isLight ? 'text-[#334155]/40' : 'text-[#CBD5E1]/40';
  const dividerLine = isLight ? 'bg-[#E2E8F0]' : 'bg-white/[0.08]';
  const dividerText = isLight ? 'text-[#334155]/40 bg-[#F8FAFC]' : 'text-[#CBD5E1]/40 bg-[#020617]';
  const magicButtonBg = isLight
    ? 'bg-white border-[#E2E8F0] hover:bg-[#F8FAFC] text-[#0F172A]'
    : 'bg-[#0F172A] border-white/[0.08] hover:bg-[#1E293B] text-white';
  const magicCardBg = isLight
    ? 'bg-white border-[#E2E8F0]'
    : 'bg-[#0F172A] border-white/[0.08]';
  const linkColor = 'text-brand-300 hover:text-[#87b5c7]';

  return (
    <div className={`min-h-screen ${pageBg} flex flex-col items-center justify-center px-4 relative overflow-hidden`}>
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: isLight
            ? 'radial-gradient(ellipse 80% 50% at 50% -10%, rgb(var(--brand-600) / 0.10) 0%, transparent 65%)'
            : 'radial-gradient(ellipse 80% 50% at 50% -10%, rgb(var(--brand-600) / 0.18) 0%, transparent 65%)',
        }}
      />

      <div className="relative z-10 w-full max-w-sm">
        <button
          onClick={() => onViewChange('landing')}
          className={`flex items-center gap-1.5 text-sm ${backColor} transition-colors mb-8 group`}
        >
          <ArrowLeft size={14} className="group-hover:-translate-x-0.5 transition-transform" />
          Back
        </button>

        <div className="flex items-center gap-2.5 mb-8">
          <img src="/PIQC_Logo.png" alt="" className="w-8 h-8 object-contain" />
          <span className={`text-[15px] font-semibold ${logoText} tracking-tight`}>
            <span className="text-brand-600">PIQC</span>linical
          </span>
        </div>

        <div className="mb-8">
          <h1 className={`text-2xl font-bold ${headingColor} mb-1.5`}>Sign in or create your account</h1>
          <p className={`${subColor} text-sm`}>Magic link works for new and returning users — no password required.</p>
        </div>

        {!magicOpen && !passwordInUse && (
          <div>
            <button
              type="button"
              onClick={() => setMagicOpen(true)}
              disabled={loading}
              className={`w-full flex items-center justify-center gap-2.5 px-4 py-2.5 ${magicButtonBg} border rounded-lg text-sm font-medium transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              <Mail size={15} />
              Continue with magic link
            </button>
            <p className={`mt-2 text-center text-xs ${subColor}`}>
              No password needed — works for new and returning users
            </p>
          </div>
        )}

        {magicOpen && !magicSent && (
          <form onSubmit={handleMagicLink} className={`p-4 ${magicCardBg} border rounded-lg space-y-3`}>
            <div className="flex items-center gap-2 text-sm font-medium text-fg-heading">
              <Mail size={15} />
              Continue with magic link
            </div>
            <div>
              <label className={`block text-xs font-medium ${labelColor} mb-1.5`}>
                Email address
              </label>
              <input
                type="email"
                value={magicEmail}
                onChange={(e) => setMagicEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="you@organization.com"
                className={`w-full px-3.5 py-2.5 ${inputBg} border rounded-lg text-sm focus:outline-none focus:ring-1 transition-all`}
              />
            </div>
            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={magicLoading || !magicEmail}
                className="flex-1 px-4 py-2.5 text-sm font-semibold text-white bg-brand-600 rounded-lg hover:bg-brand-500 transition-all duration-150 shadow-btn hover:shadow-btn-hover disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {magicLoading ? 'Sending...' : 'Send link'}
              </button>
              <button
                type="button"
                onClick={() => setMagicOpen(false)}
                className={`text-xs ${linkColor} transition-colors font-medium`}
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {magicOpen && magicSent && (
          <div className={`p-4 ${magicCardBg} border rounded-lg space-y-3`}>
            <div className="flex items-center gap-2 text-sm font-medium text-fg-heading">
              <Mail size={15} />
              Check your inbox
            </div>
            <p className={`text-sm ${subColor}`}>
              We sent a sign-in link to <span className="font-medium text-fg-heading">{magicEmail}</span>. Click it to continue.
            </p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleResend}
                disabled={resendCooldown > 0 || resending}
                className={`flex-1 px-4 py-2.5 text-sm font-semibold border rounded-lg transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed ${magicButtonBg}`}
              >
                {resending ? 'Sending...' : resendCooldown > 0 ? `Resend link (${resendCooldown}s)` : 'Resend link'}
              </button>
              <button
                type="button"
                onClick={handleUseDifferentEmail}
                className={`text-xs ${linkColor} transition-colors font-medium whitespace-nowrap`}
              >
                Use a different email
              </button>
            </div>
          </div>
        )}

        {!magicOpen && !passwordInUse && (
          <div className="relative my-5">
            <div className={`absolute inset-0 flex items-center`}>
              <div className={`w-full h-px ${dividerLine}`} />
            </div>
            <div className="relative flex justify-center">
              <span className={`px-3 text-xs ${dividerText}`}>or</span>
            </div>
          </div>
        )}

        {!magicOpen && (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className={`block text-sm font-medium ${labelColor} mb-1.5`}>
              Email address
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder="you@organization.com"
              className={`w-full px-3.5 py-2.5 ${inputBg} border rounded-lg text-sm focus:outline-none focus:ring-1 transition-all`}
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className={`block text-sm font-medium ${labelColor}`}>
                Password
              </label>
              <button
                type="button"
                onClick={() => onViewChange('forgot-password')}
                className="text-xs text-brand-300 hover:text-[#87b5c7] transition-colors font-medium"
              >
                Forgot password?
              </button>
            </div>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                placeholder="Enter your password"
                className={`w-full px-3.5 py-2.5 ${inputBg} border rounded-lg text-sm focus:outline-none focus:ring-1 transition-all pr-10`}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className={`absolute right-3 top-1/2 -translate-y-1/2 ${eyeColor} transition-colors`}
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          {error && (
            <div className="px-3.5 py-2.5 bg-red-500/10 border border-red-500/20 rounded-lg">
              <p className="text-red-500 text-sm">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full px-4 py-2.5 text-sm font-semibold text-white bg-brand-600 rounded-lg hover:bg-brand-500 transition-all duration-150 shadow-btn hover:shadow-btn-hover disabled:opacity-50 disabled:cursor-not-allowed mt-2"
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
        )}

        <p className={`mt-6 text-center text-sm ${footerColor}`}>
          We'll email you a one-time sign-in link. New accounts are created automatically on first use.
        </p>
      </div>
    </div>
  );
}
