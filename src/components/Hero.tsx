import { ArrowRight } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import type { AppView } from '../App';

interface HeroProps {
  onViewChange: (view: AppView) => void;
}

export default function Hero({ onViewChange }: HeroProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  return (
    <section
      className={`relative min-h-[90vh] flex flex-col items-center justify-center overflow-hidden px-4 sm:px-6 lg:px-8 pt-16 ${isLight ? 'bg-[#F8FAFC]' : 'bg-[#020617]'}`}
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: isLight
            ? 'radial-gradient(ellipse 90% 55% at 50% -5%, rgb(var(--brand-600) / 0.12) 0%, transparent 68%)'
            : 'radial-gradient(ellipse 90% 55% at 50% -5%, rgb(var(--brand-600) / 0.22) 0%, transparent 68%)',
        }}
      />

      <div
        className="absolute bottom-0 left-0 right-0 h-32 pointer-events-none"
        style={{
          background: isLight
            ? 'linear-gradient(to bottom, transparent, #F8FAFC)'
            : 'linear-gradient(to bottom, transparent, #020617)',
        }}
      />

      <div className="relative z-10 max-w-3xl mx-auto text-center py-24">
        <h1 className={`text-5xl sm:text-6xl lg:text-7xl font-bold leading-[1.07] tracking-tight mb-5 ${isLight ? 'text-[#0F172A]' : 'text-white'}`}>
          Managing Clinical Protocols
          <br />
          Doesn't Have to Be
          <br />
          This Difficult
        </h1>

        <p className={`text-lg sm:text-xl font-medium mb-4 ${isLight ? 'text-[#334155]/80' : 'text-[#CBD5E1]/80'}`}>
          PIQClinical turns complex protocols into guided workflows your team can execute.
        </p>

        <p className={`text-[15px] leading-relaxed max-w-xl mx-auto mb-10 ${isLight ? 'text-[#334155]/50' : 'text-[#CBD5E1]/50'}`}>
          Designed for site managers, auditors, and clinical teams running real trials
        </p>

        <div className="flex flex-col items-center gap-3">
          <button
            onClick={() => onViewChange('login')}
            className="inline-flex items-center gap-2 px-7 py-3.5 text-sm font-semibold text-white bg-brand-600 rounded-xl hover:bg-brand-500 transition-all duration-200 shadow-btn hover:shadow-btn-hover group"
          >
            Get Started
            <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
          </button>
          <p className={`text-xs ${isLight ? 'text-[#334155]/50' : 'text-[#CBD5E1]/50'}`}>
            New or returning — sign in with your email, no password required.
          </p>
        </div>
      </div>
    </section>
  );
}
