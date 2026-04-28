import { createContext, useContext, useEffect, useState } from 'react';
import type {
  AuditStage,
  AuditStatus,
  AuditType,
  ClinicalTrialPhase,
} from '../types/audit';

// =============================================================================
// AuditContext — active audit selection for Audit Mode
//
// Phase A uses mock data. Phase B replaces MOCK_AUDITS with a Supabase query
// (`SELECT a.*, v.name AS vendor_name, p.title AS protocol_title, ...`) and
// keeps the same shape. UI components import `useAudit` and don't need to
// change when the data source flips.
//
// activeAudit is nullable: null means no audit is selected → workspace shows
// the audit-required gate / worklist instead of stage content.
// =============================================================================

// Shape returned by the picker / context. Combines the core Audit row with
// joined vendor + protocol fields needed for display.
export interface AuditWithContext {
  id: string;
  audit_name: string;
  audit_type: AuditType;
  status: AuditStatus;
  current_stage: AuditStage;
  scheduled_date: string | null;
  vendor_name: string;
  protocol_code: string;       // study number / short label
  protocol_title: string;
  clinical_trial_phase: ClinicalTrialPhase;
}

interface AuditContextValue {
  audits: AuditWithContext[];
  activeAudit: AuditWithContext | null;
  setActiveAudit: (audit: AuditWithContext | null) => void;
  // Mutates the active audit's current_stage in the in-session store. Phase B
  // mock pattern; replace with a Supabase RPC call when wired.
  advanceStage: (toStage: AuditStage) => void;
}

const AUDIT_STORAGE_KEY = 'piq-audit-v1';

// Mock audits — illustrative data covering the spread of stages + statuses
// the UI needs to render. Swap for a Supabase query in Phase B.
const MOCK_AUDITS: AuditWithContext[] = [
  {
    id: 'audit-001',
    audit_name: 'CRO QC oversight — BRIGHTEN-2',
    audit_type: 'REMOTE',
    status: 'IN_PROGRESS',
    current_stage: 'QUESTIONNAIRE_REVIEW',
    scheduled_date: '2026-05-15',
    vendor_name: 'Aurora Clinical Services',
    protocol_code: 'BRIGHTEN-2',
    protocol_title: 'BRIGHTEN-2: Phase 3 Oncology Study',
    clinical_trial_phase: 'PHASE_3',
  },
  {
    id: 'audit-002',
    audit_name: 'Central lab data integrity — CARDIAC-7',
    audit_type: 'ONSITE',
    status: 'DRAFT',
    current_stage: 'INTAKE',
    scheduled_date: '2026-06-08',
    vendor_name: 'Helix Diagnostics',
    protocol_code: 'CARDIAC-7',
    protocol_title: 'CARDIAC-7: Heart Failure Intervention',
    clinical_trial_phase: 'PHASE_2_3',
  },
  {
    id: 'audit-003',
    audit_name: 'ePRO platform GxP audit — IMMUNE-14',
    audit_type: 'HYBRID',
    status: 'IN_PROGRESS',
    current_stage: 'PRE_AUDIT_DRAFTING',
    scheduled_date: '2026-05-22',
    vendor_name: 'PatientPulse Technologies',
    protocol_code: 'IMMUNE-14',
    protocol_title: 'IMMUNE-14: Autoimmune Biologic Trial',
    clinical_trial_phase: 'PHASE_2',
  },
];

const AuditContext = createContext<AuditContextValue>({
  audits: MOCK_AUDITS,
  activeAudit: null,
  setActiveAudit: () => {},
  advanceStage: () => {},
});

export function AuditProvider({ children }: { children: React.ReactNode }) {
  // In-session mutable copy of the audit list. Phase B mock pattern allows
  // stage transitions to update Audit.current_stage; resets on page reload.
  const [audits, setAudits] = useState<AuditWithContext[]>(MOCK_AUDITS);

  const [activeId, setActiveId] = useState<string | null>(() => {
    try {
      const stored = localStorage.getItem(AUDIT_STORAGE_KEY);
      if (stored && MOCK_AUDITS.some((a) => a.id === stored)) return stored;
    } catch {
      /* ignore */
    }
    return null;
  });

  useEffect(() => {
    try {
      if (activeId) localStorage.setItem(AUDIT_STORAGE_KEY, activeId);
      else localStorage.removeItem(AUDIT_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, [activeId]);

  const activeAudit = activeId
    ? audits.find((a) => a.id === activeId) ?? null
    : null;

  const setActiveAudit = (audit: AuditWithContext | null) => {
    setActiveId(audit ? audit.id : null);
  };

  const advanceStage = (toStage: AuditStage) => {
    if (!activeId) return;
    setAudits((prev) =>
      prev.map((a) => (a.id === activeId ? { ...a, current_stage: toStage } : a)),
    );
  };

  return (
    <AuditContext.Provider
      value={{
        audits,
        activeAudit,
        setActiveAudit,
        advanceStage,
      }}
    >
      {children}
    </AuditContext.Provider>
  );
}

export function useAudit() {
  return useContext(AuditContext);
}
