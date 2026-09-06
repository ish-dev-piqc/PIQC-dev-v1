import { ISA_DOMAIN_LABELS } from './labels';
import {
  BASELINE_DOCUMENTS,
  DEFAULT_SAMPLING_APPROACH,
  DOMAIN_DOCUMENTS,
  type StandardDocument,
} from './documentRequestVocabulary';
import type {
  DerivedCriticality,
  DocumentRequestContent,
  DocumentRequestItem,
  DocumentRequestItemBasis,
  IsaDomain,
  SiteScopeContent,
} from '../../types/audit';

// =============================================================================
// documentRequest — the Audit prep derivation (isa-document-request).
//
// Pure: no React, no Supabase, no model call. The document request of a site
// audit is a deterministic function of the site scope and the closed-world
// vocabulary:
//
//   baseline documents (every site audit)
//     → one line each, basis { kind: 'baseline' }
//   each scope module, in the scope's own order (criticality, then domain)
//     → that domain's standard set, basis { kind: 'module', domain,
//       criticality pinned at build }
//
// Same scope + same `now` → identical content (only built_at moves). The
// scope's module order is inherited, never re-sorted: that contract belongs
// to siteScope.ts, and the scope builder guarantees one module per domain.
//
// What the auditor changes afterwards — include / exclude, a note per line,
// lines they add — is keyed by the line's stable key, so a Rebuild merges it
// back (mergeRebuild) instead of losing it. Drift is the (domain,
// criticality) pairs the request was built from versus the live scope's
// modules; not detected: scope item changes inside a module, the scope's
// approval status, and vocabulary edits deployed after a build (ledgered).
// =============================================================================

/** The scope fields the derivation reads — structural, so this module never
 *  imports the Api layer. `SiteScope` from siteScopeApi satisfies it. */
export interface DocumentRequestScopeSource {
  id: string;
  content: SiteScopeContent;
}

export interface DocumentRequestScopeModule {
  isa_domain: IsaDomain;
  criticality: DerivedCriticality;
}

function standardItem(doc: StandardDocument, basis: DocumentRequestItemBasis): DocumentRequestItem {
  return {
    key: doc.key,
    title: doc.title,
    ...(doc.detail ? { detail: doc.detail } : {}),
    basis,
    included: true,
    note: '',
  };
}

export function buildDocumentRequestContent(
  scope: DocumentRequestScopeSource,
  now: string,
): DocumentRequestContent {
  const items: DocumentRequestItem[] = BASELINE_DOCUMENTS.map((doc) =>
    standardItem(doc, { kind: 'baseline' }),
  );
  for (const module of scope.content.modules) {
    for (const doc of DOMAIN_DOCUMENTS[module.isa_domain]) {
      items.push(
        standardItem(doc, {
          kind: 'module',
          isa_domain: module.isa_domain,
          criticality: module.criticality,
        }),
      );
    }
  }
  return {
    built_from: {
      scope_id: scope.id,
      scope_modules: scope.content.modules.map((m) => ({
        isa_domain: m.isa_domain,
        criticality: m.criticality,
      })),
      built_at: now,
    },
    items,
    sampling_approach: DEFAULT_SAMPLING_APPROACH,
    instructions: '',
  };
}

/** A rebuild that keeps what the auditor decided: `included` and `note`
 *  survive for every standard line with the same key (title, detail and
 *  basis come from the fresh build — the vocabulary or a criticality may
 *  have moved); lines the auditor added are kept, after the standard ones;
 *  standard lines no longer derivable are dropped. The letter fields carry
 *  over; built_from is the fresh build's. */
export function mergeRebuild(
  existing: DocumentRequestContent,
  fresh: DocumentRequestContent,
): DocumentRequestContent {
  const prior = new Map(existing.items.map((item) => [item.key, item]));
  const standard = fresh.items.map((item) => {
    const was = prior.get(item.key);
    return was ? { ...item, included: was.included, note: was.note } : item;
  });
  const auditor = existing.items.filter((item) => item.basis.kind === 'auditor');
  return {
    built_from: fresh.built_from,
    items: [...standard, ...auditor],
    sampling_approach: existing.sampling_approach,
    instructions: existing.instructions,
  };
}

/** Modules added to / removed from the scope since the request was built,
 *  and modules whose criticality changed. All zero = the request still
 *  describes the scope it was built from. */
export interface DocumentRequestDrift {
  added: number;
  removed: number;
  changed: number;
}

export function requestDrift(
  content: DocumentRequestContent,
  scopeModules: readonly DocumentRequestScopeModule[],
): DocumentRequestDrift {
  const built = new Map(content.built_from.scope_modules.map((m) => [m.isa_domain, m.criticality]));
  const live = new Map(scopeModules.map((m) => [m.isa_domain, m.criticality]));
  let added = 0;
  let removed = 0;
  let changed = 0;
  for (const [domain, criticality] of live) {
    const was = built.get(domain);
    if (was === undefined) added += 1;
    else if (was !== criticality) changed += 1;
  }
  for (const domain of built.keys()) {
    if (!live.has(domain)) removed += 1;
  }
  return { added, removed, changed };
}

export function hasDrift(drift: DocumentRequestDrift): boolean {
  return drift.added + drift.removed + drift.changed > 0;
}

// -----------------------------------------------------------------------------
// Grouping — one order for the workspace list and every letter renderer:
// baseline, the scope's modules in the scope's order, then any domain outside
// the scope that carries a line (auditor-added), then untagged auditor lines.
// The letter prints `heading` only; `criticality` is for the workspace chips
// — the site never sees the ranking.
// -----------------------------------------------------------------------------

export interface DocumentRequestGroup {
  key: string;
  heading: string;
  criticality: DerivedCriticality | null;
  items: DocumentRequestItem[];
}

export const BASELINE_GROUP_HEADING = 'Baseline documents';
export const ADDITIONAL_GROUP_HEADING = 'Additional documents';

const DOMAIN_ORDER = Object.keys(ISA_DOMAIN_LABELS) as IsaDomain[];

function domainOf(item: DocumentRequestItem): IsaDomain | null {
  return item.basis.kind === 'baseline' ? null : item.basis.isa_domain;
}

export function groupDocumentRequestItems(
  content: DocumentRequestContent,
  includedOnly: boolean,
): DocumentRequestGroup[] {
  const items = includedOnly ? content.items.filter((item) => item.included) : content.items;
  const groups: DocumentRequestGroup[] = [];
  const push = (group: DocumentRequestGroup) => {
    if (group.items.length > 0) groups.push(group);
  };

  push({
    key: 'baseline',
    heading: BASELINE_GROUP_HEADING,
    criticality: null,
    items: items.filter((item) => item.basis.kind === 'baseline'),
  });

  const inScope = new Set<IsaDomain>();
  for (const module of content.built_from.scope_modules) {
    inScope.add(module.isa_domain);
    push({
      key: module.isa_domain,
      heading: ISA_DOMAIN_LABELS[module.isa_domain],
      criticality: module.criticality,
      items: items.filter((item) => domainOf(item) === module.isa_domain),
    });
  }

  for (const domain of DOMAIN_ORDER) {
    if (inScope.has(domain)) continue;
    push({
      key: domain,
      heading: ISA_DOMAIN_LABELS[domain],
      criticality: null,
      items: items.filter((item) => domainOf(item) === domain),
    });
  }

  push({
    key: 'additional',
    heading: ADDITIONAL_GROUP_HEADING,
    criticality: null,
    items: items.filter((item) => item.basis.kind === 'auditor' && item.basis.isa_domain === null),
  });

  return groups;
}

// -----------------------------------------------------------------------------
// Auditor-added lines
// -----------------------------------------------------------------------------

/** `auditor:<ms>`, suffixed only if that key is already taken (two adds in
 *  one millisecond). Wall-clock, not crypto.randomUUID — CI's Node version
 *  is unverified and the key only has to be unique within one request. */
export function newAuditorItemKey(
  items: readonly DocumentRequestItem[],
  now: number = Date.now(),
): string {
  const taken = new Set(items.map((item) => item.key));
  const base = `auditor:${now}`;
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

export function newAuditorItem(
  items: readonly DocumentRequestItem[],
  title: string,
  isaDomain: IsaDomain | null,
  now: number = Date.now(),
): DocumentRequestItem {
  return {
    key: newAuditorItemKey(items, now),
    title,
    basis: { kind: 'auditor', isa_domain: isaDomain },
    included: true,
    note: '',
  };
}
