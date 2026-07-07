```yaml
run_id: FA-eecb2f2-eecb2f2-1d86c21f9518
base_sha: eecb2f2 (fable-audit-phase-a; src/** + supabase/** verified byte-identical to main @ ec396aa)
head_sha: eecb2f2
manifest_digest: 1d86c21f9518
approved_finding_ids:
  - FA-eecb2f2-eecb2f2-1d86c21f9518-AUD-M1   # ISA stage-gate fail-open (incl. duplicate AUD-11)
  - FA-eecb2f2-eecb2f2-1d86c21f9518-AUD-301  # silent mutation failures
  - FA-eecb2f2-eecb2f2-1d86c21f9518-AUD-401  # empty-state during load
approved_by: sixonelabs-piqc (founder), via interactive approval 2026-07-06
approved_at: 2026-07-06
scope_exceptions:
  - path: src/components/dashboard/audit/AuditWorkspaceShell.tsx
    reason: calls upsertReportDraft (missed by reviewer allowed_paths); required so the
      AUD-301 result-shape change doesn't silently break the Shell's truthiness check
    approved_by: sixonelabs-piqc (founder), 2026-07-06
  - path: src/lib/audit/__tests__/workspaceEntriesApi.test.ts
    reason: one assertion read the old bare-object return; updated to the discriminated
      result (the apply plan's "[x] test — assertions broken by the shape change")
    approved_by: implied by finding validation (asserts error affordance) + apply-plan test layer
  - path: src/components/dashboard/audit/stages/__tests__/ReportDraftingWorkspace.test.tsx
    reason: two upsertReportDraft mocks resolved the old shape; updated to { ok, data }
    approved_by: implied by finding validation + apply-plan test layer
  # intakeApi.test.ts NOT touched — its createProtocolRisk tests assert RPC call args only.
```

Decision context: "All 3 confirmed" selected from the FA-eecb2f2-eecb2f2-1d86c21f9518 report
(Approve with upgrades; 0 blockers, 0 needs-human). Apply = reviewable diffs on a dedicated
branch; nothing merges without owner review (@rv61 for the migration batch, @karl-dev-piqc for
the audit-surface batch).
