// =============================================================================
// evidenceRegister — normalization of audit_source_documents rows into the
// engine's evidence-register view. Extracted from audit-deliverable-draft
// (PR-D4, absorbing the parked engine-test-seam PR-P) so the AUDIT_EVIDENCE
// invariant — the register contains audit evidence documents ONLY, never
// protocol rows that share the join table — is unit-tested on the engine
// side, mirroring the client's same-language filter in evidenceApi's mapper.
//
// Pure module: no Deno APIs, no Supabase client — importable by Vitest
// cross-tree (see protocolCandidates.ts for the precedent).
// =============================================================================

// One normalized row per AUDIT_EVIDENCE register entry — the single place the
// evidence-kind predicate and PostgREST embed unwrap live.
export interface RegisterDoc {
  document_id: string;
  source_type: string;
  title: string;
  status: string;
  content_hash: string | null;
  included: boolean;
}

export function normalizeRegister(registerRows: unknown[] | null): RegisterDoc[] {
  return (registerRows ?? []).flatMap((r) => {
    const docRaw = (r as { documents: unknown }).documents;
    const doc = (Array.isArray(docRaw) ? docRaw[0] : docRaw) as
      | { title?: string; status?: string; content_hash?: string | null; kind?: string }
      | null;
    if (!doc || doc.kind !== "AUDIT_EVIDENCE") return [];
    return [{
      document_id: String((r as { document_id: unknown }).document_id),
      source_type: String((r as { source_type: unknown }).source_type),
      title: (doc.title ?? "").trim() || "(untitled)",
      status: doc.status ?? "unknown",
      content_hash: doc.content_hash ?? null,
      included: (r as { include_in_generation: boolean }).include_in_generation === true,
    }];
  });
}
