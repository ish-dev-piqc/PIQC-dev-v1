import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  History as HistoryIcon,
  ListChecks,
  RefreshCw,
  X as XIcon,
} from 'lucide-react';
import { useTheme } from '../../../../../context/ThemeContext';
import { useAudit } from '../../../../../context/AuditContext';
import { useAuditData } from '../../../../../context/AuditDataContext';
import { ISA_DOMAIN_LABELS } from '../../../../../lib/audit/labels';
import { hasReachedStage } from '../../../../../lib/audit/workflowStages';
import { fetchProtocolRisksForAudit } from '../../../../../lib/audit/intakeApi';
import { fetchSiteModuleMappings } from '../../../../../lib/audit/siteModulesApi';
import {
  approveSiteScope,
  fetchSiteScope,
  upsertSiteScope,
  type SiteScope,
} from '../../../../../lib/audit/siteScopeApi';
import { buildSiteScopeContent, scopeDrift } from '../../../../../lib/audit/siteScope';
import type { TaggedSection } from '../../../../../lib/audit/mockProtocolRisks';
import type { SiteModuleMapping } from '../../../../../types/audit';
import StagePreviewNotice from '../../StagePreviewNotice';
import StatusBadge from '../../deliverables/StatusBadge';
import { useDeliverablePersistence } from '../../deliverables/useDeliverablePersistence';
import HistoryDrawer from '../../HistoryDrawer';
import CriticalityChip from './CriticalityChip';

// =============================================================================
// IsaScopeBuilderWorkspace — ISA_SCOPE_BUILDER stage center pane
//
// Third stage of the Investigator Site Audit workflow: the risk-based audit
// scope. Stage 2 mapped each tagged protocol risk to the site audit modules
// it lands in, with a server-derived criticality per mapping; this stage
// turns that set into a document — modules ranked by their highest
// criticality, each with the scope items behind it, every item tracing to
// one mapping (its id), the protocol risk and the module. The derivation is
// buildSiteScopeContent (pure, deterministic, no model call); the document
// is the 8th deliverable kind on the generic pair (site_scope,
// 20260918000100), held behind the house approval latch.
//
// Approval pins THIS document's version (updated_at CAS). The mapping set
// it was built from is recorded in content.built_from and compared with the
// live mappings on every render: mappings added or removed since the build
// show as drift with a Rebuild — and a rebuild is a content change, so it
// demotes an approved scope to Draft (said on the control). A server-side
// pin on the mapping set is ledgered.
//
// Load is all-or-nothing (mappings, the saved scope, the tagged risks):
// either table missing → "not available in this environment" (schema not
// applied); any read failed, or a mapping whose risk did not load → Retry,
// never a partial scope. Persistence is useDeliverablePersistence with a
// one-key bundle (AuditCertificateSection precedent): optimistic row,
// revert on a failed upsert, STALE_CONTENT reload + notice. The hook's save
// -failure string speaks of a preserved editor; the scope has none, so the
// banner here says what is true — nothing was recorded, build again.
//
// House preview gate: viewed one ahead (audit still at Risk assessment)
// the page shows StagePreviewNotice, an existing scope read-only, and no
// Build / Rebuild / Approve. No Stage 3 → Prep card yet: Audit prep is
// still a placeholder (isa-placeholder-advance follows).
// =============================================================================

type LoadState =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; mappings: SiteModuleMapping[]; risks: TaggedSection[] };

interface SiteScopeBundle {
  site_scope: SiteScope | null;
}

// The one read path — the mount effect and the persistence hook's refresh
// both go through it, so a stale-approve reload re-reads the mappings the
// drift notice compares against, not just the row.
async function loadAll(
  auditId: string,
  storeRisks: TaggedSection[] | undefined,
): Promise<{ state: LoadState; scope: SiteScope | null }> {
  const [mappingsRes, scopeRes, risks] = await Promise.all([
    fetchSiteModuleMappings(auditId),
    fetchSiteScope(auditId),
    // Tagged risks come from the store Stage 2 fills; the fallback read
    // covers a fresh session (RiskSummaryPanel precedent).
    storeRisks?.length ? Promise.resolve(storeRisks) : fetchProtocolRisksForAudit(auditId),
  ]);

  if (!mappingsRes.ok) {
    return { state: { kind: 'error', message: mappingsRes.error }, scope: null };
  }
  if (scopeRes.kind === 'failed') {
    return { state: { kind: 'error', message: 'the saved scope could not be read' }, scope: null };
  }
  if (!mappingsRes.data.available || scopeRes.kind === 'unavailable') {
    return { state: { kind: 'unavailable' }, scope: null };
  }

  // Coverage: the create RPC guarantees every mapped risk is on the audit's
  // protocol version, so a full read covers every mapping unless the read
  // failed (fetchProtocolRisksForAudit reports failure as []). A hole here
  // is a load failure, never a scope with silent gaps.
  const mappings = mappingsRes.data.mappings;
  const riskIds = new Set(risks.map((r) => r.id));
  const uncovered = mappings.filter((m) => !riskIds.has(m.protocol_risk_id)).length;
  if (uncovered > 0) {
    return {
      state: {
        kind: 'error',
        message: `the tagged sections behind ${uncovered} mapping${uncovered === 1 ? '' : 's'} could not be read`,
      },
      scope: null,
    };
  }

  return { state: { kind: 'ready', mappings, risks }, scope: scopeRes.scope };
}

export default function IsaScopeBuilderWorkspace() {
  const { theme } = useTheme();
  const { activeAudit } = useAudit();
  const { protocolRisks } = useAuditData();
  const isLight = theme === 'light';

  const auditId = activeAudit?.id ?? '';
  const storeRisks = protocolRisks[auditId];

  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [scope, setScope] = useState<SiteScope | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);

  const {
    savingTabs,
    persistErrors,
    approveErrors,
    staleReloadNotices,
    persistDeliverable,
    dismissSaveError,
  } = useDeliverablePersistence<SiteScopeBundle>({
    auditId,
    setField: (_key, value) => setScope(value),
    refresh: refreshFromServer,
    logTag: 'IsaScopeBuilderWorkspace',
  });

  // THE refetch path (hook contract: never throws; false = refresh failed,
  // and the page keeps what it had rather than swapping to an error state
  // under the hook's own "reloading failed" notice).
  async function refreshFromServer(): Promise<boolean> {
    const loaded = await loadAll(auditId, storeRisks);
    if (loaded.state.kind !== 'ready') return false;
    setState(loaded.state);
    setScope(loaded.scope);
    return true;
  }

  useEffect(() => {
    if (!auditId) return;
    let cancelled = false;
    setState({ kind: 'loading' });
    void loadAll(auditId, storeRisks).then((loaded) => {
      if (cancelled) return;
      setState(loaded.state);
      if (loaded.state.kind === 'ready') setScope(loaded.scope);
    });
    return () => {
      cancelled = true;
    };
  }, [auditId, reloadNonce, storeRisks]);

  if (!activeAudit) return null;

  const hasReached = hasReachedStage(
    activeAudit.workflow_type,
    activeAudit.current_stage,
    'ISA_SCOPE_BUILDER',
  );

  const saveError = persistErrors[auditId]?.site_scope ?? null;
  const approveError = approveErrors.site_scope ?? null;
  const staleNotice = staleReloadNotices.site_scope ?? null;
  const saving = savingTabs.site_scope === true;
  const approved = scope?.approval_status === 'APPROVED';

  const mappings = state.kind === 'ready' ? state.mappings : [];
  const drift = scope ? scopeDrift(scope.content, mappings) : null;
  const drifted = !!drift && (drift.added > 0 || drift.removed > 0);
  const moduleCount = scope?.content.modules.length ?? 0;
  const itemCount = scope?.content.modules.reduce((n, m) => n + m.items.length, 0) ?? 0;
  const mappedModuleCount = new Set(mappings.map((m) => m.isa_domain)).size;

  const build = () => {
    if (state.kind !== 'ready' || saving) return;
    const prev = scope;
    const n = state.mappings.length;
    const next: SiteScope = {
      id: prev?.id ?? `site-scope-${Date.now()}`,
      audit_id: auditId,
      content: buildSiteScopeContent(state.mappings, state.risks, new Date().toISOString()),
      approval_status: 'DRAFT',
      approved_at: null,
      approved_by_name: null,
      updated_at: prev?.updated_at ?? new Date(0).toISOString(),
    };
    const reason = `Site audit scope ${prev ? 'rebuilt' : 'built'} from ${n} module mapping${n === 1 ? '' : 's'}`;
    setScope(next);
    void persistDeliverable('site_scope', 'SiteScope', prev, next, {
      upsert: (row) => upsertSiteScope(auditId, row.content, reason),
      // Unreachable from a build (next stays DRAFT — no approval transition);
      // present to satisfy the ops contract.
      approve: (p) => approveSiteScope(p.id, p.updated_at),
    });
  };

  const approveNow = () => {
    if (!scope || saving || saveError) return;
    const next: SiteScope = { ...scope, approval_status: 'APPROVED' };
    setScope(next);
    void persistDeliverable('site_scope', 'SiteScope', scope, next, {
      upsert: (row) => upsertSiteScope(auditId, row.content),
      approve: (p) => approveSiteScope(p.id, p.updated_at),
    });
  };

  // ---------------------------------------------------------------------------
  // Theme tokens (the ISA stage palette)
  // ---------------------------------------------------------------------------
  const cardBg = isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/5';
  const rowBg = isLight ? 'bg-[#F8FAFC] border-[#E2E8F0]' : 'bg-white/[0.02] border-white/5';
  const identifierChip = isLight ? 'bg-[#F2F2F2] text-brand-600' : 'bg-white/[0.06] text-brand-300';
  const buttonPrimary = isLight
    ? 'bg-brand-600 text-white hover:bg-brand-800 disabled:bg-[#CBD5E1]'
    : 'bg-brand-300 text-[#0F172A] hover:bg-brand-700 disabled:bg-white/10 disabled:text-white/35';
  const buttonSecondary = isLight
    ? 'bg-white border border-[#E2E8F0] text-[#334155] hover:bg-[#F8FAFC]'
    : 'bg-[#0F172A] border border-white/10 text-[#CBD5E1] hover:bg-white/[0.04]';
  const buttonApprove = isLight
    ? 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-[#CBD5E1]'
    : 'bg-emerald-500 text-[#020617] hover:bg-emerald-400 disabled:bg-white/10 disabled:text-white/35';
  const amberBox = isLight
    ? 'bg-amber-50 border-amber-200 text-amber-700'
    : 'bg-amber-500/15 border-amber-500/30 text-amber-300';
  const redBox = isLight
    ? 'bg-red-50 border-red-200 text-red-700'
    : 'bg-red-500/15 border-red-500/30 text-red-300';

  return (
    // Container + type scale match the sibling ISA stages (p-6 max-w-4xl,
    // text-xl heading).
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {!hasReached && <StagePreviewNotice currentStage={activeAudit.current_stage} />}

      {/* Header */}
      <div>
        <p className="text-fg-label text-[10px] uppercase tracking-wider font-semibold">
          Stage 3 · Scope builder
        </p>
        <h2 className="text-fg-heading text-xl font-semibold mt-1">
          Build the risk-based audit scope
        </h2>
        <p className="text-fg-sub text-sm mt-1.5 leading-relaxed max-w-2xl">
          The scope is derived from the module mappings on Risk assessment: one module per site
          audit area a tagged section landed in, ranked by its highest criticality, with every scope
          item tracing back to the section and the mapping it came from. Nothing is written by a
          model. Approving pins this version of the scope.
        </p>
      </div>

      <section className={`${cardBg} border rounded-xl p-5`}>
        <div className="flex items-start gap-2">
          <ListChecks size={15} className={`flex-shrink-0 mt-0.5 ${isLight ? 'text-brand-600' : 'text-brand-300'}`} />
          <div className="min-w-0 flex-1">
            <p className="text-fg-label text-[10px] uppercase tracking-wider font-semibold">
              Site audit scope
            </p>
            <h3 className="text-fg-heading text-sm font-semibold mt-1">
              Modules and scope items for {activeAudit.auditee_name || 'this site'}
            </h3>
          </div>
          {scope && state.kind === 'ready' && <StatusBadge approved={approved} isLight={isLight} />}
        </div>

        <div className="mt-4 space-y-3">
          {state.kind === 'loading' && (
            <p className="text-fg-sub text-sm">Loading the scope builder…</p>
          )}

          {state.kind === 'unavailable' && (
            <p className="text-fg-sub text-sm">
              Scope builder isn’t available in this environment yet.
            </p>
          )}

          {state.kind === 'error' && (
            <div role="alert" className={`text-xs px-3 py-2 rounded-md border ${redBox}`}>
              Couldn’t load the scope builder: {state.message}
              <button
                type="button"
                onClick={() => setReloadNonce((n) => n + 1)}
                className="ml-2 underline font-medium"
              >
                Retry
              </button>
            </div>
          )}

          {state.kind === 'ready' && !scope && mappings.length === 0 && (
            <p className="text-fg-sub text-sm">
              No module mappings yet. Map tagged sections to site modules on Risk assessment first.
            </p>
          )}

          {state.kind === 'ready' && !scope && mappings.length > 0 && (
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-fg-sub text-sm">
                No scope built yet. {mappings.length} mapping{mappings.length === 1 ? '' : 's'} across{' '}
                {mappedModuleCount} module{mappedModuleCount === 1 ? '' : 's'}{' '}
                {mappings.length === 1 ? 'is' : 'are'} ready to scope.
              </p>
              {hasReached && (
                <button
                  type="button"
                  onClick={build}
                  disabled={saving}
                  className={`inline-flex items-center gap-1.5 text-sm font-semibold px-3.5 py-2 rounded-md transition-colors ${buttonPrimary}`}
                >
                  <ListChecks size={14} />
                  {saving ? 'Building…' : 'Build scope'}
                </button>
              )}
            </div>
          )}

          {state.kind === 'ready' && scope && (
            <>
              <p className="text-fg-label text-[10px] uppercase tracking-wider font-semibold">
                {moduleCount} module{moduleCount === 1 ? '' : 's'} · {itemCount} scope item
                {itemCount === 1 ? '' : 's'}
                {scope.content.built_from.built_at
                  ? ` · built ${new Date(scope.content.built_from.built_at).toLocaleDateString()}`
                  : ''}
              </p>

              {drifted && drift && (
                <div
                  role="status"
                  className={`flex items-start gap-2 px-3 py-2 rounded-md border ${amberBox}`}
                >
                  <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                  <p className="text-xs leading-relaxed flex-1">
                    <span className="font-semibold">
                      {drift.added} mapping{drift.added === 1 ? '' : 's'} added and {drift.removed}{' '}
                      removed on Risk assessment since this scope was built.
                    </span>{' '}
                    Rebuild to bring the scope up to date
                    {approved ? ' — rebuilding reverts approval to Draft.' : '.'}
                  </p>
                  {hasReached && (
                    <button
                      type="button"
                      onClick={build}
                      disabled={saving}
                      className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md transition-colors ${buttonPrimary}`}
                    >
                      <RefreshCw size={12} />
                      {saving ? 'Rebuilding…' : 'Rebuild scope'}
                    </button>
                  )}
                </div>
              )}

              {staleNotice && (
                <div className={`px-3 py-2 rounded-md border text-xs leading-relaxed ${amberBox}`}>
                  {staleNotice}
                </div>
              )}
              {approveError && (
                <div role="alert" className={`px-3 py-2 rounded-md border text-xs leading-relaxed ${redBox}`}>
                  {approveError}
                </div>
              )}

              {scope.content.modules.map((module) => (
                <div key={module.isa_domain} className={`${rowBg} border rounded-lg px-4 py-3`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-fg-heading text-sm font-semibold">
                      {ISA_DOMAIN_LABELS[module.isa_domain]}
                    </span>
                    <CriticalityChip criticality={module.criticality} isLight={isLight} />
                    <span className="text-fg-muted text-xs">
                      {module.items.length} item{module.items.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <ul className="mt-2 space-y-1.5">
                    {module.items.map((item) => (
                      <li key={item.id} className="flex items-baseline gap-2 flex-wrap text-xs">
                        <span
                          className={`text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded ${identifierChip}`}
                        >
                          {item.section_identifier}
                        </span>
                        <span className="text-fg-body font-medium">{item.section_title}</span>
                        <CriticalityChip criticality={item.criticality} isLight={isLight} />
                        <span className="text-fg-muted">{item.rationale}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}

              {/* Latch row */}
              <div className="flex items-center gap-2 flex-wrap pt-1">
                {approved ? (
                  <span className="text-fg-sub text-xs">
                    Approved
                    {scope.approved_at ? ` ${new Date(scope.approved_at).toLocaleDateString()}` : ''}
                    {scope.approved_by_name ? ` · ${scope.approved_by_name}` : ''}
                  </span>
                ) : (
                  hasReached && (
                    <button
                      type="button"
                      onClick={approveNow}
                      // Blocked while a save is in flight or failed (the cache
                      // and the server may disagree — the CAS-latch hole).
                      disabled={saving || !!saveError}
                      className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md transition-colors ${buttonApprove}`}
                    >
                      <CheckCircle2 size={12} />
                      Approve scope
                    </button>
                  )
                )}
                {hasReached && !drifted && (
                  <button
                    type="button"
                    onClick={build}
                    disabled={saving}
                    title={approved ? 'Rebuilding reverts approval to Draft' : undefined}
                    className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors disabled:opacity-50 ${buttonSecondary}`}
                  >
                    <RefreshCw size={12} />
                    {saving ? 'Rebuilding…' : 'Rebuild scope'}
                  </button>
                )}
                {/* !saving: during an in-flight FIRST build the cached row is an
                    optimistic mint whose id the history RPC would reject. */}
                {!saving && (
                  <button
                    type="button"
                    onClick={() => setHistoryOpen(true)}
                    className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors ${buttonSecondary}`}
                    aria-label="Open change history for the site audit scope"
                  >
                    <HistoryIcon size={12} />
                    History
                  </button>
                )}
              </div>
            </>
          )}

          {state.kind === 'ready' && saveError && (
            <div
              role="alert"
              className={`flex items-start gap-2 px-3 py-2 rounded-md border text-xs leading-relaxed ${redBox}`}
            >
              <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
              <p className="flex-1">
                Couldn’t save the scope — nothing was recorded. Build again to retry.
              </p>
              <button
                type="button"
                onClick={() => dismissSaveError('site_scope')}
                aria-label="Dismiss the save error"
                className="inline-flex items-center justify-center w-5 h-5 rounded opacity-70 hover:opacity-100"
              >
                <XIcon size={11} />
              </button>
            </div>
          )}
        </div>
      </section>

      {historyOpen && scope && (
        <HistoryDrawer
          objectType="SITE_SCOPE_OBJECT"
          objectId={scope.id}
          title="Site audit scope"
          subTitle="Scope builder · change history"
          onClose={() => setHistoryOpen(false)}
        />
      )}
    </div>
  );
}
