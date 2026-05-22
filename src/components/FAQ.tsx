import { ChevronDown } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

const faqs = [
  {
    q: 'Who is PIQClinical built for?',
    a: 'Site managers, study coordinators, auditors, and sponsors running real clinical trials. The product structures protocol content into a format teams work from directly, rather than re-interpreting dense documents at each visit.',
  },
  {
    q: 'What does the platform actually do?',
    a: 'Upload a protocol document and it extracts procedures, timelines, eligibility criteria, and responsibilities into a navigable, queryable structure. Site Mode runs the trial day-to-day; Audit Mode reviews execution against the protocol.',
  },
  {
    q: 'Is PIQClinical HIPAA-aware?',
    a: 'Yes. PIQClinical is built for clinical research workflows with HIPAA-aware data handling. Get in touch via the form below if you need specifics for your compliance review.',
  },
  {
    q: 'Does this replace our CTMS or EDC?',
    a: 'No. PIQClinical sits alongside your existing CTMS / EDC and focuses on protocol interpretation and execution. It turns the protocol document itself into a workflow your team can move through, complementing the systems that handle scheduling and data capture.',
  },
  {
    q: 'How does my team get started?',
    a: 'Sign in with your email on the Sign In page — magic link, no password required, works for new and returning users. From there, the Pilot tier lets you run PIQClinical against a single protocol your team already knows.',
  },
  {
    q: "What's the difference between the Pilot and a Workspace?",
    a: 'The Pilot is a one-time purchase for a single protocol — designed for teams that want to see PIQClinical handle a real document before committing. Workspace is a recurring plan (monthly or annual) for ongoing use, with add-ons available for additional protocols or seats.',
  },
  {
    q: 'Do you integrate with EHRs or other source systems?',
    a: "Not at the moment. PIQClinical focuses on the protocol-execution and protocol-review surfaces. If integrations are on your shortlist, drop a note in the contact form and we'll talk through what's on the roadmap.",
  },
  {
    q: 'Can multiple sites or sponsors work on the same protocol?',
    a: 'Yes. Workspaces support cross-organization collaboration on shared protocols, with scoped access controls so each org sees only what it should.',
  },
];

export default function FAQ() {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const bg = isLight ? 'bg-[#f5f7fa]' : 'bg-[#0d1118]';
  const border = isLight ? 'border-[#e2e8ee]' : 'border-white/[0.05]';
  const itemBg = isLight ? 'bg-white border-[#e2e8ee]' : 'bg-[#161d25] border-white/[0.07]';
  const itemHover = isLight ? 'hover:bg-[#f0f4f8]' : 'hover:bg-[#1a2230]';

  return (
    <section
      id="faq"
      className={`py-24 px-4 sm:px-6 lg:px-8 ${bg} border-t ${border}`}
    >
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-12">
          <p className="text-xs font-semibold text-[#6e8fb5] uppercase tracking-widest mb-4">
            FAQ
          </p>
          <h2 className="text-3xl sm:text-4xl font-bold text-fg-heading leading-tight">
            Common questions
          </h2>
        </div>

        <div className="space-y-3">
          {faqs.map(({ q, a }) => (
            <details
              key={q}
              className={`group rounded-xl border ${itemBg} overflow-hidden transition-colors`}
            >
              <summary
                className={`flex items-center justify-between gap-4 px-5 py-4 cursor-pointer list-none ${itemHover} transition-colors`}
              >
                <span className="text-[15px] font-semibold text-fg-heading leading-snug">
                  {q}
                </span>
                <ChevronDown
                  className="w-4 h-4 text-fg-muted flex-shrink-0 transition-transform group-open:rotate-180"
                  strokeWidth={2}
                />
              </summary>
              <div className="px-5 pb-5 -mt-1">
                <p className="text-[14px] text-fg-sub leading-relaxed">{a}</p>
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
