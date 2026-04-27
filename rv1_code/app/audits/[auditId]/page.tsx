// =============================================================================
// Audit workspace page (D-010)
//
// The host page for an Audit. Loads stage readout + rendered risk summary,
// then renders AuditWorkspaceShell wrapping a per-stage center component.
//
// Per-stage center components:
//   INTAKE                → IntakeWorkspace (protocol section tagging)
//   VENDOR_ENRICHMENT     → VendorEnrichmentWorkspace (service + mapping + trust)
//   QUESTIONNAIRE_REVIEW  → QuestionnaireWorkspace (or QuestionnaireInitiator if no instance)
//   SCOPE_AND_RISK_REVIEW → ScopeReviewWorkspace (scope confirmation + advance gate)
//   PRE_AUDIT_DRAFTING    → PreAuditDraftingWorkspace (deliverable-aware)
//   Others                → StagePlaceholder — placeholder until that stage's workspace is built
//
// Auth deferred: actorId is the audit's leadAuditor for now. Replace with
// session.user.id when auth lands.
// =============================================================================

import { notFound } from "next/navigation";
import { AuditStage } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getStageReadout } from "@/lib/audit-stage";
import { getRenderedRiskSummary } from "@/lib/risk-summary";
import { getInstanceByAudit, getRenderedQuestionnaire } from "@/lib/questionnaires";
import { getAllRenderedDeliverables } from "@/lib/deliverables";
import { getVendorServiceWithMappings } from "@/lib/vendor-services";
import { getTrustAssessment } from "@/lib/trust-assessments";
import { getProtocolRiskObjectsForStage } from "@/lib/risk-objects";
import { listWorkspaceEntries } from "@/lib/workspace-entries";
import { parseJsonStringArray } from "@/lib/api/json";
import { AuditWorkspaceShell } from "@/components/workspace/AuditWorkspaceShell";
import { AuditConductWorkspace } from "@/components/workspace/AuditConductWorkspace";
import { QuestionnaireWorkspace } from "@/components/questionnaire/QuestionnaireWorkspace";
import { QuestionnaireInitiator } from "@/components/questionnaire/QuestionnaireInitiator";
import { PreAuditDraftingWorkspace } from "@/components/workspace/PreAuditDraftingWorkspace";
import { VendorEnrichmentWorkspace } from "@/components/workspace/VendorEnrichmentWorkspace";
import { IntakeWorkspace } from "@/components/workspace/IntakeWorkspace";
import { ScopeReviewWorkspace } from "@/components/workspace/ScopeReviewWorkspace";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { color, space, type as typeScale } from "@/lib/ui/tokens";

interface PageProps {
  params: Promise<{ auditId: string }>;
}

export default async function AuditWorkspacePage({ params }: PageProps) {
  const { auditId } = await params;

  const [audit, readout, riskSummary] = await Promise.all([
    prisma.audit.findUnique({
      where: { id: auditId },
      select: {
        id: true,
        leadAuditorId: true,
        currentStage: true,
        auditName: true,
        auditType: true,
        scheduledDate: true,
        protocolVersionId: true,
        vendor:   { select: { name: true } },
        protocol: { select: { studyNumber: true } },
      },
    }),
    getStageReadout(auditId),
    getRenderedRiskSummary(auditId),
  ]);

  if (!audit || !readout) notFound();

  const actorId = audit.leadAuditorId; // TODO: replace with session.user.id

  const center = await renderCenter({
    auditId,
    actorId,
    stage: audit.currentStage,
    protocolVersionId: audit.protocolVersionId,
  });

  const breadcrumbLabel = audit.protocol.studyNumber
    ? `${audit.protocol.studyNumber} — ${audit.vendor.name}`
    : audit.auditName;

  // Audit-type ("Onsite") + scheduled date — what the breadcrumb doesn't carry.
  // Replaces the old duplicate-of-breadcrumb auditName line.
  const auditTypeLabel = audit.auditType.charAt(0) + audit.auditType.slice(1).toLowerCase();
  const scheduledLabel = audit.scheduledDate
    ? new Date(audit.scheduledDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : "Date TBD";

  return (
    <AuditWorkspaceShell
      auditId={auditId}
      actorId={actorId}
      initialReadout={readout}
      initialRiskSummary={riskSummary}
      headerSlot={
        <div>
          <Breadcrumb
            items={[
              { label: "Audits", href: "/audits" },
              { label: breadcrumbLabel },
            ]}
          />
          <div style={{ ...typeScale.caption, color: color.fgMuted, marginTop: space[1] }}>
            {auditTypeLabel} audit · {scheduledLabel}
          </div>
        </div>
      }
    >
      {center}
    </AuditWorkspaceShell>
  );
}

// -----------------------------------------------------------------------------
// Per-stage center component renderer
// -----------------------------------------------------------------------------
async function renderCenter({
  auditId,
  actorId,
  stage,
  protocolVersionId,
}: {
  auditId: string;
  actorId: string;
  stage: AuditStage;
  protocolVersionId: string;
}): Promise<React.ReactNode> {
  switch (stage) {
    case AuditStage.QUESTIONNAIRE_REVIEW: {
      const instance = await getInstanceByAudit(auditId);
      if (!instance) {
        return <QuestionnaireInitiator auditId={auditId} actorId={actorId} />;
      }
      const { instance: i, questions } = await getRenderedQuestionnaire(instance.id);
      return (
        <QuestionnaireWorkspace
          auditId={auditId}
          actorId={actorId}
          initialInstance={{
            id: i.id,
            auditId: i.auditId,
            templateVersionId: i.templateVersionId,
            status: i.status,
            vendorContactName: i.vendorContactName,
            vendorContactEmail: i.vendorContactEmail,
            vendorContactTitle: i.vendorContactTitle,
            addendaGeneratedAt: i.addendaGeneratedAt?.toISOString() ?? null,
            sentToVendorAt: i.sentToVendorAt?.toISOString() ?? null,
            vendorRespondedAt: i.vendorRespondedAt?.toISOString() ?? null,
            completedAt: i.completedAt?.toISOString() ?? null,
          }}
          initialQuestions={questions}
        />
      );
    }

    case AuditStage.PRE_AUDIT_DRAFTING: {
      // Library returns the kind-typed RenderedDeliverable map directly —
      // no per-row content narrowing here. Single Promise.all inside the lib.
      const initial = await getAllRenderedDeliverables(auditId);
      return (
        <PreAuditDraftingWorkspace auditId={auditId} actorId={actorId} initial={initial} />
      );
    }

    case AuditStage.INTAKE: {
      const initialSections = await prisma.protocolRiskObject.findMany({
        where:   { protocolVersionId },
        orderBy: { taggedAt: "asc" },
        select: {
          id: true,
          sectionIdentifier: true,
          sectionTitle: true,
          endpointTier: true,
          impactSurface: true,
          timeSensitivity: true,
          vendorDependencyFlags: true,
          operationalDomainTag: true,
          taggingMode: true,
        },
      });
      return (
        <IntakeWorkspace
          auditId={auditId}
          protocolVersionId={protocolVersionId}
          actorId={actorId}
          initialSections={initialSections.map((s) => ({
            ...s,
            vendorDependencyFlags: parseJsonStringArray(s.vendorDependencyFlags, "vendorDependencyFlags"),
          }))}
        />
      );
    }

    case AuditStage.VENDOR_ENRICHMENT: {
      const [serviceRaw, trustAssessment, riskObjects] = await Promise.all([
        getVendorServiceWithMappings(auditId),
        getTrustAssessment(auditId),
        getProtocolRiskObjectsForStage(protocolVersionId),
      ]);

      const initialService = serviceRaw
        ? {
            id:                 serviceRaw.id,
            serviceName:        serviceRaw.serviceName,
            serviceType:        serviceRaw.serviceType,
            serviceDescription: serviceRaw.serviceDescription,
          }
        : null;

      const initialMappings = (serviceRaw?.mappings ?? []).map((m) => ({
        mappingId:            m.id,
        derivedCriticality:   m.derivedCriticality,
        criticalityRationale: m.criticalityRationale,
        riskObject: {
          id:                   m.protocolRisk.id,
          sectionIdentifier:    m.protocolRisk.sectionIdentifier,
          sectionTitle:         m.protocolRisk.sectionTitle,
          endpointTier:         m.protocolRisk.endpointTier,
          impactSurface:        m.protocolRisk.impactSurface,
          timeSensitivity:      m.protocolRisk.timeSensitivity,
          operationalDomainTag: m.protocolRisk.operationalDomainTag,
        },
      }));

      const initialTrust = trustAssessment
        ? {
            id:                      trustAssessment.id,
            certificationsClaimed:   parseJsonStringArray(trustAssessment.certificationsClaimed, "certificationsClaimed"),
            regulatoryClaims:        parseJsonStringArray(trustAssessment.regulatoryClaims, "regulatoryClaims"),
            compliancePosture:       trustAssessment.compliancePosture,
            maturityPosture:         trustAssessment.maturityPosture,
            provisionalTrustPosture: trustAssessment.provisionalTrustPosture,
            riskHypotheses:          parseJsonStringArray(trustAssessment.riskHypotheses, "riskHypotheses"),
            notes:                   trustAssessment.notes,
          }
        : null;

      return (
        <VendorEnrichmentWorkspace
          auditId={auditId}
          actorId={actorId}
          initialService={initialService}
          initialMappings={initialMappings}
          availableRiskObjects={riskObjects}
          initialTrustAssessment={initialTrust}
        />
      );
    }

    case AuditStage.SCOPE_AND_RISK_REVIEW: {
      const [serviceRaw2, trustAssessment2, riskObjects2] = await Promise.all([
        getVendorServiceWithMappings(auditId),
        getTrustAssessment(auditId),
        getProtocolRiskObjectsForStage(protocolVersionId),
      ]);

      const scopeService = serviceRaw2
        ? {
            id:                 serviceRaw2.id,
            serviceName:        serviceRaw2.serviceName,
            serviceType:        serviceRaw2.serviceType,
            serviceDescription: serviceRaw2.serviceDescription,
            mappings: (serviceRaw2.mappings ?? []).map((m) => ({
              mappingId:            m.id,
              derivedCriticality:   m.derivedCriticality,
              criticalityRationale: m.criticalityRationale,
              riskObject: {
                id:                   m.protocolRisk.id,
                sectionIdentifier:    m.protocolRisk.sectionIdentifier,
                sectionTitle:         m.protocolRisk.sectionTitle,
                endpointTier:         m.protocolRisk.endpointTier,
                impactSurface:        m.protocolRisk.impactSurface,
                timeSensitivity:      m.protocolRisk.timeSensitivity,
                operationalDomainTag: m.protocolRisk.operationalDomainTag,
              },
            })),
          }
        : null;

      const scopeTrust = trustAssessment2
        ? {
            compliancePosture:       trustAssessment2.compliancePosture,
            maturityPosture:         trustAssessment2.maturityPosture,
            provisionalTrustPosture: trustAssessment2.provisionalTrustPosture,
            certificationsClaimed:   parseJsonStringArray(trustAssessment2.certificationsClaimed, "certificationsClaimed"),
            riskHypotheses:          parseJsonStringArray(trustAssessment2.riskHypotheses, "riskHypotheses"),
          }
        : null;

      return (
        <ScopeReviewWorkspace
          riskObjects={riskObjects2}
          vendorService={scopeService}
          trustAssessment={scopeTrust}
        />
      );
    }

    case AuditStage.AUDIT_CONDUCT: {
      const [initialEntries, riskObjects] = await Promise.all([
        listWorkspaceEntries(auditId),
        getProtocolRiskObjectsForStage(protocolVersionId),
      ]);
      return (
        <AuditConductWorkspace
          auditId={auditId}
          actorId={actorId}
          initialEntries={initialEntries}
          availableRiskObjects={riskObjects}
        />
      );
    }

    case AuditStage.REPORT_DRAFTING:
      return (
        <StagePlaceholder
          title="Report Drafting"
          body="Report drafting reads only APPROVED upstream artifacts (questionnaire, risk summary, deliverables). Workspace lands in a follow-up task."
        />
      );

    case AuditStage.FINAL_REVIEW_EXPORT:
      return (
        <StagePlaceholder
          title="Final Review & Export"
          body="Final review + sponsor-branded export not yet scaffolded."
        />
      );

    default: {
      const _exhaustive: never = stage;
      return _exhaustive;
    }
  }
}

function StagePlaceholder({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ padding: space[6], maxWidth: 720 }}>
      <h2 style={{ ...typeScale.title, margin: 0 }}>{title}</h2>
      <p style={{ ...typeScale.body, color: color.fgMuted, marginTop: space[2], lineHeight: 1.6 }}>{body}</p>
    </div>
  );
}
