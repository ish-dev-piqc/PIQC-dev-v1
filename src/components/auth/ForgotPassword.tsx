import { useState } from 'react';
import { Activity, ArrowLeft, CheckCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { AppView } from '../../App';

interface ForgotPasswordProps {
  onViewChange: (view: AppView) => void;
}

export default function ForgotPassword({ onViewChange }: ForgotPasswordProps) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const { error: authError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    setSent(true);
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-[#0d1118] flex flex-col items-center justify-center px-4 relative overflow-hidden">
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(74,111,165,0.18) 0%, transparent 65%)',
        }}
      />

      <div className="relative z-10 w-full max-w-sm">
        <button
          onClick={() => onViewChange('login')}
          className="flex items-center gap-1.5 text-sm text-[#d2d7e0]/40 hover:text-[#d2d7e0]/70 transition-colors mb-8 group"
        >
          <ArrowLeft size={14} className="group-hover:-translate-x-0.5 transition-transform" />
          Back to sign in
        </button>

        <div className="flex items-center gap-2.5 mb-8">
          <div className="w-8 h-8 rounded-lg bg-[#4a6fa5] flex items-center justify-center shadow-btn">
            <Activity className="w-4 h-4 text-white" strokeWidth={2.5} />
          </div>
          <span className="text-[15px] font-semibold text-white tracking-tight">
            PIQ<span className="text-[#6e8fb5]">Clinical</span>
          </span>
        </div>

        {sent ? (
          <div className="text-center">
            <div className="w-12 h-12 rounded-full bg-[#4a6fa5]/15 border border-[#4a6fa5]/25 flex items-center justify-center mx-auto mb-5">
              <CheckCircle size={22} className="text-[#6e8fb5]" />
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">Check your email</h1>
            <p className="text-[#d2d7e0]/45 text-sm leading-relaxed mb-6">
              We sent a password reset link to <span className="text-[#d2d7e0]/70 font-medium">{email}</span>. Check your inbox and follow the instructions.
            </p>
            <button
              onClick={() => onViewChange('login')}
              className="text-sm text-[#6e8fb5] hover:text-[#87b5c7] transition-colors font-medium"
            >
              Return to sign in
            </button>
          </div>
        ) : (
          <>
            <div className="mb-8">
              <h1 className="text-2xl font-bold text-white mb-1.5">Reset your password</h1>
              <p className="text-[#d2d7e0]/45 text-sm">
                Enter your email and we'll send you a reset link.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[#d2d7e0]/70 mb-1.5">
                  Email address
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  placeholder="you@organization.com"
                  className="w-full px-3.5 py-2.5 bg-[#131a22] border border-white/[0.08] rounded-lg text-white placeholder-[#d2d7e0]/20 text-sm focus:outline-none focus:border-[#4a6fa5]/60 focus:ring-1 focus:ring-[#4a6fa5]/30 transition-all"
                />
              </div>

              {error && (
                <div className="px-3.5 py-2.5 bg-red-500/10 border border-red-500/20 rounded-lg">
                  <p className="text-red-400 text-sm">{error}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full px-4 py-2.5 text-sm font-semibold text-white bg-[#4a6fa5] rounded-lg hover:bg-[#5b82b8] transition-all duration-150 shadow-btn hover:shadow-btn-hover disabled:opacity-50 disabled:cursor-not-allowed mt-2"
              >
                {loading ? 'Sending...' : 'Send reset link'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
