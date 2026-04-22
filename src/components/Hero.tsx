import { ArrowRight } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import type { AppView } from '../App';

interface HeroProps {
  onViewChange: (view: AppView) => void;
}

export default function Hero({ onViewChange }: HeroProps) {
  const { theme } = useTheme();
  const { session } = useAuth();
  const isLight = theme === 'light';

  return (
    <section
      className={`relative min-h-[90vh] flex flex-col items-center justify-center overflow-hidden px-4 sm:px-6 lg:px-8 pt-16 ${isLight ? 'bg-[#f5f7fa]' : 'bg-[#0d1118]'}`}
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: isLight
            ? 'radial-gradient(ellipse 90% 55% at 50% -5%, rgba(74,111,165,0.12) 0%, transparent 68%)'
            : 'radial-gradient(ellipse 90% 55% at 50% -5%, rgba(74,111,165,0.22) 0%, transparent 68%)',
        }}
      />

      <div
        className="absolute bottom-0 left-0 right-0 h-32 pointer-events-none"
        style={{
          background: isLight
            ? 'linear-gradient(to bottom, transparent, #f5f7fa)'
            : 'linear-gradient(to bottom, transparent, #0d1118)',
        }}
      />

      <div className="relative z-10 max-w-3xl mx-auto text-center py-24">
        <h1 className={`text-5xl sm:text-6xl lg:text-7xl font-bold leading-[1.07] tracking-tight mb-5 ${isLight ? 'text-[#1a1f28]' : 'text-white'}`}>
          Managing Clinical Protocols
          <br />
          Doesn't Have to Be
          <br />
          This Difficult
        </h1>

        <p className={`text-lg sm:text-xl font-medium mb-4 ${isLight ? 'text-[#374152]/80' : 'text-[#d2d7e0]/80'}`}>
          Turn complex protocols into workflows you can track and manage in one place
        </p>

        <p className={`text-[15px] leading-relaxed max-w-xl mx-auto mb-10 ${isLight ? 'text-[#374152]/50' : 'text-[#d2d7e0]/50'}`}>
          Designed for site managers, auditors, and clinical teams running real trials
        </p>

        <div className="flex flex-col items-center gap-4">
          <a
            href="#contact"
            className="inline-flex items-center gap-2 px-7 py-3.5 text-sm font-semibold text-white bg-[#4a6fa5] rounded-xl hover:bg-[#5b82b8] transition-all duration-200 shadow-btn hover:shadow-btn-hover group"
          >
            Get Started
            <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
          </a>
          {!session && (
            <p className={`text-sm ${isLight ? 'text-[#374152]/50' : 'text-[#d2d7e0]/50'}`}>
              Already have an account?{' '}
              <button
                onClick={() => onViewChange('login')}
                className={`font-medium transition-colors inline-flex items-center gap-1 group ${isLight ? 'text-[#374152]/70 hover:text-[#1a1f28]' : 'text-[#d2d7e0]/70 hover:text-white'}`}
              >
                Log in
                <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
              </button>
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
