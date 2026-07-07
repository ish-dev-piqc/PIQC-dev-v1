// =============================================================================
// fable-audit Phase B — pure core for the deterministic run manifest.
//
// Everything here is side-effect-free and unit-tested (scripts/__tests__/).
// The CLIs (scripts/fable-audit-manifest.mjs, scripts/fable-audit-gates.mjs)
// do the git/fs I/O and feed these functions.
//
// Plain .mjs (not .ts) on purpose: runs directly under any node ≥18 with zero
// build step — CI uses node 20, local runs use the scratchpad node. Types are
// documented via JSDoc; the module imports the repo's own `typescript` package
// for AST work, so no new dependencies.
// =============================================================================

import ts from 'typescript';
import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Baseline surface globs — mirrors .claude/skills/fable-audit/surfaces.md.
// Advisory scope map; the runtime diff is authoritative. Prefixes, not globs:
// matching is startsWith, which is all the layout needs.
// ---------------------------------------------------------------------------
export const SURFACES = {
  audit: ['src/lib/audit/', 'src/components/dashboard/audit/', 'src/types/audit/'],
  deliverables: ['src/lib/deliverables/', 'src/components/deliverables/', 'src/types/deliverables/'],
  sponsor: ['src/components/dashboard/sponsor/', 'src/types/sponsor/', 'src/lib/sponsor/'],
  cra: ['src/components/dashboard/cra/', 'src/context/ModeContext.tsx'],
  site: ['src/lib/site/', 'src/components/dashboard/site/'],
  'visit-execution': ['src/lib/visit-execution/', 'src/components/dashboard/visit-execution/', 'src/types/visit-execution/'],
  sotr: ['src/lib/sotr/', 'src/components/sotr/', 'src/types/sotr/'],
  context: ['src/context/'],
  shared: ['src/lib/entitlements.ts', 'supabase/migrations/'],
};

/** Paths that are never the audit subject, even when they show in a diff. */
export const DENYLIST = ['website/', 'plans/', '.claude/', 'docs/', 'landing.html'];

/** Provenance/attribution surfaces — changing one is a T3 trigger. */
export const PROVENANCE_FILES = [
  'ContentOriginBadge.tsx',
  'DeliverableReviewBadge.tsx',
  'DeliverableTraceabilityDrawer.tsx',
  'TraceabilityDrawer.tsx',
  'lineageAdapter.ts',
  'lineageApi.ts',
  'sourceEvidenceAdapter.ts',
  'visitNameNormalize.ts',
];

export function matchSurface(path) {
  for (const [name, prefixes] of Object.entries(SURFACES)) {
    if (prefixes.some((p) => path === p || path.startsWith(p))) return name;
  }
  return null;
}

export function isDenied(path) {
  return DENYLIST.some((p) => path === p || path.startsWith(p));
}

// ---------------------------------------------------------------------------
// CODEOWNERS (docs/CODEOWNERS.md — a markdown doc, not .github/CODEOWNERS).
// Ownership lines look like:  /src/lib/audit/    @karl-dev-piqc
// Longest-prefix wins, mirroring gitignore-style specificity.
// ---------------------------------------------------------------------------
export function parseCodeowners(mdText) {
  const rules = [];
  for (const line of mdText.split('\n')) {
    const m = /^\s*(\/\S+)\s+((?:@[\w-]+\s*)+)\s*$/.exec(line);
    if (!m) continue;
    rules.push({
      prefix: m[1].replace(/^\//, ''),
      owners: m[2].trim().split(/\s+/),
    });
  }
  return rules;
}

export function ownerFor(path, rules) {
  let best = null;
  for (const r of rules) {
    if (path === r.prefix || path.startsWith(r.prefix)) {
      if (!best || r.prefix.length > best.prefix.length) best = r;
    }
  }
  return best ? best.owners.join(' ') : 'unowned — 2-reviewer default';
}

// ---------------------------------------------------------------------------
// Exported-symbol extraction (TS compiler AST — no type checking needed).
// Returns { values: Set<string>, types: Set<string> } of EXPORTED names.
// ---------------------------------------------------------------------------
export function exportedSymbols(sourceText, fileName = 'file.tsx') {
  const sf = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const values = new Set();
  const types = new Set();

  const hasExport = (node) =>
    (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) !== 0;
  const isDefault = (node) =>
    (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Default) !== 0;

  for (const node of sf.statements) {
    // `export default function main()` exports ONLY 'default' — the local
    // name is not importable, so it must not count as a named export.
    if (ts.isFunctionDeclaration(node) && hasExport(node) && node.name && !isDefault(node)) {
      values.add(node.name.text);
    } else if (ts.isClassDeclaration(node) && hasExport(node) && node.name && !isDefault(node)) {
      values.add(node.name.text);
    } else if (ts.isVariableStatement(node) && hasExport(node)) {
      for (const d of node.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) values.add(d.name.text);
      }
    } else if ((ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) && hasExport(node)) {
      types.add(node.name.text);
    } else if (ts.isEnumDeclaration(node) && hasExport(node)) {
      values.add(node.name.text);
    } else if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const spec of node.exportClause.elements) {
        (node.isTypeOnly || spec.isTypeOnly ? types : values).add(spec.name.text);
      }
    } else if (ts.isExportAssignment(node)) {
      values.add('default');
    }
    // `export default function/class Name` carries the Default modifier:
    if (
      (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) &&
      (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Default) !== 0
    ) {
      values.add('default');
    }
  }
  return { values, types };
}

/** Diff two exportedSymbols results → { added: [], removed: [] } (values+types). */
export function diffExports(before, after) {
  const all = (s) => new Set([...s.values, ...s.types]);
  const b = all(before);
  const a = all(after);
  return {
    added: [...a].filter((x) => !b.has(x)).sort(),
    removed: [...b].filter((x) => !a.has(x)).sort(),
  };
}

// ---------------------------------------------------------------------------
// Reverse import graph. Relative specifiers only — the app has no path
// aliases (tsconfig has no `paths`), so non-relative imports are packages.
// Dynamic import() with a non-literal argument is recorded as UNRESOLVED,
// never silently dropped (fail-closed doctrine).
// ---------------------------------------------------------------------------
const RESOLVE_SUFFIXES = ['', '.ts', '.tsx', '.d.ts', '/index.ts', '/index.tsx'];

export function resolveRelative(fromFile, specifier, fileSet) {
  const dir = fromFile.split('/').slice(0, -1);
  const parts = specifier.split('/');
  const stack = [...dir];
  for (const part of parts) {
    if (part === '.' || part === '') continue;
    else if (part === '..') stack.pop();
    else stack.push(part);
  }
  const base = stack.join('/');
  for (const suf of RESOLVE_SUFFIXES) {
    if (fileSet.has(base + suf)) return base + suf;
  }
  return null;
}

/**
 * @param files Map<string, string> — repo-relative path → source text
 * @returns {{ importersOf: Map<string, Set<string>>, unresolved: Array<{from: string, specifier: string, reason: string}> }}
 */
export function buildReverseImportGraph(files) {
  const fileSet = new Set(files.keys());
  const importersOf = new Map();
  const unresolved = [];

  const record = (target, from) => {
    let set = importersOf.get(target);
    if (!set) importersOf.set(target, (set = new Set()));
    set.add(from);
  };

  for (const [path, text] of files) {
    const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

    const handleSpecifier = (spec, isLiteral) => {
      if (!isLiteral) {
        unresolved.push({ from: path, specifier: '<dynamic non-literal>', reason: 'computed import specifier' });
        return;
      }
      if (!spec.startsWith('.')) return; // package import — external, not a repo edge
      const target = resolveRelative(path, spec, fileSet);
      if (target) record(target, path);
      else unresolved.push({ from: path, specifier: spec, reason: 'relative specifier did not resolve to a repo file' });
    };

    const visit = (node) => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
        if (ts.isStringLiteral(node.moduleSpecifier)) handleSpecifier(node.moduleSpecifier.text, true);
      } else if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword
      ) {
        const arg = node.arguments[0];
        if (arg && ts.isStringLiteral(arg)) handleSpecifier(arg.text, true);
        else handleSpecifier(null, false);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return { importersOf, unresolved };
}

// ---------------------------------------------------------------------------
// Risk classification — mirrors surfaces.md's trigger table.
// ---------------------------------------------------------------------------
export function classifyRisk({ changedFiles, exportsChangedWithConsumers, realtimeTouched }) {
  const reasons = [];
  for (const f of changedFiles) {
    if (f === 'src/lib/entitlements.ts') reasons.push(`T3: entitlement gate changed (${f})`);
    else if (f.startsWith('supabase/migrations/')) reasons.push(`T3: migration (${f})`);
    else if (f === 'src/context/ModeContext.tsx') reasons.push(`T3: mode wiring (${f})`);
    else if (PROVENANCE_FILES.some((p) => f.endsWith('/' + p) || f.endsWith(p))) {
      reasons.push(`T3: provenance surface (${f})`);
    } else if (f.startsWith('src/components/auth/') || f === 'src/context/AuthContext.tsx') {
      reasons.push(`T3: auth (${f})`);
    }
  }
  if (reasons.length > 0) return { tier: 'T3', reasons };
  if (exportsChangedWithConsumers.length > 0) {
    return {
      tier: 'T2',
      reasons: exportsChangedWithConsumers.map(
        (e) => `T2: ${e.file} changed exports [${e.symbols.join(', ')}] with ${e.consumerCount} consumer(s)`,
      ),
    };
  }
  if (realtimeTouched.length > 0) {
    return { tier: 'T2', reasons: realtimeTouched.map((f) => `T2: realtime/event contract touched (${f})`) };
  }
  return { tier: 'T1', reasons: ['internal implementation change only'] };
}

// ---------------------------------------------------------------------------
// Digest — sha256 over the sorted changed-file list + base + head.
// ---------------------------------------------------------------------------
export function manifestDigest(baseSha, headSha, changedFiles) {
  const h = createHash('sha256');
  h.update(baseSha + '\n' + headSha + '\n' + [...changedFiles].sort().join('\n'));
  return h.digest('hex').slice(0, 12);
}

export function runId(baseSha, headSha, digest) {
  return `FA-${baseSha.slice(0, 7)}-${headSha.slice(0, 7)}-${digest}`;
}
