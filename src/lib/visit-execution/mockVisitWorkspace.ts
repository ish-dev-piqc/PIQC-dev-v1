// =============================================================================
// Visit Execution Workspace — demo fixture.
//
// Demo mode serves a CARBON COPY of the real visit_execution_get_workspace RPC
// output for the 3 demo protocols, captured from the parsed protocols and
// remapped to the demo alias ids. The data lives in the generated module
// `demoVisitWorkspaces.generated.ts` (do not hand-edit it); this module is the
// stable public entry point the API layer calls.
//
// Gated by the piq-visit-execution-mock-v1 toggle OR Demo Mode (see
// visitExecutionApi.isMockEnabled). Non-demo protocols → empty array (the real
// RPC handles those).
// =============================================================================

import type { VisitExecutionWorkspace } from '../../types/visit-execution';
import { DEMO_VISIT_WORKSPACES } from './demoVisitWorkspaces.generated';

export function getMockVisitExecutionWorkspaces(
  protocolId: string,
): VisitExecutionWorkspace[] {
  return DEMO_VISIT_WORKSPACES[protocolId] ?? [];
}
