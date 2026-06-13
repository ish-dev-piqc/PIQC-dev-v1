import { describe, expect, it } from 'vitest';
import {
  adaptSponsorPortfolio,
  adaptSponsorPortfolioRow,
  type SponsorPortfolioRow,
} from './sponsorAdapter';

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
});
