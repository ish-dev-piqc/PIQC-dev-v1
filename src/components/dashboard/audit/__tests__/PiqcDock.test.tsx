// Unit tests for PiqcDock — persistent bottom-right summon affordance.
//
// The dock is the single summon path for PIQC after the "Ask" header
// button was retired. These tests lock the two contracts that matter:
//
//   1. Click fires onOpen — the dock is wired to the shell's chat opener
//   2. hidden=true unmounts the dock — when the chat panel is open, the
//      dock must not be in the DOM (avoids visual fight + z-index race
//      with the z-40 panel)
//
// Visual treatment (color, shadow, position) is not asserted — those are
// design tokens that should evolve without breaking tests. We assert what
// the auditor's hand and eye depend on: it's clickable, it's named, and
// it disappears when the panel is up.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PiqcDock from '../PiqcDock';

describe('PiqcDock — summon affordance', () => {
  it('renders the "Ask PIQC" label so first-time users have brand discovery', () => {
    render(<PiqcDock onOpen={() => {}} hidden={false} />);
    // Both the visible label and the aria-label reference PIQC by name —
    // brand-naming is the point of the rename + skin pass.
    expect(screen.getByText('Ask PIQC')).toBeInTheDocument();
    expect(screen.getByLabelText(/Ask PIQC/i)).toBeInTheDocument();
  });

  it('calls onOpen when clicked', async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(<PiqcDock onOpen={onOpen} hidden={false} />);

    await user.click(screen.getByTestId('piqc-dock'));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('unmounts entirely when hidden=true (no orphan DOM during panel open)', () => {
    render(<PiqcDock onOpen={() => {}} hidden={true} />);
    expect(screen.queryByTestId('piqc-dock')).not.toBeInTheDocument();
  });

  it('renders the brand mark inside the dock', () => {
    render(<PiqcDock onOpen={() => {}} hidden={false} />);
    // PIQC's face — the brand mark badge inside the pill. Locking the
    // test-id here so a future redesign that keeps the dock but reshapes
    // the mark surface still keeps PIQC's face visible.
    expect(screen.getByTestId('piqc-dock-mark')).toBeInTheDocument();
  });
});
