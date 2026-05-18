-- =============================================================================
-- piqc_thread_messages — persistence for the PIQC chat thread per audit.
--
-- Before this migration: the F-3 chat thread lived only in
-- `AuditWorkspaceShell.chatThreads` state (a Record<auditId, msgs[]>).
-- Reloading the tab, closing the browser, or signing back in lost the
-- conversation entirely. This was a deliberate v1 simplification — see
-- product_piqc_vision_audit_chat.md ("amnesia") — but it broke the
-- on-shoulder-partner illusion: an auditor who asked PIQC a complex
-- question, navigated away to gather evidence, and returned found a
-- blank panel.
--
-- This table closes the amnesia gap with the smallest viable shape:
--   - One row per turn (user or assistant)
--   - ordinal preserves order across ties on created_at
--   - audit_id is the FK + RLS gate (single-auditor product — see
--     founder decision #2; one audit, one auditor, one thread)
--   - ON DELETE CASCADE so dropping an audit removes its thread
--
-- Doctrine alignment:
--   - PHI/PII handling: chat content can carry observation_text per
--     founder decision #6 ("full text IS sent to OpenAI"). The same
--     text is now persisted in our DB under the same RLS gate that
--     protects `audits` itself. No NEW disclosure surface — just
--     longer retention. Revisit on first BAA/DPA ask.
--   - Auditor-only access: the RLS policy mirrors `report_draft_objects`
--     (PR #51 lineage) — `audit_id IN (SELECT id FROM audits WHERE
--     lead_auditor_id = auth.uid())`. Single-auditor product means
--     this is a hard ownership boundary, not a soft team scope.
--
-- Out of scope for this migration (named as decision debt):
--   - Cross-tab sync. Two browser tabs on the same audit will
--     last-write-win. Real but rare for the single-auditor workflow;
--     deferred until the dual-tab case is observed in practice.
--   - Append-style RPCs. The save RPC is whole-thread-replace because
--     the client already has the full array (the panel caps threads at
--     MAX_MESSAGES = 24 turns) and replace-O(N) is simpler than an
--     append+ordinal protocol that has to coexist with optimistic-then-
--     final state commits.
--   - Soft delete / retention policy. CASCADE on audit drop is the only
--     deletion vector today. Long-term retention follows the same
--     policy as the audit row itself.
-- =============================================================================

CREATE TABLE piqc_thread_messages (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id   UUID        NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  ordinal    INTEGER     NOT NULL,
  role       TEXT        NOT NULL CHECK (role IN ('user', 'assistant')),
  -- Length cap mirrors (and exceeds) the edge function's MAX_MESSAGE_CHARS
  -- (= 2000) so the persistence layer can't be inflated by a client that
  -- skips the edge function and calls save_piqc_thread directly with a
  -- valid JWT. 8000 leaves headroom for the assistant's own replies
  -- (typically 500-1500 chars; cap allows 4x growth without a schema
  -- change). Defense in depth: a hostile client with a valid auth token
  -- still can't fill the DB row-by-row.
  content    TEXT        NOT NULL CHECK (length(content) <= 8000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (audit_id, ordinal)
);

CREATE INDEX idx_piqc_thread_audit_ordinal
  ON piqc_thread_messages (audit_id, ordinal);

ALTER TABLE piqc_thread_messages ENABLE ROW LEVEL SECURITY;

-- Same shape as `report_draft_objects_via_audit` — the audit_id-IN-owned-audits
-- pattern is the canonical audit-scoped RLS predicate in this codebase.
CREATE POLICY "piqc_thread_messages_via_audit"
  ON piqc_thread_messages
  FOR ALL
  TO authenticated
  USING (
    audit_id IN (
      SELECT id FROM audits WHERE lead_auditor_id = auth.uid()
    )
  )
  WITH CHECK (
    audit_id IN (
      SELECT id FROM audits WHERE lead_auditor_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- save_piqc_thread(audit_id, messages JSONB)
--
-- Atomic delete-then-insert of the entire thread. The client passes a
-- coherent message array (the snapshot it would also render); the RPC
-- assigns ordinals server-side (0, 1, 2…) so client and server can't
-- disagree about order.
--
-- Why whole-replace instead of append:
--   1. Threads are small (capped at ~24 client-side); replace cost is
--      tiny.
--   2. The client state commits twice per turn (optimistic user-turn,
--      then assistant or error commit). Append-by-ordinal would have
--      to reconcile out-of-order or duplicate writes. Replace is
--      idempotent.
--   3. "Clear thread" is the same RPC with an empty array — no
--      separate code path.
--
-- SECURITY INVOKER keeps RLS in force; the explicit ownership check
-- below gives reviewers a louder failure mode than an RLS-denied
-- INSERT (which would silently leave the thread half-deleted in a
-- transaction-without-explicit-BEGIN context). We're inside a function
-- so the whole thing is atomic.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION save_piqc_thread(
  p_audit_id UUID,
  p_messages JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  msg JSONB;
  i   INTEGER := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM audits
    WHERE id = p_audit_id AND lead_auditor_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'save_piqc_thread: caller does not own audit %', p_audit_id;
  END IF;

  DELETE FROM piqc_thread_messages WHERE audit_id = p_audit_id;

  IF p_messages IS NULL OR jsonb_array_length(p_messages) = 0 THEN
    RETURN;
  END IF;

  FOR msg IN SELECT * FROM jsonb_array_elements(p_messages)
  LOOP
    -- Defensive: skip malformed entries rather than throw. A single
    -- bad message shouldn't lose the rest of the thread. Empty role,
    -- empty content, or content over the CHECK length cap is a
    -- client-side bug (or worst case a hostile client) we'd rather
    -- log + skip than abort the whole batch on.
    IF msg->>'role' NOT IN ('user', 'assistant') OR
       COALESCE(msg->>'content', '') = '' OR
       length(msg->>'content') > 8000 THEN
      CONTINUE;
    END IF;

    INSERT INTO piqc_thread_messages (audit_id, ordinal, role, content)
    VALUES (
      p_audit_id,
      i,
      msg->>'role',
      msg->>'content'
    );
    i := i + 1;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION save_piqc_thread(UUID, JSONB) TO authenticated;
