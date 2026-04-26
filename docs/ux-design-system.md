# Vendor Audit UX/UI Design System Prompt

## Purpose
Create a clean, implementation-oriented UX/UI system for the **PIQC Vendor Audit workflow**.

This document is intended for Claude Code so product, UX, and engineering remain aligned during a token-efficient build.

The goal is not to design a generic audit dashboard. The goal is to design a **human + AI vendor audit workspace** that reduces cognitive load, structures audit preparation, and turns parsed protocol intelligence into usable audit deliverables.

---

## Core Product Positioning
PIQC is an AI-powered protocol intelligence system for clinical trials.

In Vendor Audit mode, PIQC should help an auditor move from:

**vendor notification -> audit intake -> AI enrichment -> protocol-aware risk context -> draft deliverables -> human review -> final export**

PIQC is not:
- a generic chatbot
- a document storage system
- a reactive compliance tracker
- a research dump interface

PIQC is:
- a protocol-aware audit preparation system
- a human-in-the-loop drafting environment
- a workflow that reduces manual reading, manual research, and blank-page drafting

---

## UX Principles
The UI must:
- reduce cognitive load
- feel calm, structured, and obvious
- make the next action clear
- keep the auditor inside a guided workflow
- avoid unnecessary dashboard complexity
- avoid showing raw AI output as the primary interface

The product should feel like:
- a structured audit copilot
- a drafting system with memory
- a low-friction collaboration loop between auditor and AI

The product should not feel like:
- a busy operations center
- a generic LLM chat screen
- a dense enterprise dashboard

---

## Scope of This Design
This design is for the **Vendor Audit workflow only**.

It does not yet need to fully solve:
- investigator site audit workflow
- broad enterprise reporting systems
- high-volume queue operations
- final mature UX patterns for every audit team

Some early UX assumptions may remain flexible because this is a new AI-native tool category and user feedback will be important over time.

---

## Human Workflow Foundation
The vendor audit begins when the auditor receives notification that a vendor has been selected to support a study.

The auditor then needs to:
1. create a new vendor audit
2. enter known audit details
3. manually determine the vendor service category based on contract review
4. connect the audit to the canonical parsed protocol
5. let AI perform a vendor deep-dive using web research plus protocol context
6. review the AI-populated questionnaire and protocol-aware risk summary
7. use that approved context to generate downstream audit deliverables
8. repeat human review after each AI-supported drafting step
9. approve final deliverables for export

---

## Critical Product Truths

### 1. Vendor service category is manually entered
The vendor service category should **not** be inferred automatically.

It must be manually entered by the auditor after contract review, because the auditor determines the applicable contracted services supporting protocol execution.

### 2. PIQC begins with protocol intelligence, but not protocol alone
PIQC's core engine parses the canonical protocol into structured data.

That parsed protocol gives PIQC context such as:
- therapeutic space
- primary endpoints
- secondary endpoints
- protocol-derived support implications

This context is used to create a **risk-informed view** of the vendor's relevance to the study.

### 3. AI enrichment should not end in a research dump
After the vendor deep-dive, the UI should not primarily show raw research output.

Instead, AI should use gathered context to populate:
- the standard vendor questionnaire
- a protocol-aware risk summary

### 4. Human review is continuous, not delayed until the end
The workflow should not be:
- AI generates everything at once
- human reviews only at the end

The workflow should be:
- AI generates a meaningful draft or summary
- auditor reviews, edits, approves, or refines
- AI uses that approved state for the next workflow step

This repeated pattern is the core human + AI collaboration model.

### 5. Do not overbuild queue management in V1
A human auditor may only manage about 2 audits per month, with some reporting backlog after audit conduct.

Do not over-optimize for a complex queue dashboard in the initial build.

A simple, clean worklist or audit index is sufficient as long as the auditor can see:
- what audit is active
- what stage it is in
- what deliverable is currently being drafted or reviewed
- whether post-audit reporting is still outstanding

---

## Primary Workflow Stages
Use a simple stage model that supports clarity and lightweight status tracking.

Recommended stages:
1. New Audit Intake
2. Vendor Research / AI Enrichment
3. Questionnaire Review
4. Scope & Risk Review
5. Confirmation Letter Drafting
6. Agenda Drafting
7. Checklist Drafting
8. Audit Conduct Support
9. Audit Report Drafting
10. Final Review / Export

These stages do not need to be visually elaborate. Stage labels and progress states are enough.

---

## Core Deliverables
PIQC should support drafting and refinement of the following vendor audit deliverables:
- vendor questionnaire
- email communications
- audit confirmation letter
- audit agenda
- audit checklist
- audit report draft

These deliverables must not be generic templates detached from the protocol.

They should be informed by:
- parsed protocol context
- manual vendor service category input
- AI vendor enrichment
- auditor edits and approvals

---

## The Questionnaire as the Primary Working Artifact
The standard vendor questionnaire should function as the main working artifact early in the workflow.

It should:
- be pre-populated after AI enrichment
- contain vendor background and pre-qualification information
- be editable by the auditor
- carry forward information into later deliverables
- help define and refine audit scope

Think of the questionnaire as a living data object, not just a document.

It should serve as a reusable source for downstream drafting.

---

## The Risk Summary as the Secondary Decision Layer
Alongside the questionnaire, PIQC should generate a **protocol-aware risk summary**.

This summary should explain why the vendor matters in context of the study and protocol.

It should be informed by:
- therapeutic space
- primary endpoints
- secondary endpoints
- the likely impact of the vendor's services on study execution risk

The risk summary should help the auditor quickly understand:
- where to focus attention
- why the vendor is relevant
- where audit scope may need to go deeper

This should be concise, structured, and easy to scan.

---

## Recommended Information Architecture

### Screen 1: Audit Index / Worklist
Purpose: give the auditor a lightweight overview of current vendor audits.

Show:
- study / protocol
- vendor name
- vendor service category
- tentative audit date
- current stage
- draft status
- reporting status if applicable

Design note:
Keep this simple. A clean list or compact table is enough.

### Screen 2: New Vendor Audit Intake
Purpose: let the auditor create a new audit from vendor selection notice.

Inputs:
- vendor name
- study / protocol
- therapeutic space if needed
- tentative audit date
- vendor service category (manual input after contract review)
- notes / known context

Primary action:
- create audit and trigger AI enrichment

### Screen 3: AI Enrichment Review Workspace
Purpose: show the first useful outputs after AI research.

Primary object:
- pre-populated standard vendor questionnaire

Secondary object:
- protocol-aware risk summary

Optional tertiary object:
- expandable source/research traceability

Do not make raw research the default focus.

### Screen 4: Questionnaire Editing Workspace
Purpose: let the auditor review, edit, and approve the questionnaire.

Needs:
- editable fields
- clear save / approve actions
- ability to preserve approved context for downstream drafting

### Screen 5: Deliverable Drafting Workspace
Purpose: support drafting of confirmation letter, agenda, checklist, and later report using approved context.

Needs:
- document-style drafting view
- visible relationship to approved questionnaire/risk context
- review and approval actions after each AI-generated draft

### Screen 6: Final Review / Export
Purpose: let the auditor finalize outputs.

Needs:
- export-ready deliverable states
- clear final approval markers
- simple export options

---

## Layout Guidance
Use a calm, structured workspace.

A practical pattern is:
- left: audit navigation / stage navigation
- center: current primary artifact (questionnaire or deliverable draft)
- right: protocol-aware risk summary, AI guidance, or traceability context

This layout is a recommendation, not a hard requirement.

Claude Code may choose a simpler or cleaner layout if it preserves the workflow logic and keeps the primary artifact central.

---

## Human-in-the-Loop Rules
Each meaningful AI output should have a human checkpoint.

Required human checkpoints include:
- after AI populates the questionnaire
- after risk summary generation
- after each major deliverable draft
- before final export

The auditor must be able to:
- edit
- approve
- request regeneration/refinement
- carry approved state forward

The approved state should become the source of truth for the next AI-assisted step.

---

## Design Constraints for Clean Build
Prioritize:
- simple components
- obvious workflow states
- minimal but clear status labels
- token-efficient implementation
- reusability across multiple deliverable screens

Avoid:
- complex dashboard widgets
- unnecessary visualizations
- multiple competing navigation systems
- over-engineering for future edge cases
- treating AI as a separate chat product

---

## What Can Stay Flexible in V1
Claude Code can make reasonable first-pass UX assumptions around:
- whether the worklist is card-based or table-based
- whether stage navigation is top, left, or inline
- exact visual styling of summary panels
- whether drafting is split across tabs, steps, or route-based screens

As long as the build preserves these non-negotiables:
- intake comes before enrichment
- enrichment populates the questionnaire
- risk summary is protocol-aware
- human review happens after each AI-supported step
- questionnaire acts as a reusable working artifact
- downstream deliverables build from approved context

---

## Build Intent for Claude Code
Design and implement the Vendor Audit UX/UI as a clean, low-cognitive-load workflow that starts with audit intake, uses AI to enrich vendor context, populates a standard questionnaire, generates a protocol-aware risk summary, and then supports iterative drafting of audit deliverables through repeated human approval loops.

Optimize for implementation clarity, not visual novelty.

The build should feel:
- professional
- calm
- structured
- audit-ready
- easy to extend later

---

## Ultra-Short Build Summary
Build PIQC Vendor Audit mode as a human-in-the-loop drafting workflow.

Flow:
- new audit intake
- manual vendor service category entry
- AI vendor enrichment
- pre-populated questionnaire
- protocol-aware risk summary
- iterative drafting of confirmation letter, agenda, checklist, and report
- human approval after each step
- final export
