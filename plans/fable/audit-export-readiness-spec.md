# Audit export-readiness integrity — full-stack spec (Fable design pass)

**Status:** build-ready spec — Fable designed 2026-07-20; Opus builds. Supersedes the "Theme A" framing in `plans/fable/main-quality-audit-2026-07.md` (findings A1/A2/A3 + the walk-back/sign-off hole found in this pass).

**Doctrine (founder ruling, 2026-07-20):** an audit report is a GxP deliverable, but **PIQC is not generating a GxP deliverable** — it ships a close-to-final *draft* that breaks the auditor's writer's block. In-PIQC "approval" is a **readiness-to-export latch at the draft boundary**, never an attestation; the user's QMS owns signatures. (The export filenames already say it: `*_draft.md`, `*_draft.docx`.) The latch's one job: **what exports = what the human marked ready.** Every gate below exists to keep that sentence true; none performs a signature ceremony.

---

## 1 · The verified hole map (all at `origin/main` = `b0cd64e`, latest definitions)

| # | Hole | Evidence |
|---|---|---|
| H1 | All **6** approve RPCs stamp blind — `UPDATE … SET approval_status='APPROVED', approved_by, approved_at WHERE id = p_id`, no guard. Stamp attests to whatever the row holds at commit, not what the reviewer saw. | `20260430150000` (questionnaire), `20260430160000` (risk summary), `20260430170000` (letter, agenda, checklist), `20260501010000` (report) |
| H2 | Advance gate list stops at stage 6 — `FINAL_REVIEW_EXPORT` transition has **no server gate**; backward moves ungated (by design) and demote nothing. | `20260721000100_audit_mode_lock_current_stage_column.sql` (latest advance RPC: gates exist only for `PRE_AUDIT_DRAFTING`, `AUDIT_CONDUCT`) |
| H3 | `final_sign_off_report` checks only its own idempotency — **signs off a `DRAFT` report**. | `20260501010000` |
| H4 | **Sign-off latch never clears.** `upsert_report_draft` demotes `approval_status`/`approved_*` on text change but not `final_signed_off_*`. Walk back from stage 8 → edit → return: checklist shows red but export buttons check only `finalSignedOff` → **export enabled on a demoted draft**. | upsert: `20260501010000`; export gating: `FinalReviewExportWorkspace.tsx:117,366,375` |
| H5 | Client: Approve not disabled during LLM refine (Edit is); refine write-back's pre-write refetch checks `!current` but never `approval_status` → refine can clobber/demote right after a human marks ready. No in-flight disable on any approve button. | `ReportDraftingWorkspace.tsx:970` (approve `disabled={unclassifiedCount>0}` only), `:666` (Edit correctly gated), `:177-193` (refetch guard) |
| H6 | Report readiness covers only 2 text columns. The draft the human reviews = exec summary + conclusions **+ the classified entry set** (`audit_workspace_entry_objects.provisional_classification`), but entry edits touch nothing on `report_draft_objects` → post-ready entry changes are invisible to every gate. | `ReportDraftingWorkspace.tsx:270-285` |

Working parts to preserve (don't rebuild): upsert demote-on-change for `approved_*` (D-010's half that works), delta-log on every transition, the lead-auditor ownership + fail-closed ISA logic in the advance RPC, the stage-8 client checklist UI.

## 2 · The mechanism — "assert what you saw, seal what you marked ready"

One mechanism, applied at three layers. All hashing is **server-side**; the client never computes a hash.

**(a) CAS on every approve (H1).** Each approve RPC gains `p_expected_updated_at timestamptz DEFAULT NULL`:
- `NULL` → reject, hint `MISSING_EXPECTED_VERSION` (fail-closed; a stale deployed bundle recovers by refresh).
- Mismatch vs row's `updated_at` → reject, hint `STALE_CONTENT`.
- Match → stamp as today. Uniform across all 6 (questionnaire, risk summary, letter, agenda, checklist, report) — one mental model.

**(b) Seal + verify on the report path (H2, H3, H6).** On successful report approve, the RPC computes and stores `readiness_fingerprint = md5(exec_summary || conclusions || entry-set digest)` where the entry-set digest is `md5(string_agg(<id + classification + every human-visible content column>, ORDER BY id))` over the audit's `audit_workspace_entry_objects`. Then:
- **Advance → `FINAL_REVIEW_EXPORT` gate:** report `APPROVED` (`GATE_REPORT_NOT_APPROVED`) ∧ zero `NOT_YET_CLASSIFIED` entries (`GATE_ENTRIES_UNCLASSIFIED`) ∧ recomputed fingerprint = stored (`GATE_REPORT_DIVERGED`).
- **`final_sign_off_report` gate:** same three checks before stamping.
- Fingerprint column on `report_draft_objects` **only** — letter/agenda/checklist's boundary (stage-5 advance) already gates on `APPROVED`, and CAS keeps those stamps honest; no fingerprint needed there. Leaner.

**(c) Boundary hygiene (H4, H5).**
- `upsert_report_draft` on content change also clears `final_signed_off_at/by` (symmetric with `approved_*`).
- New tiny RPC `audit_mode_verify_export_readiness(p_audit_id)` → `{ready boolean, reasons text[]}` (recompute the three checks). Export buttons call it, then refetch + generate on `ready`; on `¬ready` refresh state so the checklist shows why. Closes the client-side-blob loophole without building server-side doc generation.
- Client: Approve disabled during `llmRefining || llmConclusionsRefining` + while in flight; refine write-back refetch guard adds `current.approval_status === 'DRAFT'` (skip write otherwise — the human's latch wins over the agent, per draft-boundary doctrine); PreAudit approve handlers get per-deliverable in-flight state + thread `updated_at` from the row they render.

**Recovery UX (collapse-the-load, invitational not alarm):** on `STALE_CONTENT` / `GATE_REPORT_DIVERGED`, auto-refetch and show neutral copy — "This draft changed since you last reviewed it — refreshed for another look." `FileText`/neutral palette, never `AlertTriangle`/amber (per the agentic-UX icon vocabulary).

## 3 · Contracts

**Migration (one file, append-only), in order:**
1. `ALTER TABLE report_draft_objects ADD COLUMN readiness_fingerprint text;`
2. `DROP FUNCTION` old signatures, then `CREATE OR REPLACE` the 6 approve RPCs with the CAS param. **Must DROP first** — `CREATE OR REPLACE` with a new param list creates a PostgREST *overload*, leaving the blind-stamp callable forever.
3. Replace `audit_mode_advance_audit_stage` (add the `FINAL_REVIEW_EXPORT` gate; body otherwise byte-identical to `20260721000100` — preserve every existing hint/ERRCODE so the shipped `advanceStageError` UI keeps working).
4. Replace `audit_mode_final_sign_off_report` (gates) and `audit_mode_upsert_report_draft` (clear `final_signed_off_*`).
5. Add `audit_mode_verify_export_readiness`.
Timestamp: **after** the current max on main (`20260728000000` — the ISA arc is future-dated; use `2026073*`).

**API layer (stay file-local, don't sweep the S2 fracture here):** upgrade the 6 approve fns + `finalSignOffReport` from `T | null` (which swallows PostgREST hints in a `console.error`) to the hint-carrying shape already in `auditApi.ts` (`{ok, data?, errorMessage?, errorHint?}`), threading `expectedUpdatedAt`. `advanceAuditStage` needs only new hint values documented.

**Types (CI: migration ⇒ types mirror):** `readiness_fingerprint` on the report row type; hint string unions extended (`MISSING_EXPECTED_VERSION`, `STALE_CONTENT`, `GATE_REPORT_NOT_APPROVED`, `GATE_ENTRIES_UNCLASSIFIED`, `GATE_REPORT_DIVERGED`).

**Components:** `ReportDraftingWorkspace` (disable matrix + threading + write-back guard), `PreAuditDraftingWorkspace` (threading + in-flight), `FinalReviewExportWorkspace` (verify-before-export; export disabled unless `allPassed && finalSignedOff`), `QuestionnaireReviewWorkspace` + risk-summary approve caller (threading only).

**Tests:** extend `ReportDraftingWorkspace.test.tsx` (approve disabled during refine; stale-approve recovery path), API-layer unit tests for hint mapping, PR-body SQL smoke block (stale CAS → `STALE_CONTENT`; advance with unclassified entry → gate; sign-off on `DRAFT` → gate; edit-after-sign-off clears latch).

## 4 · Founder-choice points (defaults set, veto in review)

1. **NULL CAS = reject** (fail-closed) — default. Alternative: one permissive transition release. Under the drafting doctrine the stakes are UX not compliance, but latch honesty *is* the product promise; a refresh is cheap. Default stands unless vetoed.
2. **Button copy** — enum stays `APPROVED` (no churn), but the doctrine suggests the UI say what it means: "Approve report" → **"Mark ready to export"** (+ checklist header "Readiness"). One-line changes, same PR. Default: do it.

## 5 · Intentionally not built (decision debt, named)

- **Entry edits don't demote report readiness** — divergence is *detected* at advance/sign-off/export (fingerprint), not *demoted* at entry-save. Same user outcome, far smaller blast radius than wiring every entry RPC to `report_draft_objects`. Revisit only if users report confusing late failures.
- **No letter/agenda/checklist fingerprints** (CAS suffices at their boundary). Trigger to revisit: a per-deliverable "send to vendor" export action.
- **No pgTAP** — RPC guards verified by SQL smoke + component tests (S4 test-investment stays open).
- **No S2 Result-shape sweep** — separate lane.

## 6 · Opus build checklist

1. Branch off fresh `origin/main`; plan MD `plans/sixonelabs-piqc/audit-export-readiness.md` (Scope = the files above; Approved-by: Karl — audit components/lib, Roger — migration; this spec referenced).
2. Migration exactly per §3 order; verify each object table's `updated_at` touch trigger exists before relying on it (confirmed for `report_draft_objects`; verify the other five at build time).
3. API + types + components per §3; match each file's local conventions.
4. `tsc -p tsconfig.app.json` + `vitest run` green; JSX bracket re-read after multi-element edits (PR #59 lesson).
5. PR body: first line = bare plan path; SQL smoke block; deploy note — **migration `supabase db push` (dev team)**; no edge-function deploy.
