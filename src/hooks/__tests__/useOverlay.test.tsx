// Locks the stacking contract from audit finding FA-38bbb03-38bbb03-23e5de6f8d9d-M2:
// when overlays nest (ParticipantProfileDrawer above VisitDetailDrawer), one Escape
// press must close ONLY the topmost overlay, not every mounted instance.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { useRef } from 'react';
import { useOverlay } from '../useOverlay';

function Overlay({ label, onClose }: { label: string; onClose: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  useOverlay({ isOpen: true, onClose, containerRef });
  return (
    <div ref={containerRef} role="dialog" aria-label={label}>
      <button type="button">{label}-action</button>
    </div>
  );
}

describe('useOverlay stacking', () => {
  it('closes a single open overlay on Escape', () => {
    const onClose = vi.fn();
    render(<Overlay label="only" onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape closes only the topmost of two stacked overlays', () => {
    const closeParent = vi.fn();
    const closeChild = vi.fn();
    const { rerender } = render(<Overlay label="parent" onClose={closeParent} />);
    // Child mounts after the parent is already open (drawer-above-drawer).
    rerender(
      <>
        <Overlay label="parent" onClose={closeParent} />
        <Overlay label="child" onClose={closeChild} />
      </>,
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(closeChild).toHaveBeenCalledTimes(1);
    expect(closeParent).not.toHaveBeenCalled();
  });

  it('after the topmost unmounts, Escape reaches the overlay beneath it', () => {
    const closeParent = vi.fn();
    const closeChild = vi.fn();
    const { rerender } = render(<Overlay label="parent" onClose={closeParent} />);
    rerender(
      <>
        <Overlay label="parent" onClose={closeParent} />
        <Overlay label="child" onClose={closeChild} />
      </>,
    );
    // Close the child (as its onClose handler would) by unmounting it.
    rerender(<Overlay label="parent" onClose={closeParent} />);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(closeParent).toHaveBeenCalledTimes(1);
    expect(closeChild).not.toHaveBeenCalled();
  });
});
