import { describe, expect, it } from 'vitest';
import { canUseProtocolIntelligence } from '../entitlements';

// =============================================================================
// Protocol Deliverable Engine gate — merged Sponsor + CRA surface.
//
// Gates on the org's real 'deliverable_engine' capability (a boolean read
// from org_has_entitlement via useDeliverableEntitlement), NOT on a dead
// subscription tier. Sponsor Mode and CRA Mode were merged into one workspace
// 2026-08-02 (CraWorkspaceShell), so the two formerly-separate gate functions
// (canUseSponsorMode/canUseCraMode) collapsed into this one.
// =============================================================================

describe('canUseProtocolIntelligence', () => {
  it('allows when the org holds the deliverable_engine capability', () => {
    expect(canUseProtocolIntelligence(true)).toEqual({ allowed: true });
  });

  it('denies when the org lacks the capability, with a reason and no addon path', () => {
    const d = canUseProtocolIntelligence(false);
    expect(d.allowed).toBe(false);
    if (!d.allowed) {
      expect(d.reason).toMatch(/isn’t enabled/);
      expect(d.addonProductKind).toBeNull();
    }
  });

  it('does not mention the dead enterprise tier in its denial', () => {
    const d = canUseProtocolIntelligence(false);
    if (!d.allowed) expect(d.reason).not.toMatch(/enterprise/i);
  });

  it('names Protocol Intelligence in the denial reason', () => {
    const d = canUseProtocolIntelligence(false);
    if (!d.allowed) expect(d.reason).toMatch(/Protocol Intelligence/);
  });
});
