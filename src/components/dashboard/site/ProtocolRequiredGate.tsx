import { ArrowUpRight } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useProtocol } from '../../../context/ProtocolContext';

interface ProtocolRequiredGateProps {
  label: string;
  description?: string;
  children: React.ReactNode;
}

export default function ProtocolRequiredGate({ label, description, children }: ProtocolRequiredGateProps) {
  const { theme } = useTheme();
  const { activeProtocol, isLoading } = useProtocol();
  const isLight = theme === 'light';

  if (activeProtocol) {
    return <>{children}</>;
  }

  // While protocols are still loading we don't know whether the persisted
  // activeId will resolve to a protocol, so render nothing rather than flash
  // the "select a protocol" prompt at returning users on every reload.
  if (isLoading) {
    return null;
  }

  const headingColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';
  const cardBg = isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/5';
  const iconBg = isLight ? 'bg-brand-600/10 border-brand-600/20 text-brand-600' : 'bg-brand-600/15 border-brand-600/30 text-brand-300';

  return (
    <div className="flex items-center justify-center h-full p-6">
      <div className={`${cardBg} border rounded-xl p-8 max-w-md text-center`}>
        <div className={`inline-flex items-center justify-center w-12 h-12 rounded-2xl border mb-4 ${iconBg}`}>
          <ArrowUpRight size={20} />
        </div>
        <h3 className={`${headingColor} font-semibold text-base mb-2`}>
          Select a protocol to open {label}
        </h3>
        <p className={`${subColor} text-sm leading-relaxed`}>
          {description ??
            `${label} is specific to a single study. Choose one from the protocol picker in the header to continue.`}
        </p>
      </div>
    </div>
  );
}
