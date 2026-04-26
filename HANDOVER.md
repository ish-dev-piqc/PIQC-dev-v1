# Session Handover — Vendor PIQC
> Paste this at the start of a new Claude session to resume without context loss.
> Last updated: 2026-04-26

---

## What was just built

Phase 1 is **functionally complete**. Every active audit stage has a real workspace. The full workflow is walkable end-to-end:

| Stage | Status | Key component |
|---|---|---|
| INTAKE | ✅ | `IntakeWorkspace` — protocol section tagging |
| VENDOR_ENRICHMENT | ✅ | `VendorEnrichmentWorkspace` — service + mapping + trust |
| QUESTIONNAIRE_REVIEW | ✅ | `QuestionnaireWorkspace` — full lifecycle: draft → addenda → vendor return → approve → export |
| SCOPE_AND_RISK_REVIEW | ✅ | `ScopeReviewWorkspace` — read-only confirmation + stage gate |
| PRE_AUDIT_DRAFTING | ✅ | `PreAuditDraftingWorkspace` — 3-tab: confirmation letter, agenda, checklist |
| AUDIT_CONDUCT | ✅ | `AuditConductWorkspace` — observation entry recording *(just built)* |
| REPORT_DRAFTING | ⏸ Phase 2 | Placeholder |
| FINAL_REVIEW_EXPORT | ⏸ Phase 2 | Placeholder |

The last thing we built was the AUDIT_CONDUCT workspace (lib + API + UI) and a design critique → 5 fixes:
- Added `danger` tone to `Badge` component; CRITICAL impact now renders red not amber
- Removed duplicated `Field`/`inputStyle` from `AuditConductWorkspace` — now imports from `components/ui/Field`
- Fixed `HistoryDrawer` FIELD_LABELS key: `vendorDependencyFlag` → `vendorDependencyFlags`
- Added disabled affordance (opacity + hint text) to locked domain field in entry form
- Added confirmation step before approving risk summary in `RiskSummaryPanel`

---

## Two things still pending

### 1. Run the tests
127 integration tests written across 9 files, never run against a real DB.

```bash
cd ~/Desktop/vendor-piqc && npm install && npm run test:db:migrate && npm run test
```

`.env.test` is already created with `DATABASE_URL_TEST` pointing at `vendor_piqc_test`. Adjust Postgres credentials in that file if needed before running.

### 2. Auth provider decision (human decision required)
13 mutation routes accept `actorId` from the request body — any caller can attribute GxP trail entries to any user. This requires choosing a session auth provider (NextAuth, Clerk, or custom JWT). Once decided, the wire-up is ~half a day mechanical work across those routes. **Cannot build until you decide.**

---

## Architecture in one paragraph

Next.js 15 App Router, PostgreSQL, Prisma. All mutations go through library functions (`lib/*.ts`) that run inside `prisma.$transaction` and call `writeDelta` in the same transaction — GxP trail is enforced at the lib layer, never in route handlers. The schema is relational and schema-first; no text blobs for structured data. The 3-pane shell (`AuditWorkspaceShell`) wraps every audit stage: left = `StageNav` (8 stages), center = stage-specific workspace, right = `RiskSummaryPanel`. All state deltas are stored in `StateHistoryDelta` and surfaced via `HistoryDrawer` on every mutable object.

---

## Key file map

```
prisma/schema.prisma          — single source of truth for all models + enums
lib/                          — all business logic (one file per domain object)
  workspace-entries.ts        — AuditWorkspaceEntryObject CRUD (just built)
  questionnaires.ts           — questionnaire lifecycle
  risk-summary.ts             — vendor risk summary + approval
  audit-stage.ts              — stage transitions + gate enforcement
  deliverables.ts             — confirmation letter, agenda, checklist
  state-history.ts            — writeDelta + diffFields + getObjectHistory
app/api/audits/[auditId]/     — all audit-scoped API routes
components/workspace/         — all workspace UI components
components/ui/                — Button, Badge, Field, Breadcrumb, TopBar
lib/ui/tokens.ts              — single source for color, spacing, type, radii
tests/lib/                    — 9 integration test files (real Postgres, no mocks)
tests/helpers/factory.ts      — test factories
docs/decisions.md             — all architectural decisions with status
tasks/active.md               — full build history + what was completed
```

---

## Open architectural decisions

| ID | Question | Status |
|---|---|---|
| D-004 | SOP parsing / ControlCheckpointObject phasing | Open — Phase 2 |
| D-005 | Trust posture scoring model (qualitative vs. numeric) | Open |
| D-007 | Evidence attachment model | Open — Phase 2 |
| D-009 | PIQC → Vendor PIQC API contract | Open — dev team coordination |

D-008 (coherence engine UI) was decided this session: Phase 1 exposes human-governed fields only, no coherence surface.

---

## Standing rules (never violate)

- No autonomous finding finalization, no black-box scoring, no autonomous vendor communication
- All risk/trust/classification changes stored as state deltas with timestamp + actorId
- Sponsor name never in any generated template, seed, or draft — auditors add branding on export
- `actorId` shim (`audit.leadAuditorId`) is a placeholder — replace with `session.user.id` when auth lands
- `checkpointRef` is plain text in Phase 1 (`[D-004 STUB]`) — do not build logic that depends on it being a FK
- Do NOT build a protocol parser or PDF ingestion — Vendor PIQC receives already-structured data from PIQC

---

## Phase 2 scope (do not start without explicit instruction)

- SOP upload + ControlCheckpointObject extraction (D-004)
- Evidence versioning model (D-007)
- Coherence engine UI stubs (D-008)
- REPORT_DRAFTING + FINAL_REVIEW_EXPORT workspaces
- PIQC ingest endpoint (once D-009 is resolved with dev team)
- LLM-assisted risk tagging + questionnaire suggestions (PIQC_ASSISTED / LLM_ASSISTED tagging modes)
