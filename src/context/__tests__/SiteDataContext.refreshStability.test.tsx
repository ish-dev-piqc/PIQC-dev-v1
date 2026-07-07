import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { SiteDataProvider, useSiteData } from '../SiteDataContext';
import type { Protocol } from '../ProtocolContext';

// =============================================================================
// Regression (CTX-501): SiteDataContext.refresh() identity must be STABLE
// across a ProtocolContext protocols-list update that changes the array
// reference but NOT the set of protocol ids.
//
// The bug: refresh depended on the whole `protocols` array. ProtocolContext
// hands back a brand-new array on every load() — including unrelated, org-wide
// realtime-triggered reloads via the unfiltered protocols-changes channel. That
// churned refresh's identity, which re-ran the fetch effect AND tore down /
// re-subscribed the per-protocol realtime channel for a protocol that never
// changed. This test locks refresh's identity to the actual set of ids.
// =============================================================================

const ok = <T,>(data: T) => ({ ok: true as const, data });

// --- Supabase seam: count channel create / removeChannel so we can assert the
//     realtime subscription is NOT torn down on unrelated list churn. ---
const channelSubscribe = vi.fn();
const createChannel = vi.fn(() => ({
  on() {
    return this;
  },
  subscribe: channelSubscribe,
}));
const removeChannel = vi.fn();
vi.mock('../../lib/supabase', () => ({
  supabase: {
    channel: (...args: unknown[]) => createChannel(...(args as [])),
    removeChannel: (...args: unknown[]) => removeChannel(...(args as [])),
  },
}));

// --- siteApi fetch seam: count how many times refresh actually fetches. ---
const fetchParticipants = vi.fn(async () => ok([]));
vi.mock('../../lib/site/siteApi', () => ({
  fetchParticipants: (...a: unknown[]) => fetchParticipants(...(a as [])),
  fetchVisitsForProtocol: async () => ok([]),
  fetchTeamMembers: async () => ok([]),
  fetchProtocolDocuments: async () => ok([]),
  subscribeSiteRepo: () => () => {},
}));

// Real mode (not demo) so we take the supabase realtime branch.
vi.mock('../DemoModeContext', () => ({
  useDemoMode: () => ({ demoActive: false, setDemoActive: () => {}, canUseDemo: false }),
}));
vi.mock('../../lib/demo', () => ({
  getDemoStore: () => ({ subscribe: () => () => {} }),
}));

// --- Controllable ProtocolContext: a single scoped active protocol, plus a
//     protocols array whose *reference* we can churn on demand without changing
//     the ids (simulating an unrelated org-wide load()). ---
const PROTO: Protocol = {
  id: 'p-1',
  code: 'P-1',
  name: 'Protocol 1',
  sponsor: 'S',
  phase: 'Phase 1',
  demoAnchorDate: null,
  timezone: null,
};

let churnProtocols: () => void = () => {};

vi.mock('../ProtocolContext', () => ({
  useProtocol: () => {
    // Fresh array each churn — same id, new reference (the exact shape
    // ProtocolContext.load() produces on every fetch).
    const [protocols, setProtocols] = useState<Protocol[]>([{ ...PROTO }]);
    churnProtocols = () => setProtocols([{ ...PROTO }]);
    return {
      protocols,
      activeProtocol: PROTO, // scoped to a single protocol
      isLoading: false,
      setActiveProtocol: () => {},
      refresh: () => {},
    };
  },
}));

let capturedRefresh: (() => void) | null = null;
function Probe() {
  const { refresh } = useSiteData();
  capturedRefresh = refresh;
  return null;
}

describe('SiteDataContext — refresh identity stability (CTX-501)', () => {
  beforeEach(() => {
    capturedRefresh = null;
    createChannel.mockClear();
    removeChannel.mockClear();
    fetchParticipants.mockClear();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('keeps refresh identity stable across a protocols-array churn with unchanged ids', async () => {
    render(
      <SiteDataProvider>
        <Probe />
      </SiteDataProvider>,
    );

    // Let the initial mount fetch + realtime subscribe settle.
    await waitFor(() => expect(fetchParticipants).toHaveBeenCalled());
    const refreshBefore = capturedRefresh;
    const channelsBefore = createChannel.mock.calls.length;
    const fetchesBefore = fetchParticipants.mock.calls.length;
    expect(refreshBefore).toBeTypeOf('function');

    // Simulate an unrelated org-wide protocols reload: new array, same ids.
    await act(async () => {
      churnProtocols();
    });

    // refresh identity must be UNCHANGED → the fetch effect and the realtime
    // effect never re-run.
    expect(capturedRefresh).toBe(refreshBefore);
    // No new realtime channel created and none removed for the same protocol.
    expect(createChannel.mock.calls.length).toBe(channelsBefore);
    expect(removeChannel).not.toHaveBeenCalled();
    // No needless refetch triggered by the list churn.
    expect(fetchParticipants.mock.calls.length).toBe(fetchesBefore);
  });
});
