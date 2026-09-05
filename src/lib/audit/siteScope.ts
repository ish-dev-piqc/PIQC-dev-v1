import { ISA_DOMAIN_LABELS } from './labels';
import type { TaggedSection } from './mockProtocolRisks';
import type {
  DerivedCriticality,
  IsaDomain,
  SiteModuleMapping,
  SiteScopeContent,
  SiteScopeItem,
  SiteScopeModule,
} from '../../types/audit';

// =============================================================================
// siteScope — the Scope builder's derivation (isa-scope-builder).
//
// Pure: no React, no Supabase, no model call. The scope of a site audit is
// a deterministic function of Stage 2's module mappings and the tagged
// protocol risks behind them:
//
//   mapping (risk → module, server-derived criticality + rationale)
//     → one scope item, carrying the mapping id as its provenance
//   items grouped by module
//     → one scope module, its criticality the highest of its items
//
// Same inputs → same content (only built_at moves). Ordering is part of
// the contract so the saved document diffs cleanly across rebuilds: modules
// by rollup criticality, then by the module vocabulary's declaration order;
// items by criticality, then section identifier, then mapping id.
//
// Coverage precondition: every mapping's risk is in `risks`. The workspace
// refuses to build otherwise (a mapping whose risk did not load is a load
// failure, never a partial scope); the lookup miss below is the type
// narrowing that precondition leaves behind, not a policy.
// =============================================================================

const CRITICALITY_RANK: Record<DerivedCriticality, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MODERATE: 2,
  LOW: 3,
};

// The tie-break after criticality — the module vocabulary's declaration
// order, so two modules of equal criticality always list the same way.
const DOMAIN_ORDER = Object.keys(ISA_DOMAIN_LABELS) as IsaDomain[];

function compareItems(a: SiteScopeItem, b: SiteScopeItem): number {
  return (
    CRITICALITY_RANK[a.criticality] - CRITICALITY_RANK[b.criticality] ||
    a.section_identifier.localeCompare(b.section_identifier) ||
    a.id.localeCompare(b.id)
  );
}

function compareModules(a: SiteScopeModule, b: SiteScopeModule): number {
  return (
    CRITICALITY_RANK[a.criticality] - CRITICALITY_RANK[b.criticality] ||
    DOMAIN_ORDER.indexOf(a.isa_domain) - DOMAIN_ORDER.indexOf(b.isa_domain)
  );
}

export function buildSiteScopeContent(
  mappings: SiteModuleMapping[],
  risks: TaggedSection[],
  now: string,
): SiteScopeContent {
  const risksById = new Map(risks.map((r) => [r.id, r]));
  const byModule = new Map<IsaDomain, SiteScopeItem[]>();

  for (const m of mappings) {
    const risk = risksById.get(m.protocol_risk_id);
    if (!risk) continue;
    const item: SiteScopeItem = {
      id: m.id,
      protocol_risk_id: m.protocol_risk_id,
      isa_domain: m.isa_domain,
      section_identifier: risk.section_identifier,
      section_title: risk.section_title,
      criticality: m.derived_criticality,
      rationale: m.criticality_rationale,
    };
    const list = byModule.get(m.isa_domain);
    if (list) list.push(item);
    else byModule.set(m.isa_domain, [item]);
  }

  const modules = Array.from(byModule, ([isa_domain, items]): SiteScopeModule => {
    const sorted = [...items].sort(compareItems);
    // Items are ranked most critical first, so the first one IS the rollup.
    return { isa_domain, criticality: sorted[0].criticality, items: sorted };
  }).sort(compareModules);

  return {
    built_from: {
      mapping_ids: mappings.map((m) => m.id).sort(),
      built_at: now,
    },
    modules,
  };
}

/** Mapping ids added to / removed from the live set since the scope was
 *  built. Both zero = the scope still describes the mappings it names.
 *  Edits to a risk's title or tier after the build are NOT detected —
 *  ledgered in plans/sixonelabs-piqc/isa-scope-builder.md. */
export interface SiteScopeDrift {
  added: number;
  removed: number;
}

export function scopeDrift(content: SiteScopeContent, mappings: SiteModuleMapping[]): SiteScopeDrift {
  const built = new Set(content.built_from.mapping_ids);
  const live = new Set(mappings.map((m) => m.id));
  return {
    added: Array.from(live).filter((id) => !built.has(id)).length,
    removed: Array.from(built).filter((id) => !live.has(id)).length,
  };
}
