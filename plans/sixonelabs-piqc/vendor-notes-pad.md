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
4. **Delete refuses promoted notes** (either FK set) — a note cited by an observation of record must stay resolvable for the trail (ISA's 20260724000100 guard, mirrored).
5. **Component pattern, not code, is copied from IsaConductWorkspace** (a 1,217-line no-props file with structural ISA coupling — nothing extractable). `VendorNotesPad` is a self-contained sibling under `stages/vendor/` so AuditConductWorkspace's diff is one mount.
6. **PHI/privacy line on the pad**: no participant identifiers or personnel names; note text is sent to PIQC when drafting observations (slice 2). Honest about where the text goes before the feature that sends it exists.

## Deferral ledger

- `fetchVendorNotes` duplicates `fetchIsaNotes`'s 12-line RLS read (second copy; consolidate to a shared `fetchAuditNotes` at the third caller).
- No HistoryDrawer for notes (deltas exist, unrendered — ISA parity).
- Prod debt: +1 migration on the 8-deep unapplied stack (D1/D3/D4/D6 pairs). Surface is honest-degraded until applied.

## Verification

- CI green — first execution of typecheck + vitest (no local Node).
- Unit: vendorNotesApi routes to the vendor RPCs with the right args/defaults, Result error mapping, select filters soft-deleted rows; VendorNotesPad — capture (Enter adds, Shift+Enter newline, 1,000-char cap, positive toggle, clears on success, focus returns), load-failure banner with retry (absence ≠ failure), save-failure banner preserving text, inline edit + two-tap delete, promoted chip, `hasReached=false` hides every mutation surface; AuditConductWorkspace mounts the pad and the preview guard still holds.
- End-to-end (user, deployed after apply): open a vendor audit at Stage 6 → pad renders above the observation form → add 3 notes (1 positive) → edit one → delete one → HistoryDrawer-less but deltas visible via the audit history surface → preview from Stage 5 shows notes read-only.
