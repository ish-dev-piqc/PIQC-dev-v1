import { describe, it, expect } from 'vitest';
import {
  adaptChatDecisionAck,
  adaptChatDecisionAcks,
  type ChatDecisionAckRow,
} from '../chatDecisionAcksAdapter';

const pendingRow: ChatDecisionAckRow = {
  id: 'ack-1',
  decision_id: 'd-1',
  required_user_id: 'user-1',
  acknowledged_at: null,
  acknowledged_note: null,
  created_at: '2026-06-04T12:00:00Z',
};

describe('chatDecisionAcksAdapter', () => {
  it('maps all fields straight through for a pending ack', () => {
    expect(adaptChatDecisionAck(pendingRow)).toEqual(pendingRow);
  });

  it('maps an acknowledged row with a note', () => {
    const row: ChatDecisionAckRow = {
      ...pendingRow,
      id: 'ack-2',
      acknowledged_at: '2026-06-04T12:05:00Z',
      acknowledged_note: 'Read and agree.',
    };
    expect(adaptChatDecisionAck(row).acknowledged_at).toBe('2026-06-04T12:05:00Z');
    expect(adaptChatDecisionAck(row).acknowledged_note).toBe('Read and agree.');
  });

  it('handles empty array', () => {
    expect(adaptChatDecisionAcks([])).toEqual([]);
  });

  it('maps multiple rows preserving order', () => {
    const rows: ChatDecisionAckRow[] = [
      pendingRow,
      {
        ...pendingRow,
        id: 'ack-2',
        required_user_id: 'user-2',
        acknowledged_at: '2026-06-04T12:05:00Z',
      },
    ];
    const result = adaptChatDecisionAcks(rows);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('ack-1');
    expect(result[1].id).toBe('ack-2');
  });
});
