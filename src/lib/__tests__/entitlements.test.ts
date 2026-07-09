import { describe, expect, it } from 'vitest';
import { canUseCraMode, canUseSponsorMode } from '../entitlements';

// =============================================================================
// Protocol Deliverable Engine gates — Sponsor + CRA surfaces.
//
// These gate on the org's real 'deliverable_engine' capability (a boolean read
// from org_has_entitlement via useDeliverableEntitlement), NOT on a dead
// subscription tier. The two gates are deliberately separate functions
// (entitlements are product levers; coupling them would couple future pricing)
// but share behavior today, so both are pinned by the same matrix.
// =============================================================================

const GATES = [
  ['canUseSponsorMode', canUseSponsorMode],
  ['canUseCraMode', canUseCraMode],
] as const;

describe.each(GATES)('%s', (_name, gate) => {
  it('allows when the org holds the deliverable_engine capability', () => {
    expect(gate(true)).toEqual({ allowed: true });
  });

  it('denies when the org lacks the capability, with a reason and no addon path', () => {
    const d = gate(false);
    expect(d.allowed).toBe(false);
    if (!d.allowed) {
      expect(d.reason).toMatch(/isn’t enabled/);
      expect(d.addonProductKind).toBeNull();
    }
  });

  it('does not mention the dead enterprise tier in its denial', () => {
    const d = gate(false);
    if (!d.allowed) expect(d.reason).not.toMatch(/enterprise/i);
  });
});

describe('gate copy stays mode-specific', () => {
  it('names its own mode in the denial reason', () => {
    const sponsor = canUseSponsorMode(false);
    const cra = canUseCraMode(false);
    if (!sponsor.allowed) expect(sponsor.reason).toMatch(/Sponsor Mode/);
    if (!cra.allowed) expect(cra.reason).toMatch(/CRA Mode/);
  });
});
