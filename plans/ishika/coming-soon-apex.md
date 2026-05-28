---
owner: ish-dev-piqc
feature: coming-soon-apex
status: active
started: 2026-05-28
target_pr:
---

# Coming-soon mode at piqclinical.com (apex)

## Context

Public-facing launch domain `piqclinical.com` (apex) currently has no A record. We want to point it at the existing VPS, serve the same React app, and gate three small UI differences on the apex hostname: hide login/Get-Started CTAs (Hero + Navbar desktop + Navbar mobile), hide the Contact form, show a thin "Coming Soon" banner at the top. `dev.piqclinical.com` is untouched in both code-path behavior and on the VPS (separate bundle directory, separate nginx server block).

## Scope (files allowed)

- src/lib/comingSoonMode.ts
- src/components/ComingSoonBanner.tsx
- src/App.tsx
- src/components/Hero.tsx
- src/components/Navbar.tsx
- src/components/Contact.tsx

## Out of scope (files forbidden)

- src/lib/supabase.ts
- src/context/**
- supabase/**
- src/components/dashboard/**

## Architecture layers touched

- [ ] migration
- [ ] RPC
- [ ] adapter
- [ ] context
- [x] component
- [ ] test

## Mock data plan

None.

## Approved-by

Shared-infra files (App.tsx, Hero.tsx, Navbar.tsx, Contact.tsx) — Ishika (team lead, verbal approval to execute as part of apex-launch infra work).

## Verification

- [ ] `https://piqclinical.com` renders coming-soon banner, no Sign In / Get Started buttons (desktop + mobile), no Contact section
- [ ] `https://dev.piqclinical.com` renders exactly as today (banner absent, all CTAs present, Contact form present)
- [ ] Chatbot still works on both hosts
- [ ] Hero / ValueProps / Pricing / FAQ / Footer render on both hosts
