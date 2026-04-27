"use client";

// =============================================================================
// VendorEnrichmentWorkspace
//
// VENDOR_ENRICHMENT stage center pane. Three sections in vertical sequence:
//   1. Vendor service definition (one-time; locked once saved)
//   2. Protocol section mapping (enabled after service exists)
//   3. Trust intelligence capture (always available)
//
// Each section is a paper card. Section 2 is visually disabled until Section 1
// is complete — the vendor service ID anchors mapping + addenda generation.
// =============================================================================

import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { VendorServiceForm } from "@/components/vendor-service/VendorServiceForm";
import { ServiceMappingPanel } from "@/components/vendor-service/ServiceMappingPanel";
import { TrustAssessmentForm } from "@/components/trust-mode/TrustAssessmentForm";
import { HistoryDrawer } from "@/components/workspace/HistoryDrawer";
import { color, space, type as typeScale, radius } from "@/lib/ui/tokens";
import type { MappingWithRisk, VendorRiskObjectShape } from "@/lib/types/vendor-service";
import type { TrustAssessmentValues } from "@/lib/types/trust-assessment";

// ── Types ─────────────────────────────────────────────────────────────────────

interface VendorService {
  id: string;
  serviceName: string;
  serviceType: string;
  serviceDescription: string | null;
}

type TrustAssessmentShape = TrustAssessmentValues & { id: string; notes: string | null };

interface VendorEnrichmentWorkspaceProps {
  auditId: string;
  actorId: string;
  initialService: VendorService | null;
  initialMappings: MappingWithRisk[];
  availableRiskObjects: VendorRiskObjectShape[];
  initialTrustAssessment: TrustAssessmentShape | null;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function VendorEnrichmentWorkspace({
  auditId,
  actorId,
  initialService,
  initialMappings,
  availableRiskObjects,
  initialTrustAssessment,
}: VendorEnrichmentWorkspaceProps) {
  const [service, setService] = useState<VendorService | null>(initialService);
  const [mappings, setMappings] = useState<MappingWithRisk[]>(initialMappings);
  const [trustAssessment, setTrustAssessment] = useState<TrustAssessmentShape | null>(
    initialTrustAssessment
  );

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        background: color.bgMuted,
        padding: space[5],
        display: "flex",
        flexDirection: "column",
        gap: space[5],
      }}
    >
      {/* ── Section 1: Vendor Service ── */}
      <SectionCard
        step={1}
        title="Vendor service"
        description="Define the service this vendor is providing under the trial. This anchors questionnaire addenda and deliverable stub generation."
        status={service ? "done" : "pending"}
      >
        {service ? (
          <>
            <ServiceSummary service={service} />
            <div style={{ marginTop: space[4] }}>
              <HistoryDrawer
                auditId={auditId}
                objectType="VENDOR_SERVICE_OBJECT"
                objectId={service.id}
                label="Service definition history"
              />
            </div>
          </>
        ) : (
          <VendorServiceForm
            auditId={auditId}
            actorId={actorId}
            onSuccess={(s) =>
              setService({ id: s.id, serviceName: s.serviceName, serviceType: s.serviceType, serviceDescription: s.serviceDescription })
            }
          />
        )}
      </SectionCard>

      {/* ── Section 2: Protocol Section Mapping ── */}
      <SectionCard
        step={2}
        title="Protocol section mapping"
        description="Link the protocol sections this vendor service is responsible for. Derived criticality is computed automatically — auditor can override."
        status={!service ? "locked" : mappings.length > 0 ? "done" : "pending"}
        lockedReason="Define the vendor service above first."
      >
        {service && (
          <ServiceMappingPanel
            auditId={auditId}
            actorId={actorId}
            availableRiskObjects={availableRiskObjects}
            existingMappings={mappings}
            onMappingsChange={setMappings}
          />
        )}
      </SectionCard>

      {/* ── Section 3: Trust Intelligence ── */}
      <SectionCard
        step={3}
        title="Trust intelligence"
        description="Record certifications claimed, compliance posture, and risk hypotheses from public vendor materials. All entries are auditor-authored — this is structured capture, not autonomous research."
        status={trustAssessment ? "done" : "pending"}
      >
        <TrustAssessmentForm
          auditId={auditId}
          actorId={actorId}
          initialValues={
            trustAssessment
              ? {
                  certificationsClaimed:   trustAssessment.certificationsClaimed,
                  regulatoryClaims:        trustAssessment.regulatoryClaims,
                  compliancePosture:       trustAssessment.compliancePosture,
                  maturityPosture:         trustAssessment.maturityPosture,
                  provisionalTrustPosture: trustAssessment.provisionalTrustPosture,
                  riskHypotheses:          trustAssessment.riskHypotheses,
                  notes:                   trustAssessment.notes ?? undefined,
                }
              : undefined
          }
          isExisting={!!trustAssessment}
          onSuccess={(result) =>
            setTrustAssessment({
              id:                      result.id,
              certificationsClaimed:   result.certificationsClaimed,
              regulatoryClaims:        result.regulatoryClaims,
              compliancePosture:       result.compliancePosture,
              maturityPosture:         result.maturityPosture,
              provisionalTrustPosture: result.provisionalTrustPosture,
              riskHypotheses:          result.riskHypotheses,
              notes:                   result.notes ?? null,
            })
          }
        />
        {trustAssessment && (
          <div style={{ marginTop: space[4] }}>
            <HistoryDrawer
              auditId={auditId}
              objectType="TRUST_ASSESSMENT_OBJECT"
              objectId={trustAssessment.id}
              label="Trust intelligence history"
            />
          </div>
        )}
      </SectionCard>
    </div>
  );
}

// ── ServiceSummary ─────────────────────────────────────────────────────────────

function ServiceSummary({ service }: { service: VendorService }) {
  const typeLabel = service.serviceType.replace(/_/g, " ");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: space[2] }}>
      <div style={{ display: "flex", alignItems: "center", gap: space[2] }}>
        <span style={{ ...typeScale.body, fontWeight: 600 }}>{service.serviceName}</span>
        <Badge tone="neutral">{typeLabel}</Badge>
      </div>
      {service.serviceDescription && (
        <p style={{ ...typeScale.body, color: color.fgMuted, margin: 0 }}>
          {service.serviceDescription}
        </p>
      )}
      <p style={{ ...typeScale.caption, color: color.fgSubtle, margin: 0 }}>
        Service is locked. Re-create the audit from Intake if the service type changes.
      </p>
    </div>
  );
}

// ── SectionCard ────────────────────────────────────────────────────────────────

type SectionStatus = "pending" | "done" | "locked";

function SectionCard({
  step,
  title,
  description,
  status,
  lockedReason,
  children,
}: {
  step: number;
  title: string;
  description: string;
  status: SectionStatus;
  lockedReason?: string;
  children: React.ReactNode;
}) {
  const cardStyle: React.CSSProperties = {
    background: color.bg,
    border: `1px solid ${color.border}`,
    borderRadius: radius.lg,
    boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
    overflow: "hidden",
    opacity: status === "locked" ? 0.55 : 1,
  };

  const headerStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: space[3],
    padding: `${space[4]}px ${space[5]}px`,
    borderBottom: `1px solid ${color.borderSubtle}`,
  };

  return (
    <div style={cardStyle}>
      <div style={headerStyle}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: space[2], marginBottom: space[1] }}>
            <span style={{ ...typeScale.eyebrow, color: color.fgSubtle }}>Step {step}</span>
            {status === "done"    && <Badge tone="approved">Defined</Badge>}
            {status === "pending" && <Badge tone="draft">Not started</Badge>}
            {status === "locked"  && <Badge tone="neutral">Locked</Badge>}
          </div>
          <h2 style={{ ...typeScale.section, margin: 0 }}>{title}</h2>
          <p style={{ ...typeScale.caption, color: color.fgMuted, margin: `${space[1]}px 0 0` }}>
            {status === "locked" && lockedReason ? lockedReason : description}
          </p>
        </div>
      </div>

      {status !== "locked" && (
        <div style={{ padding: `${space[4]}px ${space[5]}px ${space[5]}px` }}>
          {children}
        </div>
      )}
    </div>
  );
}
