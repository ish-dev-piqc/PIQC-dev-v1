import { Building2, Clock, FlaskConical, Tag } from 'lucide-react';
import { useProtocol } from '../../../context/ProtocolContext';
import { useTheme } from '../../../context/ThemeContext';

// =============================================================================
// ProtocolTab — Protocol metadata panel for Site Mode.
//
// Shows code, sponsor, phase from ProtocolContext.
// Document content is blocked on D-009 (Reducto pipeline).
// =============================================================================

export default function ProtocolTab() {
  const { activeProtocol } = useProtocol();
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const pageBg = isLight ? 'bg-[#f5f7fa]' : 'bg-[#0d1118]';
  const cardBg = isLight ? 'bg-white border-[#e2e8ee]' : 'bg-[#131a22] border-white/5';
  const divideColor = isLight ? 'divide-[#f0f3f6]' : 'divide-white/[0.04]';

  if (!activeProtocol) return null;

  return (
    <div className={`${pageBg} h-full overflow-y-auto`}>
      <div className="p-6 max-w-3xl mx-auto space-y-6">

        {/* Header */}
        <div>
          <p className="text-fg-label text-[10px] uppercase tracking-wider font-semibold">
            {activeProtocol.code}
          </p>
          <h2 className="text-fg-heading text-xl font-semibold mt-0.5">Protocol</h2>
          <p className="text-fg-sub text-sm mt-1">{activeProtocol.name}</p>
        </div>

        {/* Metadata rows */}
        <div className={`${cardBg} border rounded-xl divide-y ${divideColor}`}>
          <MetaRow icon={<Tag size={14} />} label="Protocol code" value={activeProtocol.code} isLight={isLight} />
          <MetaRow icon={<Building2 size={14} />} label="Sponsor" value={activeProtocol.sponsor || '—'} isLight={isLight} />
          <MetaRow icon={<FlaskConical size={14} />} label="Phase" value={activeProtocol.phase || '—'} isLight={isLight} />
        </div>

        {/* Documents pending callout */}
        <div className={`${cardBg} border rounded-xl p-5`}>
          <div className="flex items-start gap-3">
            <Clock
              size={16}
              className={`mt-0.5 flex-shrink-0 ${isLight ? 'text-[#374152]/30' : 'text-[#d2d7e0]/25'}`}
            />
            <div>
              <p className="text-fg-heading text-sm font-medium">Protocol documents</p>
              <p className="text-fg-muted text-xs mt-1 leading-relaxed">
                Full document access — ICFs, schedules of events, and amendment history — is
                pending integration with the Reducto document pipeline. Parsed content will appear
                here once the pipeline is live.
              </p>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

interface MetaRowProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  isLight: boolean;
}

function MetaRow({ icon, label, value, isLight }: MetaRowProps) {
  return (
    <div className="px-5 py-4 flex items-center gap-4">
      <span className={`flex-shrink-0 ${isLight ? 'text-[#374152]/35' : 'text-[#d2d7e0]/30'}`}>
        {icon}
      </span>
      <div className="flex-1 min-w-0 flex items-center justify-between gap-4 flex-wrap">
        <span className="text-fg-label text-xs uppercase tracking-wider font-semibold">{label}</span>
        <span className={`text-sm ${isLight ? 'text-[#1a1f28]' : 'text-[#d2d7e0]'}`}>{value}</span>
      </div>
    </div>
  );
}
