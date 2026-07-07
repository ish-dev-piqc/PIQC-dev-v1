# Surfaces — precomputed scope manifest

The orchestrator trusts this file instead of re-scanning the repo. LOC figures are
approximate and only used for budgeting/sharding. Owners come from `docs/CODEOWNERS.md`.

> **Subject = the Opus delta, not the whole surface.** By default a run reviews
> `git diff main...HEAD` **intersected** with the globs below — i.e. the Opus-built code within
> each surface. The globs/LOC here bound and route that delta (which agent gets which files) and
> supply the hotspots to weight. Only a `full <surface>` invocation reviews the entire surface.
>
> Keep this current: when a new surface ships, add a row + its hotspots here rather than letting
> agents rediscover scope at runtime.
>
> **Never a surface:** `website/**`, `landing.html`, `plans/**`, `.claude/**`, `docs/**`. A
> concurrent Fable run owns the marketing site (`website/FABLE-BRIEF.md`); this audit never reads,
> reviews, or edits those files even if they're dirty in the working tree. App source only.

---

## Audit Mode — owner: Karl (~23.4k LOC)

**Globs:** `src/lib/audit/**`, `src/components/dashboard/audit/**`, `src/types/audit/**`

**Key modules:**
- 8 stage workspaces — `src/components/dashboard/audit/stages/{Intake, ScopeReview,
  VendorEnrichment, QuestionnaireReview, AuditConduct, PreAuditDrafting, ReportDrafting,
  FinalReviewExport}Workspace.tsx` + sub-flows `stages/{intake, investigator, vendor-enrichment}/`.
- Workspace shell + nav — `AuditWorkspaceShell.tsx`, `StageNav.tsx`, `StagePlaceholder.tsx`.
- Agentic UX surfaces — `AuditChatPanel.tsx`, `PrefillAgentNote.tsx`, `PiqcDock.tsx`,
  `RiskSummaryPanel.tsx`, drawers (`HistoryDrawer`, `IssuesCapaDrawer`, `TraceabilityDrawer`).
- API layer — `src/lib/audit/*Api.ts` (auditApi, capaApi, chatApi, intakeApi, preAuditApi,
  questionnaireApi, reportApi, riskSummaryApi, signalsApi, vendorEnrichmentApi,
  workspaceEntriesApi, lineageApi, auditCreationApi).
- Adapters / helpers — `lineageAdapter.ts`, `stateHistory.ts`, `workflowStages.ts`, `labels.ts`.

**Known-risk hotspots (prioritize):**
- **Mock proliferation** — `src/lib/audit/mock{PreAudit, ProtocolRisks, Questionnaire, Report,
  RiskSummary, VendorEnrichment, WorkspaceEntries}.ts`. For each: is it wired behind a
  `piq-*-v1` localStorage toggle **default-off** (allowed), or shipped as default runtime data
  (violates the "no new mocks" rule)? This is the #1 clinical-integrity target for this surface.
- **"sponsor" references inside `audit/`** — appear in `RiskSummaryPanel.tsx`,
  `FinalReviewExportWorkspace.tsx`, `PreAuditDraftingWorkspace.tsx`, `ReportDraftingWorkspace.tsx`,
  `IssuesCapaDrawer.tsx`, `capaApi.ts`, `auditCreationApi.ts`, `types/audit/objects.ts`.
  Distinguish **domain vocabulary** (a protocol's sponsor name — fine) from an actual
  cross-mode **import** of Sponsor code (mode-isolation violation). The CI gate does NOT
  check sponsor/deliverables cross-imports, so this is a real audit gap, not a CI dupe.
- Stage-advancement + prefill logic (`stage5/6/7_prefill`, `stage_advancement_rpc`) — provenance
  and attribution correctness ("PIQC drafted") on generated content.

**Related migrations (type-mirror + RLS spot-check only):** `supabase/migrations/2026043*_audit_mode_*`,
`2026050*_audit_mode_report_*`, `2026051*_audit_mode_*`, `20260705*_workflow_type*`,
`20260707*_issue_capa*`, `20260709*_investigator*`.

---

## Deliverables engine — owner: @fable-dev-piqc (~10.5k LOC)

**Globs:** `src/lib/deliverables/**`, `src/components/deliverables/**`, `src/types/deliverables/**`

**Key modules:**
- API — `deliverablesApi.ts`, `deliverablesMutationsApi.ts`, `deliverablesExportApi.ts`.
- Adapter (must be pure) — `deliverablesAdapter.ts`.
- Selection logic ("generate many") — `selection/{riskOverview, monitoringChecklist,
  craMonitoringFocus, sivPackage, siteTrainingPriorities}.ts`.
- Exporters — `exporters/buildSivDeck.ts`.
- Components — `DeliverablePanel.tsx`, `DeliverableBlockList.tsx`, `DeliverableBlockRow.tsx`,
  `DeliverableTextDrawer.tsx`, `DeliverableTraceabilityDrawer.tsx`, `deliverableConfigs.ts`.
- Provenance UI — `ContentOriginBadge.tsx`, `DeliverableReviewBadge.tsx`.

**Known-risk hotspots (prioritize):**
- **Provenance / attribution** — `ContentOriginBadge`, `DeliverableReviewBadge`,
  `DeliverableTraceabilityDrawer`: every generated block must carry origin + review state and
  the "PIQC drafted/flagged/found" voice. Missing/weak attribution = clinical-integrity finding.
- **Export fidelity** — `buildSivDeck.ts` + `deliverablesExportApi.ts`: no sponsor branding in
  PIQC artifacts (added externally on export); no PHI leakage; completeness of exported content.
- **`deliverableConfigs.ts`** — config sprawl / overengineering; single-caller abstractions.
- Adapter purity + `Result<T>` discipline across the Api files (CI gate covers supabase-in-adapter
  and `any`-in-lib mechanically — audit the *shape/semantics*, not those two).

**Related migrations:** `20260708*_protocol_deliverables*`, `20260708*_deliverable_rpcs*`,
`20260709*_deliverable_risk_overview*`, `20260710*_prohibited_meds*`, `20260711*_cra_focus*`,
`20260713*_siv_package*`, `20260715*_amendment_refresh*`.

---

## Sponsor Mode — owner: mixed (~1.7k LOC) — **use for the dry-run**

Owners per `docs/CODEOWNERS.md`: `src/types/sponsor/` → @ki-dev-piqc @ish-dev-piqc (2-reviewer);
`sponsor/deliverables/` components → @fable-dev-piqc.

**Globs:** `src/components/dashboard/sponsor/**`, `src/types/sponsor/**`

**Key modules:** `SponsorPage.tsx`, `SponsorProtocolDrawer.tsx`,
`deliverables/DeliverablePortfolioGrid.tsx`, `deliverables/ProtocolIntelligenceTab.tsx`.

**Known-risk hotspots:**
- **Dormant entitlement gate** — `canUseSponsorMode` in `src/lib/entitlements.ts` was noted as
  unused. Confirm the gate is actually enforced on the Sponsor surface (route + render), not
  declared-but-bypassed.
- Owner-only SOTR RLS interaction — Sponsor surface reads parsed-protocol data; confirm it
  respects the owner-only RLS rather than assuming broad read.
- Design parity — does Sponsor Mode follow the drawer pattern (`useOverlay` + `useSwipeDismiss`)
  and semantic tokens, or has it drifted from the app design system?

---

## CRA mode — owner: shared (~0.1k LOC) — **shallow pass only**

**Globs:** `src/components/dashboard/cra/**`, `src/context/ModeContext.tsx`,
`src/lib/entitlements.ts` (`canUseCraMode`)

Shell + deliverable wiring (`CraWorkspaceShell.tsx`, `craDeliverables.ts`) — still the smallest
surface; shallow pass unless the delta shows material change. One agent, gates-&-wiring lens
first: is `canUseCraMode` gated correctly (distinct enterprise gate from `canUseSponsorMode`),
is `DashboardMode 'cra'` wired without leaking into other modes, is the surface honest
(no fake data implying a finished feature)?

---

## Shared touchpoints — always T3

**Globs:** `src/lib/entitlements.ts` (2-reviewer: @ish-dev-piqc @ki-dev-piqc),
`supabase/migrations/**` (owner: @rv61) — these are part of the baseline glob set so the Phase-0
intersection picks them up.

`src/lib/entitlements.ts` — audit `canUseSponsorMode` / `canUseCraMode` for correct tier logic
and actual enforcement. `supabase/migrations/**` — append-only; new migrations get a
consumer/type-mirror consequence review (never restate the CI mirror warning). Not a full infra
audit.

**Canonical owner handles** (use these exact strings in findings, apply batches, Approved-by):
@karl-dev-piqc (audit) · @fable-dev-piqc (deliverables, sponsor components) ·
@ish-dev-piqc @ki-dev-piqc (types/sponsor, entitlements, context — 2-reviewer) ·
@rv61 (supabase) · @ish-dev-piqc (.claude tooling).

---

## Risk-tier triggers (path → tier)

| Tier | Trigger |
|---|---|
| **T3** | Delta touches `src/lib/entitlements.ts`, `supabase/migrations/**`, `src/context/ModeContext.tsx`, provenance/attribution surfaces (`ContentOriginBadge.tsx`, `DeliverableReviewBadge.tsx`, `DeliverableTraceabilityDrawer.tsx`, `TraceabilityDrawer.tsx`, `lineage*`), auth, anything PHI-adjacent, or introduces a cross-mode import |
| **T2** | Changed exported symbol / type / route / RPC signature with ≥1 consumer outside the changed file (grep importers; label barrels/dynamic imports `unresolved`) |
| **T1** | Everything else — internal implementation only |

T3 cannot be Approved while a consumer edge is `unresolved` or a required gate did not run.

---

## Workflow spines — what the macro pass reads (breadth, not deep)

The Phase-2 macro reviewer reads these per surface to judge whether the *flow* coheres end-to-end
— it does not deep-read them (triage already receives them as routing input in Phase 1). Keep to
the spine; the micro fan-out handles the rest.

- **Audit Mode:** `src/lib/audit/workflowStages.ts` (the 8-stage definition + order),
  `StageNav.tsx` + `AuditWorkspaceShell.tsx` (how stages present + advance), `stateHistory.ts`,
  the stage-advancement RPC (`supabase/migrations/20260430200000_audit_mode_stage_advancement_rpc.sql`),
  and the `stages/investigator/` variant. Question: do the 8 stages + gates + Issue→CAPA form one
  coherent, gap-free journey?
- **Deliverables:** `src/lib/deliverables/selection/*` (the "generate many" selectors),
  `deliverableConfigs.ts`, `deliverablesApi.ts` + the deliverable RPCs. Question: does
  "parse once → generate many" hold — one protocol fanning into deliverables without dropping
  provenance or requirements between parse and render?
- **Sponsor:** `SponsorPage.tsx` → `SponsorProtocolDrawer.tsx` →
  `deliverables/{DeliverablePortfolioGrid,ProtocolIntelligenceTab}.tsx`, gated by
  `canUseSponsorMode`. Question: is the enterprise journey (portfolio → protocol → deliverable)
  coherent and actually gated?
- **CRA:** `src/context/ModeContext.tsx` + `cra/CraWorkspaceShell.tsx` + `cra/craDeliverables.ts`.
  Question: is the mode wired honestly (no fake finished-feature affordances) and isolated from
  other modes?

## CI-gate exclusions — DO NOT report these (already caught mechanically)

`.github/workflows/piqc-discipline.yml` + `scripts/scope-check.sh` already fail the PR on:

1. Cross-mode imports **among site/audit/sotr** (has an `ALLOWED_CROSS_MODE` allowlist).
   → *But sponsor/deliverables/cra cross-imports are NOT checked — those ARE in audit scope.*
2. Raw Tailwind color classes `text-(gray|slate|zinc|neutral)-N`.
3. Components importing `@supabase/supabase-js` or `lib/supabase` (non-type).
4. Adapters (`src/lib/*/*Adapter.ts`) importing supabase.
5. Realtime (`.channel(` / `.on('postgres_changes')`) in `src/components`.
6. `: any` / `as any` in `src/lib/**` (non-test).
7. Migrations edited rather than appended.
8. Migration changed without `src/types/` update (warning).
9. `console.log` / `console.debug` in added non-test lines.
10. `vitest.config.ts.timestamp-*` litter at repo root.
11. New `*Api.ts` / `*Adapter.ts` without a matching test.

Spend findings on **judgment-level** issues these can't see: design/UX quality, semantic
correctness, mode-isolation for the *new* modes, provenance completeness, mock-vs-real data,
dead code, overengineering, and clinical completeness.
