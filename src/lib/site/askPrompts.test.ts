import { describe, it, expect } from 'vitest';
import { deriveAskPrompts } from './askPrompts';
import type { Protocol } from '../../context/ProtocolContext';
import type { SiteTeamMember } from './types';

function makeProtocol(overrides: Partial<Protocol> = {}): Protocol {
  return {
    id: 'p1',
    code: 'TEST-1',
    name: 'Test protocol',
    sponsor: 'Acme Pharma',
    phase: 'Phase 1',
    demoAnchorDate: null,
    ...overrides,
  };
}

function makeMember(overrides: Partial<SiteTeamMember> = {}): SiteTeamMember {
  return {
    id: 'm1',
    protocol_id: 'p1',
    name: 'Test Member',
    role: 'COORDINATOR',
    email: null,
    delegated_tasks: [],
    certified_through: '2030-01-01',
    status: 'ACTIVE',
    notes: null,
    ...overrides,
  };
}

describe('deriveAskPrompts', () => {
  it('always returns exactly 4 prompts', () => {
    const out = deriveAskPrompts({
      protocol: makeProtocol(),
      team: [],
      hasVisitTemplates: false,
    });
    expect(out).toHaveLength(4);
  });

  it('uses the "Has the schedule been finalised" variant when templates are absent', () => {
    const out = deriveAskPrompts({
      protocol: makeProtocol(),
      team: [],
      hasVisitTemplates: false,
    });
    expect(out[0].text).toMatch(/Has the schedule of assessments/);
  });

  it('uses the "What is the schedule" variant when templates are present', () => {
    const out = deriveAskPrompts({
      protocol: makeProtocol(),
      team: [],
      hasVisitTemplates: true,
    });
    expect(out[0].text).toMatch(/What is the schedule of assessments/);
  });

  it('Phase 1 yields dose escalation + safety stopping prompts', () => {
    const out = deriveAskPrompts({
      protocol: makeProtocol({ phase: 'Phase 1' }),
      team: [],
      hasVisitTemplates: true,
    });
    const phasePrompts = out.slice(2).map((p) => p.text);
    expect(phasePrompts.some((t) => /dose escalation|DLT/.test(t))).toBe(true);
    expect(phasePrompts.some((t) => /safety stopping/.test(t))).toBe(true);
  });

  it('Phase 3 yields endpoint adjudication + SAE reporting prompts', () => {
    const out = deriveAskPrompts({
      protocol: makeProtocol({ phase: 'Phase 3' }),
      team: [],
      hasVisitTemplates: true,
    });
    const phasePrompts = out.slice(2).map((p) => p.text);
    expect(phasePrompts.some((t) => /adjudicated/.test(t))).toBe(true);
    expect(phasePrompts.some((t) => /SAE reporting/.test(t))).toBe(true);
  });

  it('a pharmacist on team swaps in a drug accountability prompt', () => {
    const out = deriveAskPrompts({
      protocol: makeProtocol(),
      team: [makeMember({ role: 'PHARMACIST' })],
      hasVisitTemplates: true,
    });
    expect(out.some((p) => /drug accountability/.test(p.text))).toBe(true);
  });

  it('a monitor on team swaps in a monitor-prep prompt', () => {
    const out = deriveAskPrompts({
      protocol: makeProtocol(),
      team: [makeMember({ role: 'MONITOR' })],
      hasVisitTemplates: true,
    });
    expect(out.some((p) => /monitor expect/.test(p.text))).toBe(true);
  });

  it('inactive team members are ignored', () => {
    const out = deriveAskPrompts({
      protocol: makeProtocol(),
      team: [makeMember({ role: 'PHARMACIST', status: 'INACTIVE' })],
      hasVisitTemplates: true,
    });
    expect(out.some((p) => /drug accountability/.test(p.text))).toBe(false);
  });
});
