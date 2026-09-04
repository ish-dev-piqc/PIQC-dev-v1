import { createContext, useContext } from 'react';

// =============================================================================
// Dedicated context for the shell-owned Records ▸ Protocol source drawer's
// open action — the same hoist as evidenceDrawerContext.ts.
//
// AuditWorkspaceShell owns the drawer (audit-level, cross-stage); the Stage-1
// ProtocolReadinessCard only needs "open it" once the protocol is parsed. The
// shell's dispatch comment forbids growing its if-ladder for shell-injected
// state — this context is the prescribed pattern. Audit-mode-internal.
//
// null = no provider above (tests, placeholder paths) — consumers hide the
// affordance rather than rendering a dead button.
// =============================================================================

export const ProtocolSourceOpenContext = createContext<(() => void) | null>(null);

export function useOpenProtocolSource(): (() => void) | null {
  return useContext(ProtocolSourceOpenContext);
}
