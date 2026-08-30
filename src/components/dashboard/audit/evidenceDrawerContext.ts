import { createContext, useContext } from 'react';

// =============================================================================
// Dedicated context for the shell-owned Evidence drawer's open action.
//
// AuditWorkspaceShell owns the drawer (audit-level, cross-stage); stage
// workspaces (Questionnaire Review's attach line, Pre-Audit Drafting's summary
// chip) only need "open it". The shell's dispatch comment forbids growing the
// REPORT_DRAFTING if-ladder for shell-injected state — this context is the
// hoist it prescribes. Audit-mode-internal: never import from another mode.
//
// null = no provider above (ISA placeholder paths, tests) — consumers hide
// their affordance rather than rendering a dead button.
// =============================================================================

export const EvidenceOpenContext = createContext<(() => void) | null>(null);

export function useOpenEvidence(): (() => void) | null {
  return useContext(EvidenceOpenContext);
}
