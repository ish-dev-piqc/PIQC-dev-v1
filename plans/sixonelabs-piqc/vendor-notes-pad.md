---
status: active
feature: vendor-notes-pad
owner: sixonelabs-piqc
branch: sixonelabs-piqc/vendor-notes-pad
target_pr: TBD
---

# Vendor-audit notes pad (fieldwork lane, slice 1 of 3)

Product-owner Q&A (2026-09-01, auditor's seat) exposed a missing capability upstream of every export question: during a vendor audit the auditor captures live notes, but vendor audits have **no notes pad** — site audits (ISA) do, and their pad feeds AI-drafted findings. Stage-6 observations are 100% hand-typed. This slice gives vendor audits the pad; slice 2 (`vendor-observation-candidates`) adds the drafting engine + candidate review; slice 3 surfaces provenance. Approved arc: `~/.claude/plans/cryptic-whistling-ullman.md`.

Standalone value: a real place to capture fieldwork notes during the audit, with the audit trail (deltas) the ISA pad already has — notes are working papers, not findings, and nothing here touches the observation record.

## Scope

- plans/sixonelabs-piqc/vendor-notes-pad.md
- supabase/migrations/20260908000000_audit_vendor_notes.sql (new)
- src/lib/audit/vendorNotesApi.ts (new)
- src/lib/audit/__tests__/vendorNotesApi.test.ts (new)
- src/lib/audit/__tests__/isaNotesApi.test.ts (fixture gains the new column — type-forced)
- src/lib/audit/__tests__/isaInsights.test.ts (same type-forced fixture line)
- src/types/audit/objects.ts
- src/components/dashboard/audit/stages/vendor/VendorNotesPad.tsx (new)
- src/components/dashboard/audit/stages/vendor/__tests__/VendorNotesPad.test.tsx (new)
- src/components/dashboard/audit/stages/AuditConductWorkspace.tsx (mount only)
- src/components/dashboard/audit/stages/__tests__/AuditConductWorkspace.test.tsx

## Out of scope

- The ISA note RPCs (`audit_mode_*_isa_note`, applied in prod) and `IsaConductWorkspace.tsx` — untouched; vendor RPCs are additive siblings.
- The drafting engine, candidate review, promote RPC, entry `origin` column — slice 2.
- Any edit to `audit_workspace_entry_objects` or its RPCs.
- src/context/** (no realtime, no cache changes — the pad owns its own notes state in this slice; slice 2 lifts the fetch).
- Merged migrations (append-only).
- AuditConductWorkspace render blocks beyond the single mount (a parallel session is sweeping theme tokens in audit components).

## Architecture layers touched

migration, RPC, adapter (pure client module), component, test. No context.

## Mock data plan

None. Real Supabase, honest-degraded: until the migration is applied in prod, note reads succeed (RLS select — no RPC involved) and every save/edit/delete surfaces the RPC error inline with the text preserved. Nothing silently succeeds.

## Approved-by

- @karl-dev-piqc (src/lib/audit, src/components/dashboard/audit, src/types/audit)
- @rv61 (supabase/** — self, per CODEOWNERS)

## Decision record

1. **Reuse `audit_note_objects`, add vendor RPCs.** The table has no stage/workflow constraint, but the ISA RPCs raise on non-ISA workflows and `promoted_finding_id` FKs to `isa_finding_objects`. Additive-only rule (backend partner away) → new `audit_mode_{create,update,delete}_vendor_note` with the inverted guard `workflow_type = 'VENDOR_AUDIT'`, plus additive `promoted_entry_id UUID REFERENCES audit_workspace_entry_objects(id)` with a single-promotion CHECK (a note promotes into exactly one lane's record). The ISA RPCs are not replaced.
2. **No domain at capture.** Vendor notes carry `body` + `is_positive` only (`isa_domain` stays NULL). Forcing mid-fieldwork categorization is ISA structure the vendor lane doesn't have; slice 2's engine proposes free-text `vendor_domain` on candidates instead.
3. **Positive notes are excluded from drafting** (slice 2), same filter as ISA — the toggle exists now so the exclusion is meaningful later.
4. **A promoted note refuses BOTH edit and delete** (server-side, either backlink set; the pad hides both affordances). Post-review amendment — the first cut mirrored ISA (delete refused, edit allowed), and two independent finders called edit the more damaging op: the accepted observation carries its own copy of the text, so from promotion on the note's job is to be the unchanged evidence it was accepted from. Stricter than ISA on purpose.
4a. **Update and delete lock the live row and re-qualify the write** (`SELECT … FOR UPDATE` + `WHERE deleted_at IS NULL` + `FOUND` check) — the first cut had moved ISA's liveness guard into an unlocked pre-read and left the UPDATE unqualified, so a double-fired delete would have overwritten the tombstone and written two contradictory deltas. All three RPCs also carry the lane guard (VENDOR_AUDIT), so the vendor trio can't act on ISA notes.
4b. **No hard length cap.** The first cut's `maxLength={1000}` claimed to mirror ISA — it didn't (the ISA pad has no cap; only its drafting engine's *prompt copy* truncates at 1,000). A browser cap silently discards pasted fieldwork. The pad now stores everything and, past 1,000 chars, says out loud that drafting reads the first 1,000 — the full note is kept.
5. **Component pattern, not code, is copied from IsaConductWorkspace** (a 1,217-line no-props file with structural ISA coupling — nothing extractable). `VendorNotesPad` is a self-contained sibling under `stages/vendor/` so AuditConductWorkspace's diff is one mount.
6. **PHI/privacy line on the pad**: no participant identifiers or personnel names; note text is sent to PIQC when drafting observations (slice 2). Honest about where the text goes before the feature that sends it exists.

## Deferral ledger

- **The pad fetches from a component** (CLAUDE.md non-negotiable 3 says "never fetch in components"; the mechanical CI check only catches direct supabase imports). Disclosed, not hidden: it follows the ISA pad's precedent, the pad owns audit-scoped working-paper state with no cross-surface consumer yet, and slice 2 lifts the fetch into the workspace to feed the candidate panel. Reviewer signs off on the deviation explicitly.
- `fetchVendorNotes` is a byte-identical copy of `fetchIsaNotes` bar the log prefix (second copy; consolidate to a shared `fetchAuditNotes` when slice 2 lifts the read, or at the third caller).
- `noteTimestamp` is a second, differently-formatted timestamp helper (ISA's is file-local too). Pinned locale here; consolidate into `dateWindow.ts` when either is next touched.
- Mutations in flight across an audit switch resolve against the unmounted instance (no-op setState; the note lands server-side and appears on return). ISA parity; a mounted-ref guard is the fix if it ever confuses an auditor.
- `text-[#0F172A]` dark-ink-on-brand label copies the house idiom; no inverse `fg-*` token exists. The theme-sweep session owns that decision.
- The new single-promotion CHECK can only be tripped by an ISA finding citing a note that is ALREADY promoted into a vendor entry — impossible today (ISA notes live on ISA audits). Slice 2's promote RPC must ship the entry-lane equivalent of `audit_mode_validate_isa_evidence` (a friendly "already promoted" error) so the CHECK is never the only backstop.
- `audit_mode_delete_isa_note` (applied) checks only `promoted_finding_id`; unreachable for vendor notes from the ISA UI. Partner-return item.
- No HistoryDrawer for notes (deltas exist, unrendered — ISA parity).
- Prod debt: +1 migration on the 8-deep unapplied stack (D1/D3/D4/D6 pairs). Surface is honest-degraded until applied.

## Verification

- CI green — first execution of typecheck + vitest (no local Node).
- Unit: vendorNotesApi routes to the vendor RPCs with the right args/defaults, Result error mapping, select filters soft-deleted rows; VendorNotesPad — capture (Enter adds, Shift+Enter newline, 1,000-char cap, positive toggle, clears on success, focus returns), load-failure banner with retry (absence ≠ failure), save-failure banner preserving text, inline edit + two-tap delete, promoted chip, `hasReached=false` hides every mutation surface; AuditConductWorkspace mounts the pad and the preview guard still holds.
- End-to-end (user, deployed after apply): open a vendor audit at Stage 6 → pad renders above the observation form → add 3 notes (1 positive) → edit one → delete one → HistoryDrawer-less but deltas visible via the audit history surface → preview from Stage 5 shows notes read-only.
