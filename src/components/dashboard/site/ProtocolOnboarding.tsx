import { Activity, FileText, Layers, Workflow } from 'lucide-react';
import { UploadForm } from '../KnowledgeBase';
import { useTheme } from '../../../context/ThemeContext';

// =============================================================================
// ProtocolOnboarding — full-screen wall shown after login when the user has
// zero protocols. Composes the existing UploadForm so we don't duplicate the
// PDF → Reducto → ingest pipeline. Once a protocol is created (the ingest
// edge function auto-creates one from the extracted metadata via B2.4),
// ProtocolContext realtime + the Dashboard gate re-render the normal site
// mode UI.
// =============================================================================

const STEPS = [
  {
    icon: FileText,
    title: 'Upload your protocol PDF',
    detail: 'Drop in the full protocol document — any length, any formatting.',
  },
  {
    icon: Layers,
    title: 'Reducto parses it',
    detail: 'Visits, procedures, eligibility, and the schedule of assessments are extracted with citations.',
  },
  {
    icon: Workflow,
    title: 'Your dashboard is set up',
    detail: 'Protocol metadata, visit templates, and the Ask assistant become ready in Site Mode.',
  },
];

export default function ProtocolOnboarding() {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const pageBg = isLight ? 'bg-[#f5f7fa]' : 'bg-[#0d1118]';
  const cardBg = isLight ? 'bg-white border-[#e2e8ee]' : 'bg-[#131a22] border-white/5';
  const headingColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';
  const mutedColor = 'text-fg-muted';
  const stepIconBg = isLight ? 'bg-[#4a6fa5]/10 border-[#4a6fa5]/20' : 'bg-[#4a6fa5]/15 border-[#4a6fa5]/25';

  return (
    <div className={`min-h-screen ${pageBg} pt-20 pb-16 px-4 sm:px-6`}>
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-2.5 mb-8">
          <div className="w-8 h-8 rounded-lg bg-[#4a6fa5] flex items-center justify-center shadow-btn">
            <Activity className="w-4 h-4 text-white" strokeWidth={2.5} />
          </div>
          <span className={`text-[15px] font-semibold ${headingColor} tracking-tight`}>
            PIQ<span className="text-[#6e8fb5]">Clinical</span>
          </span>
        </div>

        <div className="mb-8">
          <h1 className={`text-2xl sm:text-3xl font-bold ${headingColor} mb-2 leading-tight`}>
            Upload your first protocol
          </h1>
          <p className={`${subColor} text-sm leading-relaxed max-w-xl`}>
            PIQClinical sets up your workspace from your protocol PDF. Upload the document below and we'll
            handle structuring it into visits, procedures, and the schedule of assessments.
          </p>
        </div>

        <div className={`${cardBg} border rounded-2xl p-6 sm:p-8 mb-6`}>
          <div className="space-y-5 mb-7">
            {STEPS.map(({ icon: Icon, title, detail }, idx) => (
              <div key={title} className="flex gap-4">
                <div className={`flex-shrink-0 w-9 h-9 rounded-xl ${stepIconBg} border flex items-center justify-center`}>
                  <Icon className="w-4 h-4 text-[#6e8fb5]" strokeWidth={1.75} />
                </div>
                <div className="flex-1 pt-0.5">
                  <p className={`text-[11px] font-semibold ${mutedColor} tracking-widest uppercase mb-1`}>
                    Step {idx + 1}
                  </p>
                  <p className={`${headingColor} text-sm font-semibold mb-1`}>{title}</p>
                  <p className={`${subColor} text-[13px] leading-relaxed`}>{detail}</p>
                </div>
              </div>
            ))}
          </div>

          <div className={`pt-6 border-t ${isLight ? 'border-[#e2e8ee]' : 'border-white/5'}`}>
            <UploadForm
              isLight={isLight}
              onSuccess={() => {
                // ProtocolContext realtime picks up the new protocols row and
                // Dashboard re-renders the normal site-mode UI. No explicit
                // navigation needed.
              }}
            />
          </div>
        </div>

        <p className={`${mutedColor} text-xs text-center leading-relaxed max-w-md mx-auto`}>
          Parse typically takes 30–90 seconds. If extraction has low confidence,
          you'll be routed to the Source of Truth Reviewer to verify the fields.
        </p>
      </div>
    </div>
  );
}
