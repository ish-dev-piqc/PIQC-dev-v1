import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { advanceAuditStage } from '../lib/audit/auditApi';
import type {
  AuditStage,
  AuditStatus,
  AuditType,
  ClinicalTrialPhase,
} from '../types/audit';

// =============================================================================
// AuditContext — active audit selection for Audit Mode
//
// Reads from Supabase: joins audits + vendors + protocols + protocol_versions.
// RLS scopes results to the signed-in lead auditor. Re-fetches on auth changes.
//
// activeAudit is nullable: null means no audit is selected → workspace shows
// the audit-required gate / worklist instead of stage content.
// =============================================================================

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
  protocol_version_id: string; // needed by Stage 1 (Intake) to scope risk-tag mutations
}

interface AuditContextValue {
  audits: AuditWithContext[];
  loading: boolean;
  error: string | null;
  activeAudit: AuditWithContext | null;
  setActiveAudit: (audit: AuditWithContext | null) => void;
  // Currently in-session only. Phase 4 replaces with a Supabase RPC that
  // updates audits.current_stage with server-side gating.
  advanceStage: (toStage: AuditStage) => void;
  refresh: () => Promise<void>;
}

const AUDIT_STORAGE_KEY = 'piq-audit-v1';

const AuditContext = createContext<AuditContextValue>({
  audits: [],
  loading: false,
  error: null,
  activeAudit: null,
  setActiveAudit: () => {},
  advanceStage: () => {},
  refresh: async () => {},
});

// Shape returned by the joined Supabase select. The nested `vendors`,
// `protocols`, `protocol_versions` come back as objects when using foreign-key
// joins via `!inner`.
interface AuditRow {
  id: string;
  audit_name: string;
  audit_type: AuditType;
  status: AuditStatus;
  current_stage: AuditStage;
  scheduled_date: string | null;
  protocol_version_id: string;
  vendors: { name: string } | null;
  protocols: { study_number: string | null; title: string } | null;
  protocol_versions: { clinical_trial_phase: ClinicalTrialPhase } | null;
}

function flatten(row: AuditRow): AuditWithContext {
  return {
    id: row.id,
    audit_name: row.audit_name,
    audit_type: row.audit_type,
    status: row.status,
    current_stage: row.current_stage,
    scheduled_date: row.scheduled_date,
    vendor_name: row.vendors?.name ?? '',
    protocol_code: row.protocols?.study_number ?? '',
    protocol_title: row.protocols?.title ?? '',
    clinical_trial_phase: row.protocol_versions?.clinical_trial_phase ?? 'NOT_APPLICABLE',
    protocol_version_id: row.protocol_version_id,
  };
}

export function AuditProvider({ children }: { children: React.ReactNode }) {
  const [audits, setAudits] = useState<AuditWithContext[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [activeId, setActiveId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(AUDIT_STORAGE_KEY);
    } catch {
      return null;
    }
  });

  const fetchAudits = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: queryError } = await supabase
      .from('audits')
      .select(`
        id, audit_name, audit_type, status, current_stage, scheduled_date,
        protocol_version_id,
        vendors!inner ( name ),
        protocols!inner ( study_number, title ),
        protocol_versions!inner ( clinical_trial_phase )
      `)
      .order('updated_at', { ascending: false });

    if (queryError) {
      setError(queryError.message);
      setAudits([]);
    } else {
      setAudits(((data ?? []) as unknown as AuditRow[]).map(flatten));
    }
    setLoading(false);
  }, []);

  // Initial load + react to auth state changes (sign-in/out re-fetches via RLS)
  useEffect(() => {
    fetchAudits();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED') {
        fetchAudits();
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [fetchAudits]);

  // Persist active selection across reloads. Clear when the active audit is no
  // longer in the visible list (e.g. after sign-out).
  useEffect(() => {
    try {
      if (activeId) localStorage.setItem(AUDIT_STORAGE_KEY, activeId);
      else localStorage.removeItem(AUDIT_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, [activeId]);

  useEffect(() => {
    if (activeId && !loading && !audits.some((a) => a.id === activeId)) {
      setActiveId(null);
    }
  }, [activeId, audits, loading]);

  const activeAudit = activeId
    ? audits.find((a) => a.id === activeId) ?? null
    : null;

  const setActiveAudit = (audit: AuditWithContext | null) => {
    setActiveId(audit ? audit.id : null);
  };

  const advanceStage = async (toStage: AuditStage) => {
    if (!activeId) return;
    const result = await advanceAuditStage(activeId, toStage);
    if (result.ok && result.currentStage) {
      setAudits((prev) =>
        prev.map((a) =>
          a.id === activeId ? { ...a, current_stage: result.currentStage as AuditStage } : a,
        ),
      );
    } else {
      // Server-side gate / validation message bubbled up. Stage stays as-is.
      console.error(
        '[AuditContext] Stage advancement failed:',
        result.errorHint ?? '',
        result.errorMessage,
      );
    }
  };

  return (
    <AuditContext.Provider
      value={{
        audits,
        loading,
        error,
        activeAudit,
        setActiveAudit,
        advanceStage,
        refresh: fetchAudits,
      }}
    >
      {children}
    </AuditContext.Provider>
  );
}

export function useAudit() {
  return useContext(AuditContext);
}
