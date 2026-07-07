// Unit tests for the fable-audit Phase B pure core (scripts/lib/fableAudit.mjs)
// and the gates inventory. The CLIs are exercised end-to-end against real git
// history in the PR verification steps; these tests lock the pure logic.

import { describe, it, expect } from 'vitest';
import {
  parseCodeowners, ownerFor, exportedSymbols, diffExports,
  buildReverseImportGraph, resolveRelative, classifyRisk,
  manifestDigest, runId, matchSurface, isDenied,
} from '../lib/fableAudit.mjs';
import { gatesInventory } from '../fable-audit-gates.mjs';

describe('parseCodeowners / ownerFor', () => {
  const rules = parseCodeowners([
    '# heading',
    '/src/lib/audit/                   @karl-dev-piqc',
    '/src/types/sponsor/               @ki-dev-piqc @ish-dev-piqc',
    '/supabase/                        @rv61',
    'not an ownership line',
  ].join('\n'));

  it('parses prefix + owners from the markdown table lines', () => {
    expect(rules).toHaveLength(3);
    expect(rules[1]).toEqual({ prefix: 'src/types/sponsor/', owners: ['@ki-dev-piqc', '@ish-dev-piqc'] });
  });

  it('longest-prefix wins and misses fall back to the 2-reviewer default', () => {
    expect(ownerFor('src/lib/audit/auditApi.ts', rules)).toBe('@karl-dev-piqc');
    expect(ownerFor('src/types/sponsor/index.ts', rules)).toBe('@ki-dev-piqc @ish-dev-piqc');
    expect(ownerFor('supabase/migrations/x.sql', rules)).toBe('@rv61');
    expect(ownerFor('src/components/dashboard/site/TodayTab.tsx', rules)).toBe('unowned — 2-reviewer default');
  });
});

describe('exportedSymbols / diffExports', () => {
  it('collects exported functions, consts, classes, types, enums, re-exports, default', () => {
    const src = `
      export function fnA() {}
      export const constB = 1, constC = 2;
      export class ClassD {}
      export interface TypeE { x: number }
      export type TypeF = string;
      export enum EnumG { X }
      export { original as aliasH } from './other';
      export type { TypeI } from './other';
      export default function main() {}
      function notExported() {}
    `;
    const { values, types } = exportedSymbols(src);
    expect([...values].sort()).toEqual(['ClassD', 'EnumG', 'aliasH', 'constB', 'constC', 'default', 'fnA']);
    expect([...types].sort()).toEqual(['TypeE', 'TypeF', 'TypeI']);
  });

  it('diffExports reports added and removed names', () => {
    const before = exportedSymbols('export function a() {}\nexport function b() {}');
    const after = exportedSymbols('export function b() {}\nexport function c() {}');
    expect(diffExports(before, after)).toEqual({ added: ['c'], removed: ['a'] });
  });
});

describe('resolveRelative / buildReverseImportGraph', () => {
  it('resolves ./, ../, extensionless, and index imports', () => {
    const files = new Set([
      'src/lib/a.ts', 'src/lib/dir/index.ts', 'src/components/B.tsx',
    ]);
    expect(resolveRelative('src/components/B.tsx', '../lib/a', files)).toBe('src/lib/a.ts');
    expect(resolveRelative('src/components/B.tsx', '../lib/dir', files)).toBe('src/lib/dir/index.ts');
    expect(resolveRelative('src/lib/a.ts', './missing', files)).toBeNull();
  });

  it('builds the reverse graph and surfaces unresolved edges', () => {
    const files = new Map([
      ['src/lib/a.ts', 'export const x = 1;'],
      ['src/ui/B.tsx', "import { x } from '../lib/a';\nexport const B = x;"],
      ['src/ui/C.tsx', "import { B } from './B';\nconst lazy = import('./missing-' + name);"],
    ]);
    const { importersOf, unresolved } = buildReverseImportGraph(files);
    expect([...importersOf.get('src/lib/a.ts')!]).toEqual(['src/ui/B.tsx']);
    expect([...importersOf.get('src/ui/B.tsx')!]).toEqual(['src/ui/C.tsx']);
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0].reason).toBe('computed import specifier');
  });

  it('ignores package imports (no repo edge, no unresolved noise)', () => {
    const files = new Map([['src/a.ts', "import ts from 'typescript'; export const a = ts;"]]);
    const { importersOf, unresolved } = buildReverseImportGraph(files);
    expect(importersOf.size).toBe(0);
    expect(unresolved).toHaveLength(0);
  });
});

describe('classifyRisk (surfaces.md trigger table)', () => {
  const base = { exportsChangedWithConsumers: [], realtimeTouched: [] };

  it('T3 on entitlements / migrations / provenance / mode wiring', () => {
    expect(classifyRisk({ ...base, changedFiles: ['src/lib/entitlements.ts'] }).tier).toBe('T3');
    expect(classifyRisk({ ...base, changedFiles: ['supabase/migrations/2026_x.sql'] }).tier).toBe('T3');
    expect(classifyRisk({ ...base, changedFiles: ['src/components/deliverables/ContentOriginBadge.tsx'] }).tier).toBe('T3');
    expect(classifyRisk({ ...base, changedFiles: ['src/context/ModeContext.tsx'] }).tier).toBe('T3');
  });

  it('T2 on changed exports with consumers; T1 otherwise', () => {
    expect(classifyRisk({
      changedFiles: ['src/lib/site/dateUtils.ts'],
      exportsChangedWithConsumers: [{ file: 'src/lib/site/dateUtils.ts', symbols: ['addMonths'], consumerCount: 3 }],
      realtimeTouched: [],
    }).tier).toBe('T2');
    expect(classifyRisk({ ...base, changedFiles: ['src/lib/site/labels.ts'] }).tier).toBe('T1');
  });
});

describe('digest / run id / scope helpers', () => {
  it('digest is order-insensitive and identity-sensitive', () => {
    const d1 = manifestDigest('aaa', 'bbb', ['x.ts', 'y.ts']);
    const d2 = manifestDigest('aaa', 'bbb', ['y.ts', 'x.ts']);
    const d3 = manifestDigest('aaa', 'ccc', ['x.ts', 'y.ts']);
    expect(d1).toBe(d2);
    expect(d1).not.toBe(d3);
    expect(d1).toHaveLength(12);
  });

  it('runId matches the FA-<base7>-<head7>-<digest12> contract', () => {
    expect(runId('abcdef0123456', '9876543210abc', 'd1d2d3d4d5d6')).toBe('FA-abcdef0-9876543-d1d2d3d4d5d6');
  });

  it('surface matching + denylist', () => {
    expect(matchSurface('src/lib/audit/auditApi.ts')).toBe('audit');
    expect(matchSurface('src/context/ModeContext.tsx')).toBe('cra');
    expect(matchSurface('supabase/migrations/x.sql')).toBe('shared');
    expect(matchSurface('src/main.tsx')).toBeNull();
    expect(isDenied('website/index.html')).toBe(true);
    expect(isDenied('src/lib/site/siteApi.ts')).toBe(false);
  });
});

describe('gatesInventory', () => {
  it('marks mapped steps present and detects missing/renamed steps', () => {
    const workflow = [
      '      - name: Typecheck (tsc --noEmit)',
      '      - name: Tests (vitest)',
      "      - name: Cross-mode imports (site/audit/sotr don't import from each other)",
      '      - name: Some Brand New Check',
    ].join('\n');
    const inv = gatesInventory(workflow);
    const byName = Object.fromEntries(inv.gates.map((g) => [g.name, g.status]));
    expect(byName['Typecheck (tsc --noEmit)']).toBe('present');
    expect(byName['No console.log in non-test code']).toContain('MISSING');
    expect(inv.missing_steps.length).toBeGreaterThan(0);
    expect(inv.unmapped_steps).toEqual(['Some Brand New Check']);
  });

  it('is fully green against the real workflow file', () => {
    // Runs against the actual repo workflow — locks RULE_MAP ↔ workflow sync.
    const inv = gatesInventory();
    expect(inv.missing_steps).toEqual([]);
    expect(inv.unmapped_steps).toEqual([]);
  });
});
