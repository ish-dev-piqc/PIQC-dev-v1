// =============================================================================
// ScopeReviewWorkspace — Stage 4 of 8.
//
// Phase A: shared StagePlaceholder. Phase B replaces with read-only scope
// confirmation + risk summary approval gate. Approving the risk summary here
// unlocks PRE_AUDIT_DRAFTING.
// =============================================================================

import StagePlaceholder from '../StagePlaceholder';

export default function ScopeReviewWorkspace() {
  return <StagePlaceholder stage="SCOPE_AND_RISK_REVIEW" />;
}
