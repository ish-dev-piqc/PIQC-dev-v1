import { ClipboardList } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';

// =============================================================================
// AuditRequiredGate — empty state when no audit is selected.
// Shown by AuditWorkspaceShell when activeAudit === null.
// =============================================================================

export default function AuditRequiredGate() {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const headingColor = isLight ? 'text-[#1a1f28]' : 'text-white';
  const subColor = isLight ? 'text-[#374152]/55' : 'text-[#d2d7e0]/45';
  const cardBg = isLight ? 'bg-white border-[#e2e8ee]' : 'bg-[#131a22] border-white/5';
  const iconBg = isLight
    ? 'bg-[#4a6fa5]/10 border-[#4a6fa5]/20 text-[#4a6fa5]'
    : 'bg-[#4a6fa5]/15 border-[#4a6fa5]/30 text-[#6e8fb5]';

  return (
    <div className="flex items-center justify-center h-full p-6">
      <div className={`${cardBg} border rounded-xl p-8 max-w-md text-center`}>
        <div className={`inline-flex items-center justify-center w-12 h-12 rounded-2xl border mb-4 ${iconBg}`}>
          <ClipboardList size={20} />
        </div>
        <h3 className={`${headingColor} font-semibold text-base mb-2`}>
          Select an audit to begin
        </h3>
        <p className={`${subColor} text-sm leading-relaxed`}>
          Audit Mode is scoped to a single vendor audit. Pick one from the audit picker
          in the header to open its workspace.
        </p>
      </div>
    </div>
  );
}
