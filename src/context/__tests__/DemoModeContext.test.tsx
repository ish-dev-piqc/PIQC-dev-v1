import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import type { UserProfile } from '../AuthContext';

// -----------------------------------------------------------------------------
// Mocks
// -----------------------------------------------------------------------------
//
// DemoModeContext depends on:
//   - useAuth() — for the server-side is_demo_user flag
//   - setSiteRepo + realSiteRepo + demoSiteRepo — for the dispatcher swap
//
// We stub all of these so the test is hermetic: it only exercises the gating
// logic, not the auth or repo machinery.

const setSiteRepoMock = vi.fn();
const realRepoSentinel = { __kind: 'real' as const };
const demoRepoSentinel = { __kind: 'demo' as const };

vi.mock('../../lib/site/siteApi', () => ({
  setSiteRepo: (...args: unknown[]) => setSiteRepoMock(...args),
}));
vi.mock('../../lib/site/repos/realSiteRepo', () => ({
  realSiteRepo: realRepoSentinel,
}));
vi.mock('../../lib/site/repos/demoSiteRepo', () => ({
  demoSiteRepo: demoRepoSentinel,
}));

let mockProfile: UserProfile | null = null;
vi.mock('../AuthContext', () => ({
  useAuth: () => ({ profile: mockProfile }),
}));

// Import AFTER mocks so the module picks them up.
const importContext = async () =>
  await import('../DemoModeContext');

const STORAGE_KEY = 'piq-demo-active-v1';

function makeProfile(flag: boolean): UserProfile {
  return {
    id: 'u-1',
    name: 'Test',
    role: 'AUDITOR',
    title: null,
    organization: null,
    timezone: null,
    phone: null,
    profile_completed_at: '2026-01-01',
    is_demo_user: flag,
  };
}

// -----------------------------------------------------------------------------

describe('DemoModeContext — server-gated demo toggle', () => {
  beforeEach(() => {
    localStorage.clear();
    setSiteRepoMock.mockClear();
    mockProfile = null;
    vi.resetModules();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('non-flagged users: canUseDemo is false, demoActive is false', async () => {
    mockProfile = makeProfile(false);
    localStorage.setItem(STORAGE_KEY, '1'); // even with the bit set locally
    const { DemoModeProvider, useDemoMode } = await importContext();

    let captured = { demoActive: true, canUseDemo: true };
    function Probe() {
      const v = useDemoMode();
      captured = { demoActive: v.demoActive, canUseDemo: v.canUseDemo };
      return null;
    }

    render(
      <DemoModeProvider>
        <Probe />
      </DemoModeProvider>,
    );

    expect(captured.canUseDemo).toBe(false);
    expect(captured.demoActive).toBe(false);
  });

  it('flagged users with bit off: canUseDemo true, demoActive false', async () => {
    mockProfile = makeProfile(true);
    const { DemoModeProvider, useDemoMode } = await importContext();

    let captured = { demoActive: true, canUseDemo: false };
    function Probe() {
      const v = useDemoMode();
      captured = { demoActive: v.demoActive, canUseDemo: v.canUseDemo };
      return null;
    }
    render(
      <DemoModeProvider>
        <Probe />
      </DemoModeProvider>,
    );

    expect(captured.canUseDemo).toBe(true);
    expect(captured.demoActive).toBe(false);
  });

  it('flagged users with bit on: demoActive is true and siteApi swaps to demoSiteRepo', async () => {
    mockProfile = makeProfile(true);
    localStorage.setItem(STORAGE_KEY, '1');
    const { DemoModeProvider, useDemoMode } = await importContext();

    let captured = { demoActive: false };
    function Probe() {
      const v = useDemoMode();
      captured = { demoActive: v.demoActive };
      return null;
    }
    render(
      <DemoModeProvider>
        <Probe />
      </DemoModeProvider>,
    );

    expect(captured.demoActive).toBe(true);
    // The effect that flips siteApi should have fired with the demo repo.
    expect(setSiteRepoMock).toHaveBeenLastCalledWith(demoRepoSentinel);
  });

  it('setDemoActive(true) is a no-op when canUseDemo is false (security gate)', async () => {
    mockProfile = makeProfile(false);
    const { DemoModeProvider, useDemoMode } = await importContext();

    let api: ReturnType<typeof useDemoMode> | null = null;
    function Probe() {
      api = useDemoMode();
      return null;
    }
    render(
      <DemoModeProvider>
        <Probe />
      </DemoModeProvider>,
    );

    expect(api!.demoActive).toBe(false);
    act(() => {
      api!.setDemoActive(true);
    });

    // localStorage must not have been flipped — bit stays off.
    expect(localStorage.getItem(STORAGE_KEY)).not.toBe('1');
    // Provider re-renders with the same view: still off, still gated.
    expect(api!.demoActive).toBe(false);
  });

  it('setDemoActive(false) always works (revoke path)', async () => {
    mockProfile = makeProfile(true);
    localStorage.setItem(STORAGE_KEY, '1');
    const { DemoModeProvider, useDemoMode } = await importContext();

    let api: ReturnType<typeof useDemoMode> | null = null;
    function Probe() {
      api = useDemoMode();
      return null;
    }
    render(
      <DemoModeProvider>
        <Probe />
      </DemoModeProvider>,
    );

    expect(api!.demoActive).toBe(true);
    act(() => {
      api!.setDemoActive(false);
    });
    expect(localStorage.getItem(STORAGE_KEY)).toBe('0');
    expect(api!.demoActive).toBe(false);
  });
});
