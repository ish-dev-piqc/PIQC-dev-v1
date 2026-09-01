---
status: active
feature: vendor-observation-candidates
owner: sixonelabs-piqc
branch: sixonelabs-piqc/vendor-observation-candidates
target_pr: TBD
---

# Vendor-audit candidate observations (fieldwork lane, slice 2 of 3)

Slice 1 (#595) gave vendor audits a fieldwork notes pad. This slice is the heart of the lane: PIQC reads the un-promoted notes plus the filed evidence and proposes **candidate observations for the auditor to consider** — accept / edit / reject, never direct-to-document. An accepted candidate becomes a Stage-6 `audit_workspace_entry_objects` row with provenance (origin, the notes it consumed, the evidence chain, the verified protocol quote, the engine that drafted it), and from there flows into everything downstream that already exists (findings-report blocks, digest, readiness gates, export, lineage, CAPA triage). This feature ends at entry creation. Approved arc: `~/.claude/plans/cryptic-whistling-ullman.md`; slice 3 (`vendor-entry-provenance`) surfaces the provenance on entry rows.

D4's binding decision is respected, not bent: the model never authors observations of record. The candidate/promote latch satisfies it — the ISA lane's shipped proposals → gates → promote pattern, copied.

## Scope

- plans/sixonelabs-piqc/vendor-observation-candidates.md
- supabase/migrations/20260909000000_audit_entry_origin_promote.sql (new)
- supabase/functions/audit-observation-draft/index.ts (new)
- supabase/functions/audit-observation-draft/gates.ts (new)
- src/types/audit/enums.ts (`WorkspaceEntryOrigin` mirror)
- src/lib/audit/labels.ts (`PROVISIONAL_CLASSIFICATION_ORDER` — one picker order for the entry form and the panel)
- src/lib/audit/observationDraftApi.ts (new)
- src/lib/audit/__tests__/observationDraftApi.test.ts (new)
- src/lib/audit/__tests__/vendorObservationGates.test.ts (new)
- src/lib/audit/workspaceEntriesApi.ts (`promoteWorkspaceCandidate`)
- src/lib/audit/__tests__/workspaceEntriesApi.test.ts
- src/components/dashboard/audit/stages/vendor/VendorCandidatePanel.tsx (new)
- src/components/dashboard/audit/stages/vendor/__tests__/VendorCandidatePanel.test.tsx (new)
- src/components/dashboard/audit/stages/vendor/VendorNotesPad.tsx (fetch lifted — becomes props-driven)
- src/components/dashboard/audit/stages/vendor/__tests__/VendorNotesPad.test.tsx
- src/components/dashboard/audit/stages/AuditConductWorkspace.tsx (one lifted notes fetch keyed by audit + panel mount + promoted merge + shared classification order)
- src/components/dashboard/audit/stages/__tests__/AuditConductWorkspace.test.tsx

## Out of scope

- The applied entry RPCs (`audit_mode_create_workspace_entry`, `audit_mode_update_workspace_entry`) — untouched; the promote RPC is an additive sibling.
- The ISA lane (`isa-finding-draft`, `IsaConductWorkspace.tsx`, ISA RPCs, `isaReportModel.ts`) — untouched; the vendor engine is a sibling, and the shared citation-locator formatter is imported, not edited.
- `src/lib/audit/mockWorkspaceEntries.ts` and every fixture that builds a `MockWorkspaceEntry` literal — the display shape gains the provenance fields in slice 3, with its consumer (decision 6).
- src/context/** (no realtime, no cache changes; `useAuth` is consumed, not changed).
- Export, readiness gates, findings-report engine, lineage — they consume entries already.
- Merged migrations (append-only).
- AuditConductWorkspace render blocks beyond the mounts, the lifted fetch, the promoted merge, and the classification-order const (a parallel session is sweeping theme tokens in audit components).

## Architecture layers touched

migration, RPC, edge function, adapter (pure client modules), component, test. No context.

## Mock data plan

None. Real Supabase + real edge function, honest-degraded until applied/deployed: Draft surfaces a typed "drafting engine is not deployed yet" state (the function 404s); Accept surfaces the RPC error on the card and the candidate stays stashed. Nothing silently succeeds.

## Approved-by

- @karl-dev-piqc (src/lib/audit, src/components/dashboard/audit, src/types/audit)
- @rv61 (supabase/** — self, per CODEOWNERS)

## Decision record

1. **Direct-INSERT promote RPC, not a wrapper around the applied create RPC.** `audit_mode_promote_workspace_candidate` validates, inserts the entry with its provenance columns, stamps `promoted_entry_id` on the consumed notes, and writes ONE delta — in one transaction. Wrapping `audit_mode_create_workspace_entry` would force a post-hoc UPDATE and a second delta; ISA's create-with-origin (20260727000000) is the direct-insert precedent. The duplicated insert list is ledgered.
2. **Lane-specific origin enum.** `workspace_entry_origin ('AUDITOR','PIQC_DRAFTED','PIQC_EDITED')` — a NEW type used in the same file is safe (the same-transaction hazard is only `ALTER TYPE … ADD VALUE`). Not reusing `isa_finding_origin` across lanes: the two lanes' provenance vocabularies evolve separately (ISA flips DRAFTED→EDITED on update; vendor defers that — ledger).
3. **Candidates carry NO severity and NO classification — schema-level absence.** The engine's response shape cannot express them and the gates never pass them through. Classification is the sponsor-QA-facing decision feeding CAPA triage; D4's doctrine beats the ISA severity precedent. Accepted entries default `NOT_YET_CLASSIFIED` (blocks Stage-8 sign-off via `GATE_ENTRIES_UNCLASSIFIED`; excluded from report bodies) and `provisional_impact = 'NONE'`; the auditor sets classification at accept (auditor-only select, one shared option order with the entry form) and everything else on the entry afterwards.
4. **Gates.** Gate 1 cite-or-drop: every evidence item keeps ≥1 live note id OR ≥1 valid evidence-passage label, or the candidate is withheld (counted, disclosed). Evidence-only candidates are legitimate — the owner scoped grounding as notes + filed evidence. Gate 3 `materializeRef`: a protocol_ref must name a passage sent to the model and quote it verbatim, else stripped (counted). **No Gate 2** — there is no vendor closed-world citation map; deliberate omission. Passage citations are materialized to the DB row's facts (chunk/document ids, the document's `content_hash` as its version, section, pages) — the model's labels never leave the function.
5. **One notes read, lifted to AuditConductWorkspace and keyed by audit.** It feeds the pad and the panel; both are props-driven (`notes` + a `status` union — 'failed' is a state, never an empty list). The slot names the audit it was read for, so on a switch the stale read reads as *loading* rather than as the next audit's notes, and a note mutation resolving after a switch is dropped instead of landing in the wrong audit. The pad hides capture while a read is in flight (a note added mid-read would be overwritten). Fetch-in-component disclosure: the workspace already hydrates entries this way (:128), and the panel calls the drafting and promote Api wrappers the same way the entry form calls create/update — the established site pattern; the mechanical rule (no direct supabase imports) holds.
6. **Display-shape fields deferred to slice 3.** `MockWorkspaceEntry` does not gain the provenance fields here: nothing in this slice reads them, and adding required fields touches six fixture files for no behavior. The type mirror for this migration is the `WorkspaceEntryOrigin` enum plus the promote input types; the row mapping ignores the new columns until slice 3 consumes them. Until then an accepted candidate renders like a hand-typed entry — known, and the very next PR.
7. **Promote locks the cited notes (`FOR UPDATE`, in the same statement that reads them).** Two accepts citing the same note in parallel: the second blocks, re-reads the promoted backlink, and raises the friendly "already promoted" error instead of silently overwriting the first entry's backlink. The single-promotion CHECK is the last backstop, never the only one.
8. **Provenance is record content, not change history.** Post-review amendment — the first cut kept the evidence chain and the protocol quote in the delta only; nothing downstream reads deltas, and the ISA lane stores both as columns. This migration already adds columns additively, so the same additive risk buys `evidence_refs`, `protocol_ref`, `drafting_engine` (model/tool — piqc-architect Law 5), and `candidate_key` on the row, next to `origin` and `source_note_ids`. The delta still records all of it plus `drafted` (the proposal as returned).
9. **Origin is a comparison the server makes, not a claim the client sends.** Post-review amendment — the first cut derived origin from a UI dirty flag that a typed-then-deleted character flipped permanently. The client now sends `drafted` (the proposal as the engine returned it) and the RPC sets PIQC_DRAFTED only when the accepted vendor_domain / observation_text / checkpoint_ref match it after trimming; the panel's "Edited" chip is the same comparison (`isCandidateEdited`), so the two never disagree and reverting an edit un-edits it. Residual hole ledgered: the server cannot prove `drafted` is what the engine proposed.
10. **Every accept is idempotent per candidate.** Post-review amendment — note locks only protect note-citing candidates; an evidence-only candidate could be recorded twice by a lost response + second click, a double click, or a second tab, and entries have no delete. The client mints a `candidate_key` per candidate; a partial UNIQUE index `(audit_id, candidate_key)` makes the repeat raise a friendly 23505, and a ref (not state) guards the double click.
11. **Stash** `piq-vendor-candidates-v1:<user_id>:<audit_id>` — scoped to the signed-in user AND the audit (a shared on-site laptop must never hand one auditor's edited candidates to the next); hydrated once the user is known; written debounced (per-keystroke serialization of every card was wasted disk); flushed on unmount; every element shape-checked on read (one bad row must not take Stage 6 down on every reload); the auditor's classification persists with its card. Candidates whose cited notes are gone or promoted are pruned only once the notes are KNOWN for this audit.
12. **The human latch is held while the notes are unknown.** Post-review amendment — with a failed notes read, every cited note rendered "(note not loaded)" while Accept stayed armed; the side-by-side note IS the review act. Draft and Accept disarm unless the notes read is `ready`, with a banner naming the Retry above. The engine holds the same line server-side (503 on an unreadable pad or register — an unreadable pad is not an empty pad).
13. **Retrieval is partitioned per corpus and seeded from the audit's own material.** Post-review amendment — one shared 4-slot pool let filed evidence crowd the protocol out (then reported the stripped citations as "couldn't be verified", blaming the wrong thing), and evidence-only runs were seeded from a hardcoded keyword bag. Now: one batched embeddings request; one `hybrid_search` per query per non-empty corpus; evidence-only runs query each filed document's title framed by the audit type and protocol title; 6 × 10 note groups cover all 60 notes sent.
14. **Zero-draftable rule.** 409 when there are zero draftable notes AND zero ready evidence documents. Notes alone or evidence alone is enough to run.
15. **No note selection in v1.** Draft reads every live, un-promoted, non-positive note (≤60, first 1,000 chars each — the pad already says so) and every included, ready evidence document. Scope selection is a follow-up if long vendor audits need it.
16. **Reuse over re-declaration.** The panel wears `PiqcMark` (the single source of PIQC's face), reuses `IsaProtocolRef` for the verified quote and the shared `formatProtocolRefWhere` locator (so the same citation reads identically in the ISA card, report, docx, clipboard, and here), and the classification picker order lives once in `labels.ts`.

## Deferral ledger

- **HMAC attestation of `drafted`** — the promote RPC compares accepted text with the proposal the client says it received; a client could fabricate both. Closing it means the edge function mints an HMAC over the normalized proposal and the RPC verifies it — needs a shared secret in the database. Partner-return item.
- **PHI in prompts and in the stash** — note bodies + evidence chunks reach the model; the pad carries the warning line, no mechanical filter (same accepted exposure as ISA and Sponsor Ask). The stash is a plaintext localStorage copy scoped to the user; it is not swept on sign-out (an app-shell `onAuthStateChange` sweep would cover this stash and ISA's together). Trigger: shared-device deployment guidance.
- **Digest staling on accept** — each accept changes the entry set: findings-report basis goes STALE_BASIS / an approved Stage-7 report diverges. By design — the honesty machinery working; the panel says so before the first accept.
- **Origin flip on post-accept edits** — a PIQC_DRAFTED entry edited later keeps the enum (the edit itself is delta-trailed). Partner-return item: origin param on `audit_mode_update_workspace_entry`. A trigger-based flip was reviewed and rejected (invisible control flow; double-logs each edit).
- **No un-promote** — entries are append-only; the promote decision is real; edit is the remedy. Trigger: auditor demand.
- **Promote RPC duplicates the create RPC's insert list** — drift risk when entry columns grow; consolidate at the partner's return.
- **Prompt injection via note/evidence text** — bounded by proposals-only + cite-or-drop + human latch; no input sanitization (ISA parity).
- **Post-accept creator-name round trip** — `promoteWorkspaceCandidate` resolves the creator name the way create/update do (one extra read per accept). Consolidate with the other wrappers if it ever shows.
- **Findings-report document preview not mounted in Stage 6** — the candidate panel is the mid-audit read. Trigger: the owner asks for the document itself mid-audit.
- **Backend debt**: +1 migration (stack now 10 unapplied) + 1 NEW edge function to deploy (`audit-observation-draft`).

## Verification

- CI green — first execution of typecheck + vitest (no local Node).
- Gates (the product): phantom note ids dropped; an item with neither a live note nor a valid passage label kills its candidate (withheld, counted); evidence-only candidates survive with passages materialized to row facts incl. content_hash; protocol_ref stripped on unknown label / paraphrase / E-label / no passages, kept on verbatim; severity/classification keys on the raw output are never passed through; caps (≤15 candidates, ≤12 items); checkpoint_ref normalized.
- observationDraftApi: POST under the session JWT; maps only what the panel consumes; a malformed candidate element is dropped; missing engine provenance → unreadable; 409/404 message passthrough; function-not-deployed → the typed message; network failure → unreachable; stash is user+audit scoped, round-trips, drops malformed elements, removes on empty; `stashCandidate` snapshots the proposal; `isCandidateEdited` is trim-insensitive and reversible.
- workspaceEntriesApi: promote forwards the provenance bundle with NO origin key; forwards classification/checkpoint/protocol quote; RPC refusal → ok:false.
- VendorCandidatePanel: Draft renders cards + shared-format passage locator + counts; empty/failed run copy; Accept sends the bundle and clears the card + stash; Edited chip derived and reversible; double click fires once; an edit during an in-flight Accept survives; refused Accept keeps the card; Dismiss clears; stash restores review state (edit + classification) unarmed while notes load; not read for another user/audit; pruned only when notes are ready; failed notes disarm Draft/Accept with a hint; preview hides every action.
- VendorNotesPad (props-driven): same contracts as slice 1, `status` union, capture hidden while loading, Retry calls onRetry, harness wired updater-only.
- AuditConductWorkspace: one `fetchVendorNotes` call per audit; pad and panel receive the same status + notes; failed read reaches both as a state; Retry refetches; switching audits shows loading, never the previous audit's notes; panel mounts between the record and the stage transition; onPromoted appends the entry to the shared store.
- End-to-end (user, deployed after apply + function deploy): jot 3 notes (1 positive) → Draft → candidates cite only the 2 non-positive notes ± evidence passages and carry no classification → edit one → Accept both (one verbatim, one edited) → entries appear NOT_YET_CLASSIFIED in the entry list, the findings-report blocks, and the digest (a previously approved findings report now shows the divergence banner — expected); the history drawer on each shows origin, source notes, evidence refs, engine → consumed notes show the Observation chip and are excluded from the next Draft → a second Accept of the same card (two tabs) is refused as already accepted → classify → Stage-8 gate clears → export contains them.
- Degraded checks pre-apply / pre-deploy: Draft banners "not deployed"; Accept banners the RPC error on the card; nothing silently succeeds.
