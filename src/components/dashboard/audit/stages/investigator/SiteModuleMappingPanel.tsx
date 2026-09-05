import { useEffect, useState } from 'react';
import { Layers, X } from 'lucide-react';
import { useTheme } from '../../../../../context/ThemeContext';
import { useAudit } from '../../../../../context/AuditContext';
import { useAuditData } from '../../../../../context/AuditDataContext';
import { DERIVED_CRITICALITY_LABELS, ISA_DOMAIN_LABELS } from '../../../../../lib/audit/labels';
import {
  createSiteModuleMapping,
  deleteSiteModuleMapping,
  fetchSiteModuleMappings,
} from '../../../../../lib/audit/siteModulesApi';
import type { DerivedCriticality, IsaDomain, SiteModuleMapping } from '../../../../../types/audit';

// =============================================================================
// SiteModuleMappingPanel — ISA Stage 2, under the tagging flow.
//
// For every protocol risk tagged above (read from the shared protocolRisks
// store the tagging flow fills, so a section tagged a moment ago is mappable
// at once), the site audit modules it lands in. Adding a module calls the
// create RPC, which derives the criticality and the rationale server-side
// from the risk's tier, surface and timing — the same rule the vendor lane
// applies to service mappings. The Scope builder (next stage) rolls these
// rows up per module; this panel only records and shows them.
//
// State is local to the panel (IsaConductWorkspace precedent): loaded per
// audit with a cancel latch, mutated in place on success. Three honest
// non-list states: loading, "not available in this environment" (the schema
// migration is not applied — the table is missing), and a read error with
// Retry. `readOnly` is the stage's one-ahead preview: mappings visible, no
// picker, no remove.
// =============================================================================

const ISA_DOMAINS = Object.keys(ISA_DOMAIN_LABELS) as IsaDomain[];

interface SiteModuleMappingPanelProps {
  /** One-ahead preview: mappings visible, add/remove off. */
  readOnly: boolean;
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; mappings: SiteModuleMapping[] };

export default function SiteModuleMappingPanel({ readOnly }: SiteModuleMappingPanelProps) {
  const { theme } = useTheme();
  const { activeAudit } = useAudit();
  const { protocolRisks } = useAuditData();
  const isLight = theme === 'light';

  const auditId = activeAudit?.id ?? null;
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busyRiskId, setBusyRiskId] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    if (!auditId) return;
    let cancelled = false;
    setState({ kind: 'loading' });
    setSaveError(null);
    void fetchSiteModuleMappings(auditId).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setState({ kind: 'error', message: result.error });
        return;
      }
      setState(
        result.data.available
          ? { kind: 'ready', mappings: result.data.mappings }
          : { kind: 'unavailable' },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [auditId, reloadNonce]);

  if (!auditId) return null;

  const risks = protocolRisks[auditId] ?? [];
  const mappings = state.kind === 'ready' ? state.mappings : [];
  const moduleCount = new Set(mappings.map((m) => m.isa_domain)).size;

  const addMapping = async (riskId: string, domain: IsaDomain) => {
    setSaveError(null);
    setBusyRiskId(riskId);
    const result = await createSiteModuleMapping(auditId, riskId, domain);
    setBusyRiskId(null);
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }
    setState((prev) =>
      prev.kind === 'ready' ? { kind: 'ready', mappings: [...prev.mappings, result.data] } : prev,
    );
  };

  const removeMapping = async (mapping: SiteModuleMapping) => {
    setSaveError(null);
    setBusyRiskId(mapping.protocol_risk_id);
    const result = await deleteSiteModuleMapping(mapping.id);
    setBusyRiskId(null);
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }
    setState((prev) =>
      prev.kind === 'ready'
        ? { kind: 'ready', mappings: prev.mappings.filter((m) => m.id !== mapping.id) }
        : prev,
    );
  };

  const cardBg = isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/5';
  const rowBg = isLight ? 'bg-[#F8FAFC] border-[#E2E8F0]' : 'bg-white/[0.02] border-white/5';
  const selectCls = isLight
    ? 'bg-white border-[#E2E8F0] text-fg-body'
    : 'bg-[#0F172A] border-white/10 text-fg-body';
  const alertCls = isLight
    ? 'bg-red-50 border-red-200 text-red-700'
    : 'bg-red-500/15 border-red-500/30 text-red-300';
  const identifierChip = isLight
    ? 'bg-[#F2F2F2] text-brand-600'
    : 'bg-white/[0.06] text-brand-300';
  const removeCls = isLight
    ? 'text-fg-muted hover:text-red-700 disabled:opacity-50'
    : 'text-fg-muted hover:text-red-300 disabled:opacity-50';

  return (
    <section className={`${cardBg} border rounded-xl p-5`}>
      <div className="flex items-start gap-2">
        <Layers size={15} className={`flex-shrink-0 mt-0.5 ${isLight ? 'text-brand-600' : 'text-brand-300'}`} />
        <div className="min-w-0">
          <p className="text-fg-label text-[10px] uppercase tracking-wider font-semibold">
            Site modules
          </p>
          <h3 className="text-fg-heading text-sm font-semibold mt-1">
            Map tagged risks to site audit modules
          </h3>
          <p className="text-fg-sub text-xs mt-1 leading-relaxed">
            Each mapping derives its criticality from the risk’s endpoint tier, impact surface and
            timing — the rule the vendor lane uses. The scope builder rolls modules up next.
          </p>
        </div>
      </div>

      <div className="mt-4">
        {state.kind === 'loading' && (
          <p className="text-fg-sub text-sm">Loading module mappings…</p>
        )}

        {state.kind === 'unavailable' && (
          <p className="text-fg-sub text-sm">
            Site modules aren’t available in this environment yet.
          </p>
        )}

        {state.kind === 'error' && (
          <div role="alert" className={`text-xs px-3 py-2 rounded-md border ${alertCls}`}>
            Couldn’t load module mappings: {state.message}
            <button
              type="button"
              onClick={() => setReloadNonce((n) => n + 1)}
              className="ml-2 underline font-medium"
            >
              Retry
            </button>
          </div>
        )}

        {state.kind === 'ready' && risks.length === 0 && (
          <p className="text-fg-sub text-sm">
            Tag a protocol section above to map it to a site module.
          </p>
        )}

        {state.kind === 'ready' && risks.length > 0 && (
          <div className="space-y-3">
            <p className="text-fg-label text-[10px] uppercase tracking-wider font-semibold">
              {mappings.length} mapping{mappings.length === 1 ? '' : 's'} across {moduleCount} module
              {moduleCount === 1 ? '' : 's'}
            </p>

            {risks.map((risk) => {
              const own = mappings.filter((m) => m.protocol_risk_id === risk.id);
              const mapped = new Set(own.map((m) => m.isa_domain));
              const remaining = ISA_DOMAINS.filter((d) => !mapped.has(d));
              const busy = busyRiskId === risk.id;

              return (
                <div key={risk.id} className={`${rowBg} border rounded-lg px-4 py-3`}>
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span
                      className={`text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded ${identifierChip}`}
                    >
                      {risk.section_identifier}
                    </span>
                    <span className="text-fg-heading text-sm font-semibold truncate">
                      {risk.section_title}
                    </span>
                  </div>

                  {own.length === 0 && (
                    <p className="text-fg-muted text-xs mt-2">
                      {readOnly ? 'No modules mapped.' : 'Not mapped to a module yet.'}
                    </p>
                  )}

                  {own.length > 0 && (
                    <ul className="mt-2 space-y-1.5">
                      {own.map((m) => (
                        <li key={m.id} className="flex items-center gap-2 flex-wrap text-xs">
                          <span className="text-fg-body font-medium">
                            {ISA_DOMAIN_LABELS[m.isa_domain]}
                          </span>
                          <CriticalityChip criticality={m.derived_criticality} isLight={isLight} />
                          <span className="text-fg-muted">{m.criticality_rationale}</span>
                          {!readOnly && (
                            <button
                              type="button"
                              onClick={() => void removeMapping(m)}
                              disabled={busy}
                              aria-label={`Remove ${ISA_DOMAIN_LABELS[m.isa_domain]} from ${risk.section_identifier}`}
                              className={`inline-flex items-center p-0.5 rounded transition-colors ${removeCls}`}
                            >
                              <X size={12} />
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}

                  {!readOnly && remaining.length > 0 && (
                    <select
                      aria-label={`Map ${risk.section_identifier} to a module`}
                      value=""
                      disabled={busy}
                      onChange={(e) => {
                        const domain = e.target.value as IsaDomain | '';
                        if (domain) void addMapping(risk.id, domain);
                      }}
                      className={`mt-2 text-xs rounded-md border px-2 py-1.5 disabled:opacity-50 ${selectCls}`}
                    >
                      <option value="">{busy ? 'Saving…' : 'Add module…'}</option>
                      {remaining.map((d) => (
                        <option key={d} value={d}>
                          {ISA_DOMAIN_LABELS[d]}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {saveError && (
          <div role="alert" className={`text-xs px-3 py-2 mt-3 rounded-md border ${alertCls}`}>
            Couldn’t update the module mapping: {saveError}
          </div>
        )}
      </div>
    </section>
  );
}

// Same tones as the vendor lane's mapping table so a criticality reads the
// same on both workflows.
function CriticalityChip({
  criticality,
  isLight,
}: {
  criticality: DerivedCriticality;
  isLight: boolean;
}) {
  const tones: Record<DerivedCriticality, string> = {
    CRITICAL: isLight
      ? 'bg-red-50 border-red-200 text-red-700'
      : 'bg-red-500/15 border-red-500/30 text-red-300',
    HIGH: isLight
      ? 'bg-orange-50 border-orange-200 text-orange-700'
      : 'bg-orange-500/15 border-orange-500/30 text-orange-300',
    MODERATE: isLight
      ? 'bg-amber-50 border-amber-200 text-amber-700'
      : 'bg-amber-500/15 border-amber-500/30 text-amber-300',
    LOW: isLight
      ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
      : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300',
  };
  return (
    <span
      className={`text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded border ${tones[criticality]}`}
    >
      {DERIVED_CRITICALITY_LABELS[criticality]}
    </span>
  );
}
