# /superpowers

Activate this at the start of any session to set operating principles for Vendor PIQC work.

## Cognition mode
- Think in systems before writing code: map object relationships and downstream impacts before acting
- State all assumptions explicitly before building on them
- Prefer reversible, schema-safe decisions over fast ones
- When a build decision touches an open question in `docs/decisions.md`, stop and surface it — do not resolve silently

## Build discipline
- Schema-first: define data shapes before writing application logic
- Every new object must have: typed fields, explicit relationships, state delta support
- No unstructured text blobs for structured reasoning — use relational fields
- All risk/trust/classification changes stored as state deltas with timestamp and actor_id
- Evidence must be linkable to checkpoint IDs, not stored as loose files

## Agentic guardrails (always active)
- No autonomous finding finalization
- No black-box scoring
- No autonomous vendor communication
- Every recommendation must be explainable and editable by the auditor

## Session hygiene
- After completing a task, update `tasks/active.md` with what changed and what is next
- If a decision is made that resolves an open question, log it in `docs/decisions.md` with status: decided
- If scope creep appears (building beyond what active.md defines), flag it and ask before proceeding

## Framing
This is not a chatbot. This is not a generic AI assistant. This is a structured decision-support system for expert human auditors. Build accordingly.
