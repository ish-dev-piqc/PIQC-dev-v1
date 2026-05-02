import { createContext, useContext, useState } from 'react';
import type { TaggedSection } from '../lib/audit/mockProtocolRisks';
import type {
  MockVendorService,
  MockServiceMapping,
  MockTrustAssessment,
} from '../lib/audit/mockVendorEnrichment';
import type { MockRiskSummary } from '../lib/audit/mockRiskSummary';
import type { MockQuestionnaireBundle } from '../lib/audit/mockQuestionnaire';
import type { MockPreAuditBundle } from '../lib/audit/mockPreAudit';
import type { MockWorkspaceEntry } from '../lib/audit/mockWorkspaceEntries';
import type { MockReportDraft } from '../lib/audit/mockReport';

// =============================================================================
// AuditDataContext — the shared in-session store for Audit Mode mock data.
//
// Phase B replaces seven component-local useState stores with one shared
// state tree, so cross-stage edits propagate. For example, approving the
// risk summary in the right rail (Stage * any) immediately clears the
// approval gate in Scope Review (Stage 4); approving the questionnaire in
// Stage 3 does the same.
//
// Each store is keyed by audit_id (matches schema scoping). Setters use the
// React.Dispatch shape so component code can keep calling
// `setX(prev => ({ ...prev, [auditId]: next }))` exactly as before.
//
// When real Supabase wires up, this module is the single replacement target:
//   - Initial state comes from supabase.from(...).select() instead of MOCK_*
//   - Setters become per-mutation supabase.rpc(...) calls
//   - Component code doesn't change.
// =============================================================================

interface AuditDataContextValue {
  protocolRisks: Record<string, TaggedSection[]>;
  setProtocolRisks: React.Dispatch<React.SetStateAction<Record<string, TaggedSection[]>>>;

  vendorServices: Record<string, MockVendorService | null>;
  setVendorServices: React.Dispatch<
    React.SetStateAction<Record<string, MockVendorService | null>>
  >;

  serviceMappings: Record<string, MockServiceMapping[]>;
  setServiceMappings: React.Dispatch<
    React.SetStateAction<Record<string, MockServiceMapping[]>>
  >;

  trustAssessments: Record<string, MockTrustAssessment | null>;
  setTrustAssessments: React.Dispatch<
    React.SetStateAction<Record<string, MockTrustAssessment | null>>
  >;

  riskSummaries: Record<string, MockRiskSummary | null>;
  setRiskSummaries: React.Dispatch<
    React.SetStateAction<Record<string, MockRiskSummary | null>>
  >;

  questionnaires: Record<string, MockQuestionnaireBundle | null>;
  setQuestionnaires: React.Dispatch<
    React.SetStateAction<Record<string, MockQuestionnaireBundle | null>>
  >;

  preAuditBundles: Record<string, MockPreAuditBundle>;
  setPreAuditBundles: React.Dispatch<
    React.SetStateAction<Record<string, MockPreAuditBundle>>
  >;

  workspaceEntries: Record<string, MockWorkspaceEntry[]>;
  setWorkspaceEntries: React.Dispatch<
    React.SetStateAction<Record<string, MockWorkspaceEntry[]>>
  >;

  reports: Record<string, MockReportDraft | null>;
  setReports: React.Dispatch<
    React.SetStateAction<Record<string, MockReportDraft | null>>
  >;
}

const noop = () => {};

const AuditDataContext = createContext<AuditDataContextValue>({
  protocolRisks: {},
  setProtocolRisks: noop,
  vendorServices: {},
  setVendorServices: noop,
  serviceMappings: {},
  setServiceMappings: noop,
  trustAssessments: {},
  setTrustAssessments: noop,
  riskSummaries: {},
  setRiskSummaries: noop,
  questionnaires: {},
  setQuestionnaires: noop,
  preAuditBundles: {},
  setPreAuditBundles: noop,
  workspaceEntries: {},
  setWorkspaceEntries: noop,
  reports: {},
  setReports: noop,
});

export function AuditDataProvider({ children }: { children: React.ReactNode }) {
  // All stores start empty. Each stage workspace's load `useEffect` populates
  // its slice via Supabase RPCs/SELECTs on mount. This means the UI shows
  // briefly empty (no flash-of-mock-data) and reflects only what the backend
  // actually returns under the current user's RLS scope.
  const [protocolRisks, setProtocolRisks] = useState<Record<string, TaggedSection[]>>({});
  const [vendorServices, setVendorServices] = useState<
    Record<string, MockVendorService | null>
  >({});
  const [serviceMappings, setServiceMappings] = useState<
    Record<string, MockServiceMapping[]>
  >({});
  const [trustAssessments, setTrustAssessments] = useState<
    Record<string, MockTrustAssessment | null>
  >({});
  const [riskSummaries, setRiskSummaries] = useState<
    Record<string, MockRiskSummary | null>
  >({});
  const [questionnaires, setQuestionnaires] = useState<
    Record<string, MockQuestionnaireBundle | null>
  >({});
  const [preAuditBundles, setPreAuditBundles] = useState<
    Record<string, MockPreAuditBundle>
  >({});
  const [workspaceEntries, setWorkspaceEntries] = useState<
    Record<string, MockWorkspaceEntry[]>
  >({});
  const [reports, setReports] = useState<Record<string, MockReportDraft | null>>({});

  return (
    <AuditDataContext.Provider
      value={{
        protocolRisks,
        setProtocolRisks,
        vendorServices,
        setVendorServices,
        serviceMappings,
        setServiceMappings,
        trustAssessments,
        setTrustAssessments,
        riskSummaries,
        setRiskSummaries,
        questionnaires,
        setQuestionnaires,
        preAuditBundles,
        setPreAuditBundles,
        workspaceEntries,
        setWorkspaceEntries,
        reports,
        setReports,
      }}
    >
      {children}
    </AuditDataContext.Provider>
  );
}

export function useAuditData() {
  return useContext(AuditDataContext);
}
