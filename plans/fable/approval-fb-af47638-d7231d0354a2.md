```yaml
run_id: FB-af47638-d7231d0354a2
base_sha: af47638 (origin/main @ merge of #456)
head_sha: af47638
manifest_digest: d7231d0354a2
scope: bug hunt over Site / VEW / SOTR / context (never-audited surfaces)
approved_finding_ids:
  # 11 distinct root causes (15 verified IDs; dupes noted)
  - FB-...-SOT-M1    # formatVisit asymmetric window → ±  (HIGH clinical)
  - FB-...-SOT-301   # canonicalVisitName cycle collapse  (HIGH clinical)
  - FB-...-CTX-M1/11/12  # ProtocolChatContext stale-response race (HIGH)
  - FB-...-CTX-M2/201    # advanceStage silent failure (HIGH)
  - FB-...-SIT-M1    # participant-delete error banner unmounts (HIGH)
  - FB-...-SIT-201   # addMonths day-29-31 month skip (MED)
  - FB-...-SIT-202   # cert-expiry fail-open on empty date (MED)
  - FB-...-CTX-501   # SiteDataContext refresh identity churn (MED)
  - FB-...-VEW-M2    # parseRoleHint pi/lab substring false-positives (MED)
  - FB-...-SIT-11    # demoSiteRepo missing confidenceState (MED, demo-only)
  - FB-...-SOT-M2/11 # persistAdapterOutput dead code + partial-failure (MED → delete)
approved_by: sixonelabs-piqc (founder), interactive "Apply all 11" 2026-07-06
approved_at: 2026-07-06
not_applied:
  - FB-...-VEW-M1 (needs-human): snapshot card filtered/unfiltered mix — verifier
    traced to deliberate Sprint-6 plan decision; product call, left for owner.
  - FB-...-SOT-301 (FLAGGED, not applied): canonicalVisitName cannot distinguish a
    strippable time-restatement from a distinguishing cycle at the pure-string layer
    (the bug case and a locked legitimate-collapse case are lexically identical). Real
    fix is folding study_day/cycle into the grouping key in
    sourceEvidenceAdapter.dedupeVisitArray (+ its Deno mirror) — a separate task for
    @ish-dev-piqc. A describe.skip test documents the gap. Function left byte-identical
    to the Deno copy (parity preserved). So 10 of 11 applied; SOT-301 → tracked follow-up.
applied_count: 10 of 11 (SOT-301 flagged)
verification: tsc --noEmit clean; vitest 99 files / 1329 passed + 1 skipped (the SOT-301 doc-skip).
```
