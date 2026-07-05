import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertOctagon,
  AlertTriangle,
  BadgeCheck,
  Info,
  MessageSquare,
  MoreHorizontal,
  Presentation,
} from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import {
  CONFIDENCE_LABELS,
  type DeliverableConfidenceState,
  type DeliverablePacketBlock,
} from '../../types/deliverables';
import { ContentOriginBadge } from './ContentOriginBadge';
import { DeliverableReviewBadge } from './DeliverableReviewBadge';

// =============================================================================
// DeliverableBlockRow — one block of a deliverable draft, following the VEW
// ExecutionChecklist row density:
//
//   - left checkbox toggles reviewed ↔ (un)reviewed via the paired callbacks
//   - display_text + origin/review badges + rare-loud confidence chip
//   - review-note preview line when a note exists
//   - "View source" affordance ONLY when the block actually carries evidence
//     (facts do; framing and human notes must never imply provenance)
//   - remaining actions live in a compact ⋯ overflow menu (flag / edit /
//     note / remove-from-draft / delete) so the row stays calm
//
// "Remove from draft" is the reject action: the block is preserved in the DB
// and edit log, excluded from render/export, and never resurrected by
// regeneration. Hard delete is offered ONLY for human_added blocks.
//
// Pure presentation: no data access, no optimistic state — the parent owns
// packet state and refreshes rows after each mutation resolves.
// =============================================================================

interface Props {
  block: DeliverablePacketBlock;
  onMarkReviewed: (block: DeliverablePacketBlock) => void;
  onUnmarkReviewed: (block: DeliverablePacketBlock) => void;
  onFlag: (block: DeliverablePacketBlock) => void;
  onReject: (block: DeliverablePacketBlock) => void;
  onEdit: (block: DeliverablePacketBlock) => void;
  onAddNote: (block: DeliverablePacketBlock) => void;
  onShowSource: (block: DeliverablePacketBlock) => void;
  onDelete: (block: DeliverablePacketBlock) => void;
}

export function DeliverableBlockRow({
  block,
  onMarkReviewed,
  onUnmarkReviewed,
  onFlag,
  onReject,
  onEdit,
  onAddNote,
  onShowSource,
  onDelete,
}: Props) {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const [menuOpen, setMenuOpen] = useState(false);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  // "Remove from draft" is hidden from the packet once it lands, so there is
  // no in-UI undo — it earns a two-step confirm inside the menu.
  const [confirmingReject, setConfirmingReject] = useState(false);

  const isReviewed = block.review_state === 'reviewed';
  const hasSource = block.source_evidence_id !== null || block.source_quote !== null;

  interface MenuItem {
    label: string;
    title?: string;
    danger: boolean;
    /** Keep the menu open after selecting (used by the confirm step). */
    keepOpen?: boolean;
    onSelect: () => void;
  }

  const menuItems: MenuItem[] = [
    { label: 'Edit text', danger: false, onSelect: () => onEdit(block) },
    { label: 'Add note', danger: false, onSelect: () => onAddNote(block) },
    { label: 'Flag for review', danger: false, onSelect: () => onFlag(block) },
    confirmingReject
      ? {
          label: 'Confirm removal',
          title:
            'The item is hidden from the draft and every export, preserved in the record, and never re-added by regeneration.',
          danger: true,
          onSelect: () => onReject(block),
        }
      : {
          label: 'Remove from draft',
          title:
            'Removes this item from the draft and every export. It is preserved in the record, and regeneration will not re-add it. Click twice to confirm.',
          danger: false,
          keepOpen: true,
          onSelect: () => setConfirmingReject(true),
        },
  ];
  // Hard delete is reserved for reviewer-added blocks; parser-origin blocks
  // are rejected (preserved) instead so regeneration can't resurrect them.
  // Gate on content_origin (immutable) — review_state mutates as soon as the
  // block is reviewed or edited, and deletability must survive that.
  if (block.content_origin === 'human_editorial') {
    menuItems.push({ label: 'Delete item', danger: true, onSelect: () => onDelete(block) });
  }

  const closeMenu = () => {
    setMenuOpen(false);
    setConfirmingReject(false);
  };

  const toggleMenu = () => {
    setConfirmingReject(false);
    setMenuOpen((prev) => {
      const next = !prev;
      if (next && menuBtnRef.current) {
        const r = menuBtnRef.current.getBoundingClientRect();
        // Flip above the trigger when there's no room below (same portal
        // pattern as VEW — escapes the section card's overflow-hidden).
        const estHeight = 8 + menuItems.length * 33;
        const openUp = r.bottom + estHeight > window.innerHeight;
        setMenuPos({
          top: openUp ? Math.max(8, r.top - estHeight - 4) : r.bottom + 4,
          right: Math.max(8, window.innerWidth - r.right),
        });
      }
      return next;
    });
  };

  return (
    <li
      data-testid="deliverable-block-row"
      data-block-id={block.id}
      data-review-state={block.review_state}
      className={`px-4 py-3.5 ${
        isReviewed ? (isLight ? 'bg-emerald-50/30' : 'bg-emerald-400/[0.04]') : ''
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Review toggle */}
        <button
          type="button"
          onClick={() => (isReviewed ? onUnmarkReviewed(block) : onMarkReviewed(block))}
          aria-label={isReviewed ? 'Unmark as reviewed' : 'Mark as reviewed'}
          aria-pressed={isReviewed}
          data-testid="deliverable-review-toggle"
          className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded-md border flex items-center justify-center ${
            isReviewed
              ? isLight
                ? 'bg-emerald-500 border-emerald-500 text-white'
                : 'bg-emerald-500/80 border-emerald-500/80 text-white'
              : isLight
                ? 'border-[#CBD5E1] hover:border-[#334155]'
                : 'border-white/15 hover:border-white/30'
          }`}
        >
          {isReviewed && (
            <svg viewBox="0 0 12 12" fill="none" className="w-3 h-3" aria-hidden>
              <path
                d="M2 6.5 5 9.5 10 3.5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </button>

        <div className="flex-1 min-w-0">
          {/* Speaker notes get a quiet label line — teaching prose reads as
              teaching prose, with the same review machinery as every block. */}
          {block.block_type === 'speaker_note' && (
            <p
              title="Teaching prose for the SIV deck notes band — review like any other block."
              data-testid="deliverable-speaker-note-label"
              className="flex items-center gap-1 text-fg-label text-[10px] uppercase tracking-wider font-semibold mb-1"
            >
              <Presentation size={10} aria-hidden />
              Speaker note
            </p>
          )}
          <p className="text-fg-body text-sm font-medium leading-relaxed">
            {block.display_text}
          </p>

          <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
            <ContentOriginBadge origin={block.content_origin} />
            <DeliverableReviewBadge state={block.review_state} />
            {block.confidence_state !== null && (
              <ConfidenceChip confidence={block.confidence_state} isLight={isLight} />
            )}
          </div>

          {block.review_note && (
            <p
              data-testid="deliverable-review-note-preview"
              className="flex items-start gap-1.5 text-fg-muted text-xs mt-1.5 leading-relaxed"
            >
              <MessageSquare size={11} className="mt-0.5 flex-shrink-0" aria-hidden />
              <span className="truncate">{block.review_note}</span>
            </p>
          )}
        </div>

        {/* Right-side action cluster */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {hasSource && (
            <button
              type="button"
              onClick={() => onShowSource(block)}
              aria-label="View protocol source"
              title="View the protocol quote and reference behind this item"
              data-testid="deliverable-view-source"
              className={`inline-flex items-center justify-center w-6 h-6 rounded-md text-fg-sub ${
                isLight
                  ? 'hover:bg-[#E2E8F0] hover:text-fg-body'
                  : 'hover:bg-white/[0.06] hover:text-fg-body'
              }`}
            >
              <Info size={14} aria-hidden />
            </button>
          )}

          <div>
            <button
              ref={menuBtnRef}
              type="button"
              onClick={toggleMenu}
              aria-label="More actions"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              data-testid="deliverable-row-menu-trigger"
              className={`inline-flex items-center justify-center w-6 h-6 rounded-md text-fg-sub ${
                isLight
                  ? 'hover:bg-[#E2E8F0] hover:text-fg-body'
                  : 'hover:bg-white/[0.06] hover:text-fg-body'
              }`}
            >
              <MoreHorizontal size={13} aria-hidden />
            </button>
            {menuOpen &&
              menuPos &&
              createPortal(
                <>
                  <button
                    type="button"
                    aria-hidden
                    tabIndex={-1}
                    onClick={closeMenu}
                    className="fixed inset-0 z-[60] cursor-default"
                  />
                  <div
                    role="menu"
                    data-testid="deliverable-row-menu"
                    style={{ position: 'fixed', top: menuPos.top, right: menuPos.right }}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        e.stopPropagation();
                        closeMenu();
                        menuBtnRef.current?.focus();
                      }
                    }}
                    className={`w-48 z-[61] rounded-md border shadow-lg overflow-hidden ${
                      isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/10'
                    }`}
                  >
                    {menuItems.map((item, index) => (
                      <button
                        key={item.label}
                        type="button"
                        role="menuitem"
                        title={item.title}
                        // Focus lands in the menu on open so keyboard users
                        // aren't dumped at the end of the document by the
                        // portal (Escape returns focus to the trigger).
                        autoFocus={index === 0}
                        onClick={() => {
                          item.onSelect();
                          if (!item.keepOpen) closeMenu();
                        }}
                        className={`w-full text-left text-xs px-3 py-2 ${
                          item.danger
                            ? isLight
                              ? 'text-rose-700 hover:bg-rose-50 border-t border-[#E2E8F0]'
                              : 'text-rose-300 hover:bg-rose-500/10 border-t border-white/10'
                            : isLight
                              ? 'text-fg-body hover:bg-[#F8FAFC]'
                              : 'text-fg-body hover:bg-white/[0.04]'
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </>,
                document.body,
              )}
          </div>
        </div>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Confidence chip — rare-loud discipline: 'low' / 'needs_review' earn filled
// caution chips; 'high' / 'medium' render as quiet text so the alarms pop.
// Local to the row (deliverables can't import the VEW badge — copy, don't
// couple). Only protocol_fact blocks carry confidence; framing/human blocks
// pass NULL and never reach here.
// ---------------------------------------------------------------------------

const CONFIDENCE_TITLES: Record<DeliverableConfidenceState, string> = {
  high: 'High extraction confidence for this protocol fact.',
  medium: 'Medium extraction confidence — worth a glance against the source quote.',
  low: 'Low extraction confidence — verify this item against the protocol source before relying on it.',
  needs_review:
    'PIQC could not gauge confidence on this extraction — check it against the protocol source.',
};

function ConfidenceChip({
  confidence,
  isLight,
}: {
  confidence: DeliverableConfidenceState;
  isLight: boolean;
}) {
  const tone = (() => {
    switch (confidence) {
      case 'high':
        return isLight
          ? 'text-emerald-700 bg-transparent border-transparent'
          : 'text-emerald-400 bg-transparent border-transparent';
      case 'medium':
        return isLight
          ? 'text-brand-700 bg-transparent border-transparent'
          : 'text-brand-400 bg-transparent border-transparent';
      case 'low':
        return isLight
          ? 'text-amber-700 bg-amber-50 border-amber-200'
          : 'text-amber-400 bg-amber-400/10 border-amber-400/20';
      case 'needs_review':
        return isLight
          ? 'text-rose-700 bg-rose-50 border-rose-200'
          : 'text-rose-400 bg-rose-400/10 border-rose-400/20';
    }
  })();

  const Icon = (() => {
    switch (confidence) {
      case 'high':
        return BadgeCheck;
      case 'medium':
        return Info;
      case 'low':
        return AlertTriangle;
      case 'needs_review':
        return AlertOctagon;
    }
  })();

  return (
    <span
      title={CONFIDENCE_TITLES[confidence]}
      aria-label={CONFIDENCE_LABELS[confidence]}
      data-testid="deliverable-confidence-chip"
      data-confidence={confidence}
      className={`inline-flex items-center gap-1 font-semibold uppercase tracking-wider rounded-md border text-[10px] px-1.5 py-0.5 ${tone}`}
    >
      <Icon size={10} aria-hidden />
      {CONFIDENCE_LABELS[confidence]}
    </span>
  );
}
