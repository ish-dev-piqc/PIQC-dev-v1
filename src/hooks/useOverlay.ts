import { useEffect, useRef } from 'react';

// Shared hook for drawer/modal overlay behaviour.
//
// Handles four concerns every overlay needs:
//   1. ESC key closes the overlay
//   2. Body scroll is locked while open
//   3. Focus is trapped inside containerRef
//   4. Focus returns to the element that was active when the overlay opened
//
// Usage:
//   const containerRef = useRef<HTMLDivElement>(null);
//   useOverlay({ isOpen, onClose, containerRef });

interface UseOverlayOptions {
  isOpen: boolean;
  onClose: () => void;
  containerRef: React.RefObject<HTMLElement | null>;
}

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

// Overlays can stack (e.g. ParticipantProfileDrawer opens above VisitDetailDrawer).
// Each open instance registers here in open order; only the TOPMOST instance
// handles keydown. Without this, every mounted instance's document-level Escape
// listener fires on one keypress, closing every layer at once — and a parent's
// Tab focus-trap can fight the stacked child's.
const overlayStack: symbol[] = [];

export function useOverlay({ isOpen, onClose, containerRef }: UseOverlayOptions) {
  // Remember what had focus before the overlay opened so we can restore it.
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    // Register this instance as the current topmost overlay.
    const stackId = Symbol('overlay');
    overlayStack.push(stackId);

    // Capture trigger so we can restore focus on close.
    previousFocusRef.current = document.activeElement as HTMLElement | null;

    // Lock body scroll.
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Move initial focus into the container.
    const container = containerRef.current;
    if (container) {
      const first = container.querySelectorAll<HTMLElement>(FOCUSABLE)[0];
      first?.focus();
    }

    function handleKeyDown(e: KeyboardEvent) {
      // Only the topmost open overlay responds to keyboard dismiss/trap.
      if (overlayStack[overlayStack.length - 1] !== stackId) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key !== 'Tab' || !container) return;

      const nodes = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (nodes.length === 0) {
        e.preventDefault();
        return;
      }

      const first = nodes[0];
      const last = nodes[nodes.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      const idx = overlayStack.indexOf(stackId);
      if (idx !== -1) overlayStack.splice(idx, 1);
      document.body.style.overflow = original;
      document.removeEventListener('keydown', handleKeyDown);
      // Restore focus to whatever opened the overlay.
      previousFocusRef.current?.focus();
    };
  }, [isOpen, onClose, containerRef]);
}
