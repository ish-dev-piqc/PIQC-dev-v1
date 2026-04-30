import { createContext, useContext, useEffect, useState } from 'react';
import { MOCK_PROTOCOL_RISKS, type TaggedSection } from '../lib/audit/mockProtocolRisks';
import { fetchProtocolRisksForAudit } from '../lib/audit/intakeApi';
import {
  MOCK_VENDOR_SERVICES,
  MOCK_SERVICE_MAPPINGS,
  MOCK_TRUST_ASSESSMENTS,
  type MockVendorService,
  type MockServiceMapping,
  type MockTrustAssessment,
} from '../lib/audit/mockVendorEnrichment';
import {
  MOCK_RISK_SUMMARIES,
  type MockRiskSummary,
} from '../lib/audit/mockRiskSummary';
import {
  MOCK_QUESTIONNAIRES,
  type MockQuestionnaireBundle,
} from '../lib/audit/mockQuestionnaire';
import {
  MOCK_PRE_AUDIT,
  type MockPreAuditBundle,
} from '../lib/audit/mockPreAudit';
import {
  MOCK_WORKSPACE_ENTRIES,
  type MockWorkspaceEntry,
} from '../lib/audit/mockWorkspaceEntries';
import { MOCK_REPORTS, type MockReportDraft } from '../lib/audit/mockReport';

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
  const [protocolRisks, setProtocolRisks] = useState<Record<string, TaggedSection[]>>(
    () => ({ ...MOCK_PROTOCOL_RISKS }),
  );
  const [loadedRisksAuditIds, setLoadedRisksAuditIds] = useState<Set<string>>(new Set());
  const [vendorServices, setVendorServices] = useState<
    Record<string, MockVendorService | null>
  >(() => ({ ...MOCK_VENDOR_SERVICES }));
  const [serviceMappings, setServiceMappings] = useState<
    Record<string, MockServiceMapping[]>
  >(() => ({ ...MOCK_SERVICE_MAPPINGS }));
  const [trustAssessments, setTrustAssessments] = useState<
    Record<string, MockTrustAssessment | null>
  >(() => ({ ...MOCK_TRUST_ASSESSMENTS }));
  const [riskSummaries, setRiskSummaries] = useState<
    Record<string, MockRiskSummary | null>
  >(() => ({ ...MOCK_RISK_SUMMARIES }));
  const [questionnaires, setQuestionnaires] = useState<
    Record<string, MockQuestionnaireBundle | null>
  >(() => ({ ...MOCK_QUESTIONNAIRES }));
  const [preAuditBundles, setPreAuditBundles] = useState<
    Record<string, MockPreAuditBundle>
  >(() => ({ ...MOCK_PRE_AUDIT }));
  const [workspaceEntries, setWorkspaceEntries] = useState<
    Record<string, MockWorkspaceEntry[]>
  >(() => ({ ...MOCK_WORKSPACE_ENTRIES }));
  const [reports, setReports] = useState<Record<string, MockReportDraft | null>>(
    () => ({ ...MOCK_REPORTS }),
  );

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
