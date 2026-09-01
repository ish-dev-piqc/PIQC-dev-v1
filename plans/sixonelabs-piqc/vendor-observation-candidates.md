---
status: active
feature: vendor-observation-candidates
owner: sixonelabs-piqc
branch: sixonelabs-piqc/vendor-observation-candidates
target_pr: TBD
---

# Vendor-audit candidate observations (fieldwork lane, slice 2 of 3)

Slice 1 (#595) gave vendor audits a fieldwork notes pad. This slice is the heart of the lane: PIQC reads the un-promoted notes plus the filed evidence and proposes **candidate observations for the auditor to consider** — accept / edit / reject, never direct-to-document. An accepted candidate becomes a Stage-6 `audit_workspace_entry_objects` row with provenance (origin + the note ids it consumed), and from there flows into everything downstream that already exists (findings-report blocks, digest, readiness gates, export, lineage, CAPA triage). This feature ends at entry creation. Approved arc: `~/.claude/plans/cryptic-whistling-ullman.md`; slice 3 (`vendor-entry-provenance`) surfaces the origin on entry rows.

D4's binding decision is respected, not bent: the model never authors observations of record. The candidate/promote latch satisfies it — the ISA lane's shipped proposals → gates → promote pattern, copied.

## Scope

- plans/sixonelabs-piqc/vendor-observation-candidates.md
- supabase/migrations/20260909000000_audit_entry_origin_promote.sql (new)
- supabase/functions/audit-observation-draft/index.ts (new)
- supabase/functions/audit-observation-draft/gates.ts (new)
- src/types/audit/enums.ts (`WorkspaceEntryOrigin` mirror)
- src/lib/audit/observationDraftApi.ts (new)
- src/lib/audit/__tests__/observationDraftApi.test.ts (new)
- src/lib/audit/__tests__/vendorObservationGates.test.ts (new)
- src/lib/audit/workspaceEntriesApi.ts (`promoteWorkspaceCandidate`)
- src/lib/audit/__tests__/workspaceEntriesApi.test.ts
- src/components/dashboard/audit/stages/vendor/VendorCandidatePanel.tsx (new)
- src/components/dashboard/audit/stages/vendor/__tests__/VendorCandidatePanel.test.tsx (new)
- src/components/dashboard/audit/stages/vendor/VendorNotesPad.tsx (fetch lifted — becomes props-driven)
- src/components/dashboard/audit/stages/vendor/__tests__/VendorNotesPad.test.tsx
- src/components/dashboard/audit/stages/AuditConductWorkspace.tsx (one lifted notes fetch + panel mount + promoted merge)
- src/components/dashboard/audit/stages/__tests__/AuditConductWorkspace.test.tsx

## Out of scope

- The applied entry RPCs (`audit_mode_create_workspace_entry`, `audit_mode_update_workspace_entry`) — untouched; the promote RPC is an additive sibling.
- The ISA lane (`isa-finding-draft`, `IsaConductWorkspace.tsx`, ISA RPCs) — untouched; the vendor engine is a sibling, not a refactor.
- `src/lib/audit/mockWorkspaceEntries.ts` and every fixture that builds a `MockWorkspaceEntry` literal — the display shape gains `origin`/`source_note_ids` in slice 3, with its consumer (decision 6).
- src/context/** (no realtime, no cache changes).
- Export, readiness gates, findings-report engine, lineage — they consume entries already.
- Merged migrations (append-only).
- AuditConductWorkspace render blocks beyond the mounts, the lifted fetch, and the promoted merge (a parallel session is sweeping theme tokens in audit components).

## Architecture layers touched

migration, RPC, edge function, adapter (pure client modules), component, test. No context.

## Mock data plan

None. Real Supabase + real edge function, honest-degraded until applied/deployed: Generate surfaces a typed "drafting engine is not deployed yet" state (the function 404s); Accept surfaces the RPC error on the card and the candidate stays stashed. Nothing silently succeeds.

## Approved-by

- @karl-dev-piqc (src/lib/audit, src/components/dashboard/audit, src/types/audit)
- @rv61 (supabase/** — self, per CODEOWNERS)

## Decision record

1. **Direct-INSERT promote RPC, not a wrapper around the applied create RPC.** `audit_mode_promote_workspace_candidate` validates, inserts the entry with `origin` + `source_note_ids`, stamps `promoted_entry_id` on the consumed notes, and writes ONE delta carrying origin / source_note_ids / evidence_refs / protocol_ref — in one transaction. Wrapping `audit_mode_create_workspace_entry` would force a post-hoc UPDATE and a second delta; ISA's create-with-origin (20260727000000) is the direct-insert precedent. The duplicated insert list is ledgered.
2. **Lane-specific origin enum.** `workspace_entry_origin ('AUDITOR','PIQC_DRAFTED','PIQC_EDITED')` — a NEW type used in the same file is safe (the same-transaction hazard is only `ALTER TYPE … ADD VALUE`). Not reusing `isa_finding_origin` across lanes: the two lanes' provenance vocabularies evolve separately (ISA flips DRAFTED→EDITED on update; vendor defers that — ledger 3).
3. **Candidates carry NO severity and NO classification — schema-level absence.** The engine's response shape cannot express them and the gates never pass them through. Classification is the sponsor-QA-facing decision feeding CAPA triage; D4's doctrine beats the ISA severity precedent. Accepted entries default `NOT_YET_CLASSIFIED` (blocks Stage-8 sign-off via `GATE_ENTRIES_UNCLASSIFIED`; excluded from report bodies) and `provisional_impact = 'NONE'`; the auditor sets classification at accept (auditor-only select) and everything else on the entry afterwards.
4. **Gates.** Gate 1 cite-or-drop: every evidence item keeps ≥1 live note id OR ≥1 valid evidence-passage label, or the candidate is withheld (counted, disclosed). Evidence-only candidates are legitimate — the owner scoped grounding as notes + filed evidence. Gate 3 `materializeRef`: a protocol_ref must name a passage sent to the model and quote it verbatim, else stripped (counted). **No Gate 2** — there is no vendor closed-world citation map; deliberate omission, not an oversight. Passage citations are materialized to the DB row's facts (chunk/document ids, section, pages) — the model's labels never leave the function.
5. **One notes read, lifted to AuditConductWorkspace.** It feeds the pad and the panel; the pad becomes props-driven (`notes`, `loading`, `loadFailed`, `onRetry`, `onNotesChange`). The fetch-in-component disclosure from slice 1 persists — the workspace already hydrates entries the same way (:128) — and the lift removes the duplicate-read debt slice 1 ledgered.
6. **Display-shape fields deferred to slice 3.** `MockWorkspaceEntry` does not gain `origin`/`source_note_ids` here: nothing in this slice reads them, and adding required fields touches six fixture files for no behavior. The type mirror for this migration is the `WorkspaceEntryOrigin` enum plus the promote input types; the row mapping ignores the new columns until slice 3 consumes them.
7. **Promote locks the cited notes (`FOR UPDATE`).** Two accepts citing the same note in parallel: the second blocks, re-reads the promoted backlink, and raises the friendly "already promoted" error instead of silently overwriting the first entry's backlink. The single-promotion CHECK is the last backstop, never the only one (slice 1's ledger item).
8. **Protocol quote is delta-only provenance.** Entries have no protocol_refs column (that is an ISA finding column); the verified quote rides in the promote delta under `protocol_ref`. The auditor can paste it into `checkpoint_ref` on the card if they want it on the record. Ledgered with evidence-only provenance.
9. **Stash** `piq-vendor-candidates-v1:<audit_id>` with `{key, dirty}` per candidate (ISA's `piq-isa-drafts-v1` precedent). Candidates whose cited notes are gone or promoted are dropped when the notes change — an Accept on them would rightly fail the DB gate.
10. **Zero-draftable rule.** 409 when there are zero draftable notes AND zero ready evidence documents. Notes alone or evidence alone is enough to run.
11. **No note selection in v1.** Generate reads every live, un-promoted, non-positive note (≤60, first 1,000 chars each — the pad already says so) and every included, ready evidence document. Scope selection is a follow-up if long vendor audits need it.

## Deferral ledger

- **PHI in prompts** — note bodies + evidence chunks reach the model; the pad carries the warning line, no mechanical filter (same accepted exposure as ISA and Sponsor Ask).
- **Digest staling on accept** — each accept changes the entry set: findings-report basis goes STALE_BASIS / an approved Stage-7 report diverges. By design — the honesty machinery working; the panel says so before the first accept.
- **Origin flip on post-accept edits** — a PIQC_DRAFTED entry edited later keeps the enum (the edit itself is delta-trailed). Partner-return item: origin param on `audit_mode_update_workspace_entry`. A trigger-based flip was reviewed and rejected (invisible control flow; double-logs each edit).
- **No un-promote** — entries are append-only; the promote decision is real; edit is the remedy. Trigger: auditor demand.
- **Evidence-passage and protocol-quote provenance is delta-only** (no first-class entry columns). Trigger: lineage/trace demand.
- **Promote RPC duplicates the create RPC's insert list** — drift risk when entry columns grow; consolidate at the partner's return.
- **Prompt injection via note/evidence text** — bounded by proposals-only + cite-or-drop + human latch; no input sanitization (ISA parity).
- **Retrieval grouping** — notes are embedded in creation-order groups of 8 (≤6 groups); ISA groups by auditor domain, which vendor notes don't carry. Trigger: irrelevant passages on multi-topic audits.
- **Findings-report document preview not mounted in Stage 6** — the candidate panel is the mid-audit read. Trigger: the owner asks for the document itself mid-audit.
- **Backend debt**: +1 migration (stack now 10 unapplied) + 1 NEW edge function to deploy (`audit-observation-draft`).

## Verification

- CI green — first execution of typecheck + vitest (no local Node).
- Gates (the product): phantom note ids dropped; an item with neither a live note nor a valid passage label kills its candidate (withheld, counted); evidence-only candidates survive; passage labels materialize to row facts; protocol_ref stripped on unknown label / paraphrase / oversize, kept on verbatim; severity/classification keys on the raw output are never passed through; caps (≤15 candidates, ≤12 items).
- observationDraftApi: POST under the session JWT; 409 message passthrough; function-not-deployed → the typed "not deployed" message; network failure → Result error; stash round-trip, corrupt stash → null, empty → removed.
- workspaceEntriesApi: promote maps args (origin from dirty, distinct note ids, evidence, protocol_ref, classification default); RPC error → ok:false.
- VendorCandidatePanel: Generate renders cards + withheld/stripped line; empty result copy; engine failure copy keeps prior cards; edit marks dirty → Accept sends PIQC_EDITED, verbatim → PIQC_DRAFTED; Accept success removes the card and calls onPromoted with the entry + consumed note ids; failed Accept keeps the card with the reason; Dismiss removes; stash restored on mount and pruned when a cited note is promoted; preview (hasReached=false) hides Generate/Accept and keeps the cards readable.
- VendorNotesPad (props-driven): same contracts as slice 1, with Retry calling onRetry and mutations routed through onNotesChange.
- AuditConductWorkspace: one `fetchVendorNotes` call per audit; pad receives the notes; panel mounts between the entry list and the stage transition; onPromoted appends the entry to the shared store and marks the consumed notes promoted.
- End-to-end (user, deployed after apply + function deploy): jot 3 notes (1 positive) → Generate → candidates cite only the 2 non-positive notes ± evidence passages and carry no classification → edit one → Accept both (one verbatim, one edited) → entries appear NOT_YET_CLASSIFIED in the entry list, the findings-report blocks, and the digest (a previously approved findings report now shows the divergence banner — expected) → consumed notes show the Observation chip and are excluded from the next Generate → classify → Stage-8 gate clears → export contains them.
- Degraded checks pre-apply / pre-deploy: Generate banners "not deployed"; Accept banners the RPC error on the card; nothing silently succeeds.
