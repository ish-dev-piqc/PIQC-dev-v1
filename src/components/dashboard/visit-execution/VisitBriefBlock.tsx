import { AlertTriangle, BookOpen, CalendarClock, GitFork, Timer, Users } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import type { VisitBriefLine, VisitBriefLineKind } from '../../../lib/visit-execution/visitBriefModel';

// =============================================================================
// VisitBriefBlock — the narrative-first landing's opening object: the visit,
// read back to the coordinator as a handful of claims. Line assembly happens
// in visitBriefModel (pure, tested); this component only presents.
//
// Provenance treatment: the block-level label is "PIQC drafted" (the orient
// prose IS a PIQC draft, composed at ingest) with the advisory microcopy the
// VEW carries everywhere. Every claim that has a locatable source wears its
// address as a chip (§ · page) — the chip is the claim's citation, not a
// button; the verbatim quotes live one layer down in the sequence nodes and
// the traceability drawer.
// =============================================================================

interface Props {
  lines: VisitBriefLine[];
}

const KIND_ICONS: Partial<Record<VisitBriefLineKind, React.ReactNode>> = {
  scope: <Users size={12} aria-hidden />,
  clock: <CalendarClock size={12} aria-hidden />,
  gate: <GitFork size={12} aria-hidden />,
  timed: <Timer size={12} aria-hidden />,
  watchout: <AlertTriangle size={12} aria-hidden />,
};

export default function VisitBriefBlock({ lines }: Props) {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  if (lines.length === 0) return null;

  const orient = lines.find((l) => l.kind === 'orient');
  const claims = lines.filter((l) => l.kind !== 'orient');

  return (
    <section
      data-testid="vew-visit-brief"
      aria-label="Visit brief"
      className={`rounded-2xl border p-5 ${
        isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/5'
      }`}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <BookOpen size={13} className="text-brand-500 flex-shrink-0" aria-hidden />
        <h3 className="text-fg-heading text-sm font-semibold">The visit, in brief</h3>
        <span
          className="text-fg-label text-[10px] uppercase tracking-wider font-semibold"
          data-testid="vew-brief-attribution"
        >
          · PIQC drafted
        </span>
        <span className="ml-auto text-fg-muted text-[11px]">
          Draft — verify against the protocol source
        </span>
      </div>

      {orient && (
        <p className="text-fg-body text-sm leading-relaxed mt-3">{orient.text}</p>
      )}

      {claims.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {claims.map((line) => (
            <li
              key={line.key}
              data-testid={`vew-brief-line-${line.kind}`}
              className={`flex items-start gap-2 text-[13px] leading-relaxed ${
                line.kind === 'watchout'
                  ? 'text-amber-800 dark:text-amber-300'
                  : line.kind === 'more'
                    ? 'text-fg-muted text-[12px]'
                    : 'text-fg-body'
              }`}
            >
              {KIND_ICONS[line.kind] && (
                <span
                  className={`mt-1 flex-shrink-0 ${
                    line.kind === 'watchout'
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-fg-muted'
                  }`}
                >
                  {KIND_ICONS[line.kind]}
                </span>
              )}
              <span className="min-w-0">
                {line.text}
                {line.refs.map((ref) => (
                  <span
                    key={ref.label}
                    data-testid="vew-brief-ref"
                    title={`Protocol source: ${ref.label}`}
                    className={`ml-1.5 inline-flex items-center align-[1px] rounded border px-1 py-px font-mono text-[10px] leading-4 whitespace-nowrap ${
                      isLight
                        ? 'text-brand-700 bg-brand-50 border-brand-200'
                        : 'text-brand-300 bg-brand-400/10 border-brand-400/20'
                    }`}
                  >
                    {ref.label}
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
