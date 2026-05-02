import { useState, useEffect } from 'react';
import { CheckCircle2, Lock, Pencil, History as HistoryIcon } from 'lucide-react';
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
  } = useAuditData();

  // Form modes
  const [serviceMode, setServiceMode] = useState<'view' | 'edit' | 'create'>('view');
  const [trustMode, setTrustMode] = useState<'view' | 'edit' | 'create'>('view');
  const [historyTarget, setHistoryTarget] = useState<{ objectType: TrackedObjectType; objectId: string } | null>(null);

  // Load vendor data when active audit changes
  useEffect(() => {
    if (!activeAudit) return;

    const loadVendorData = async () => {
      try {
        const [service, mappings, assessment] = await Promise.all([
          fetchVendorService(activeAudit.id),
          fetchServiceMappingsByAudit(activeAudit.id),
          fetchTrustAssessment(activeAudit.id),
        ]);
        
        if (service) {
          setServices((prev) => ({ ...prev, [activeAudit.id]: service }));
        }
        if (mappings.length > 0) {
          setMappings((prev) => ({ ...prev, [activeAudit.id]: mappings }));
        }
        if (assessment) {
          setAssessments((prev) => ({ ...prev, [activeAudit.id]: assessment }));
        }
      } catch (err) {
        console.error('[VendorEnrichmentWorkspace] Load error:', err);
      }
    };

    loadVendorData();
    setServiceMode('view');
    setTrustMode('view');
    // Depend on activeAudit?.id only — see RiskSummaryPanel for rationale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAudit?.id, setServices, setMappings, setAssessments]);

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
    setServices((prev) => ({ ...prev, [auditId]: next }));
    setServiceMode('view');

    // Persist to database
    try {
      const result = service
        ? await updateVendorService(service.id, values)
        : await createVendorService(auditId, values);
      
      if (result) {
        setServices((prev) => ({ ...prev, [auditId]: result }));
      }
    } catch (err) {
      console.error('[VendorEnrichmentWorkspace] Save service error:', err);
      // Revert on error
      if (service) {
        setServices((prev) => ({ ...prev, [auditId]: service }));
      } else {
        setServices((prev) => {
          const updated = { ...prev };
          delete updated[auditId];
          return updated;
        });
      }
    }
  };

  const addMapping = async (m: Omit<MockServiceMapping, 'id'>) => {
    if (!service) return;
    
    const newMapping: MockServiceMapping = { ...m, id: `sm-${auditId}-${Date.now()}` };
    
    // Optimistic update
    setMappings((prev) => ({
      ...prev,
      [auditId]: [...(prev[auditId] ?? []), newMapping],
    }));

    // Persist to database — RPC derives criticality from the protocol risk
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
      }
    } catch (err) {
      console.error('[VendorEnrichmentWorkspace] Add mapping error:', err);
      // Revert on error
      setMappings((prev) => ({
        ...prev,
        [auditId]: (prev[auditId] ?? []).filter((x) => x.id !== newMapping.id),
      }));
    }
  };

  const updateMapping = async (mappingId: string, updates: Partial<MockServiceMapping>) => {
    // Optimistic update
    setMappings((prev) => ({
      ...prev,
      [auditId]: (prev[auditId] ?? []).map((m) =>
        m.id === mappingId ? { ...m, ...updates } : m,
      ),
    }));

    // Persist to database
    try {
      await updateServiceMapping(mappingId, updates);
    } catch (err) {
      console.error('[VendorEnrichmentWorkspace] Update mapping error:', err);
      // Revert on error
      const currentMapping = auditMappings.find((m) => m.id === mappingId);
      if (currentMapping) {
        setMappings((prev) => ({
          ...prev,
          [auditId]: (prev[auditId] ?? []).map((m) =>
            m.id === mappingId ? currentMapping : m,
          ),
        }));
      }
    }
  };

  const removeMapping = async (mappingId: string) => {
    const removedMapping = auditMappings.find((m) => m.id === mappingId);
    
    // Optimistic update
    setMappings((prev) => ({
      ...prev,
      [auditId]: (prev[auditId] ?? []).filter((m) => m.id !== mappingId),
    }));

    // Persist to database
    try {
      await deleteServiceMapping(mappingId);
    } catch (err) {
      console.error('[VendorEnrichmentWorkspace] Remove mapping error:', err);
      // Revert on error
      if (removedMapping) {
        setMappings((prev) => ({
          ...prev,
          [auditId]: [...(prev[auditId] ?? []), removedMapping],
        }));
      }
    }
  };

  const saveAssessment = async (values: TrustAssessmentFormValues) => {
    const next: MockTrustAssessment = assessment
      ? { ...assessment, ...values }
      : { id: `ta-${auditId}-${Date.now()}`, audit_id: auditId, ...values };
    
    // Optimistic update
    setAssessments((prev) => ({ ...prev, [auditId]: next }));
    setTrustMode('view');

    // Persist to database — upsert handles both create and update.
    try {
      const result = await upsertTrustAssessment(auditId, values);
      if (result) {
        setAssessments((prev) => ({ ...prev, [auditId]: result }));
      }
    } catch (err) {
      console.error('[VendorEnrichmentWorkspace] Save assessment error:', err);
      // Revert on error
      if (assessment) {
        setAssessments((prev) => ({ ...prev, [auditId]: assessment }));
      } else {
        setAssessments((prev) => {
          const updated = { ...prev };
          delete updated[auditId];
          return updated;
        });
      }
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

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
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

      {/* Section 1: Vendor service */}
      <SectionCard
        step={1}
        title="Vendor service"
        description="Define the service this vendor is providing under the trial. Manual entry after contract review — not inferred."
        status={serviceStatus}
        isLight={isLight}
      >
        {service && serviceMode === 'view' ? (
          <ServiceSummary
            service={service}
            isLight={isLight}
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

      {/* Section 2: Protocol section mapping */}
      <SectionCard
        step={2}
        title="Protocol section mapping"
        description="Link the protocol sections this vendor service is responsible for. Auditor assigns a derived criticality + rationale."
        status={mappingStatus}
        lockedReason="Define the vendor service above first."
        isLight={isLight}
      >
        {service && (
          <ServiceMappingTable
            mappings={auditMappings}
            availableRisks={auditProtocolRisks}
            vendorServiceId={service.id}
            onAdd={addMapping}
            onUpdate={updateMapping}
            onRemove={removeMapping}
          />
        )}
      </SectionCard>

      {/* Section 3: Trust intelligence */}
      <SectionCard
        step={3}
        title="Trust intelligence"
        description="Record certifications claimed, compliance posture, and risk hypotheses from public vendor materials. Auditor-authored only — this is structured capture, not autonomous research."
        status={trustStatus}
        isLight={isLight}
      >
        {assessment && trustMode === 'view' ? (
          <TrustAssessmentSummary
            assessment={assessment}
            isLight={isLight}
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
  const cardBg = isLight ? 'bg-white border-[#e2e8ee]' : 'bg-[#131a22] border-white/5';
  const headingColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';
  const sectionHeader = 'text-fg-label';
  const borderTone = isLight ? 'border-[#eef2f6]' : 'border-white/5';

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
      ? 'bg-[#eef2f6] border-[#cbd2db] text-[#374152]/60'
      : 'bg-white/[0.06] border-white/10 text-[#d2d7e0]/50',
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
  service: MockVendorService;
  isLight: boolean;
  onEdit: () => void;
  onHistoryClick: () => void;
}

function ServiceSummary({ service, isLight, onEdit, onHistoryClick }: ServiceSummaryProps) {
  const headingColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';
  const mutedColor = 'text-fg-muted';
  const buttonSecondary = isLight
    ? 'bg-white border border-[#e2e8ee] text-[#374152] hover:bg-[#f5f7fa]'
    : 'bg-[#131a22] border border-white/10 text-[#d2d7e0] hover:bg-white/[0.04]';
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
                  ? 'bg-[#eef2f6] border-[#cbd2db] text-[#374152]/70'
                  : 'bg-white/[0.06] border-white/10 text-[#d2d7e0]/65'
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
          <button
            type="button"
            onClick={onEdit}
            className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors ${buttonSecondary}`}
          >
            <Pencil size={12} />
            Edit
          </button>
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
}: TrustAssessmentSummaryProps) {
  const headingColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';
  const mutedColor = 'text-fg-muted';
  const sectionHeader = 'text-fg-label';
  const chipBg = isLight
    ? 'bg-[#eef2f6] border-[#cbd2db] text-[#1a1f28]'
    : 'bg-white/[0.06] border-white/10 text-[#d2d7e0]';
  const buttonSecondary = isLight
    ? 'bg-white border border-[#e2e8ee] text-[#374152] hover:bg-[#f5f7fa]'
    : 'bg-[#131a22] border border-white/10 text-[#d2d7e0] hover:bg-white/[0.04]';

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
                    isLight ? 'bg-[#4a6fa5]/55' : 'bg-[#6e8fb5]/55'
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
        <button
          type="button"
          onClick={onEdit}
          className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors ${buttonSecondary}`}
        >
          <Pencil size={12} />
          Edit
        </button>
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
      ? 'bg-[#f9fafc] border-[#e2e8ee]'
      : 'bg-white/[0.02] border-white/5'
    : isLight
    ? 'bg-[#4a6fa5]/[0.06] border-[#4a6fa5]/20'
    : 'bg-[#4a6fa5]/[0.10] border-[#6e8fb5]/30';
  const sectionHeader = 'text-fg-label';
  const valueColor = isUnknown
    ? isLight
      ? 'text-[#374152]/55'
      : 'text-[#d2d7e0]/45'
    : isLight
    ? 'text-[#1a1f28]'
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
