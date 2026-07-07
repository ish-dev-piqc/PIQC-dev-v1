```yaml
run_id: FA-38bbb03-38bbb03-23e5de6f8d9d
base_sha: 38bbb03268686ff6ac0fb32145136d9df94941f3
head_sha: 38bbb03268686ff6ac0fb32145136d9df94941f3
manifest_digest: 23e5de6f8d9d
approved_finding_ids:
  - FA-38bbb03-38bbb03-23e5de6f8d9d-901   # report stats drop overdue/closing_soon (high)
  - FA-38bbb03-38bbb03-23e5de6f8d9d-801   # cross-protocol partial fetch failure swallowed (high)
  - FA-38bbb03-38bbb03-23e5de6f8d9d-802   # no pagination — 1000-row cap truncates visits (high)
  - FA-38bbb03-38bbb03-23e5de6f8d9d-301   # stale pending-key handoff, no TTL/scope (high)
  - FA-38bbb03-38bbb03-23e5de6f8d9d-501   # false "select a protocol" flash during load (high)
  - FA-38bbb03-38bbb03-23e5de6f8d9d-M2    # useOverlay Esc not stack-aware — double-close (high)
  - FA-38bbb03-38bbb03-23e5de6f8d9d-M3    # open drawer renders frozen snapshot vs realtime (medium)
  - FA-38bbb03-38bbb03-23e5de6f8d9d-201   # empty banner during first load (medium)
  - FA-38bbb03-38bbb03-23e5de6f8d9d-102   # ProtocolDetailDrawer bespoke overlay (medium)
  - FA-38bbb03-38bbb03-23e5de6f8d9d-101   # AnchorDateModal no Esc handler (medium)
  - FA-38bbb03-38bbb03-23e5de6f8d9d-902   # UTC toISOString "today" vs local visit dates (medium)
  - FA-38bbb03-38bbb03-23e5de6f8d9d-903   # CSV formula injection in free-text fields (medium)
  - FA-38bbb03-38bbb03-23e5de6f8d9d-601   # undebounced realtime refresh storm (medium)
  - FA-38bbb03-38bbb03-23e5de6f8d9d-203   # TodayTab 1699 LOC — split (medium, own PR)
approved_by: sixonelabs-piqc (founder), via interactive approval 2026-07-07
approved_at: 2026-07-07
scope_exceptions: []   # apply each finding to its VERIFIED allowed_paths only — no silent widening
```

Decision context: full-surface war-game audit of Site Mode (the non-Fable-built surface).
14 findings survived blind verification (1 refuted — M1 — dropped to telemetry; 2 needs-human
held for founder). "Apply all 14" selected, batched into 4 PRs for dev-team reviewability.

## Apply sequencing — 4 PRs, owner-batched, disjoint file sets

Run `/fable-apply` once per batch (each disjoint finding-ID subset → its own branch → its own PR).
Sequential, not parallel — one worktree at a time.

- **Batch 1 — site surface** · branch `fable-apply/FA-38bbb03-batch1-site` · Approved-by @ki-dev-piqc
  IDs: 901 802 501 M3 201 102 101 902 903
  (901 802 902 903 → ReportsTab/realSiteRepo; 501 → ProtocolRequiredGate; M3 201 → TodayTab;
  102 101 → ProtocolDetailDrawer/AnchorDateModal)

- **Batch 2 — context (2-reviewer, own PR)** · branch `fable-apply/FA-38bbb03-batch2-context`
  Approved-by @ish-dev-piqc @ki-dev-piqc · IDs: 801 601  (src/context/SiteDataContext.tsx only)

- **Batch 3 — shared hook (isolate, 24 consumers)** · branch `fable-apply/FA-38bbb03-batch3-overlay`
  Approved-by @ki-dev-piqc (+ shared-hook reviewer) · IDs: M2  (src/hooks/useOverlay.ts + stacking
  regression test) — behavior-neutral for single-overlay callers; test proves topmost-only close.

- **Batch 4 — TodayTab split (own PR, last)** · branch `fable-apply/FA-38bbb03-batch4-todaytab-split`
  Approved-by @ki-dev-piqc · IDs: 203  (pure move of 8 inline components to sibling files; ship
  AFTER batch 1 merges to avoid burying the bug fixes and to minimise TodayTab conflict window)

## Cross-owner path note (not a scope exception — declared in a finding's allowed_paths)

- 301 touches `src/App.tsx` (shared infra) — its own Approved-by line required on Batch 1's PR, or
  split 301 into its own micro-PR if @ki-dev-piqc prefers not to co-sign App.tsx. **Founder note:**
  keep 301 in Batch 1 unless review pushes back.

## Tracked follow-ups (NOT in this apply — verified scope was single-file)

The verifier confirmed 902 and M3 fixes at their single-file scope and explicitly flagged the same
idiom/pattern in sibling files as out-of-scope-for-this-fix. Applying only the verified scope keeps
each diff exactly what was reviewed. Open as a fast follow-up:
- **TH4 (902 sibling):** same UTC `toISOString` "today" idiom in `VisitsTab.tsx:123`,
  `VisitFormDrawer.tsx:52`, `AnchorDateModal.tsx:39` → migrate all to `dateUtils.formatYmd`.
- **TH3 (M3 sibling):** same frozen-`openVisit` snapshot pattern in `VisitsTab.tsx` → same re-sync.
