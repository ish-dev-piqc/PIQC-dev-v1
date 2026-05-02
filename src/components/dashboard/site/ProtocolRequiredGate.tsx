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
  const { activeProtocol } = useProtocol();
  const isLight = theme === 'light';

  if (activeProtocol) {
    return <>{children}</>;
  }

  const headingColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';
  const cardBg = isLight ? 'bg-white border-[#e2e8ee]' : 'bg-[#131a22] border-white/5';
  const iconBg = isLight ? 'bg-[#4a6fa5]/10 border-[#4a6fa5]/20 text-[#4a6fa5]' : 'bg-[#4a6fa5]/15 border-[#4a6fa5]/30 text-[#6e8fb5]';

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
