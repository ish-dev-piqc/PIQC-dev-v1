import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, waitFor, screen } from '@testing-library/react';
import { ProtocolProvider, useProtocol } from '../ProtocolContext';
import { setSiteRepo } from '../../lib/site/siteApi';
import type { SiteRepo } from '../../lib/site/repos/types';
import type { Protocol } from '../ProtocolContext';

const ok = <T,>(data: T) => ({ ok: true as const, data });

// =============================================================================
// Regression: ProtocolContext must not let a slow real-repo fetch clobber a
// fast demo-repo fetch when the repo swaps mid-flight (the demo-toggle race).
//
// In the app, flipping the demo toggle re-runs ProtocolContext's load() while
// the active repo is still real (child effect fires before the parent's
// setSiteRepo), then a second load() runs after the swap. The slow Supabase
// fetch can resolve AFTER the fast in-memory demo fetch and overwrite the
// demo protocol list with the real one — so the picker shows real protocols
// (and the calendar goes empty) even though demo mode is on.
// =============================================================================

// demoActive=true so ProtocolContext takes the demo-store realtime branch
// (and never touches supabase). The store subscription is a no-op here.
vi.mock('../DemoModeContext', () => ({
  useDemoMode: () => ({ demoActive: true, setDemoActive: () => {}, canUseDemo: true }),
}));
vi.mock('../../lib/demo', () => ({
  getDemoStore: () => ({ subscribe: () => () => {} }),
}));

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function makeRepo(protocols: Protocol[], delayMs: number): SiteRepo {
  return {
    fetchProtocols: async () => {
      if (delayMs) await delay(delayMs);
      return ok(protocols);
    },
  } as unknown as SiteRepo;
}

const REAL: Protocol[] = [
  { id: 'real-1', code: 'REAL-1', name: 'Real 1', sponsor: 'S', phase: 'Phase 1', demoAnchorDate: null, timezone: null },
  { id: 'real-2', code: 'REAL-2', name: 'Real 2', sponsor: 'S', phase: 'Phase 1', demoAnchorDate: null, timezone: null },
];
const DEMO: Protocol[] = [
  { id: 'demo-1', code: 'DEMO-1', name: 'Demo 1', sponsor: 'S', phase: 'Phase 2', demoAnchorDate: null, timezone: null },
];

function Probe() {
  const { protocols } = useProtocol();
  return <div data-testid="codes">{protocols.map((p) => p.code).sort().join(',')}</div>;
}

describe('ProtocolContext — demo-toggle fetch race', () => {
  afterEach(() => {
    setSiteRepo(makeRepo([], 0)); // reset dispatcher between tests
    localStorage.clear();
  });

  it('a slow real fetch in flight does NOT overwrite the fast demo fetch after a repo swap', async () => {
    // Active repo is the SLOW real repo at mount → load() #1 starts, awaits.
    setSiteRepo(makeRepo(REAL, 50));

    render(
      <ProtocolProvider>
        <Probe />
      </ProtocolProvider>,
    );

    // Swap to the FAST demo repo mid-flight (what flipping the toggle does).
    // This notifies subscribeSiteRepo → load() #2 starts and resolves first.
    await act(async () => {
      setSiteRepo(makeRepo(DEMO, 0));
      await delay(80); // let BOTH the fast demo and the slow real fetch settle
    });

    // The demo list must win; the stale real fetch must be ignored.
    await waitFor(() => {
      expect(screen.getByTestId('codes').textContent).toBe('DEMO-1');
    });
  });
});
