import { useTheme } from '../../../context/ThemeContext';
import { useProtocol } from '../../../context/ProtocolContext';

interface SitePlaceholderProps {
  title: string;
  description: string;
  whatWillLiveHere: string[];
}

export default function SitePlaceholder({ title, description, whatWillLiveHere }: SitePlaceholderProps) {
  const { theme } = useTheme();
  const { activeProtocol } = useProtocol();
  const isLight = theme === 'light';

  const headingColor = isLight ? 'text-[#1a1f28]' : 'text-white';
  const subColor = isLight ? 'text-[#374152]/55' : 'text-[#d2d7e0]/45';
  const cardBg = isLight ? 'bg-white border-[#e2e8ee]' : 'bg-[#131a22] border-white/5';
  const bodyColor = isLight ? 'text-[#374152]/70' : 'text-[#d2d7e0]/55';
  const chipBg = isLight ? 'bg-[#4a6fa5]/10 border-[#4a6fa5]/20 text-[#4a6fa5]' : 'bg-[#4a6fa5]/15 border-[#4a6fa5]/30 text-[#6e8fb5]';

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className={`${headingColor} font-semibold text-lg mb-1`}>{title}</h2>
          <p className={`${subColor} text-sm`}>{description}</p>
        </div>
        <span className={`inline-flex items-center px-3 py-1 rounded-full border text-xs font-medium ${chipBg}`}>
          {activeProtocol?.code ?? 'Home'}
        </span>
      </div>

      <div className={`${cardBg} border rounded-xl p-6`}>
        <p className={`${subColor} text-xs uppercase tracking-wider mb-3`}>Coming soon</p>
        <ul className="space-y-2.5">
          {whatWillLiveHere.map((item, i) => (
            <li key={i} className={`${bodyColor} text-sm flex items-start gap-2.5`}>
              <span className={`mt-1.5 w-1 h-1 rounded-full flex-shrink-0 ${isLight ? 'bg-[#4a6fa5]/50' : 'bg-[#6e8fb5]/60'}`} />
              {item}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
