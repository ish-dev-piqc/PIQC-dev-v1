import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { demoSiteRepo } from '../demoSiteRepo';
import { getDemoStore } from '../../../demo';
import { DEMO_PARTICIPANT_UUIDS, DEMO_PROTOCOL_IDS } from '../../../demo';

// =============================================================================
// Behaviour tests for demoSiteRepo — verify CRUD operations against the
// in-memory demo store. Each test starts from a clean fixture state via
// store.reset() to keep them order-independent.
// =============================================================================

const BRIGHTEN = DEMO_PROTOCOL_IDS['BRIGHTEN-2'];

describe('demoSiteRepo — participants CRUD', () => {
  beforeEach(() => {
    sessionStorage.clear();
    getDemoStore().reset();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it('fetchParticipants returns rows scoped to the given protocol', async () => {
    const result = await demoSiteRepo.fetchParticipants(BRIGHTEN);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.data.every((p) => p.protocol_id === BRIGHTEN)).toBe(true);
  });

  it('fetchParticipants returns participants sorted by code', async () => {
    const result = await demoSiteRepo.fetchParticipants(BRIGHTEN);
    if (!result.ok) throw new Error(result.error);
    const codes = result.data.map((p) => p.id);
    const sorted = [...codes].sort();
    expect(codes).toEqual(sorted);
  });

  it('createParticipant inserts a new row visible on next fetch', async () => {
    const before = await demoSiteRepo.fetchParticipants(BRIGHTEN);
    if (!before.ok) throw new Error(before.error);
    const beforeCount = before.data.length;

    const created = await demoSiteRepo.createParticipant({
      participant_code: 'P-9999',
      protocol_id: BRIGHTEN,
      status: 'SCREENING',
    });

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.data.id).toBe('P-9999');
    expect(created.data.uuid).toBeTruthy();

    const after = await demoSiteRepo.fetchParticipants(BRIGHTEN);
    if (!after.ok) throw new Error(after.error);
    expect(after.data.length).toBe(beforeCount + 1);
    expect(after.data.some((p) => p.id === 'P-9999')).toBe(true);
  });

  it('createParticipant rejects duplicate participant_code on same protocol', async () => {
    const dup = await demoSiteRepo.createParticipant({
      participant_code: 'P-0019', // already in BRIGHTEN-2 fixtures
      protocol_id: BRIGHTEN,
      status: 'ACTIVE',
    });
    expect(dup.ok).toBe(false);
    if (dup.ok) return;
    expect(dup.error).toMatch(/already exists/i);
  });

  it('updateParticipant patches the named fields and leaves others alone', async () => {
    const uuid = DEMO_PARTICIPANT_UUIDS['P-0023'];
    const patched = await demoSiteRepo.updateParticipant(uuid, {
      notes: 'Updated during test',
      open_deviations: 5,
    });
    expect(patched.ok).toBe(true);
    if (!patched.ok) return;
    expect(patched.data.notes).toBe('Updated during test');
    expect(patched.data.open_deviations).toBe(5);
    expect(patched.data.id).toBe('P-0023'); // unchanged
  });

  it('updateParticipant returns an error for unknown uuid', async () => {
    const result = await demoSiteRepo.updateParticipant('00000000-0000-0000-0000-000000000000', {
      notes: 'x',
    });
    expect(result.ok).toBe(false);
  });

  it('deleteParticipant removes the row and cascades to that participant\'s visits', async () => {
    const before = await demoSiteRepo.fetchParticipants(BRIGHTEN);
    if (!before.ok) throw new Error(before.error);
    const target = before.data.find((p) => p.id === 'P-0019');
    expect(target).toBeTruthy();
    if (!target) return;

    const beforeVisits = await demoSiteRepo.fetchVisitsForProtocol(BRIGHTEN);
    if (!beforeVisits.ok) throw new Error(beforeVisits.error);
    const beforeVisitsForP0019 = beforeVisits.data.filter((v) => v.participantId === 'P-0019').length;
    expect(beforeVisitsForP0019).toBeGreaterThan(0);

    const del = await demoSiteRepo.deleteParticipant(target.uuid);
    expect(del.ok).toBe(true);

    const after = await demoSiteRepo.fetchParticipants(BRIGHTEN);
    const afterVisits = await demoSiteRepo.fetchVisitsForProtocol(BRIGHTEN);
    if (!after.ok || !afterVisits.ok) throw new Error('refetch failed');
    expect(after.data.some((p) => p.id === 'P-0019')).toBe(false);
    expect(afterVisits.data.some((v) => v.participantId === 'P-0019')).toBe(false);
  });
});

describe('demoSiteRepo — visits + protocols', () => {
  beforeEach(() => {
    sessionStorage.clear();
    getDemoStore().reset();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it('fetchProtocols returns all three demo protocols', async () => {
    const result = await demoSiteRepo.fetchProtocols();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const codes = result.data.map((p) => p.code).sort();
    expect(codes).toEqual(['CLR_18_06', 'ND-L02-s0201-005', 'PP06489']);
  });

  it('updateVisit flips status and persists', async () => {
    const visits = await demoSiteRepo.fetchVisitsForProtocol(BRIGHTEN);
    if (!visits.ok) throw new Error(visits.error);
    const scheduled = visits.data.find((v) => v.status === 'scheduled');
    expect(scheduled).toBeTruthy();
    if (!scheduled) return;

    const patched = await demoSiteRepo.updateVisit(scheduled.id, { status: 'completed' });
    expect(patched.ok).toBe(true);
    if (!patched.ok) return;
    expect(patched.data.status).toBe('completed');

    // Refetch confirms persistence in store.
    const refetch = await demoSiteRepo.fetchVisitsForProtocol(BRIGHTEN);
    if (!refetch.ok) throw new Error(refetch.error);
    const same = refetch.data.find((v) => v.id === scheduled.id);
    expect(same?.status).toBe('completed');
  });

  it('cancelVisit flips status to cancelled and persists', async () => {
    const visits = await demoSiteRepo.fetchVisitsForProtocol(BRIGHTEN);
    if (!visits.ok) throw new Error(visits.error);
    const scheduled = visits.data.find((v) => v.status === 'scheduled');
    expect(scheduled).toBeTruthy();
    if (!scheduled) return;

    const cancelled = await demoSiteRepo.cancelVisit(scheduled.id);
    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) return;
    expect(cancelled.data.status).toBe('cancelled');

    // Refetch confirms persistence in store.
    const refetch = await demoSiteRepo.fetchVisitsForProtocol(BRIGHTEN);
    if (!refetch.ok) throw new Error(refetch.error);
    const same = refetch.data.find((v) => v.id === scheduled.id);
    expect(same?.status).toBe('cancelled');
  });

  it('cancelVisit returns an error for unknown visit id', async () => {
    const result = await demoSiteRepo.cancelVisit('00000000-0000-0000-0000-000000000000');
    expect(result.ok).toBe(false);
  });

  it('setAnchorDate updates the protocol row', async () => {
    const result = await demoSiteRepo.setAnchorDate(BRIGHTEN, '2026-01-01');
    expect(result.ok).toBe(true);

    const protocols = await demoSiteRepo.fetchProtocols();
    if (!protocols.ok) throw new Error(protocols.error);
    const brighten = protocols.data.find((p) => p.id === BRIGHTEN);
    expect(brighten?.demoAnchorDate).toBe('2026-01-01');
  });

  it('materializeVisits reports a realistic created count without mutating', async () => {
    const before = await demoSiteRepo.fetchVisitsForProtocol(BRIGHTEN);
    if (!before.ok) throw new Error(before.error);
    const beforeCount = before.data.length;

    const result = await demoSiteRepo.materializeVisits(BRIGHTEN);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.created).toBe(beforeCount);
    expect(result.data.skipped_no_anchor).toBe(0);

    const after = await demoSiteRepo.fetchVisitsForProtocol(BRIGHTEN);
    if (!after.ok) throw new Error(after.error);
    expect(after.data.length).toBe(beforeCount);
  });
});

describe('demoSiteRepo — team + documents + templates', () => {
  beforeEach(() => {
    sessionStorage.clear();
    getDemoStore().reset();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it('fetchTeamMembers scopes to protocol and sorts by added_at', async () => {
    const result = await demoSiteRepo.fetchTeamMembers(BRIGHTEN);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.data.every((t) => t.protocol_id === BRIGHTEN)).toBe(true);
    const dates = result.data.map((t) => t.added_at);
    const sorted = [...dates].sort();
    expect(dates).toEqual(sorted);
  });

  it('fetchProtocolDocuments returns the demo PDFs for that protocol only', async () => {
    // PP06489's fixture set: 1 protocol PDF + 2 supplemental docs (Lab,
    // Pharmacy manuals) so cross-document references in the visit drawer
    // have real sibling docs to resolve.
    const result = await demoSiteRepo.fetchProtocolDocuments(BRIGHTEN);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.length).toBeGreaterThanOrEqual(1);
    expect(result.data.every((d) => /PP06489/i.test(d.title))).toBe(true);
  });

  it('fetchVisitTemplates scopes to protocol and sorts by study_day', async () => {
    const result = await demoSiteRepo.fetchVisitTemplates(BRIGHTEN);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.length).toBeGreaterThan(0);
    const days = result.data.map((t) => t.study_day);
    const sorted = [...days].sort((a, b) => a - b);
    expect(days).toEqual(sorted);
  });
});
