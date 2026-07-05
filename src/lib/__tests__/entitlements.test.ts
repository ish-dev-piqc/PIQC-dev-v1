import { describe, expect, it } from 'vitest';
import { canUseCraMode, canUseSponsorMode } from '../entitlements';
import type { Subscription } from '../../hooks/useSubscription';

// =============================================================================
// Mode entitlement gates — enterprise-tier checks for Sponsor and CRA modes.
// The two gates are deliberately separate functions (entitlements are product
// levers; coupling them would couple future pricing) but share behavior
// today, so both are pinned by the same matrix.
// =============================================================================

function sub(kind: Subscription['kind']): Subscription {
  return {
    kind,
    billingMode: kind === null ? null : 'monthly',
    planName: kind ?? 'none',
    status: 'active',
    includedUsers: 5,
    includedProtocols: 3,
    addonSeatPacks: 0,
    addonProtocols: 0,
    totalUsers: 5,
    totalProtocols: 3,
  } as Subscription;
}

const GATES = [
  ['canUseSponsorMode', canUseSponsorMode],
  ['canUseCraMode', canUseCraMode],
] as const;

describe.each(GATES)('%s', (_name, gate) => {
  it('denies with no subscription at all', () => {
    const d = gate(null);
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toMatch(/enterprise/);
  });

  it('denies a subscription with a null plan kind', () => {
    const d = gate(sub(null));
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.addonProductKind).toBeNull();
  });

  it('allows the enterprise tier', () => {
    expect(gate(sub('enterprise'))).toEqual({ allowed: true });
  });

  it('denies non-enterprise tiers with an upgrade reason and no addon path', () => {
    const d = gate(sub('pilot' as Subscription['kind']));
    expect(d.allowed).toBe(false);
    if (!d.allowed) {
      expect(d.reason).toMatch(/enterprise tier/);
      expect(d.addonProductKind).toBeNull();
    }
  });
});

describe('gate copy stays mode-specific', () => {
  it('names its own mode in the denial reason', () => {
    const sponsor = canUseSponsorMode(sub(null));
    const cra = canUseCraMode(sub(null));
    if (!sponsor.allowed) expect(sponsor.reason).toMatch(/Sponsor Mode/);
    if (!cra.allowed) expect(cra.reason).toMatch(/CRA Mode/);
  });
});
