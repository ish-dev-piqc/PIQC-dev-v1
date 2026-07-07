# Final report template

Compact enough to read in one sitting. No certainty claims — the decision criteria are the
authority, not the word "guaranteed".

```
# Fable Audit — <run-id>

**Decision:** Approve | Approve with upgrades | Block
**Run identity:** base <sha7> · head <sha7> · digest <12> · scope <requested → effective> ·
models <triage/review/verify/adjudicate> · skill-rev <sha7> · <date>

## Coverage
Surfaces reviewed · changed contracts reviewed · consumers checked (n of m discovered) ·
**unresolved edges: <list or none>** · gates suppressed as duplicates: <n> · cells triaged out: <n>

## Macro verdict (birds-eye)
Per surface, one line — does the workflow cohere end-to-end? e.g.
- **audit:** 8 stages + gates cohere; **TH1** — Conduct→Report hands off no draft, Report starts empty.
- **deliverables:** parse-once→generate-many holds; **TH2** — each selector re-derives provenance.
Then the structural moves (fix once, not N times), tagged TH1, TH2, …

## Confirmed findings (ranked by priority)
| id | TH | tier | sev | conf | surface · lens | file:line / flow | problem → smallest safe fix | owner | effort |
|---|---|---|---|---|---|---|---|---|---|

## Needs-human (≤3)
| id | decision required | why the repo can't settle it |
|---|---|---|

## Unverified low upgrades (optional, terse)
| surface · lens | file:line | upgrade |
|---|---|---|
Never apply-eligible, never affect the decision — polish for a human to cherry-pick.

## Apply set
Grouped by owner; union of allowed_paths per batch; the Approved-by each batch needs
(audit → @karl-dev-piqc · deliverables → @fable-dev-piqc · entitlements/context →
@ish-dev-piqc @ki-dev-piqc, isolate in its own batch · supabase → @rv61).
Handoff: create plans/fable/approval-<run-id>.md, then /fable-apply <run-id> <finding-ids>.

## Non-findings
Key risks checked with no defect confirmed (one line each — what was checked, what showed it clean).

## Telemetry
candidates <n> → confirmed <n> · refuted <n> · needs-human <n> · CI-duplicates suppressed <n> ·
agents <n> · notable caps hit <cells>
```

Rules: macro verdict always precedes findings (structural story first). Apply-order guidance:
macro/structural (TH-tagged) fixes land before the micro rows under them — a structural change
reshapes the very lines micro upgrades target.
