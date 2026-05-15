// Unit tests for PrefillAgentNote — the dismissible agentic banner.
//
// FIRST React-component test in Audit Mode. Surface decisions made here
// set precedent for follow-up component tests; calling them out:
//
//   - Render via @testing-library/react directly (no renderWithProviders
//     helper yet). PrefillAgentNote only consumes ThemeContext, which has
//     a sensible default value ('light'), so an unwrapped render gets a
//     deterministic theme without provider plumbing.
//   - localStorage comes free from happy-dom; per-test cleanup is required
//     because state persists across tests by default. Done in beforeEach.
//   - No vi.mock at this layer — the component is pure UI on top of
//     localStorage and props. Mocking would over-reach for the surface
//     under test.
//
// Covers Layer 3 of the prefill idempotency triple-layering:
// the storageKey re-sync on prop change. PR #62 self-review caught a
// stale-closure bug here: useState initializer runs only on mount, so
// changing storageKey kept the previous (stage, audit)'s dismissal state.
// The fix was a useEffect that re-reads localStorage when storageKey
// changes. This test locks that contract.

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PrefillAgentNote from '../PrefillAgentNote';

const STORAGE_KEY_A = 'piq-test-prefill-note-dismissed:audit-A';
const STORAGE_KEY_B = 'piq-test-prefill-note-dismissed:audit-B';

beforeEach(() => {
  localStorage.clear();
  // RTL auto-cleanup runs between tests via the @testing-library/react
  // afterEach hook (matches the SOTR test files' pattern).
});

describe('PrefillAgentNote — initial visibility', () => {
  it('renders when no dismissal flag is in localStorage', () => {
    render(<PrefillAgentNote storageKey={STORAGE_KEY_A} message="Drafts started from upstream context." />);

    expect(screen.getByTestId('prefill-agent-note')).toBeInTheDocument();
  });

  it('hides when localStorage already has the dismissal flag set', () => {
    localStorage.setItem(STORAGE_KEY_A, '1');

    render(<PrefillAgentNote storageKey={STORAGE_KEY_A} message="Drafts started." />);

    expect(screen.queryByTestId('prefill-agent-note')).not.toBeInTheDocument();
  });

  it('renders the custom headline when provided, default otherwise', () => {
    const { rerender } = render(
      <PrefillAgentNote storageKey={STORAGE_KEY_A} message="Body." headline="Custom headline." />,
    );
    expect(screen.getByText('Custom headline.')).toBeInTheDocument();

    rerender(<PrefillAgentNote storageKey={STORAGE_KEY_A} message="Body." />);
    expect(screen.getByText('Drafts started.')).toBeInTheDocument();
  });
});

describe('PrefillAgentNote — dismissal', () => {
  it('hides the banner and persists the flag when the dismiss button is clicked', async () => {
    const user = userEvent.setup();
    render(<PrefillAgentNote storageKey={STORAGE_KEY_A} message="Drafts started." />);

    expect(screen.getByTestId('prefill-agent-note')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /dismiss this note/i }));

    expect(screen.queryByTestId('prefill-agent-note')).not.toBeInTheDocument();
    expect(localStorage.getItem(STORAGE_KEY_A)).toBe('1');
  });
});

describe('PrefillAgentNote — storageKey re-sync on prop change (PR #62 regression)', () => {
  // This is the bug PR #62 self-review caught: useState initializer runs
  // only on first mount, so changing storageKey kept the previous
  // (stage, audit)'s dismissal state. The useEffect added in PR #62
  // commit cfc4cb5 re-reads localStorage whenever storageKey changes.

  it('resets dismissed state to false when storageKey changes to an un-dismissed key', () => {
    // A is already dismissed; B is fresh.
    localStorage.setItem(STORAGE_KEY_A, '1');

    const { rerender } = render(
      <PrefillAgentNote storageKey={STORAGE_KEY_A} message="A message." />,
    );
    expect(screen.queryByTestId('prefill-agent-note')).not.toBeInTheDocument();

    // Switch the prop — banner MUST re-appear for the new key.
    rerender(<PrefillAgentNote storageKey={STORAGE_KEY_B} message="B message." />);
    expect(screen.getByTestId('prefill-agent-note')).toBeInTheDocument();
  });

  it('hides the banner when storageKey changes to an already-dismissed key', () => {
    // A is fresh; B is already dismissed.
    localStorage.setItem(STORAGE_KEY_B, '1');

    const { rerender } = render(
      <PrefillAgentNote storageKey={STORAGE_KEY_A} message="A message." />,
    );
    expect(screen.getByTestId('prefill-agent-note')).toBeInTheDocument();

    rerender(<PrefillAgentNote storageKey={STORAGE_KEY_B} message="B message." />);
    expect(screen.queryByTestId('prefill-agent-note')).not.toBeInTheDocument();
  });

  it('dismissing under key A does NOT bleed into key B', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <PrefillAgentNote storageKey={STORAGE_KEY_A} message="A message." />,
    );

    await user.click(screen.getByRole('button', { name: /dismiss this note/i }));
    expect(localStorage.getItem(STORAGE_KEY_A)).toBe('1');
    expect(localStorage.getItem(STORAGE_KEY_B)).toBeNull();

    rerender(<PrefillAgentNote storageKey={STORAGE_KEY_B} message="B message." />);
    expect(screen.getByTestId('prefill-agent-note')).toBeInTheDocument();
  });
});
