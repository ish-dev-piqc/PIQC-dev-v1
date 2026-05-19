import { useState } from 'react';
import { Plus, FileText, Sparkles } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import AddProtocolModal from './AddProtocolModal';

// =============================================================================
// SiteWelcomePanel — first-run empty state for Site Mode.
//
// Renders when activeProtocol === null AND protocols.length === 0 AND
// !demoActive (i.e., the user is in real mode with nothing to show).
// Pre-Track B, this surface was a blank calendar and an empty picker —
// users hit a dead end.
//
// Two CTAs:
//   1. Add protocol manually — opens AddProtocolModal (Path A from master plan)
//   2. Upload protocol PDF — pointer to the Protocol tab (Path B); the user
//      has to create the protocol first either way for ingest to tag against,
//      so the primary CTA stays Add.
// =============================================================================

interface SiteWelcomePanelProps {
  onPromptPdfUpload?: () => void;
}

export default function SiteWelcomePanel({ onPromptPdfUpload }: SiteWelcomePanelProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const [addOpen, setAddOpen] = useState(false);

  const headingColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';
  const cardBg = isLight ? 'bg-white border-[#e2e8ee]' : 'bg-[#131a22] border-white/5';
  const iconBg = isLight
    ? 'bg-[#4a6fa5]/10 border-[#4a6fa5]/20 text-[#4a6fa5]'
    : 'bg-[#6e8fb5]/15 border-[#6e8fb5]/30 text-[#6e8fb5]';
  const primaryButton = isLight
    ? 'bg-[#4a6fa5] text-white hover:bg-[#3d5e8f]'
    : 'bg-[#6e8fb5] text-[#1a1f28] hover:bg-[#5e7fa5]';
  const secondaryButton = isLight
    ? 'bg-white border border-[#e2e8ee] text-[#374152] hover:bg-[#f5f7fa]'
    : 'bg-[#131a22] border border-white/5 text-[#d2d7e0] hover:bg-white/[0.04]';

  return (
    <>
      <div className="flex items-center justify-center h-full p-6">
        <div className={`${cardBg} border rounded-xl p-8 max-w-lg`}>
          <div
            className={`inline-flex items-center justify-center w-12 h-12 rounded-2xl border mb-4 ${iconBg}`}
          >
            <Sparkles size={20} />
          </div>
          <h2 className={`${headingColor} font-semibold text-lg mb-2`}>
            Welcome to PIQ Clinical
          </h2>
          <p className={`${subColor} text-sm leading-relaxed mb-6`}>
            Add your first protocol to get started. You can enter the basics manually or
            upload the protocol PDF to extract the schedule of events automatically.
          </p>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium transition-colors ${primaryButton}`}
            >
              <Plus size={15} />
              Add protocol manually
            </button>
            {onPromptPdfUpload && (
              <button
                type="button"
                onClick={onPromptPdfUpload}
                className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium transition-colors ${secondaryButton}`}
              >
                <FileText size={15} />
                Upload protocol PDF
              </button>
            )}
          </div>
          <p className={`${subColor} text-xs mt-5 leading-relaxed`}>
            <span className="font-semibold">Tip:</span> when you upload a PDF, the ingest
            pipeline parses the protocol number and either tags it to your existing protocol
            or creates a new one — whichever fits.
          </p>
        </div>
      </div>
      {addOpen && <AddProtocolModal onClose={() => setAddOpen(false)} />}
    </>
  );
}
