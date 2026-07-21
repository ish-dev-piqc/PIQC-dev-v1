---
owner: sixonelabs-piqc
feature: Whole-codebase quality hunt — Fable cross-surface audit
status: reference
started: 2026-07-19
target_pr:
---

# The Main-Codebase Quality Hunt — Fable audit report

**Run:** `FA-6b6b9d7-full-2026-07-19` · base `origin/main` @ `6b6b9d7` · scope: whole repo (~180k auditable lines)
**Baseline:** `tsc --noEmit` clean · vitest **1568/1568 green** before any finding was filed.
**Method:** deterministic scope pre-compute → 10 pre-seeded findings blind-verified → risk-tiered surface passes (db, orgs, audit-stages, edge deep; site, shared, deliverables standard; sotr/sponsor/audit-lib macro) → **every blocker/high/medium blind-verified by an adversarial agent that never saw the reviewer's rationale** → Fable cross-surface synthesis + adjudication.

---

> **Remediation status — added 2026-07-20 on commit.** This is the forensic snapshot of the audit as run on 2026-07-19; every finding below is worded as first discovered. Since then the blocker and **4 of the 8 highs** are fixed and merged to `main`, plus **2 medium** hardening items:
> - 🔴 **B1** blocker — visit-templates RLS → PR #525
> - 🟠 **D1** billing-webhook — stripe `verify_jwt` → PR #527
> - 🟠 **A1 / A2 / A3** audit-approval gates (+ **H4** sign-off latch, found during the fix design) → PR #529
> - 🟡 **D2-2 / EDG-R1-3** seed-fn lockdown + timing-safe webhook secret → PR #531
> - ⏸ **MAC-1** ISA stage-readout — left on the owner's documented B6 deferral, not a regression.
>
> **Still open:** the 3 ingest highs (B-series) and the chat 100-cap high. **Deploy debt:** these fixes are code-on-`main` but unapplied — one `supabase db push` (migrations 20260729 / 30 / 31) + `functions deploy reducto-webhook` closes it; until then the B1 blocker is still live in prod.

## Verdict

**Main is fundamentally sound, with one must-fix-now.** The engineering discipline held where it was mechanically gated: zero `any`/`@ts-ignore`, pure adapters, clean mode-isolation among the policed trees, a green test suite, and — the finding that matters most for a clinical product — **the cite-or-drop provenance spine holds** (LLM output is always gated, no cross-protocol data leaks, truncation can't fabricate a citation). The two scariest recon alarms (stale-closure bugs in the giant chat component; PHI leaking through console logs) were **false**, killed under verification.

But the hunt found **one blocker** — a table holding every customer's extracted Schedule of Assessments is missing row-level security entirely — and **eight high-severity defects** that cluster into four nameable themes, not eight unrelated bugs. The through-line: *the mechanical gates are excellent at what they check, and the product has grown past what they check.* The blocker, the approval races, and the ingest concurrency gaps all live in exactly the seams no single-diff, single-surface review was ever pointed at.

**Confidence in this report:** blind verification refuted or downgraded **7 of the ~30 candidates** it examined — including 5 that were real-in-a-mid-history-migration but already fixed by a later one. Every finding below survived an adversary trying to kill it. The refuted set is documented in full (§Non-findings) so the discipline is auditable.

---

## The numbers

| Severity | Count | |
|---|---|---|
| 🔴 Blocker | 1 | cross-tenant data exposure |
| 🟠 High | 8 | 3 audit-approval · 3 ingest · 1 chat-scale · 1 billing-webhook |
| 🟡 Medium | ~18 | governance seams + contained correctness bugs |
| ⚪ Low | 3 | hygiene |
| ✅ Refuted / downgraded | 7 | verification working as designed |

---

## 🔴 BLOCKER

### B1 · `protocol_visit_templates` has no row-level security — cross-tenant read/write of every customer's Schedule of Assessments
**`supabase/migrations/20260507000000_protocol_visit_templates.sql`** · db · confirmed deterministically (grep of all 175 migrations: zero `ENABLE ROW LEVEL SECURITY`, zero `CREATE POLICY`, zero `GRANT` referencing this table).

Supabase serves every public-schema table through the PostgREST API by default; the entire codebase's security model presumes this and enables RLS on all sibling tables (the later `protocol_visit_coverage` migration even comments that it "mirrors the other visit tables" — but this one never got the mirror). The table holds the parsed visit schedule — visit names, study days, windows, procedures — that `materialize_protocol_visits` and `visit_execution_get_workspace` both trust as source-of-truth for the Site Mode calendar and the VEW workspace.

**Failure:** any authenticated account (any org, including a zero-protocol fresh signup) can `GET /rest/v1/protocol_visit_templates?select=*` and read every customer's extracted SoA, or `INSERT/UPDATE/DELETE` to corrupt another tenant's visit schedule.

**Fix (one append-only migration, ~4 lines):** `ENABLE ROW LEVEL SECURITY` + a `FOR ALL … USING (user_can_access_protocol(auth.uid(), protocol_id))` policy — copy `protocol_visit_coverage`'s exactly. **Owner: Roger.** This is the one finding that should not wait for a sprint.

---

## 🟠 HIGH — grouped by theme

### Theme A · The audit approval gate ignores concurrent state — client *and* server (3 highs, one root cause)

All three share one shape: **an approval is stamped without re-checking that the thing being approved is still what was reviewed.** The `_vew_fingerprint` compare-and-swap machinery exists elsewhere in the codebase for re-ingest dedup but was never generalized to human approvals. One owner (Karl), likely one coherent fix (gate approve on a content hash/version + a fail-closed server check).

- **A1 · Stage-7 → Stage-8 advance is ungated after approval.** `ReportDraftingWorkspace.tsx:980` — "Advance to Final review" checks only `!approved`, never re-checks `unclassifiedCount`; the server RPC `audit_mode_advance_audit_stage` has **no gate at all** for the `FINAL_REVIEW_EXPORT` transition, and Stage-8 sign-off is also ungated server-side. Approve with zero unclassified entries → walk back to the still-unlocked Stage 6 → add an entry → the approved report advances to export **diverged from what was signed off**. *(Verifier confirmed the server RPC is genuinely ungated — this is not merely a client UX gap.)*

- **A2 · Pre-audit approve RPCs write a false attestation to the database.** `audit_mode_approve_confirmation_letter/agenda/checklist` (migration `20260430170000`) do an unconditional `UPDATE … SET approval_status='APPROVED', approved_by, approved_at WHERE id` — no content or version guard. Combined with the client's missing in-flight disable (`PreAuditDraftingWorkspace.tsx`, stale `bundle` closure), an approve-then-revise race persists a **real `approved_by`/`approved_at` on unreviewed content in the DB** — not a UI glitch. Violates the stated D-010 invariant ("editing an approved deliverable demotes it to Draft").

- **A3 · "Approve report" isn't gated on the auto-firing LLM refine.** `ReportDraftingWorkspace.tsx:970` — the *Edit* buttons are correctly disabled during `llmRefining`, but *Approve* is disabled only by `unclassifiedCount`. The LLM refine auto-fires on mount; its write-back's pre-write refetch checks only for null, never `approval_status`, and there's no AbortController. Approve during the ~3–8s refine → unreviewed LLM-generated executive summary lands under an APPROVED banner (or the report silently reverts to DRAFT under an auditor who already moved on).

### Theme B · The ingest pipeline — the provenance root — has no concurrency control and no handler tests (3 highs)

`_shared/ingestPipeline.ts` (3,072 lines, the largest file in the repo) writes the provenance-bearing rows every downstream surface cites as ground truth. It is also the least-tested (zero handler tests) and most-concurrent code in the system. Blast radius of an ingest bug = every surface.

- **B1 · No atomic claim before the slow completion.** Three callers (`reducto-webhook`, the `ingest-recover` cron firing every 5 min, and `ingest-status` — the last carrying a false in-code comment claiming it's safe) can each run `processIngestCompletion` for the same document. `chunks` has **no** `UNIQUE(document_id, chunk_index)` (confirmed), so concurrent runs double-write the RAG corpus; and the outer catch unconditionally stamps `status='failed'`, so a losing race reverts the winner's `ready`. The 10-minute recover clock has no heartbeat, so it fires on legitimately long parses.

- **B2 · Documents get stuck `ready` with a null protocol, unrecoverably.** `status='ready'` is set *before* protocol/visit-template creation; a step-5 failure (an ordinary RLS or uniqueness error on the protocols insert) is swallowed with a bare `console.warn`, leaving `protocol_id` null with **zero exception**. The pipeline's only `status='failed'` writer is then unreachable, and all three ingest entry points refuse to reprocess a `ready` doc — so re-uploading the same PDF short-circuits on the content hash. The function returns `ok:true`. No in-pipeline recovery exists.

- **B3 · Cross-reference snippets are stored as verbatim protocol citations with no verbatim check.** `cross_references.snippet` comes from freeform LLM output; the only "be verbatim" enforcement is prose in the prompt. Nothing checks it against the source chunk — even though the extract call *enables* Reducto's grounded citation object and simply never reads it for this field. It renders in `TraceabilityDrawer.tsx:163` as a quote-styled citation under "From the protocol documents." This is the one place the product's own litmus — *cite the uploaded protocol's own words* — is not enforced in code. Held to a weaker standard than the (properly validated) `source_quote` path.

### Theme C · Chat doesn't scale past 100 messages, and fails silently when it matters (1 high)

- **C1 · Hard 100-message-per-channel cap with no load-older path anywhere** (three independent callers, confirmed). Once a message ages out of the newest 100, "jump to source" (from the Decisions panel), thread-open, and search/mention deep-links all **silently no-op** — `getElementById` + `if (el)`, no fallback fetch, no toast. A promoted decision whose source message has aged out becomes unreachable *even while that decision is still awaiting a required user's acknowledgment.* On an active channel (~20 msgs/day → ~7k/year) this is months, not years, away.

### Theme D · A billing webhook the platform gateway blocks (1 high)

- **D1 · `stripe-webhook` inherits `verify_jwt=true`.** `config.toml` gives six functions `verify_jwt=false` but has **no entry for `stripe-webhook`** (confirmed). Stripe can only present its `Stripe-Signature` header — it structurally cannot mint a Supabase JWT — so the gateway 401s every delivery before the handler's (correct) signature check runs. Either subscription/cancellation/pilot-expiry sync is **silently dead in production right now** (a customer who cancels keeps full access), or it depends on a dashboard override that the next `deploy`-from-config silently drops. `contact` has the same gap (medium — safe only if always called via the SDK's anon key).

---

## 🟡 MEDIUM — the cross-surface seams (the Fable-taste layer)

These are the findings nothing else could surface: none is visible from a single diff or a single surface. Read together, they tell one story — *the product outgrew its guardrails.*

### S1 · Mode-isolation is Swiss cheese with a good grade
CI polices cross-mode imports for exactly three directories: `{site, audit, sotr}`. The hunt found **four live ways around it**, every one postdating the gate:
- `src/lib/crossMode/auditSignals.ts` — a shim whose own header comment explains how it dodges the linter regex, re-exporting audit APIs into Site Mode's Today tab (**L2**);
- `src/hooks/` — the entire tree is unscanned by both CI *and* the local `piqc-review` skill; five hooks run Supabase realtime outside `src/context/`, with 2–3 undeduped `chat_mentions` channels per user the team accepted in writing (**L3**);
- `src/lib/visit-execution/` — not in the enumeration, so it imports from `site/` and `sotr/` with nothing watching, in either direction (**L9**);
- `sponsor` / `deliverables` / `cra` — never covered by the gate at all.

The doctrine reads as enforced; the enforcement surface now has more holes than coverage. **Fix:** widen the gate's directory list to every mode tree + `hooks/`, delete the `crossMode` shim (use the sanctioned `ALLOWED_CROSS_MODE` route), and decide in writing whether `hooks/` is an allowed realtime layer.

### S2 · The `Result<T>` doctrine has fractured into four different error shapes
CLAUDE.md says API layers return `Result<T>`. Across surfaces it's actually four conventions, each internally ~consistent, collectively incoherent: orgs mostly returns `Result` (but mixes throw-in-try, direct `err()`, and a bare `boolean`, plus **uncaught adapter throws** from 8 functions on enum drift — **L5**); four audit APIs return `T | null` with `console.error` (`capaApi` *documents* this as intentional); **`auditApi` — the file CLAUDE.md holds up as the canonical `Result<T>` reference — actually uses a custom `{ok, errorMessage, errorHint}` shape**; sotr genuinely throws typed errors. Not a bug — a reviewability tax: a contractor moving between surfaces can't carry one mental model. **Fix:** pick one shape, update CLAUDE.md's reference to match reality, add a CI check for `throw` in `*Api.ts`.

### S3 · The live schema is unknowable without replaying 175 migrations in order
`visit_execution_get_workspace` is `CREATE OR REPLACE`'d **eight times** across eight migrations. Five reviewer candidates in this very hunt were **refuted** because a reviewer read a mid-history definition and the fix landed later. That's the same trap a new contractor falls into — and it's why the **migration timestamp inversions (D1)** matter: 18 migrations have back-dated filenames, so `supabase db reset` (fresh contractor, CI, disaster recovery) replays in an order that no longer matches production. All 18 are benign *today* by luck (content-disjoint or alphabetically-safe), but one slot already has a real hard dependency safe only by alphabetical tiebreak. **Fix:** a CI check enforcing merge-monotonic migration timestamps (forward-looking; no renumbering needed).

### S4 · Test coverage is inverted relative to blast radius
The well-tested code (deliverable selection engines, adapters, pure models) is the *safest* — pure functions, no concurrency. The untested code is the *highest*-blast-radius: all 19 edge handlers (service-role creds, the Stripe webhook, the provenance root), the 1,920-line `ChatTab`, 11 of 16 context providers. The CI "needs a test" gate fires only on `src/lib/*Api.ts`/`*Adapter.ts` — exactly the already-safe layer — so it *reinforces* the inversion (**L10**). **Fix:** extend the gate to edge handlers and the highest-traffic components; the five highest-leverage test investments are the Stripe webhook, `processIngestCompletion`, the audit approve/advance RPCs, `ChatTab` message-window logic, and `AuthContext`.

### Other confirmed mediums (contained correctness — full detail in the ledger)
| ID | Where | One-line |
|---|---|---|
| D2-2 | db | `seed_audit_mock_data` is SECURITY DEFINER, no caller check, PUBLIC-executable; inert today only by a NOT-NULL accident → drop it |
| MAC-1 | audit | `audit_mode_get_stage_readout` NULL-faults on all 7 ISA stages; its twin got the fail-closed fix 3 days ago, this one was missed (latent — no live caller) |
| EDG-R1-3 | edge | `reducto-webhook` secret compared with `!==`, not constant-time |
| EDG-R2-1 | edge | `isa-finding-draft` fixed `max_tokens=4000` + never checks `finish_reason` → the fullest audits fail with a misleading "unparseable output" error |
| SITE-1 | site | VEW `editText` sends no version → two coordinators editing one requirement = silent last-write-wins (edit-log recovers) |
| DLV-1 | deliverables | a block whose `section_key` falls outside the artifact's vocabulary silently vanishes from render + PDF while still counted (completeness-doctrine violation) |
| DLV-2 | deliverables | no staleness signal when a protocol re-parses after a deliverable was generated → reviewer exports a silently-stale draft |
| ISA-R-2 | audit | draft-prune effect drops `stripped_protocol_ref_count` → the cite-or-drop disclosure banner silently disappears on reload |
| ISA-R-1(r) | audit | `StageNav` stage-switch discards in-progress ISA edits with no dirty-check (the app's `guardedNavigate` pattern exists but isn't wired here) |
| ORG-R1-1 | orgs | chat subscribe-before-fetch: a realtime row that lands during the initial fetch can be clobbered by the fetch result |
| ORG-R1-2 | orgs | mention-count decrement is identity-less → a late read-receipt echo can zero a genuinely-unread mention |
| ORG-R1-3 | orgs | the acks realtime subscription is unfiltered (the filter its own comment describes lives elsewhere); acks for every org accumulate unbounded |

---

## ⚪ LOW
- **L4** — sotr APIs throw instead of `Result<T>` (every live caller catches; style/consistency for Ishika).
- **ORG-R2-2** — chat attachments have no MIME allowlist and signed URLs omit download-disposition (**downgraded** from medium: not same-origin with the app, and RLS excludes external guests; hygiene fix with in-repo precedent — the protocol-pdfs bucket already restricts MIME types).
- **ORG-R2-3** — the orphan-chat-attachment cleanup RPC pair exists in the DB but nothing calls it → interrupted uploads leak storage objects.

---

## ✅ Non-findings — refuted or downgraded under verification (the discipline story)

Blind verification exists so the report contains only what survives an adversary. It earned its place here:

- **Stale-closure bugs in `ChatTab`** (6 `exhaustive-deps` suppressions) — **refuted.** All six trace to React-guaranteed-stable values (raw `useState` setters, `useCallback([])` with ref-mirrored internals). Counts accurate; hazard unsupported.
- **PHI leaking through `console.error`** — **refuted.** Zero of the ~140 console calls log row data — only Postgrest error metadata. (Reframed to the real, smaller finding: the `Result<T>` fracture, S2.)
- **Cross-runtime adapter duplication drift** — **refuted.** The one other genuine Deno↔Vite duplicate (`visitNameNormalize`) has a *stronger* drift test than the cited example; the rest are single-copy.
- **VEW RPC emits no `source_quote` / sorts on an unset key** (D3-1/D3-2) — **refuted.** Real in the v3 migration; fixed by later ones (the function is replaced 8×; an explicit `order_fix` migration exists). See S3.
- **Deliverable engine has no server-side entitlement check** (SHR-1) — **refuted.** The check was added in a later migration (`user_can_access_deliverable_engine`, RPC + RLS); the server *is* the real boundary, as the code comments claimed.
- **Deliverable summary RPCs missing** (a suspected blocker) — **refuted.** All three exist in later migrations grep couldn't reach from the reviewer's sandbox.
- **ISA cross-audit misattribution** (ISA-R-1 at high) — **downgraded to medium.** Audit-switching always routes through a gate that unmounts the workspace; misattribution is impossible. The real residual is the missing dirty-check.

**Clean bills worth stating plainly:** the cite-or-drop integrity spine holds (LLM output always gated, no cross-protocol pull, truncation can't fabricate a citation); the ISA site-verdict is manual-only with no LLM path; the auth matrix is sound across all 18 edge handlers (Stripe derives the customer server-side, ISA scopes protocol server-side, ingest uniform-404s on ownership mismatch); the Reducto webhook can't inject fake parse results (it re-fetches from source); SOTR review-state is single-writer (no column/log divergence); auth/session/demo-mode/entitlement-race all fail closed; provenance fields pass through verbatim-or-null everywhere except B3; 21 of 22 "no-RLS" tables were false alarms; zero `any`, zero `@ts-ignore`, adapters pure, 1568 tests green.

---

## Owner-routed fix roadmap

A weighed trade-space, not a locked order — sequencing is the founder's call. Sized S (< half day) / M (1–2 days) / L (a sprint).

### Roger (supabase / infra) — **the highest-value lane**
| Do | Fix | Size | Why now |
|---|---|---|---|
| **First** | **B1 RLS on `protocol_visit_templates`** | **S** | The one true blocker; cross-tenant data. ~4-line migration. |
| Then | D1 stripe-webhook `verify_jwt=false` + contact | S | Billing may be silently broken in prod today. Verify Stripe delivery logs. |
| Then | D2-2 drop `seed_audit_mock_data`; EDG-R1-3 constant-time secret | S | Both tiny; close the SECURITY DEFINER + webhook-secret gaps. |
| Batch | D1(migrations) CI merge-monotonic-timestamp check; MAC-1 stage-readout fail-closed | M | Forward-looking guardrails; the timestamp check retires a whole class of contractor-env breakage. |

### Ingest owner (Roger or shared) — **the provenance root**
| Fix | Size | |
|---|---|---|
| B1(ingest) atomic claim (`UPDATE … WHERE status='pending'`) + `UNIQUE(document_id, chunk_index)` + conditional failure-stamp | M | Closes the 3-caller race and the corpus double-write together. |
| B2 don't set `ready` until step 5 succeeds; make re-upload recover a null-protocol doc | M | Turns an unrecoverable dead-end into a retry. |
| B3 verify crossref snippet against source chunk (use the Reducto citation object already fetched) | M | The one cite-or-drop hole; upholds the product litmus. |

### Karl (audit) — **the approval theme, one coherent fix**
| Fix | Size | |
|---|---|---|
| A1+A2+A3 gate approve/advance on content hash + fail-closed server RPC check | L | Three highs, one root cause. The DB-persisted false attestation (A2) is the sharpest. |
| ISA-R-2 disclosure-count on prune; ISA-R-1 dirty-check on StageNav | S | Both small; both protect the cite-or-drop honesty story. |

### Org-chat lane
| Fix | Size | |
|---|---|---|
| C1 cursor pagination + a "not in current view" signal for jump-to-source | L | The scale ceiling; the silent-failure half is the smaller, higher-value first step. |
| ORG-R1-1/-2/-3 realtime merge helper (shared), identity-based mention set, filter the acks sub | M | Three mediums, one shared realtime-merge fix. |

### Ishika (VEW / sotr)
| Fix | Size | |
|---|---|---|
| SITE-1 compare-and-swap on `editText`; DLV-1/DLV-2 completeness + staleness signals; L4 sotr `Result<T>` | M | Quality-of-life + doctrine consistency; none urgent. |

### Cross-cutting (2-reviewer)
| Fix | Size | |
|---|---|---|
| S1 widen mode-isolation gate to all trees + `hooks/`, delete the crossMode shim | M | Restores the doctrine the product outgrew. |
| S2 pick one `Result<T>` shape, fix the canonical reference, add a `throw`-in-`*Api.ts` check | M | Reviewability. |
| S4 extend the "needs a test" gate to edge handlers + top components; write the 5 highest-leverage tests | L | Inverts the inverted coverage. |

---

## Telemetry
~30 subagent runs (haiku triage / sonnet review + blind verify), Fable spent only on orchestration, the cross-surface synthesis, and adjudication — per the token-routing doctrine. Deterministic pre-computes (migration order, RLS index, edge auth matrix, superseding-migration resolution) done by the orchestrator to work around a missing-`ripgrep` sandbox that was pushing reviewers toward false "X is missing" positives — which is itself the origin of the S3 observation. Full working ledger (every candidate, verdict, and refutation) retained at `scratchpad/findings-ledger.md`.
