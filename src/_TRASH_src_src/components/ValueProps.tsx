import { Upload, Layers, CheckSquare, Building2, ClipboardCheck, Stethoscope } from 'lucide-react';
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
      'Procedures, timelines, eligibility criteria, and role responsibilities are extracted and organized into a navigable, queryable format.',
  },
  {
    number: '03',
    icon: CheckSquare,
    title: 'Teams work from structured clarity',
    detail:
      'Every role on the trial accesses what they need when they need it, with a built-in assistant available to answer questions as they come up.',
  },
];

const whyBullets = [
  {
    heading: 'Reduces protocol review time',
    body: 'Instead of cross-referencing scattered pages, teams navigate structured content. The time spent locating relevant information before each visit or procedure is significantly reduced.',
  },
  {
    heading: 'Keeps responsibilities visible across the trial',
    body: 'Role-specific views surface what each person is accountable for, so coordination happens through the platform rather than through repeated back-and-forth.',
  },
  {
    heading: 'Resolves ambiguity at the point of need',
    body: 'The built-in assistant interprets dense protocol language and answers contextual questions directly, reducing interruptions and reliance on manual clarification chains.',
  },
];

const roles = [
  {
    icon: Building2,
    role: 'Site Managers',
    bullets: [
      'Monitor site-level progress and upcoming protocol milestones without having to pull up source documents each time',
      'Keep staff aligned on responsibilities and timelines through structured, role-specific views of the protocol',
    ],
  },
  {
    icon: ClipboardCheck,
    role: 'Auditors',
    bullets: [
      'Review structured protocol data and follow execution progress over time rather than working from raw document exports',
      'Surface inconsistencies or procedural gaps across trial steps with a consistent, navigable record of the protocol',
    ],
  },
  {
    icon: Stethoscope,
    role: 'Practitioners',
    bullets: [
      'Access plain-language explanations of protocol requirements at the point of care without interrupting the clinical workflow',
      'Ask questions about eligibility, procedures, or safety criteria and receive answers grounded in the actual protocol text',
    ],
  },
];

export default function ValueProps() {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const bg = isLight ? 'bg-[#f5f7f5]' : 'bg-[#0d110e]';
  const border = isLight ? 'border-[#e2e8e2]' : 'border-white/[0.05]';
  const headingColor = isLight ? 'text-[#1a1f1a]' : 'text-white';
  const bodyColor = isLight ? 'text-[#374137]/50' : 'text-[#d2d7d2]/50';
  const stepHeadColor = isLight ? 'text-[#1a1f1a]' : 'text-white';
  const iconBg = isLight ? 'bg-[#487e4a]/10 border border-[#487e4a]/20' : 'bg-[#487e4a]/15 border border-[#487e4a]/25';
  const cardBg = isLight ? 'bg-[#f5f7f5]' : 'bg-[#0d110e]';
  const cardHover = isLight ? 'hover:bg-[#eef2ee]' : 'hover:bg-[#111a12]';
  const gridBg = isLight ? 'bg-[#d8e4d8]' : 'bg-white/[0.06]';

  return (
    <>
      <section id="what-it-does" className={`py-24 px-4 sm:px-6 lg:px-8 ${bg}`}>
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 lg:gap-20 items-start">
            <div className="lg:sticky lg:top-24">
              <p className="text-xs font-semibold text-[#6e966f] uppercase tracking-widest mb-4">
                What It Does
              </p>
              <h2 className={`text-3xl sm:text-4xl font-bold ${headingColor} leading-tight mb-6`}>
                From dense document to clear workflow
              </h2>
              <p className={`text-[15px] ${bodyColor} leading-relaxed`}>
                Clinical trial protocols are detailed by necessity, but the way teams have traditionally
                consumed them hasn't kept pace with that complexity. The platform structures protocol
                contents into a format every role on the trial can actually work from.
              </p>
            </div>

            <div className="space-y-0">
              {steps.map(({ number, icon: Icon, title, detail }, idx) => (
                <div key={number} className="relative flex gap-6">
                  <div className="flex flex-col items-center">
                    <div className={`w-10 h-10 rounded-xl ${iconBg} flex items-center justify-center flex-shrink-0`}>
                      <Icon className="w-4.5 h-4.5 text-[#6e966f]" strokeWidth={1.75} />
                    </div>
                    {idx < steps.length - 1 && (
                      <div className="w-px flex-1 mt-3 mb-0 bg-gradient-to-b from-[#487e4a]/20 to-transparent min-h-[2.5rem]" />
                    )}
                  </div>
                  <div className={idx < steps.length - 1 ? 'pb-10' : ''}>
                    <span className="text-[11px] font-semibold text-[#6e966f]/70 tracking-widest uppercase">
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
          <p className="text-xs font-semibold text-[#6e966f] uppercase tracking-widest mb-4 text-center">
            Why It Matters
          </p>
          <p className={`text-2xl sm:text-3xl font-semibold ${headingColor} leading-snug text-center mb-4 max-w-3xl mx-auto`}>
            The problem isn't that protocols are complex. The tools for working with them simply haven't caught up.
          </p>
          <p className={`text-[15px] ${bodyColor} leading-relaxed text-center mb-14 max-w-2xl mx-auto`}>
            Site teams spend significant time navigating documents, coordinating across roles, and resolving questions
            that the protocol itself should be able to answer. That overhead compounds across every visit, every site,
            every trial.
          </p>

          <div className="space-y-6">
            {whyBullets.map(({ heading, body }) => (
              <div key={heading} className="flex gap-6 pl-6 border-l-2 border-[#487e4a]/30">
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
          <div className="mb-14">
            <p className="text-xs font-semibold text-[#6e966f] uppercase tracking-widest mb-4">
              Who It's For
            </p>
            <h2 className={`text-3xl sm:text-4xl font-bold ${headingColor} leading-tight max-w-xl`}>
              Built for every role on the trial
            </h2>
            <p className={`text-[15px] ${bodyColor} leading-relaxed mt-4 max-w-2xl`}>
              Different roles have different needs. PIQClinical surfaces the right information in the right
              context for everyone on the trial, so each person can navigate what is directly relevant to
              their work.
            </p>
          </div>

          <div className={`grid grid-cols-1 md:grid-cols-3 gap-px ${gridBg} rounded-2xl overflow-hidden`}>
            {roles.map(({ icon: Icon, role, bullets }) => (
              <div
                key={role}
                className={`${cardBg} p-8 group ${cardHover} transition-colors duration-300`}
              >
                <div className="flex items-center gap-3 mb-6">
                  <div className={`w-9 h-9 rounded-lg ${iconBg} flex items-center justify-center`}>
                    <Icon className="w-4 h-4 text-[#6e966f]" strokeWidth={1.75} />
                  </div>
                  <h3 className={`text-[16px] font-bold ${headingColor}`}>{role}</h3>
                </div>
                <ul className="space-y-5">
                  {bullets.map((bullet, idx) => (
                    <li key={idx} className="flex gap-3">
                      <span className="w-1 flex-shrink-0 mt-2 h-1 rounded-full bg-[#6e966f]/60" />
                      <p className={`text-[13.5px] ${bodyColor} leading-relaxed`}>{bullet}</p>
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
