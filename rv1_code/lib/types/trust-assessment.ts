// [D-005] Three posture fields use qualitative label enums as placeholders.
// Options under consideration: (a) qualitative labels — current, (b) numeric 1–5,
// (c) multi-axis. Do not build reporting logic against these until D-005 is decided.

import { CompliancePosture, MaturityPosture, TrustPosture } from "@prisma/client";

export interface TrustAssessmentValues {
  certificationsClaimed: string[];
  regulatoryClaims: string[];
  compliancePosture: CompliancePosture;   // [D-005 PLACEHOLDER]
  maturityPosture: MaturityPosture;       // [D-005 PLACEHOLDER]
  provisionalTrustPosture: TrustPosture; // [D-005 PLACEHOLDER]
  riskHypotheses: string[];
  notes?: string;
}

export interface CreateTrustAssessmentInput extends TrustAssessmentValues {
  assessedBy: string; // actor_id — replace with session.user.id when auth is added
}

export interface UpdateTrustAssessmentInput {
  values: Partial<TrustAssessmentValues>;
  actorId: string;
  reason?: string;
}
