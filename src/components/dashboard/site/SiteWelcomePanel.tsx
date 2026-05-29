import { Sparkles } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';

// =============================================================================
// SiteWelcomePanel — empty state for Site Mode when no protocol is selected
// (active = Home sentinel) but the user has at least one protocol.
//
// The zero-protocols case is handled one level up in Dashboard.tsx by
// ProtocolOnboarding (full-screen upload wall), so this panel only ever
// renders when the user has protocols and just hasn't picked one. The only
// action they need from here is to use the protocol picker in the Navbar
// (which also exposes the "Upload protocol" entry for adding more).
// =============================================================================

export default function SiteWelcomePanel() {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const headingColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';
  const cardBg = isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/5';
  const iconBg = isLight
    ? 'bg-brand-600/10 border-brand-600/20 text-brand-600'
    : 'bg-brand-300/15 border-brand-300/30 text-brand-300';

  return (
    <div className="flex items-center justify-center h-full p-6">
      <div className={`${cardBg} border rounded-xl p-8 max-w-md text-center`}>
        <div
          className={`inline-flex items-center justify-center w-12 h-12 rounded-2xl border mb-4 ${iconBg}`}
        >
          <Sparkles size={20} />
        </div>
        <h2 className={`${headingColor} font-semibold text-base mb-2`}>
          Select a protocol to begin
        </h2>
        <p className={`${subColor} text-sm leading-relaxed`}>
          Pick a study from the protocol picker in the header. Need to add a new one?
          Use the <span className="font-medium text-fg-heading">Upload protocol</span> entry
          at the bottom of the picker.
        </p>
      </div>
    </div>
  );
}
