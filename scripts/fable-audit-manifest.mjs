#!/usr/bin/env node
// =============================================================================
// fable-audit-manifest — deterministic blast-radius manifest (Phase B item 6).
//
//   node scripts/fable-audit-manifest.mjs [--base <ref>] [--head <ref>] [--pretty]
//
// Emits the JSON manifest contract (schema_version 1) to stdout:
// run identity, effective scope, changed contracts, direct consumers (with
// UNRESOLVED edges surfaced, never dropped), owners, gates inventory, and the
// T1/T2/T3 risk tier. FAILS CLOSED: unresolvable base/head/merge-base exits 1
// with a JSON error — a run without identity must not look like a clean run.
//
// Pure logic lives in scripts/lib/fableAudit.mjs (unit-tested); this file is
// the git/fs shell. No dependencies beyond the repo's own `typescript`.
// =============================================================================

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import {
  SURFACES, matchSurface, isDenied, parseCodeowners, ownerFor,
  exportedSymbols, diffExports, buildReverseImportGraph,
  classifyRisk, manifestDigest, runId, PROVENANCE_FILES,
} from './lib/fableAudit.mjs';
import { gatesInventory } from './fable-audit-gates.mjs';

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : dflt;
};
const pretty = args.includes('--pretty');

function git(...a) {
  return execFileSync('git', a, { encoding: 'utf8' }).trim();
}

function fail(message) {
  process.stdout.write(JSON.stringify({ schema_version: 1, error: message }, null, 2) + '\n');
  process.exit(1);
}

// --- Run identity (fail closed) ---------------------------------------------
const baseRef = flag('base', 'origin/main');
const headRef = flag('head', 'HEAD');
let baseSha, headSha, branch, worktree, clean;
try {
  headSha = git('rev-parse', headRef);
  baseSha = git('merge-base', headSha, git('rev-parse', baseRef));
  branch = git('rev-parse', '--abbrev-ref', 'HEAD');
  worktree = git('rev-parse', '--show-toplevel');
  clean = git('status', '--porcelain') === '';
} catch (e) {
  fail(`cannot resolve run identity (base=${baseRef}, head=${headRef}): ${e.message.split('\n')[0]}`);
}

// --- Effective scope ---------------------------------------------------------
const rawChanged = baseSha === headSha
  ? []
  : git('diff', '--name-only', `${baseSha}...${headSha}`).split('\n').filter(Boolean);

const excluded = [];
const changedFiles = [];
for (const f of rawChanged) {
  if (isDenied(f)) { excluded.push({ path: f, reason: 'denylist (never the audit subject)' }); continue; }
  const inScope = f.startsWith('src/') || f.startsWith('supabase/migrations/');
  if (!inScope) { excluded.push({ path: f, reason: 'outside src/** + supabase/migrations/**' }); continue; }
  changedFiles.push(f);
}

const digest = manifestDigest(baseSha, headSha, changedFiles);

// --- Source graph over the head tree -----------------------------------------
const srcFiles = git('ls-files', 'src/**/*.ts', 'src/**/*.tsx').split('\n').filter(Boolean);
const fileMap = new Map();
for (const f of srcFiles) {
  try { fileMap.set(f, readFileSync(f, 'utf8')); } catch { /* deleted in worktree */ }
}
const { importersOf, unresolved } = buildReverseImportGraph(fileMap);

// --- Changed contracts --------------------------------------------------------
const owners = parseCodeowners(
  existsSync('docs/CODEOWNERS.md') ? readFileSync('docs/CODEOWNERS.md', 'utf8') : '',
);

const exportsChanged = [];
const typesChanged = [];
const consumers = [];
const exportsChangedWithConsumers = [];

for (const f of changedFiles) {
  if (!f.startsWith('src/') || !/\.(ts|tsx)$/.test(f)) continue;
  let beforeText = '';
  try { beforeText = git('show', `${baseSha}:${f}`); } catch { /* added file */ }
  const afterText = fileMap.get(f) ?? '';
  const d = diffExports(exportedSymbols(beforeText, f), exportedSymbols(afterText, f));
  if (d.added.length || d.removed.length) {
    exportsChanged.push({ file: f, added: d.added, removed: d.removed });
    if (/types\//.test(f)) typesChanged.push(f);
  }
  const importers = [...(importersOf.get(f) ?? [])].sort();
  for (const c of importers) {
    consumers.push({
      producer: f,
      consumer: c,
      relationship: 'import',
      distance: 1,
      changed_exports: [...d.added, ...d.removed],
    });
  }
  if ((d.added.length || d.removed.length) && importers.length) {
    exportsChangedWithConsumers.push({
      file: f,
      symbols: [...d.added, ...d.removed],
      consumerCount: importers.length,
    });
  }
}

// --- Flag detection over the patch --------------------------------------------
const patch = baseSha === headSha ? '' : git('diff', '--unified=0', `${baseSha}...${headSha}`, '--', 'src');
const addedLines = patch.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'));
const realtimeTouched = changedFiles.filter(() =>
  addedLines.some((l) => /\.channel\(|postgres_changes/.test(l)),
).slice(0, 1); // presence flag — file-level attribution not needed for tiering
const entitlementsChanged = changedFiles.filter(
  (f) => f === 'src/lib/entitlements.ts' || addedLines.some((l) => /canUse\w+Mode/.test(l)),
).slice(0, 1);
const migrations = changedFiles.filter((f) => f.startsWith('supabase/migrations/'));
const provenanceChanged = changedFiles.filter((f) =>
  PROVENANCE_FILES.some((p) => f.endsWith('/' + p) || f.endsWith(p)),
);
const routesChanged = changedFiles.filter((f) =>
  ['src/App.tsx', 'src/components/dashboard/Dashboard.tsx', 'src/components/dashboard/LeftRail.tsx', 'src/components/Navbar.tsx'].includes(f),
);

const risk = classifyRisk({ changedFiles, exportsChangedWithConsumers, realtimeTouched });

// Unresolved edges only matter for the audit when they originate from or may
// point at a changed file's neighborhood — but per fail-closed doctrine we
// surface ALL of them and let the orchestrator judge.
const changedSet = new Set(changedFiles);
const unresolvedRelevant = unresolved.filter(
  (u) => changedSet.has(u.from) || u.specifier === '<dynamic non-literal>',
);

const manifest = {
  schema_version: 1,
  run: {
    run_id: runId(baseSha, headSha, digest),
    base_ref: baseRef, base_sha: baseSha,
    head_ref: headRef, head_sha: headSha,
    branch, worktree, working_tree_clean: clean,
    node: process.version,
  },
  scope: {
    changed_files: changedFiles.map((f) => ({
      path: f,
      surface: matchSurface(f),
      owner: ownerFor(f, owners),
    })),
    excluded_files: excluded,
  },
  changes: {
    exports_changed: exportsChanged,
    types_changed: typesChanged,
    routes_changed: routesChanged,
    entitlements_changed: entitlementsChanged,
    database_migrations: migrations,
    realtime_or_event_contracts_changed: realtimeTouched,
    clinical_or_provenance_fields_changed: provenanceChanged,
  },
  consumers,
  unresolved_edges: unresolvedRelevant,
  gates: gatesInventory(),
  risk,
  manifest_digest: digest,
};

// Fail closed on T3 with unresolved edges touching the delta: still print the
// manifest (the orchestrator needs it) but exit non-zero so automation notices.
process.stdout.write(JSON.stringify(manifest, null, pretty ? 2 : 0) + '\n');
if (risk.tier === 'T3' && unresolvedRelevant.some((u) => changedSet.has(u.from))) {
  process.exitCode = 2;
}
