import { FileText, Sparkles, User } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import {
  CONTENT_ORIGIN_LABELS,
  type DeliverableContentOrigin,
} from '../../types/deliverables';

// =============================================================================
// ContentOriginBadge — small chip naming which of the 3-way content-origin
// taxonomy a deliverable block belongs to. The taxonomy is the product's core
// honesty guarantee (never blurred — see types/deliverables), so each origin
// gets a visually distinct treatment:
//
//   protocol_fact               → solid/confident filled brand chip. Facts are
//                                 the evidence-backed spine of the deliverable.
//   derived_operational_framing → outlined chip with the Sparkles PIQC-
//                                 attribution anchor (icon vocabulary per the
//                                 agentic-UX doctrine): PIQC prose, clearly
//                                 attributed, no borrowed authority.
//   human_editorial             → quiet text-only treatment: neutral, human.
//
// The title attribute teaches the taxonomy in one sentence — every element
// must explain itself to a first-time reviewer.
//
// Generic deliverables component (non-dashboard): no mode imports, no data
// access — pure presentation over the frozen types contract.
// =============================================================================

const ORIGIN_TITLES: Record<DeliverableContentOrigin, string> = {
  protocol_fact:
    'Selected from the protocol’s extracted text — carries source evidence and extraction confidence.',
  derived_operational_framing:
    'Deterministic PIQC prose that organizes protocol facts — it carries no protocol provenance of its own.',
  human_editorial:
    'Written by a human reviewer — never overwritten when the checklist is regenerated.',
};

const ORIGIN_ICONS: Record<DeliverableContentOrigin, typeof FileText> = {
  protocol_fact: FileText,
  derived_operational_framing: Sparkles,
  human_editorial: User,
};

interface Props {
  origin: DeliverableContentOrigin;
}

export function ContentOriginBadge({ origin }: Props) {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const tone = (() => {
    switch (origin) {
      // Solid/confident: the filled chip signals "this came from the protocol".
      case 'protocol_fact':
        return isLight
          ? 'text-brand-700 bg-brand-50 border-brand-200'
          : 'text-brand-300 bg-brand-400/10 border-brand-400/25';
      // Outlined: attributed PIQC prose — visible frame, no fill, no borrowed
      // evidence-weight.
      case 'derived_operational_framing':
        return isLight
          ? 'text-fg-sub bg-transparent border-[#CBD5E1]'
          : 'text-fg-sub bg-transparent border-white/15';
      // Neutral text-only: human notes don't compete with the fact/framing pair.
      case 'human_editorial':
        return 'text-fg-sub bg-transparent border-transparent';
    }
  })();

  const Icon = ORIGIN_ICONS[origin];

  return (
    <span
      title={ORIGIN_TITLES[origin]}
      data-testid="deliverable-origin-badge"
      data-origin={origin}
      className={`inline-flex items-center gap-1 font-semibold uppercase tracking-wider rounded-md border text-[10px] px-1.5 py-0.5 ${tone}`}
    >
      <Icon size={10} aria-hidden />
      {CONTENT_ORIGIN_LABELS[origin]}
    </span>
  );
}
