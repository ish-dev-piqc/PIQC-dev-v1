import { useRef } from 'react';

// Touch-swipe-to-dismiss hook for right-edge drawers.
//
// A rightward swipe (increasing clientX) past `threshold` pixels calls onClose.
// Attach the returned handlers to the outermost element of the drawer panel.
//
// Usage:
//   const swipe = useSwipeDismiss({ onClose });
//   <div {...swipe}>...</div>

interface UseSwipeDismissOptions {
  onClose: () => void;
  threshold?: number;
}

export function useSwipeDismiss({ onClose, threshold = 80 }: UseSwipeDismissOptions) {
  const startX = useRef<number | null>(null);
  const startY = useRef<number | null>(null);

  function onTouchStart(e: React.TouchEvent) {
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
  }

  function onTouchEnd(e: React.TouchEvent) {
    if (startX.current === null || startY.current === null) return;

    const dx = e.changedTouches[0].clientX - startX.current;
    const dy = Math.abs(e.changedTouches[0].clientY - startY.current);

    // Only treat as a horizontal swipe if horizontal movement dominates.
    if (dx > threshold && dy < dx * 0.5) {
      onClose();
    }

    startX.current = null;
    startY.current = null;
  }

  return { onTouchStart, onTouchEnd };
}
