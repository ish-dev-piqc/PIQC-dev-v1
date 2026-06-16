import { useEffect, useRef } from 'react';
import { FileText, Layers, Workflow, HelpCircle, ArrowRight } from 'lucide-react';
import { UploadForm } from '../KnowledgeBase';
import { useTheme } from '../../../context/ThemeContext';
import { useProtocol } from '../../../context/ProtocolContext';
import { countWorksheetItemsForStudy } from '../../../lib/sotr/sourceEvidenceApi';
import type { DashboardTab } from '../Dashboard';

// =============================================================================
// ProtocolOnboarding — full-screen wall shown after login when the user has
// zero protocols. Composes the existing UploadForm so we don't duplicate the
// PDF → Reducto → ingest pipeline.
//
// Async ingest contract (PR feature/ish-ingest-async):
//   The upload's /ingest call returns 202 with status='pending' before Reducto
//   parse completes. The protocol row doesn't exist yet at that point. The
//   /reducto-webhook function creates the protocols row later (via B2.4
//   inline-create) once parse finishes; ProtocolContext realtime fires on the
//   INSERT, protocols.length flips 0 → 1, and the Dashboard gate unmounts
//   this wall.
//
// The SOTR-routing decision (land on Protocol tab if any items need review)
// fires from a useEffect keyed on that 0 → 1 transition — NOT from
// UploadForm.onSuccess, which now resolves on pending (no protocol_id yet).
// =============================================================================

interface ProtocolOnboardingProps {
  onTabChange?: (tab: DashboardTab) => void;
}

const STEPS = [
  {
    icon: FileText,
    title: 'Upload your protocol PDF',
    detail: 'Drop in the full protocol document — any length, any formatting.',
  },
  {
    icon: Layers,
    title: 'We parse it',
    detail: 'Visits, procedures, eligibility, and the schedule of assessments are extracted with citations.',
  },
  {
    icon: Workflow,
    title: 'Your dashboard is set up',
    detail: 'Protocol metadata, visit templates, and the Ask assistant become ready in Site Mode.',
  },
];

export default function ProtocolOnboarding({ onTabChange }: ProtocolOnboardingProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const { protocols } = useProtocol();

  // SOTR routing — fires exactly once when a new protocol appears (length 0 → 1)
  // during the user's onboarding session. We watch via a ref so a refresh or
  // re-render doesn't re-trigger the route, and so the timing is independent
  // of when the /ingest POST returns (which now resolves on 'pending').
  const routedRef = useRef(false);
  const protocolsLen = protocols.length;
  useEffect(() => {
    if (routedRef.current) return;
    if (protocolsLen === 0) return;
    if (!onTabChange) return;
    const firstProtocol = protocols[0];
    if (!firstProtocol?.id) return;

    routedRef.current = true;
    let cancelled = false;
    countWorksheetItemsForStudy(firstProtocol.id)
      .then((count) => {
        if (cancelled) return;
        // Protocol is now a drawer inside Visit Prep; land there so the
        // Protocol button's awaiting-review badge surfaces the parsed items.
        if (count.awaitingReview > 0) onTabChange('visit-execution');
      })
      .catch(() => {
        // Swallow — defaults to Today, no user impact. The Dashboard gate
        // unmounts this component as soon as the realtime fires, so any
        // missed route is just "user lands on Today" rather than broken.
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [protocolsLen]);

  const pageBg = isLight ? 'bg-[#F8FAFC]' : 'bg-[#020617]';
  const cardBg = isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/5';
  const headingColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';
  const mutedColor = 'text-fg-muted';
  const stepIconBg = isLight ? 'bg-brand-600/10 border-brand-600/20' : 'bg-brand-600/15 border-brand-600/25';

  return (
    <div className={`min-h-screen ${pageBg} pt-20 pb-16 px-4 sm:px-6`}>
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-2.5 mb-8">
          <img src="/PIQC_Logo.png" alt="" className="w-8 h-8 object-contain" />
          <span className={`text-[15px] font-semibold ${headingColor} tracking-tight`}>
            <span className="text-brand-600">PIQC</span>linical
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
                  <Icon className="w-4 h-4 text-brand-300" strokeWidth={1.75} />
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

          <div className={`pt-6 border-t ${isLight ? 'border-[#E2E8F0]' : 'border-white/5'}`}>
            <UploadForm
              isLight={isLight}
              onSuccess={() => {
                // No-op — the routing decision lives in the useEffect above,
                // which fires when ProtocolContext realtime brings the new
                // protocols row into view. The UploadForm itself transitions
                // to its own 'parsing' state on 202.
              }}
            />
          </div>
        </div>

        <p className={`${mutedColor} text-xs text-center leading-relaxed max-w-md mx-auto mb-4`}>
          Parse typically takes 30–90 seconds. If extraction has low confidence,
          you'll be routed to the Source of Truth Reviewer to verify the fields.
        </p>

        {/* Fallback CTA: this wall normally unmounts itself when ProtocolContext's
            realtime fires on the new protocol row (0 → 1). Realtime is not always
            reliable, which can strand the user here even though the protocol is
            ready in the DB. This button force-refreshes so they can reach the
            dashboard without waiting on (or being blocked by) a missed event. */}
        <div className="flex flex-col items-center gap-2 mb-4">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className={`inline-flex items-center gap-1.5 text-sm font-medium rounded-lg px-4 py-2.5 border transition-colors ${
              isLight
                ? 'bg-white border-[#E2E8F0] text-fg-heading hover:bg-[#F2F2F2]'
                : 'bg-[#0F172A] border-white/10 text-fg-heading hover:bg-[#1E293B]'
            }`}
          >
            Already uploaded? Go to dashboard
            <ArrowRight size={14} strokeWidth={2} />
          </button>
          <span className={`${mutedColor} text-[11px]`}>
            Once your protocol is parsed, this takes you to your populated workspace.
          </span>
        </div>

        <details className={`${cardBg} border rounded-xl group`}>
          <summary
            className={`flex items-center gap-2 px-5 py-3 cursor-pointer list-none ${
              isLight ? 'hover:bg-[#F2F2F2]' : 'hover:bg-[#1E293B]'
            } transition-colors`}
          >
            <HelpCircle size={14} className={mutedColor} strokeWidth={1.75} />
            <span className={`text-[13px] font-medium ${headingColor}`}>
              Having trouble uploading?
            </span>
            <span className={`text-xs ${mutedColor} ml-auto group-open:rotate-180 transition-transform`}>▾</span>
          </summary>
          <div className={`px-5 pb-5 pt-1 text-[13px] ${subColor} leading-relaxed space-y-2`}>
            <p>If the upload fails or the parse errors out, the most common causes are:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li><span className={`font-medium ${headingColor}`}>Password-protected PDFs</span> — remove the password and re-upload.</li>
              <li><span className={`font-medium ${headingColor}`}>Scanned PDFs without OCR</span> — our parser handles OCR for most documents, but pure-image PDFs without an embedded text layer can fail or extract poorly. Re-export with OCR enabled.</li>
              <li><span className={`font-medium ${headingColor}`}>Files over 50 MB</span> — split into smaller documents.</li>
              <li><span className={`font-medium ${headingColor}`}>Transient API issues</span> — wait a minute and try again.</li>
            </ul>
            <p className="pt-1">
              Still stuck? Email{' '}
              <a
                href="mailto:contact@piqclinical.com"
                className="text-brand-300 hover:text-[#87b5c7] underline underline-offset-2"
              >
                contact@piqclinical.com
              </a>{' '}
              with the protocol name and we'll help.
            </p>
          </div>
        </details>
      </div>
    </div>
  );
}
