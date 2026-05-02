import { useState } from 'react';
import { Activity, Eye, EyeOff, ArrowLeft } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useTheme } from '../../context/ThemeContext';
import type { AppView } from '../../App';

interface LoginProps {
  onViewChange: (view: AppView, anchor?: string) => void;
}

export default function Login({ onViewChange }: LoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { theme } = useTheme();
  const isLight = theme === 'light';

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

  const pageBg = isLight ? 'bg-[#f5f7fa]' : 'bg-[#0d1118]';
  const logoText = 'text-fg-heading';
  const headingColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';
  const backColor = isLight ? 'text-[#374152]/40 hover:text-[#374152]/70' : 'text-[#d2d7e0]/40 hover:text-[#d2d7e0]/70';
  const labelColor = isLight ? 'text-[#374152]/70' : 'text-[#d2d7e0]/70';
  const inputBg = isLight
    ? 'bg-white border-[#d8dfe8] text-[#1a1f28] placeholder-[#374152]/20 focus:border-[#4a6fa5]/60 focus:ring-[#4a6fa5]/30'
    : 'bg-[#131a22] border-white/[0.08] text-white placeholder-[#d2d7e0]/20 focus:border-[#4a6fa5]/60 focus:ring-[#4a6fa5]/30';
  const eyeColor = isLight ? 'text-[#374152]/30 hover:text-[#374152]/60' : 'text-[#d2d7e0]/30 hover:text-[#d2d7e0]/60';
  const footerColor = isLight ? 'text-[#374152]/40' : 'text-[#d2d7e0]/40';

  return (
    <div className={`min-h-screen ${pageBg} flex flex-col items-center justify-center px-4 relative overflow-hidden`}>
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: isLight
            ? 'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(74,111,165,0.10) 0%, transparent 65%)'
            : 'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(74,111,165,0.18) 0%, transparent 65%)',
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
          <div className="w-8 h-8 rounded-lg bg-[#4a6fa5] flex items-center justify-center shadow-btn">
            <Activity className="w-4 h-4 text-white" strokeWidth={2.5} />
          </div>
          <span className={`text-[15px] font-semibold ${logoText} tracking-tight`}>
            PIQ<span className="text-[#6e8fb5]">Clinical</span>
          </span>
        </div>

        <div className="mb-8">
          <h1 className={`text-2xl font-bold ${headingColor} mb-1.5`}>Welcome back</h1>
          <p className={`${subColor} text-sm`}>Sign in to your account to continue</p>
        </div>

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
                className="text-xs text-[#6e8fb5] hover:text-[#87b5c7] transition-colors font-medium"
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
            className="w-full px-4 py-2.5 text-sm font-semibold text-white bg-[#4a6fa5] rounded-lg hover:bg-[#5b82b8] transition-all duration-150 shadow-btn hover:shadow-btn-hover disabled:opacity-50 disabled:cursor-not-allowed mt-2"
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        <p className={`mt-6 text-center text-sm ${footerColor}`}>
          Don't have an account?{' '}
          <button
            type="button"
            onClick={() => onViewChange('landing', 'contact')}
            className="text-[#6e8fb5] hover:text-[#87b5c7] transition-colors font-medium"
          >
            Request access
          </button>
        </p>
      </div>
    </div>
  );
}
