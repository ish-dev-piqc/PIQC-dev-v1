import { useState, useEffect } from 'react';
import { AlertTriangle, CheckCircle2, Lock, Pencil, History as HistoryIcon } from 'lucide-react';
import { useTheme } from '../../../../context/ThemeContext';
import { useAudit } from '../../../../context/AuditContext';
import { useAuditData } from '../../../../context/AuditDataContext';
import {
  SERVICE_TYPE_OPTIONS,
  COMPLIANCE_POSTURE_LABELS,
  MATURITY_POSTURE_LABELS,
  TRUST_POSTURE_LABELS,
} from '../../../../lib/audit/labels';
import {
  type MockVendorService,
  type MockServiceMapping,
  type MockTrustAssessment,
} from '../../../../lib/audit/mockVendorEnrichment';
import {
  fetchVendorService,
  createVendorService,
  updateVendorService,
  fetchServiceMappingsByAudit,
  createServiceMapping,
  updateServiceMapping,
  deleteServiceMapping,
  fetchTrustAssessment,
  upsertTrustAssessment,
} from '../../../../lib/audit/vendorEnrichmentApi';
import VendorServiceForm, { type VendorServiceFormValues } from './vendor-enrichment/VendorServiceForm';
import ServiceMappingTable from './vendor-enrichment/ServiceMappingTable';
import TrustAssessmentForm, { type TrustAssessmentFormValues } from './vendor-enrichment/TrustAssessmentForm';
import HistoryDrawer from '../HistoryDrawer';
import StagePreviewNotice from '../StagePreviewNotice';
import { fetchProtocolRisksForAudit } from '../../../../lib/audit/intakeApi';
import { hasReachedStage } from '../../../../lib/audit/workflowStages';
import type { TrackedObjectType } from '../../../../types/audit';

// =============================================================================
// VendorEnrichmentWorkspace — VENDOR_ENRICHMENT stage center pane.
//
// Three sequential cards:
//   1. Vendor service definition — locked once saved
//   2. Protocol section mapping — locked until vendor service exists
//   3. Trust intelligence — always available
//
// Wired to Supabase via vendorEnrichmentApi; optimistic updates pattern.
// =============================================================================

type SectionStatus = 'pending' | 'done' | 'locked';

export default function VendorEnrichmentWorkspace() {
  const { theme } = useTheme();
  const { activeAudit } = useAudit();
  const isLight = theme === 'light';

  // One-ahead preview guard (UX2): Stage 2 is viewable while the audit is
  // still at Intake. Without data the sections render live entry FORMS, so
  // the preview swaps them for placeholders; existing records show read-only.
  const hasReached =
    !!activeAudit &&
    hasReachedStage(activeAudit.workflow_type, activeAudit.current_stage, 'VENDOR_ENRICHMENT');

  // -----------------------------------------------------------------------
  // Shared state stores (Phase B — propagates across stages)
  // -----------------------------------------------------------------------
  const {
    vendorServices: services,
    setVendorServices: setServices,
    serviceMappings: mappings,
    setServiceMappings: setMappings,
    trustAssessments: assessments,
    setTrustAssessments: setAssessments,
    protocolRisks,
    setProtocolRisks,
  } = useAuditData();

  // Form modes
  const [serviceMode, setServiceMode] = useState<'view' | 'edit' | 'create'>('view');
  const [trustMode, setTrustMode] = useState<'view' | 'edit' | 'create'>('view');
  const [historyTarget, setHistoryTarget] = useState<{ objectType: TrackedObjectType; objectId: string } | null>(null);

  // Load-path honesty (hardening PR-2). Keyed by audit (a slow response must
  // never write another audit's state — PR-1's lesson) and re-earned per
  // mount. Failure is PER READ (PR-1's per-axis rule): a failed trust read
  // must not lock the auditor out of the two healthy sections — only a
  // section whose own state is unknown swaps its form for an error card.
  // Each flag carries the read's OWN error message (null = healthy):
  // Result<T> exists to surface the specific reason, and a permanent
  // "permission denied" must read differently from a network blip.
  type VendorLoadFlags = {
    service: string | null;
    mappings: string | null;
    trust: string | null;
  };
  const [loadStates, setLoadStates] = useState<
    Record<string, 'loading' | VendorLoadFlags>
  >({});
  // Retry re-runs the load effect (nonce dep) so it keeps the effect's
  // cancellation semantics instead of duplicating the fetch logic.
  const [reloadNonce, setReloadNonce] = useState(0);
  // Write-path honesty (review fix): the write RPC wrappers return null on
  // failure — a null must revert the optimistic row AND say so, or the card
  // renders unsaved content as saved (PR-1's headline bug, write-side).
  const [mutationError, setMutationError] = useState<string | null>(null);

  // Load vendor data when active audit changes
  useEffect(() => {
    if (!activeAudit) return;
    const auditIdLocal = activeAudit.id;
    let cancelled = false;

    const loadVendorData = async () => {
      setLoadStates((prev) => ({ ...prev, [auditIdLocal]: 'loading' }));
      try {
        const [serviceRes, mappingsRes, assessmentRes, risks] = await Promise.all([
          fetchVendorService(auditIdLocal),
          fetchServiceMappingsByAudit(auditIdLocal),
          fetchTrustAssessment(auditIdLocal),
          // The mapping picker renders from protocolRisks, but only Stage 1
          // used to fetch them — deep-linking straight to Stage 2 showed an
          // empty picker that read as "no tagged sections". Same hydrate
          // ScopeReview does. (intakeApi still returns a bare array —
          // its Result-ification is on the opportunistic ledger.)
          fetchProtocolRisksForAudit(auditIdLocal),
        ]);
        if (cancelled) return;
        setProtocolRisks((prev) => ({ ...prev, [auditIdLocal]: risks }));

        // ok → write server truth, INCLUDING a legitimate null/[] (the old
        // truthiness guards made "server emptied" indistinguishable from
        // "load failed", so deleted rows kept rendering forever). The
        // identity/empty bailouts skip no-op writes — the context value is
        // unmemoized and every consumer re-renders on a store change.
        //
        // Mappings write ALSO requires the service read to be healthy: the
        // mappings query inner-joins vendor_service_objects, so when the
        // service read failed, an ok-[] may mean "join filtered", not
        // "no mappings" — writing it would wipe a good cache with a lie
        // that downstream cache-only readers (Stage 7's report scope)
        // would silently trust.
        if (serviceRes.ok) {
          setServices((prev) =>
            prev[auditIdLocal] === serviceRes.data
              ? prev
              : { ...prev, [auditIdLocal]: serviceRes.data },
          );
        }
        if (mappingsRes.ok && serviceRes.ok) {
          setMappings((prev) =>
            (prev[auditIdLocal]?.length ?? 0) === 0 && mappingsRes.data.length === 0 && prev[auditIdLocal]
              ? prev
              : { ...prev, [auditIdLocal]: mappingsRes.data },
          );
        }
        if (assessmentRes.ok) {
          setAssessments((prev) =>
            prev[auditIdLocal] === assessmentRes.data
              ? prev
              : { ...prev, [auditIdLocal]: assessmentRes.data },
          );
        }
        setLoadStates((prev) => ({
          ...prev,
          [auditIdLocal]: {
            service: serviceRes.ok ? null : serviceRes.error,
            // Mappings are unknowable when the service read failed (join
            // semantics above), even if their own query returned ok.
            mappings: !mappingsRes.ok
              ? mappingsRes.error
              : !serviceRes.ok
              ? 'depends on the vendor service read, which failed'
              : null,
            trust: assessmentRes.ok ? null : assessmentRes.error,
          },
        }));
      } catch (err) {
        console.error('[VendorEnrichmentWorkspace] Load error:', err);
        if (!cancelled) {
          const msg = 'the request failed before the server answered';
          setLoadStates((prev) => ({
            ...prev,
            [auditIdLocal]: { service: msg, mappings: msg, trust: msg },
          }));
        }
      }
    };

    loadVendorData();
    return () => {
      cancelled = true;
    };
    // Depend on activeAudit?.id only — see RiskSummaryPanel for rationale.
    // reloadNonce lets the error card's Retry re-run this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAudit?.id, reloadNonce, setServices, setMappings, setAssessments]);

  // Mode/banner resets are AUDIT-SWITCH concerns only — a Retry (nonce bump)
  // re-runs the load effect but must not discard an open edit form.
  useEffect(() => {
    setServiceMode('view');
    setTrustMode('view');
    setMutationError(null);
  }, [activeAudit?.id]);

  if (!activeAudit) return null;

  const auditId = activeAudit.id;
  const service = services[auditId] ?? null;
  const auditMappings = mappings[auditId] ?? [];
  const assessment = assessments[auditId] ?? null;
  const auditProtocolRisks = protocolRisks[auditId] ?? [];

  // -----------------------------------------------------------------------
  // Mutation handlers
  // -----------------------------------------------------------------------
  const saveService = async (values: VendorServiceFormValues) => {
    const next: MockVendorService = service
      ? { ...service, ...values }
      : {
          id: `vs-${auditId}-${Date.now()}`,
          audit_id: auditId,
          ...values,
        };
    
    // Optimistic update
    setMutationError(null);
    setServices((prev) => ({ ...prev, [auditId]: next }));
    setServiceMode('view');

    // Persist to database. The wrappers return null on RPC failure (they
    // don't throw), so null MUST revert — the old `if (result)` skip left
    // the optimistic row rendering as saved when nothing existed server-side.
    try {
      const result = service
        ? await updateVendorService(service.id, values)
        : await createVendorService(auditId, values);

      if (result) {
        setServices((prev) => ({ ...prev, [auditId]: result }));
      } else {
        setServices((prev) => ({ ...prev, [auditId]: service }));
        setMutationError('Saving the vendor service failed — your change was not saved. Retry when ready.');
      }
    } catch (err) {
      console.error('[VendorEnrichmentWorkspace] Save service error:', err);
      setServices((prev) => ({ ...prev, [auditId]: service }));
      setMutationError('Saving the vendor service failed — your change was not saved. Retry when ready.');
    }
  };

  const addMapping = async (m: Omit<MockServiceMapping, 'id'>) => {
    if (!service) return;
    
    const newMapping: MockServiceMapping = { ...m, id: `sm-${auditId}-${Date.now()}` };

    // Optimistic update
    setMutationError(null);
    setMappings((prev) => ({
      ...prev,
      [auditId]: [...(prev[auditId] ?? []), newMapping],
    }));

    const revert = () => {
      setMappings((prev) => ({
        ...prev,
        [auditId]: (prev[auditId] ?? []).filter((x) => x.id !== newMapping.id),
      }));
      setMutationError('Adding the mapping failed — it was not saved. Retry when ready.');
    };

    // Persist to database — RPC derives criticality from the protocol risk.
    // null return = RPC failure (the wrapper doesn't throw): revert + banner.
    try {
      const result = await createServiceMapping(
        service.id,
        m.protocol_risk_id,
        m.criticality_rationale ?? null,
      );
      if (result) {
        // Replace temp ID with real one
        setMappings((prev) => ({
          ...prev,
          [auditId]: (prev[auditId] ?? []).map((x) =>
            x.id === newMapping.id ? result : x
          ),
        }));
      } else {
        revert();
      }
    } catch (err) {
      console.error('[VendorEnrichmentWorkspace] Add mapping error:', err);
      revert();
    }
  };

  const updateMapping = async (mappingId: string, updates: Partial<MockServiceMapping>) => {
    const currentMapping = auditMappings.find((m) => m.id === mappingId);

    // Optimistic update
    setMutationError(null);
    setMappings((prev) => ({
      ...prev,
      [auditId]: (prev[auditId] ?? []).map((m) =>
        m.id === mappingId ? { ...m, ...updates } : m,
      ),
    }));

    const revert = () => {
      if (currentMapping) {
        setMappings((prev) => ({
          ...prev,
          [auditId]: (prev[auditId] ?? []).map((m) =>
            m.id === mappingId ? currentMapping : m,
          ),
        }));
      }
      setMutationError('Updating the mapping failed — your change was not saved. Retry when ready.');
    };

    // Persist to database. null return = RPC failure: revert + banner (the
    // old fire-and-forget kept the optimistic patch rendering as saved).
    try {
      const result = await updateServiceMapping(mappingId, updates);
      if (!result) revert();
    } catch (err) {
      console.error('[VendorEnrichmentWorkspace] Update mapping error:', err);
      revert();
    }
  };

  const removeMapping = async (mappingId: string) => {
    const removedMapping = auditMappings.find((m) => m.id === mappingId);

    // Optimistic update
    setMutationError(null);
    setMappings((prev) => ({
      ...prev,
      [auditId]: (prev[auditId] ?? []).filter((m) => m.id !== mappingId),
    }));

    const revert = () => {
      if (removedMapping) {
        setMappings((prev) => ({
          ...prev,
          [auditId]: [...(prev[auditId] ?? []), removedMapping],
        }));
      }
      setMutationError('Removing the mapping failed — it still exists. Retry when ready.');
    };

    // Persist to database. false return = RPC failure: restore + banner.
    try {
      const deleted = await deleteServiceMapping(mappingId);
      if (!deleted) revert();
    } catch (err) {
      console.error('[VendorEnrichmentWorkspace] Remove mapping error:', err);
      revert();
    }
  };

  const saveAssessment = async (values: TrustAssessmentFormValues) => {
    const next: MockTrustAssessment = assessment
      ? { ...assessment, ...values }
      : { id: `ta-${auditId}-${Date.now()}`, audit_id: auditId, ...values };
    
    // Optimistic update
    setMutationError(null);
    setAssessments((prev) => ({ ...prev, [auditId]: next }));
    setTrustMode('view');

    // Persist to database — upsert handles both create and update.
    // null return = RPC failure: revert + banner (see saveService).
    try {
      const result = await upsertTrustAssessment(auditId, values);
      if (result) {
        setAssessments((prev) => ({ ...prev, [auditId]: result }));
      } else {
        setAssessments((prev) => ({ ...prev, [auditId]: assessment }));
        setMutationError('Saving the trust assessment failed — your change was not saved. Retry when ready.');
      }
    } catch (err) {
      console.error('[VendorEnrichmentWorkspace] Save assessment error:', err);
      setAssessments((prev) => ({ ...prev, [auditId]: assessment }));
      setMutationError('Saving the trust assessment failed — your change was not saved. Retry when ready.');
    }
  };

  // -----------------------------------------------------------------------
  // Theme tokens
  // -----------------------------------------------------------------------
  const headingColor = 'text-fg-heading';

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  const serviceStatus: SectionStatus = service ? 'done' : 'pending';
  const mappingStatus: SectionStatus = !service
    ? 'locked'
    : auditMappings.length > 0
    ? 'done'
    : 'pending';
  const trustStatus: SectionStatus = assessment ? 'done' : 'pending';

  const sectionHeader = 'text-fg-label';
  const subColor = 'text-fg-sub';

  // Load-path honesty: until this audit's reads settle, no section renders —
  // a 'pending' create form over unknown server state is an invitation to
  // retype and upsert over rows that exist. After settling, failure is per
  // section: only a section whose OWN read failed swaps to an error card.
  const loadState = loadStates[auditId] ?? 'loading';
  if (loadState === 'loading') {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        {!hasReached && <StagePreviewNotice currentStage={activeAudit.current_stage} />}
        <div>
          <p className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold`}>
            Stage 2 · Vendor enrichment
          </p>
          <h2 className={`${headingColor} text-xl font-semibold mt-1`}>
            Vendor service, mapping, and trust
          </h2>
        </div>
        <p className={`${subColor} text-sm`}>Loading vendor enrichment…</p>
      </div>
    );
  }
  const loadFailed = loadState;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {!hasReached && <StagePreviewNotice currentStage={activeAudit.current_stage} />}
      {/* Header */}
      <div>
        <p className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold`}>
          Stage 2 · Vendor enrichment
        </p>
        <h2 className={`${headingColor} text-xl font-semibold mt-1`}>
          Vendor service, mapping, and trust
        </h2>
        <p className={`${subColor} text-sm mt-1.5 leading-relaxed max-w-2xl`}>
          Define the contracted vendor service, link it to the protocol sections it touches,
          and capture initial trust intelligence from public materials. These three artefacts
          anchor questionnaire addenda and the risk summary downstream.
        </p>
      </div>

      {mutationError && (
        <div
          role="alert"
          data-testid="vendor-mutation-error"
          className={`text-xs px-3 py-2 rounded-md border ${
            isLight
              ? 'bg-red-50 border-red-200 text-red-700'
              : 'bg-red-500/15 border-red-500/30 text-red-300'
          }`}
        >
          {mutationError}
        </div>
      )}

      {/* Section 1: Vendor service */}
      {loadFailed.service ? (
        <SectionLoadError
          noun="vendor service"
          detail={loadFailed.service ?? ''}
          isLight={isLight}
          onRetry={() => setReloadNonce((n) => n + 1)}
        />
      ) : (
      <SectionCard
        step={1}
        title="Vendor service"
        description="Define the service this vendor is providing under the trial. Manual entry after contract review — not inferred."
        status={serviceStatus}
        isLight={isLight}
      >
        {!hasReached && !service ? (
          <p className="text-fg-muted text-sm">Nothing recorded yet.</p>
        ) : service && (serviceMode === 'view' || !hasReached) ? (
          <ServiceSummary
            service={service}
            isLight={isLight}
            previewLocked={!hasReached}
            onEdit={() => setServiceMode('edit')}
            onHistoryClick={() => setHistoryTarget({ objectType: 'VENDOR_SERVICE_OBJECT', objectId: service.id })}
          />
        ) : (
          <VendorServiceForm
            initialValues={service ?? undefined}
            onSubmit={saveService}
            onCancel={() => setServiceMode('view')}
          />
        )}
      </SectionCard>
      )}

      {/* Section 2: Protocol section mapping */}
      {loadFailed.mappings ? (
        <SectionLoadError
          noun="service mappings"
          detail={loadFailed.mappings ?? ''}
          isLight={isLight}
          onRetry={() => setReloadNonce((n) => n + 1)}
        />
      ) : (
      <SectionCard
        step={2}
        title="Protocol section mapping"
        description="Link the protocol sections this vendor service is responsible for. Auditor assigns a derived criticality + rationale."
        status={mappingStatus}
        lockedReason={
          hasReached
            ? 'Define the vendor service above first.'
            : 'Mappings follow the vendor service once the audit reaches this stage.'
        }
        isLight={isLight}
      >
        {service && hasReached && (
          <ServiceMappingTable
            mappings={auditMappings}
            availableRisks={auditProtocolRisks}
            vendorServiceId={service.id}
            onAdd={addMapping}
            onUpdate={updateMapping}
            onRemove={removeMapping}
          />
        )}
        {service && !hasReached && (
          <p className="text-fg-muted text-sm">
            {auditMappings.length} mapping{auditMappings.length === 1 ? '' : 's'} recorded —
            read-only in preview.
          </p>
        )}
      </SectionCard>
      )}

      {/* Section 3: Trust intelligence */}
      {loadFailed.trust ? (
        <SectionLoadError
          noun="trust assessment"
          detail={loadFailed.trust ?? ''}
          isLight={isLight}
          onRetry={() => setReloadNonce((n) => n + 1)}
        />
      ) : (
      <SectionCard
        step={3}
        title="Trust intelligence"
        description="Record certifications claimed, compliance posture, and risk hypotheses from public vendor materials. Auditor-authored only — this is structured capture, not autonomous research."
        status={trustStatus}
        isLight={isLight}
      >
        {!hasReached && !assessment ? (
          <p className="text-fg-muted text-sm">Nothing recorded yet.</p>
        ) : assessment && (trustMode === 'view' || !hasReached) ? (
          <TrustAssessmentSummary
            assessment={assessment}
            isLight={isLight}
            previewLocked={!hasReached}
            onEdit={() => setTrustMode('edit')}
            onHistoryClick={() => setHistoryTarget({ objectType: 'TRUST_ASSESSMENT_OBJECT', objectId: assessment.id })}
          />
        ) : (
          <TrustAssessmentForm
            initialValues={assessment ?? undefined}
            onSubmit={saveAssessment}
            onCancel={() => setTrustMode('view')}
          />
        )}
      </SectionCard>
      )}

      {historyTarget && (
        <HistoryDrawer
          objectType={historyTarget.objectType}
          objectId={historyTarget.objectId}
          title={historyTarget.objectType === 'VENDOR_SERVICE_OBJECT' ? 'Vendor service' : 'Trust assessment'}
          onClose={() => setHistoryTarget(null)}
        />
      )}
    </div>
  );
}

// ============================================================================
// SectionLoadError — honest stand-in for a section whose read failed.
// Markup mirrors PreAuditDraftingWorkspace's DeliverableLoadError so PR-6's
// extraction is a mechanical lift (no retrying prop here: Retry flips the
// whole page to its loading state, so the card unmounts immediately).
// ============================================================================

function SectionLoadError({
  noun,
  detail,
  isLight,
  onRetry,
}: {
  noun: string;
  /** The read's own error message — a permanent RLS denial must read
   *  differently from a transient blip. */
  detail: string;
  isLight: boolean;
  onRetry: () => void;
}) {
  const cardBg = isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/5';
  return (
    <div
      role="alert"
      data-testid="vendor-load-error"
      className={`${cardBg} border rounded-xl p-5 space-y-3`}
    >
      <div className="flex items-start gap-2">
        <AlertTriangle
          size={14}
          className={`flex-shrink-0 mt-0.5 ${isLight ? 'text-red-600' : 'text-red-400'}`}
        />
        <p className={`text-sm leading-relaxed ${isLight ? 'text-red-700' : 'text-red-300'}`}>
          The {noun} could not be loaded — it may exist on the server, so no entry form is
          shown (typing into one would overwrite whatever is really there). ({detail})
        </p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md border transition-colors ${
          isLight
            ? 'bg-white border-[#E2E8F0] text-[#334155] hover:bg-[#F8FAFC]'
            : 'bg-[#0F172A] border-white/10 text-[#CBD5E1] hover:bg-white/[0.04]'
        }`}
      >
        Retry
      </button>
    </div>
  );
}

// ============================================================================
// SectionCard
// ============================================================================

interface SectionCardProps {
  step: number;
  title: string;
  description: string;
  status: SectionStatus;
  lockedReason?: string;
  isLight: boolean;
  children: React.ReactNode;
}

function SectionCard({
  step,
  title,
  description,
  status,
  lockedReason,
  isLight,
  children,
}: SectionCardProps) {
  const cardBg = isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/5';
  const headingColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';
  const sectionHeader = 'text-fg-label';
  const borderTone = isLight ? 'border-[#F2F2F2]' : 'border-white/5';

  const opacity = status === 'locked' ? 'opacity-60' : '';

  return (
    <section className={`${cardBg} border rounded-xl ${opacity}`}>
      <header className={`px-5 pt-4 pb-3 border-b ${borderTone}`}>
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className={`text-[10px] uppercase tracking-wider font-semibold ${sectionHeader}`}>
            Step {step}
          </span>
          <StatusBadge status={status} isLight={isLight} />
        </div>
        <h3 className={`${headingColor} text-base font-semibold`}>{title}</h3>
        <p className={`${subColor} text-xs mt-1 leading-relaxed`}>
          {status === 'locked' && lockedReason ? lockedReason : description}
        </p>
      </header>
      {status !== 'locked' && <div className="px-5 py-5">{children}</div>}
    </section>
  );
}

function StatusBadge({ status, isLight }: { status: SectionStatus; isLight: boolean }) {
  const tones: Record<SectionStatus, string> = {
    done: isLight
      ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
      : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400',
    pending: isLight
      ? 'bg-amber-50 border-amber-200 text-amber-700'
      : 'bg-amber-500/15 border-amber-500/30 text-amber-400',
    locked: isLight
      ? 'bg-[#F2F2F2] border-[#CBD5E1] text-[#334155]/60'
      : 'bg-white/[0.06] border-white/10 text-[#CBD5E1]/50',
  };
  const labels: Record<SectionStatus, string> = {
    done: 'Defined',
    pending: 'Not started',
    locked: 'Locked',
  };
  const Icon = status === 'done' ? CheckCircle2 : status === 'locked' ? Lock : null;
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border ${tones[status]}`}
    >
      {Icon && <Icon size={10} />}
      {labels[status]}
    </span>
  );
}

// ============================================================================
// ServiceSummary — read-only view of the saved vendor service
// ============================================================================

interface ServiceSummaryProps {
  /** One-ahead preview (UX2): hide the edit affordance, keep History. */
  previewLocked?: boolean;
  service: MockVendorService;
  isLight: boolean;
  onEdit: () => void;
  onHistoryClick: () => void;
}

function ServiceSummary({ service, isLight, onEdit, onHistoryClick, previewLocked = false }: ServiceSummaryProps) {
  const headingColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';
  const mutedColor = 'text-fg-muted';
  const buttonSecondary = isLight
    ? 'bg-white border border-[#E2E8F0] text-[#334155] hover:bg-[#F8FAFC]'
    : 'bg-[#0F172A] border border-white/10 text-[#CBD5E1] hover:bg-white/[0.04]';
  const typeLabel =
    SERVICE_TYPE_OPTIONS.find((o) => o.value === service.service_type)?.label ??
    service.service_type;

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`${headingColor} text-base font-semibold`}>
              {service.service_name}
            </span>
            <span
              className={`inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded border ${
                isLight
                  ? 'bg-[#F2F2F2] border-[#CBD5E1] text-[#334155]/70'
                  : 'bg-white/[0.06] border-white/10 text-[#CBD5E1]/65'
              }`}
            >
              {typeLabel}
            </span>
          </div>
          {service.service_description && (
            <p className={`${subColor} text-sm mt-2 leading-relaxed`}>
              {service.service_description}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!previewLocked && (
            <button
              type="button"
              onClick={onEdit}
              className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors ${buttonSecondary}`}
            >
              <Pencil size={12} />
              Edit
            </button>
          )}
          <button
            type="button"
            className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors ${buttonSecondary}`}
            title="Change history"
            onClick={onHistoryClick}
          >
            <HistoryIcon size={12} />
            History
          </button>
        </div>
      </div>
      <p className={`text-[11px] ${mutedColor}`}>
        Re-create the audit if the contracted service category fundamentally changes.
      </p>
    </div>
  );
}

// ============================================================================
// TrustAssessmentSummary — read-only view of the saved assessment
// ============================================================================

interface TrustAssessmentSummaryProps {
  /** One-ahead preview (UX2): hide the edit affordance, keep History. */
  previewLocked?: boolean;
  assessment: MockTrustAssessment;
  isLight: boolean;
  onEdit: () => void;
  onHistoryClick: () => void;
}

function TrustAssessmentSummary({
  assessment,
  isLight,
  onEdit,
  onHistoryClick,
  previewLocked = false,
}: TrustAssessmentSummaryProps) {
  const headingColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';
  const mutedColor = 'text-fg-muted';
  const sectionHeader = 'text-fg-label';
  const chipBg = isLight
    ? 'bg-[#F2F2F2] border-[#CBD5E1] text-[#0F172A]'
    : 'bg-white/[0.06] border-white/10 text-[#CBD5E1]';
  const buttonSecondary = isLight
    ? 'bg-white border border-[#E2E8F0] text-[#334155] hover:bg-[#F8FAFC]'
    : 'bg-[#0F172A] border border-white/10 text-[#CBD5E1] hover:bg-white/[0.04]';

  return (
    <div className="space-y-4">
      {/* Postures — primary signal */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <PostureSummary
          label="Compliance"
          value={COMPLIANCE_POSTURE_LABELS[assessment.compliance_posture]}
          rawValue={assessment.compliance_posture}
          isLight={isLight}
        />
        <PostureSummary
          label="Maturity"
          value={MATURITY_POSTURE_LABELS[assessment.maturity_posture]}
          rawValue={assessment.maturity_posture}
          isLight={isLight}
        />
        <PostureSummary
          label="Provisional trust"
          value={TRUST_POSTURE_LABELS[assessment.provisional_trust_posture]}
          rawValue={assessment.provisional_trust_posture}
          isLight={isLight}
        />
      </div>

      {/* Certifications */}
      {assessment.certifications_claimed.length > 0 && (
        <SummaryList
          label="Certifications claimed"
          items={assessment.certifications_claimed}
          chipBg={chipBg}
          sectionHeader={sectionHeader}
          mutedColor={mutedColor}
        />
      )}

      {/* Regulatory claims */}
      {assessment.regulatory_claims.length > 0 && (
        <SummaryList
          label="Regulatory claims"
          items={assessment.regulatory_claims}
          chipBg={chipBg}
          sectionHeader={sectionHeader}
          mutedColor={mutedColor}
        />
      )}

      {/* Risk hypotheses */}
      {assessment.risk_hypotheses.length > 0 && (
        <div>
          <p className={`text-[10px] uppercase tracking-wider font-semibold mb-2 ${sectionHeader}`}>
            Risk hypotheses
          </p>
          <ul className="space-y-1.5">
            {assessment.risk_hypotheses.map((h, i) => (
              <li key={i} className={`text-sm flex items-start gap-2 ${headingColor}`}>
                <span
                  className={`mt-1.5 w-1 h-1 rounded-full flex-shrink-0 ${
                    isLight ? 'bg-brand-600/55' : 'bg-brand-300/55'
                  }`}
                />
                {h}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Notes */}
      {assessment.notes && (
        <div>
          <p className={`text-[10px] uppercase tracking-wider font-semibold mb-1.5 ${sectionHeader}`}>
            Notes
          </p>
          <p className={`text-sm leading-relaxed ${subColor}`}>{assessment.notes}</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-2">
        {!previewLocked && (
          <button
            type="button"
            onClick={onEdit}
            className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors ${buttonSecondary}`}
          >
            <Pencil size={12} />
            Edit
          </button>
        )}
        <button
          type="button"
          className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors ${buttonSecondary}`}
          title="Change history"
          onClick={onHistoryClick}
        >
          <HistoryIcon size={12} />
          History
        </button>
      </div>
    </div>
  );
}

interface PostureSummaryProps {
  label: string;
  value: string;
  rawValue: string;
  isLight: boolean;
}

function PostureSummary({ label, value, rawValue, isLight }: PostureSummaryProps) {
  // Highlight when posture is something other than UNKNOWN
  const isUnknown = rawValue === 'UNKNOWN';
  const cardBg = isUnknown
    ? isLight
      ? 'bg-[#F8FAFC] border-[#E2E8F0]'
      : 'bg-white/[0.02] border-white/5'
    : isLight
    ? 'bg-brand-600/[0.06] border-brand-600/20'
    : 'bg-brand-600/[0.10] border-brand-300/30';
  const sectionHeader = 'text-fg-label';
  const valueColor = isUnknown
    ? isLight
      ? 'text-[#334155]/55'
      : 'text-[#CBD5E1]/45'
    : isLight
    ? 'text-[#0F172A]'
    : 'text-white';

  return (
    <div className={`${cardBg} border rounded-md px-3 py-2.5`}>
      <p className={`text-[10px] uppercase tracking-wider font-semibold ${sectionHeader}`}>
        {label}
      </p>
      <p className={`text-sm font-semibold mt-0.5 ${valueColor}`}>{value}</p>
    </div>
  );
}

interface SummaryListProps {
  label: string;
  items: string[];
  chipBg: string;
  sectionHeader: string;
  mutedColor: string;
}

function SummaryList({ label, items, chipBg, sectionHeader }: SummaryListProps) {
  return (
    <div>
      <p className={`text-[10px] uppercase tracking-wider font-semibold mb-2 ${sectionHeader}`}>
        {label}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((it, i) => (
          <span
            key={`${it}-${i}`}
            className={`inline-flex items-center text-xs px-2 py-1 rounded border ${chipBg}`}
          >
            {it}
          </span>
        ))}
      </div>
    </div>
  );
}
