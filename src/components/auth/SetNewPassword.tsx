import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { friendlyAuthError } from '../../lib/authErrors';

interface SetNewPasswordProps {
  onDone: () => void;
}

export default function SetNewPassword({ onDone }: SetNewPasswordProps) {
  const { completePasswordRecovery, signOut } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const passwordsMatch = password.length > 0 && password === confirmPassword;
  const isValid = password.length > 0 && passwordsMatch;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) return;
    setError('');
    setSubmitting(true);

    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      setError(friendlyAuthError(updateError));
      setSubmitting(false);
      return;
    }

    completePasswordRecovery();
    onDone();
  };

  const handleCancel = async () => {
    await signOut();
  };

  return (
    <div className="min-h-screen bg-[#020617] flex flex-col items-center justify-center px-4 relative overflow-hidden">
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse 80% 50% at 50% -10%, rgb(var(--brand-600) / 0.18) 0%, transparent 65%)',
        }}
      />

      <div className="relative z-10 w-full max-w-sm">
        <div className="flex items-center gap-2.5 mb-8">
          <img src="/PIQC_Logo.png" alt="" className="w-8 h-8 object-contain" />
          <span className="text-[15px] font-semibold text-white tracking-tight">
            <span className="text-brand-600">PIQC</span>linical
          </span>
        </div>

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white mb-1.5">Set a new password</h1>
          <p className="text-[#CBD5E1]/45 text-sm">
            Choose a new password for your account.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[#CBD5E1]/70 mb-1.5">
              New password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="new-password"
              placeholder="Enter a new password"
              className="w-full px-3.5 py-2.5 bg-[#0F172A] border border-white/[0.08] rounded-lg text-white placeholder-[#CBD5E1]/20 text-sm focus:outline-none focus:border-brand-600/60 focus:ring-1 focus:ring-brand-600/30 transition-all"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[#CBD5E1]/70 mb-1.5">
              Confirm new password
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              autoComplete="new-password"
              placeholder="Re-enter your new password"
              className="w-full px-3.5 py-2.5 bg-[#0F172A] border border-white/[0.08] rounded-lg text-white placeholder-[#CBD5E1]/20 text-sm focus:outline-none focus:border-brand-600/60 focus:ring-1 focus:ring-brand-600/30 transition-all"
            />
            {confirmPassword.length > 0 && !passwordsMatch && (
              <p className="mt-1 text-xs text-red-500">Passwords don't match.</p>
            )}
          </div>

          {error && (
            <div className="px-3.5 py-2.5 bg-red-500/10 border border-red-500/20 rounded-lg">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={!isValid || submitting}
            className="w-full px-4 py-2.5 text-sm font-semibold text-white bg-brand-600 rounded-lg hover:bg-brand-500 transition-all duration-150 shadow-btn hover:shadow-btn-hover disabled:opacity-50 disabled:cursor-not-allowed mt-2"
          >
            {submitting ? 'Updating...' : 'Update password'}
          </button>
        </form>

        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={handleCancel}
            className="text-sm text-[#CBD5E1]/40 hover:text-[#CBD5E1]/70 transition-colors font-medium"
          >
            Cancel and sign out
          </button>
        </div>
      </div>
    </div>
  );
}
