import { describe, it, expect } from 'vitest';
import {
  adaptChatDecision,
  adaptChatDecisions,
  type ChatDecisionRow,
} from '../chatDecisionsAdapter';

const baseOrgRow: ChatDecisionRow = {
  id: 'd-1',
  title: 'Skip Visit 5 for P-0023',
  rationale: 'Patient out of country during the window.',
  org_id: 'org-1',
  protocol_id: null,
  source_org_message_id: 'msg-1',
  source_protocol_message_id: null,
  decided_by_user_id: 'user-1',
  decided_at: '2026-06-04T12:00:00Z',
  created_by_user_id: 'user-2',
  created_at: '2026-06-04T12:05:00Z',
};

describe('chatDecisionsAdapter', () => {
  it('maps all fields straight through for an org-channel decision', () => {
    expect(adaptChatDecision(baseOrgRow)).toEqual(baseOrgRow);
  });

  it('maps a protocol-channel decision with source message', () => {
    const row: ChatDecisionRow = {
      ...baseOrgRow,
      id: 'd-2',
      org_id: null,
      protocol_id: 'proto-1',
      source_org_message_id: null,
      source_protocol_message_id: 'pmsg-1',
    };
    expect(adaptChatDecision(row).protocol_id).toBe('proto-1');
    expect(adaptChatDecision(row).source_protocol_message_id).toBe('pmsg-1');
  });

  it('preserves null rationale', () => {
    const row = { ...baseOrgRow, rationale: null };
    expect(adaptChatDecision(row).rationale).toBeNull();
  });

  it('handles a decision whose source message was deleted', () => {
    const row = {
      ...baseOrgRow,
      source_org_message_id: null,
      source_protocol_message_id: null,
    };
    const r = adaptChatDecision(row);
    expect(r.source_org_message_id).toBeNull();
    expect(r.source_protocol_message_id).toBeNull();
  });

  it('maps an empty array', () => {
    expect(adaptChatDecisions([])).toEqual([]);
  });

  it('maps multiple rows preserving order', () => {
    const rows: ChatDecisionRow[] = [
      baseOrgRow,
      { ...baseOrgRow, id: 'd-2', title: 'Second decision' },
    ];
    const result = adaptChatDecisions(rows);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('d-1');
    expect(result[1].id).toBe('d-2');
  });
});
