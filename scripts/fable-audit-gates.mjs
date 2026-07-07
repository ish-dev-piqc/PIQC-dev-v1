#!/usr/bin/env node
// =============================================================================
// fable-audit-gates — deterministic-gate inventory (Phase B item 7).
//
//   node scripts/fable-audit-gates.mjs [--pretty]
//
// Reads .github/workflows/piqc-discipline.yml and emits which mechanical rule
// each CI step covers, so the LLM audit never wastes a finding restating a
// deterministically-caught failure — and so a MISSING gate (renamed/removed
// step) is detected instead of silently assumed. Exit 1 if a rule in the map
// has no matching step (the suppression list would be lying).
// =============================================================================

import { readFileSync, existsSync } from 'node:fs';

// Step name (as it appears in the workflow) → rules it covers. When a step is
// renamed, update BOTH the workflow and this map — the presence check below
// fails loudly on drift.
const RULE_MAP = {
  "Cross-mode imports (site/audit/sotr don't import from each other)":
    ['cross-mode-imports (site/audit/sotr only — sponsor/deliverables/cra NOT covered)'],
  'Raw Tailwind color classes (use text-fg-*)':
    ['raw gray/slate/zinc/neutral text classes'],
  'Components must not import supabase directly':
    ['supabase import in src/components (non-type)'],
  'Adapters must be pure (no supabase import)':
    ['supabase import in src/lib/*/*Adapter.ts'],
  'Realtime subscriptions belong in context layer':
    ['.channel(/postgres_changes in src/components'],
  'Forbid `any` types in src/lib':
    [': any / as any in src/lib (non-test)'],
  'Migrations are append-only':
    ['edits to merged supabase/migrations files'],
  'DB schema change should update TS type mirror':
    ['migration without src/types change (warning only)'],
  'No console.log in non-test code':
    ['console.log/debug in added non-test lines'],
  'No vitest timestamp litter at repo root':
    ['vitest.config.ts.timestamp-* files'],
  'New API/adapter files have tests':
    ['new *Api.ts / *Adapter.ts without sibling test'],
  'Plan MD referenced in PR body':
    ['PR body must reference a lowercase plans/<dir>/<file>.md path'],
  'Typecheck (tsc --noEmit)':
    ['type errors anywhere in tsconfig.app scope'],
  'Tests (vitest)':
    ['any failing vitest test'],
};

export function gatesInventory(workflowText) {
  const text = workflowText ?? (
    existsSync('.github/workflows/piqc-discipline.yml')
      ? readFileSync('.github/workflows/piqc-discipline.yml', 'utf8')
      : ''
  );
  const stepNames = [...text.matchAll(/^\s*- name:\s*(.+)\s*$/gm)].map((m) =>
    m[1].replace(/^['"]|['"]$/g, ''),
  );
  const present = new Set(stepNames);
  const gates = [];
  const missing = [];
  for (const [step, rules] of Object.entries(RULE_MAP)) {
    if (present.has(step)) {
      gates.push({ name: step, status: 'present', covered_rules: rules });
    } else {
      missing.push(step);
      gates.push({ name: step, status: 'MISSING — step renamed or removed', covered_rules: rules });
    }
  }
  const unmapped = stepNames.filter(
    (s) => !(s in RULE_MAP) && !/^(Set up Node|Install dependencies)$/.test(s),
  );
  return { gates, missing_steps: missing, unmapped_steps: unmapped };
}

// CLI entrypoint (skipped when imported by the manifest script).
if (import.meta.url === `file://${process.argv[1]}`) {
  const pretty = process.argv.includes('--pretty');
  const inv = gatesInventory();
  process.stdout.write(JSON.stringify(inv, null, pretty ? 2 : 0) + '\n');
  if (inv.missing_steps.length > 0) process.exit(1);
}
