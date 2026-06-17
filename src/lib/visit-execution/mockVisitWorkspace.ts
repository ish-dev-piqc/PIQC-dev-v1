// =============================================================================
// Visit Execution Workspace — mock entry point (now a no-op stub).
//
// The static demo workspace fixture was REMOVED: it was a carbon copy of real
// parsed protocol content, which must not ship in the client bundle (anything
// bundled is publicly extractable). Demo Visit-Prep now fetches the real
// workspace at RUNTIME via the RLS-protected RPC, with an alias→real protocol-id
// remap — see visitExecutionApi.fetchVisitExecutionWorkspaces.
//
// This stub remains only so the dev-only worksheet-export mock path still
// compiles; it intentionally returns nothing.
// =============================================================================

import type { VisitExecutionWorkspace } from '../../types/visit-execution';

export function getMockVisitExecutionWorkspaces(
  _protocolId: string,
): VisitExecutionWorkspace[] {
  return [];
}
