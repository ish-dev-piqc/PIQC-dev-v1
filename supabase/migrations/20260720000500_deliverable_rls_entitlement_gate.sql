-- =============================================================================
-- Gate protocol_deliverables / protocol_deliverable_blocks / deliverable_block_edits
-- RLS on the entitlement-aware check (SEC-ebc361e ENT-1 / MAC-1)
--
-- These tables' RLS policies were the actual access boundary for every
-- SECURITY INVOKER deliverable RPC (deliverable_get_packet,
-- deliverable_list_summary, deliverable_portfolio_summary,
-- deliverable_set_block_review, deliverable_edit_block_text,
-- deliverable_add_block, deliverable_delete_block, deliverable_export_packet
-- all just SELECT/INSERT/UPDATE/DELETE against these tables and let RLS do
-- the gating — none of them re-checked tier). Swapping
-- user_can_access_protocol for user_can_access_deliverable_engine here
-- closes the gap for all of them in one place, no function bodies touched.
--
-- (deliverable_generate is the one exception — SECURITY DEFINER, explicitly
-- bypasses RLS as its own "first line of defense" — fixed separately in
-- 20260720000600_deliverable_generate_entitlement_gate.sql.)
--
-- ALTER POLICY only changes the USING/WITH CHECK expression; policy names,
-- targets, and commands are unchanged, so nothing else about these tables
-- (grants, RLS enablement) needs to move.
-- =============================================================================

-- protocol_deliverables --------------------------------------------------

ALTER POLICY "protocol_deliverables_select" ON public.protocol_deliverables
  USING (public.user_can_access_deliverable_engine(auth.uid(), protocol_id));

ALTER POLICY "protocol_deliverables_insert" ON public.protocol_deliverables
  WITH CHECK (public.user_can_access_deliverable_engine(auth.uid(), protocol_id));

ALTER POLICY "protocol_deliverables_update" ON public.protocol_deliverables
  USING (public.user_can_access_deliverable_engine(auth.uid(), protocol_id))
  WITH CHECK (public.user_can_access_deliverable_engine(auth.uid(), protocol_id));

ALTER POLICY "protocol_deliverables_delete" ON public.protocol_deliverables
  USING (public.user_can_access_deliverable_engine(auth.uid(), protocol_id));

-- protocol_deliverable_blocks ---------------------------------------------

ALTER POLICY "protocol_deliverable_blocks_select" ON public.protocol_deliverable_blocks
  USING (
    EXISTS (
      SELECT 1
        FROM public.protocol_deliverables d
       WHERE d.id = protocol_deliverable_blocks.deliverable_id
         AND public.user_can_access_deliverable_engine(auth.uid(), d.protocol_id)
    )
  );

ALTER POLICY "protocol_deliverable_blocks_insert" ON public.protocol_deliverable_blocks
  WITH CHECK (
    EXISTS (
      SELECT 1
        FROM public.protocol_deliverables d
       WHERE d.id = protocol_deliverable_blocks.deliverable_id
         AND public.user_can_access_deliverable_engine(auth.uid(), d.protocol_id)
    )
  );

ALTER POLICY "protocol_deliverable_blocks_update" ON public.protocol_deliverable_blocks
  USING (
    EXISTS (
      SELECT 1
        FROM public.protocol_deliverables d
       WHERE d.id = protocol_deliverable_blocks.deliverable_id
         AND public.user_can_access_deliverable_engine(auth.uid(), d.protocol_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
        FROM public.protocol_deliverables d
       WHERE d.id = protocol_deliverable_blocks.deliverable_id
         AND public.user_can_access_deliverable_engine(auth.uid(), d.protocol_id)
    )
  );

ALTER POLICY "protocol_deliverable_blocks_delete" ON public.protocol_deliverable_blocks
  USING (
    EXISTS (
      SELECT 1
        FROM public.protocol_deliverables d
       WHERE d.id = protocol_deliverable_blocks.deliverable_id
         AND public.user_can_access_deliverable_engine(auth.uid(), d.protocol_id)
    )
  );

-- deliverable_block_edits (audit trail for the same protected resource) --

ALTER POLICY "deliverable_block_edits_select" ON public.deliverable_block_edits
  USING (
    EXISTS (
      SELECT 1
        FROM public.protocol_deliverable_blocks b
        JOIN public.protocol_deliverables d ON d.id = b.deliverable_id
       WHERE b.id = deliverable_block_edits.block_id
         AND public.user_can_access_deliverable_engine(auth.uid(), d.protocol_id)
    )
  );

ALTER POLICY "deliverable_block_edits_insert" ON public.deliverable_block_edits
  WITH CHECK (
    EXISTS (
      SELECT 1
        FROM public.protocol_deliverable_blocks b
        JOIN public.protocol_deliverables d ON d.id = b.deliverable_id
       WHERE b.id = deliverable_block_edits.block_id
         AND public.user_can_access_deliverable_engine(auth.uid(), d.protocol_id)
    )
  );
