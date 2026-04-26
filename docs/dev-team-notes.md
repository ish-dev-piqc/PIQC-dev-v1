# Dev team notes

Items that require a Node environment, dev team decision, or external coordination.
Checked off here as they are completed — do not delete entries, mark them done.

---

## Environment setup

### [ ] Install Node and initialize the project
```bash
cd vendor-piqc
npm install
```
Required before any Prisma or Next.js commands will run.

---

## Prisma

### [ ] Validate the schema
Run after `npm install`:
```bash
npx prisma validate
```
Expected: no errors. The schema was manually reviewed but not machine-validated
because Node is not available in the authoring environment.

Known issue resolved before handoff: typo `certificationsClimed` → `certificationsClaimed`
in `TrustAssessmentObject`. The `@map("certifications_claimed")` was always correct —
only the Prisma field name was misspelled.

### [ ] Run first migration
```bash
npx prisma migrate dev --name init
```
Do not run until schema validation passes. This creates the database and applies
all tables, enums, indexes, and constraints from `prisma/schema.prisma`.

### [ ] Re-run migration after D-003 schema additions
The D-003 build added: `ClinicalTrialPhase` enum, `clinicalTrialPhase` on
`ProtocolVersion`, `QuestionAnswerType`, `ResponseSource`, `QuestionnaireInstanceStatus`,
`QuestionOrigin` enums, `QUESTIONNAIRE_INSTANCE` to `TrackedObjectType`, and four new
models: `QuestionnaireTemplate`, `QuestionnaireTemplateVersion`, `QuestionnaireQuestion`,
`QuestionnaireInstance`. `QuestionnaireResponseObject` was restructured (removed
`questionText`/`questionDomain`; added `instanceId`, `questionId`, `source`,
`sourceReference`, `confidenceFlag`).

If migration was already run before these additions, run a follow-up:
```bash
npx prisma migrate dev --name d003_questionnaire_models
```

### [ ] Seed canonical questionnaire template
After migrating, seed the canonical Standard GCP Vendor Questionnaire template (D-003):
```bash
npx prisma db seed
```
This is idempotent — safe to re-run. Publishes a new version only if the seed's
`versionNumber` doesn't yet exist. To publish a revised version, bump
`versionNumber` in `prisma/seeds/standard-gcp-vendor-template.ts` and re-run.

### [ ] Run `prisma generate`
```bash
npx prisma generate
```
Generates the typed Prisma client. Required before any application code that
imports from `@prisma/client` will typecheck.

### [ ] Run migration after D-010 schema additions
The D-010 build added: `AuditStage` enum (8 values), `RiskSummaryApprovalStatus`
enum, `VENDOR_RISK_SUMMARY_OBJECT` to `TrackedObjectType`, `Audit.currentStage`,
`Audit.vendorRiskSummary` relation, `QuestionnaireInstance.approvedAt`/
`approvedBy` + `approver` relation, new `VendorRiskSummaryObject` model and
`VendorRiskSummaryProtocolRisk` junction.

Run:
```bash
npx prisma migrate dev --name d010_stage_and_risk_summary
npx prisma generate
```

No additional seeding required — risk summary stubs are created on demand by
`lib/risk-summary.ts` (next build step). Existing audits will default
`currentStage` to `INTAKE` after migration; reseed your local DB or backfill
manually if you have audits stuck mid-flow.

### [ ] Test database setup
The test suite (`npm test`) runs against a separate Postgres database — never the dev one. Tests `TRUNCATE … CASCADE` every public table between each test, so any database that's pointed at will be wiped.

**One-time setup:**
1. Create a second Postgres database, e.g. `vendor_piqc_test`.
2. Set `DATABASE_URL_TEST` in your shell (or in `.env.test` if you keep it gitignored — `dotenv-cli` is wired so that file is honored).
3. Apply the schema to the test DB:
   ```bash
   npm run test:db:migrate
   ```
   This uses `prisma migrate deploy` (not `dev`) to apply existing migrations without prompting.

**Running tests:**
```bash
npm test           # one-shot run (CI-friendly)
npm run test:watch # watch mode for local dev
```

The harness refuses to start if `DATABASE_URL_TEST` is unset (`tests/setup.ts`). All factories live in `tests/helpers/factory.ts` and bypass library lifecycles for setup speed — tests covering library X always exercise the real X for the operation under test.

When schema changes land, re-run `npm run test:db:migrate` against the test DB before re-running the suite.

### [ ] Run migration after D-010 step 7 schema additions (Pre-Audit Drafting deliverables)
Step 7 added: `DeliverableApprovalStatus` enum (DRAFT/APPROVED), three new
`TrackedObjectType` values (`CONFIRMATION_LETTER_OBJECT`, `AGENDA_OBJECT`,
`CHECKLIST_OBJECT`), three new models (`ConfirmationLetterObject`,
`AgendaObject`, `ChecklistObject`) — each 1:1 with `Audit`, with a Json
`content` blob (structure TBD in follow-up), `approvalStatus`, and
`approvedAt`/`approvedBy` + approver relations on `User`.

Run:
```bash
npx prisma migrate dev --name d010_step7_deliverables
npx prisma generate
```

Deliverable API endpoints (POST stub / PATCH content / POST approve) are not
yet built — the workspace tabs render approval-gate UI but mutations are
no-ops with an explicit "scaffold" message until endpoints land per the
deliverable-detail follow-up task.

---

## Open decisions (from docs/decisions.md)

### [ ] D-009 — PIQC API contract (blocks ProtocolRiskObject field finalization)
Requires coordination with the PIQC dev team. Before this is resolved:
- Do not rename or remove any field marked `[PIQC]` in `prisma/schema.prisma`
- Do not build any UI that exposes PIQC-sourced fields as if they are stable
- Fields affected: `piqcProtocolId`, `rawPiqcPayload` on `ProtocolVersion`;
  `sectionIdentifier`, `sectionTitle` on `ProtocolRiskObject`

Specific questions for the PIQC team (from `docs/decisions.md` D-009):
- What fields does PIQC output after processing Reducto JSON?
- How are protocol sections keyed (numeric ID, slug, hierarchy path)?
- What metadata is available per section (type, page ref, hierarchy level)?
- What is the API format — REST, payload shape, auth method?

### [ ] D-005 — Trust posture scoring model
Three enums in the schema are placeholders: `CompliancePosture`, `MaturityPosture`,
`TrustPosture`. Options are documented in `prisma/schema.prisma` enum comments.
A migration will be required when this is decided if the model changes from
qualitative labels to numeric or multi-axis.

### [ ] D-004 — SOP checkpoint phasing
`checkpointRef` on `AuditWorkspaceEntryObject` is a plain text stub. Phase 2
replaces it with a FK to `ControlCheckpointObject`. When D-004 is decided,
a migration adding that table and replacing the text field with a FK is required.

---

## Infrastructure

### [ ] Set DATABASE_URL in environment
Copy `.env.example` to `.env.local` and fill in the Postgres connection string
before running any Prisma commands.

### [ ] Set up file storage for EvidenceAttachment
`EvidenceAttachment.storageKey` stores a storage key (e.g. S3 object key).
The storage provider, bucket name, and upload API are not yet configured.
Phase 1 requires at minimum: a bucket, presigned upload URL generation, and
a route that writes the resulting key + metadata to the `evidence_attachments` table.
