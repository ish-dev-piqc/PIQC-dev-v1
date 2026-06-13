import { describe, expect, it } from 'vitest';
import {
  adaptSponsorPortfolio,
  adaptSponsorPortfolioRow,
  adaptSponsorProtocolDetail,
  type SponsorPortfolioRow,
} from '../sponsorAdapter';

describe('sponsorAdapter', () => {
  const baseRow: SponsorPortfolioRow = {
    protocol_id: 'p-1',
    protocol_code: 'NCT99999',
    protocol_title: 'Phase II Onco Study',
    site_org_id: 'so-1',
    site_org_name: 'Acme CRO',
    participant_count: 12,
    last_visit_at: '2026-06-10',
  };

  describe('adaptSponsorPortfolioRow', () => {
    it('camelCases the row shape', () => {
      const out = adaptSponsorPortfolioRow(baseRow);
      expect(out).toEqual({
        protocolId: 'p-1',
        protocolCode: 'NCT99999',
        protocolTitle: 'Phase II Onco Study',
        siteOrgId: 'so-1',
        siteOrgName: 'Acme CRO',
        participantCount: 12,
        lastVisitAt: '2026-06-10',
      });
    });

    it('coerces null participant_count to 0', () => {
      const out = adaptSponsorPortfolioRow({ ...baseRow, participant_count: null });
      expect(out.participantCount).toBe(0);
    });

    it('preserves null protocol_code (study_number is nullable)', () => {
      const out = adaptSponsorPortfolioRow({ ...baseRow, protocol_code: null });
      expect(out.protocolCode).toBeNull();
    });

    it('preserves null last_visit_at (no visits yet)', () => {
      const out = adaptSponsorPortfolioRow({ ...baseRow, last_visit_at: null });
      expect(out.lastVisitAt).toBeNull();
    });
  });

  describe('adaptSponsorPortfolio', () => {
    it('maps an empty list to an empty list', () => {
      expect(adaptSponsorPortfolio([])).toEqual([]);
    });

    it('maps multiple rows preserving order', () => {
      const rows: SponsorPortfolioRow[] = [
        baseRow,
        { ...baseRow, protocol_id: 'p-2', protocol_title: 'Phase III Cardio' },
      ];
      const out = adaptSponsorPortfolio(rows);
      expect(out.map((r) => r.protocolId)).toEqual(['p-1', 'p-2']);
    });
  });

  describe('adaptSponsorProtocolDetail', () => {
    it('coerces null payload to zeroed buckets', () => {
      const out = adaptSponsorProtocolDetail(null);
      expect(out.visitCounts.scheduled).toBe(0);
      expect(out.enrollment.active).toBe(0);
      expect(out.recentDeviations).toEqual([]);
    });

    it('preserves all five visit-count statuses', () => {
      const out = adaptSponsorProtocolDetail({
        visit_counts: { scheduled: 3, completed: 7, missed: 1, deviation: 2, overdue: 0 },
      });
      expect(out.visitCounts).toEqual({
        scheduled: 3,
        completed: 7,
        missed: 1,
        deviation: 2,
        overdue: 0,
      });
    });

    it('camelCases enrollment screen_failure → screenFailure', () => {
      const out = adaptSponsorProtocolDetail({
        enrollment: { screening: 1, screen_failure: 4, active: 12, completed: 2, withdrawn: 1 },
      });
      expect(out.enrollment.screenFailure).toBe(4);
      expect(out.enrollment.active).toBe(12);
    });

    it('shapes recent_deviations into camelCase rows', () => {
      const out = adaptSponsorProtocolDetail({
        recent_deviations: [
          {
            visit_id: 'v-1',
            date: '2026-06-10',
            participant_code: 'P-0042',
            visit_name: 'Day 14',
            deviation_reason: 'missed window',
          },
        ],
      });
      expect(out.recentDeviations).toHaveLength(1);
      expect(out.recentDeviations[0]).toEqual({
        visitId: 'v-1',
        date: '2026-06-10',
        participantCode: 'P-0042',
        visitName: 'Day 14',
        deviationReason: 'missed window',
      });
    });
  });
});
