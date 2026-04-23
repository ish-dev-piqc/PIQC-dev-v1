import { Upload, Layers, CheckSquare, Workflow, FileSearch } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

const steps = [
  {
    number: '01',
    icon: Upload,
    title: 'Upload your protocol document',
    detail:
      'Bring in any clinical trial protocol, regardless of length or formatting complexity, and the platform gets to work immediately.',
  },
  {
    number: '02',
    icon: Layers,
    title: 'Protocol is structured and indexed',
    detail:
      'Procedures, timelines, eligibility criteria, and responsibilities are extracted and organized into a navigable, queryable format.',
  },
  {
    number: '03',
    icon: CheckSquare,
    title: 'Teams work from structured clarity',
    detail:
      'Everyone on the trial accesses what they need when they need it, with a built-in assistant available to answer questions as they come up.',
  },
];

const modes = [
  {
    icon: Workflow,
    label: 'Site Mode',
    tagline: 'For running the trial',
    bullets: [
      'Move through visits, procedures, and tasks in a structured, step-by-step flow',
      'Grouped, plain-language steps on the surface, with deeper protocol detail one expansion away',
      'Built-in guidance surfaces higher-risk or commonly misunderstood areas before they become problems',
    ],
  },
  {
    icon: FileSearch,
    label: 'Audit Mode',
    tagline: 'For reviewing execution',
    bullets: [
      'Compare what the protocol requires against what actually happened',
      'Keep structured notes and findings in one focused workspace',
      'Every observation traces back to the exact protocol logic that governs it',
    ],
  },
];

const whyBullets = [
  {
    heading: 'Reduces protocol review time',
    body: 'Instead of cross-referencing scattered pages, teams navigate structured content. The time spent locating relevant information before each visit or procedure is significantly reduced.',
  },
  {
    heading: 'Keeps responsibilities visible across the trial',
    body: 'Structured views surface what each person is accountable for, so coordination happens through the platform rather than through repeated back-and-forth.',
  },
  {
    heading: 'Resolves ambiguity at the point of need',
    body: 'The built-in assistant interprets dense protocol language and answers contextual questions directly, reducing interruptions and reliance on manual clarification chains.',
  },
];

export default function ValueProps() {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const bg = isLight ? 'bg-[#f5f7fa]' : 'bg-[#0d1118]';
  const border = isLight ? 'border-[#e2e8ee]' : 'border-white/[0.05]';
  const headingColor = isLight ? 'text-[#1a1f28]' : 'text-white';
  const bodyColor = isLight ? 'text-[#374152]/50' : 'text-[#d2d7e0]/50';
  const stepHeadColor = isLight ? 'text-[#1a1f28]' : 'text-white';
  const iconBg = isLight ? 'bg-[#4a6fa5]/10 border border-[#4a6fa5]/20' : 'bg-[#4a6fa5]/15 border border-[#4a6fa5]/25';

  return (
    <>
      <section id="what-it-does" className={`py-24 px-4 sm:px-6 lg:px-8 ${bg}`}>
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 lg:gap-20 items-start">
            <div className="lg:sticky lg:top-24">
              <p className="text-xs font-semibold text-[#6e8fb5] uppercase tracking-widest mb-4">
                What It Does
              </p>
              <h2 className={`text-3xl sm:text-4xl font-bold ${headingColor} leading-tight mb-6`}>
                From dense document to clear workflow
              </h2>
              <p className={`text-[15px] ${bodyColor} leading-relaxed`}>
                Clinical trial protocols are detailed by necessity, but the way teams have traditionally
                consumed them hasn't kept pace with that complexity. PIQClinical structures protocol
                contents into a format teams can actually work from.
              </p>
            </div>

            <div className="space-y-0">
              {steps.map(({ number, icon: Icon, title, detail }, idx) => (
                <div key={number} className="relative flex gap-6">
                  <div className="flex flex-col items-center">
                    <div className={`w-10 h-10 rounded-xl ${iconBg} flex items-center justify-center flex-shrink-0`}>
                      <Icon className="w-4.5 h-4.5 text-[#6e8fb5]" strokeWidth={1.75} />
                    </div>
                    {idx < steps.length - 1 && (
                      <div className="w-px flex-1 mt-3 mb-0 bg-gradient-to-b from-[#4a6fa5]/20 to-transparent min-h-[2.5rem]" />
                    )}
                  </div>
                  <div className={idx < steps.length - 1 ? 'pb-10' : ''}>
                    <span className="text-[11px] font-semibold text-[#6e8fb5]/70 tracking-widest uppercase">
                      Step {number}
                    </span>
                    <h3 className={`text-[16px] font-semibold ${stepHeadColor} mt-1 mb-2`}>{title}</h3>
                    <p className={`text-[14px] ${bodyColor} leading-relaxed`}>{detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className={`py-24 px-4 sm:px-6 lg:px-8 ${bg} border-t ${border}`}>
        <div className="max-w-4xl mx-auto">
          <p className="text-xs font-semibold text-[#6e8fb5] uppercase tracking-widest mb-4 text-center">
            Why It Matters
          </p>
          <p className={`text-2xl sm:text-3xl font-semibold ${headingColor} leading-snug text-center mb-4 max-w-3xl mx-auto`}>
            The problem isn't that protocols are complex. The tools for working with them simply haven't caught up.
          </p>
          <p className={`text-[15px] ${bodyColor} leading-relaxed text-center mb-14 max-w-2xl mx-auto`}>
            Site teams spend significant time navigating documents, coordinating across the trial, and resolving questions
            that the protocol itself should be able to answer. That overhead compounds across every visit, every site,
            every trial.
          </p>

          <div className="space-y-6">
            {whyBullets.map(({ heading, body }) => (
              <div key={heading} className="flex gap-6 pl-6 border-l-2 border-[#4a6fa5]/30">
                <div>
                  <p className={`text-[15px] font-semibold ${headingColor} mb-1.5`}>{heading}</p>
                  <p className={`text-[14px] ${bodyColor} leading-relaxed`}>{body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={`py-24 px-4 sm:px-6 lg:px-8 ${bg} border-t ${border}`}>
        <div className="max-w-6xl mx-auto">
          <div className="mb-14 text-center">
            <p className="text-xs font-semibold text-[#6e8fb5] uppercase tracking-widest mb-4">
              How Teams Use It
            </p>
            <h2 className={`text-3xl sm:text-4xl font-bold ${headingColor} leading-tight max-w-2xl mx-auto`}>
              Built for execution and review
            </h2>
            <p className={`text-[15px] ${bodyColor} leading-relaxed mt-4 max-w-2xl mx-auto`}>
              PIQClinical supports both running the trial day-to-day and reviewing how it was run.
              Each mode is structured for a different kind of work.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {modes.map(({ icon: Icon, label, tagline, bullets }) => (
              <div
                key={label}
                className={`${isLight ? 'bg-white border-[#e2e8ee]' : 'bg-[#161d25] border-white/[0.07]'} border rounded-2xl p-7`}
              >
                <div className="flex items-center gap-3 mb-5">
                  <div className={`w-10 h-10 rounded-xl ${iconBg} flex items-center justify-center flex-shrink-0`}>
                    <Icon className="w-5 h-5 text-[#6e8fb5]" strokeWidth={1.75} />
                  </div>
                  <div>
                    <h3 className={`text-[17px] font-bold ${headingColor} leading-tight`}>{label}</h3>
                    <p className="text-[12px] font-medium text-[#6e8fb5] uppercase tracking-wider mt-0.5">
                      {tagline}
                    </p>
                  </div>
                </div>
                <ul className="space-y-4">
                  {bullets.map((bullet, idx) => (
                    <li key={idx} className="flex gap-3">
                      <span className="w-1 flex-shrink-0 mt-2 h-1 rounded-full bg-[#6e8fb5]/60" />
                      <p className={`text-[14px] ${bodyColor} leading-relaxed`}>{bullet}</p>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

    </>
  );
}
