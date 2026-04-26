// =============================================================================
// Audit stage library (D-010)
//
// Owns:
//   - Linear stage transitions (forward exactly +1; backward any distance)
//   - Approval gates (cannot enter a stage that depends on an unapproved input)
//
// Cognitive-load discipline:
//   - The stage indicator is the only field the auditor explicitly advances.
//     Per-artifact statuses change as a side effect of artifact work; the
//     auditor's stage transition is the single "I am moving on" action.
//
// Gates currently enforced (Phase 1):
//   PRE_AUDIT_DRAFTING ← APPROVED questionnaire + APPROVED risk summary
//   AUDIT_CONDUCT      ← all three deliverables APPROVED
//                        (confirmation letter + agenda + checklist)
//
// All transitions delta-tracked under TrackedObjectType.AUDIT.
// =============================================================================

import {
  Audit,
  AuditStage,
  DeliverableApprovalStatus,
  Prisma,
  RiskSummaryApprovalStatus,
  TrackedObjectType,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeDelta } from "@/lib/state-history";
import {
  STAGE_ORDER,
  TransitionAuditStageInput,
  stageIndex,
} from "@/lib/types/audit-stage";
import {
  DELIVERABLE_KINDS,
  formatDeliverableKind,
  type DeliverableKind,
} from "@/lib/types/deliverables";

export class StageTransitionError extends Error {
  readonly code:
    | "AUDIT_NOT_FOUND"
    | "INVALID_FORWARD_JUMP"
    | "GATE_QUESTIONNAIRE_NOT_APPROVED"
    | "GATE_RISK_SUMMARY_NOT_APPROVED"
    | "GATE_DELIVERABLES_NOT_APPROVED"
    | "ALREADY_AT_STAGE";

  constructor(
    code: StageTransitionError["code"],
    message: string
  ) {
    super(message);
    this.name = "StageTransitionError";
    this.code = code;
  }
}

// -----------------------------------------------------------------------------
// transitionAuditStage
// Forward: exactly +1, gated by approval state where applicable.
// Backward: any distance, ungated (auditors revisit prior stages routinely).
// -----------------------------------------------------------------------------
export async function transitionAuditStage(
  input: TransitionAuditStageInput
): Promise<Audit> {
  return prisma.$transaction(async (tx) => {
    const audit = await tx.audit.findUnique({
      where: { id: input.auditId },
    });

    if (!audit) {
      throw new StageTransitionError(
        "AUDIT_NOT_FOUND",
        `Audit ${input.auditId} not found`
      );
    }

    const fromStage = audit.currentStage;
    const toStage = input.toStage;

    if (fromStage === toStage) {
      throw new StageTransitionError(
        "ALREADY_AT_STAGE",
        `Audit is already at stage ${toStage}`
      );
    }

    const fromIdx = stageIndex(fromStage);
    const toIdx = stageIndex(toStage);
    const forward = toIdx > fromIdx;

    if (forward && toIdx - fromIdx !== 1) {
      throw new StageTransitionError(
        "INVALID_FORWARD_JUMP",
        `Forward transitions must move exactly one stage. Tried ${fromStage} → ${toStage}.`
      );
    }

    if (forward) {
      const inputs = await loadGateInputs(tx, input.auditId);
      const blocked = evaluateForwardGate(toStage, inputs);
      if (blocked) throw new StageTransitionError(blocked.code, blocked.message);
    }

    const updated = await tx.audit.update({
      where: { id: audit.id },
      data: { currentStage: toStage },
    });

    await writeDelta(
      tx,
      TrackedObjectType.AUDIT,
      audit.id,
      {
        currentStage: { from: fromStage, to: toStage },
      },
      input.actorId,
      input.reason
    );

    return updated;
  });
}

// -----------------------------------------------------------------------------
// Gate predicate — single source of truth
//
// Split into two concerns:
//   loadGateInputs  — async, fetches everything any gate could need (one
//                     query group). Both read + write paths use it.
//   evaluateForwardGate — sync, takes preloaded inputs + toStage, returns
//                         block reason or null.
//
// Why split: getStageReadout always needs the same data for its readout
// fields, so loading once + evaluating sync removes the previous double-fetch
// on the hot read path. Adding a new stage gate means one new branch in
// evaluateForwardGate (and possibly one more field on GateInputs).
// -----------------------------------------------------------------------------
type DbClient = Prisma.TransactionClient | typeof prisma;

interface GateInputs {
  questionnaire: { approvedAt: Date | null } | null;
  riskSummary:   { approvalStatus: RiskSummaryApprovalStatus } | null;
  deliverables:  Record<DeliverableKind, { approvalStatus: DeliverableApprovalStatus } | null>;
}

interface GateBlock {
  code:
    | "GATE_QUESTIONNAIRE_NOT_APPROVED"
    | "GATE_RISK_SUMMARY_NOT_APPROVED"
    | "GATE_DELIVERABLES_NOT_APPROVED";
  message: string;
  reason: string; // Short, UI-friendly
}

async function loadGateInputs(client: DbClient, auditId: string): Promise<GateInputs> {
  const [audit, letter, agenda, checklist] = await Promise.all([
    client.audit.findUnique({
      where: { id: auditId },
      select: {
        questionnaireInstance: { select: { approvedAt: true } },
        vendorRiskSummary:     { select: { approvalStatus: true } },
      },
    }),
    client.confirmationLetterObject.findUnique({ where: { auditId }, select: { approvalStatus: true } }),
    client.agendaObject.findUnique({              where: { auditId }, select: { approvalStatus: true } }),
    client.checklistObject.findUnique({           where: { auditId }, select: { approvalStatus: true } }),
  ]);

  return {
    questionnaire: audit?.questionnaireInstance ?? null,
    riskSummary:   audit?.vendorRiskSummary ?? null,
    deliverables: {
      confirmationLetter: letter,
      agenda,
      checklist,
    },
  };
}

function evaluateForwardGate(toStage: AuditStage, inputs: GateInputs): GateBlock | null {
  if (toStage === AuditStage.PRE_AUDIT_DRAFTING) {
    if (!inputs.questionnaire?.approvedAt) {
      return {
        code: "GATE_QUESTIONNAIRE_NOT_APPROVED",
        message: "Cannot enter Pre-Audit Drafting until the questionnaire is approved.",
        reason: "Questionnaire not approved",
      };
    }
    if (inputs.riskSummary?.approvalStatus !== RiskSummaryApprovalStatus.APPROVED) {
      return {
        code: "GATE_RISK_SUMMARY_NOT_APPROVED",
        message: "Cannot enter Pre-Audit Drafting until the vendor risk summary is approved.",
        reason: "Risk summary not approved",
      };
    }
    return null;
  }

  if (toStage === AuditStage.AUDIT_CONDUCT) {
    const blocked = DELIVERABLE_KINDS.filter(
      (k) => inputs.deliverables[k]?.approvalStatus !== DeliverableApprovalStatus.APPROVED
    );
    if (blocked.length > 0) {
      return {
        code: "GATE_DELIVERABLES_NOT_APPROVED",
        message: `Cannot enter Audit Conduct until all pre-audit deliverables are approved. Outstanding: ${blocked.map(formatDeliverableKind).join(", ")}.`,
        reason: `${blocked.length} deliverable${blocked.length === 1 ? "" : "s"} not approved`,
      };
    }
    return null;
  }

  return null;
}

// -----------------------------------------------------------------------------
// Stage query helper for the worklist + workspace shell
// -----------------------------------------------------------------------------
export interface StageReadout {
  currentStage: AuditStage;
  position: number; // 1..STAGE_ORDER.length
  total: number;
  questionnaireApproved: boolean;
  riskSummaryApproved: boolean;
  // Per-deliverable approval state — surfaced so the workspace can light up
  // tab badges without re-fetching deliverables for each render.
  deliverablesApproved: Record<DeliverableKind, boolean>;
  canAdvance: boolean;
  blockedReason: string | null;
}

export async function getStageReadout(auditId: string): Promise<StageReadout | null> {
  // One query group: the audit's currentStage + all gate inputs. Used both
  // for the readout fields and for the gate evaluation below — no double-fetch.
  const [audit, inputs] = await Promise.all([
    prisma.audit.findUnique({
      where: { id: auditId },
      select: { currentStage: true },
    }),
    loadGateInputs(prisma, auditId),
  ]);
  if (!audit) return null;

  const idx = stageIndex(audit.currentStage);
  const nextStage = STAGE_ORDER[idx + 1] ?? null;

  const blocked = nextStage ? evaluateForwardGate(nextStage, inputs) : null;
  const canAdvance = nextStage !== null && blocked === null;
  const blockedReason = blocked?.reason ?? null;

  return {
    currentStage: audit.currentStage,
    position: idx + 1,
    total: STAGE_ORDER.length,
    questionnaireApproved: !!inputs.questionnaire?.approvedAt,
    riskSummaryApproved:
      inputs.riskSummary?.approvalStatus === RiskSummaryApprovalStatus.APPROVED,
    deliverablesApproved: {
      confirmationLetter: inputs.deliverables.confirmationLetter?.approvalStatus === DeliverableApprovalStatus.APPROVED,
      agenda:             inputs.deliverables.agenda?.approvalStatus             === DeliverableApprovalStatus.APPROVED,
      checklist:          inputs.deliverables.checklist?.approvalStatus          === DeliverableApprovalStatus.APPROVED,
    },
    canAdvance,
    blockedReason,
  };
}
