import { useEffect, useState } from 'react';
import { ClipboardList, ChevronRight, Calendar, Building2, Stethoscope, Plus, CheckCircle2, Clock, AlertTriangle, RefreshCw } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useAudit, type AuditWithContext } from '../../../context/AuditContext';
import {
  STAGE_LABELS,
  AUDIT_STATUS_LABELS,
  AUDIT_TYPE_LABELS,
  AUDIT_WORKFLOW_TYPE_LABELS,
} from '../../../lib/audit/labels';
import { stagesForWorkflow } from '../../../lib/audit/workflowStages';
import type { AuditStatus, AuditWorkflowType } from '../../../types/audit';
import NewAuditDrawer from './onboarding/NewAuditDrawer';

// =============================================================================
// AuditRequiredGate — the Audit Workspace hub, shown when no audit is selected.
//
// Workload cockpit, not a passive list: leads with "Needs your attention"
// (in-review + overdue audits — what's waiting on the auditor NOW), then the
// full worklist segmentable by workflow (Vendor / Investigator site). Clicking
// a row sets it as the active audit and the workspace opens.
//
// Everything here derives from data already in AuditContext — no new fetches.
// =============================================================================

function stageIndex(audit: AuditWithContext): number {
  return stagesForWorkflow(audit.workflow_type).indexOf(audit.current_stage) + 1;
}

// Local (not UTC) yyyy-mm-dd, so "overdue" flips at the auditor's midnight.
function todayLocalIso(): string {
  return new Date().toLocaleDateString('en-CA');
}

// Overdue = scheduled in the past and still open. REVIEW is excluded — those
// audits already surface in the attention queue under their own reason.
function isOverdue(audit: AuditWithContext): boolean {
  if (!audit.scheduled_date) return false;
  if (audit.status === 'CLOSED' || audit.status === 'REVIEW') return false;
  return audit.scheduled_date < todayLocalIso();
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  // Anchor date-only strings to LOCAL midnight. A bare yyyy-mm-dd parses as UTC
  // midnight per ECMA-262, which renders the previous calendar day in any
  // UTC-negative zone — the auditor would see a scheduled date they never
  // entered (worst in the Overdue badge, where the date is the whole message).
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function AuditRequiredGate() {
  const { theme } = useTheme();
  const { audits, loading, error, refresh, setActiveAudit } = useAudit();
  const isLight = theme === 'light';
  const [newAuditOpen, setNewAuditOpen] = useState(false);
  // Worklist segmentation — one workspace, filterable by workflow. 'ALL' is the
  // default; the Investigator chip is clickable even at count 0 so the second
  // workflow is legible before the first site audit exists.
  const [workflowFilter, setWorkflowFilter] = useState<'ALL' | AuditWorkflowType>('ALL');
  // After the drawer fires onCreated, the AuditContext's refresh may not have
  // settled into this component's `audits` snapshot yet. Park the id and let
  // the effect below activate the audit as soon as it appears in the list.
  const [pendingNewAuditId, setPendingNewAuditId] = useState<string | null>(null);

  useEffect(() => {
    if (!pendingNewAuditId) return;
    const next = audits.find((a) => a.id === pendingNewAuditId);
    if (next) {
      setActiveAudit(next);
      setPendingNewAuditId(null);
    }
  }, [pendingNewAuditId, audits, setActiveAudit]);

  const headingColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';
  const mutedColor = 'text-fg-muted';
  const sectionHeader = 'text-fg-label';
  const cardBg = isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/5';
  const rowHover = isLight ? 'hover:bg-[#F8FAFC]' : 'hover:bg-white/[0.02]';
  const divider = isLight ? 'divide-[#F2F2F2]' : 'divide-white/[0.03]';
  const tableHeaderBg = isLight ? 'bg-[#F8FAFC] border-[#F2F2F2]' : 'bg-white/[0.02] border-white/[0.04]';

  const total = audits.length;
  // Header chips carry ONLY the counts no other hub surface reports: in-progress
  // and closed. "Total" lives in the "All (N)" segment chip; "in review" audits
  // are individually surfaced in the attention queue. One fact, one surface.
  const inProgress = audits.filter((a) => a.status === 'IN_PROGRESS').length;
  const closed = audits.filter((a) => a.status === 'CLOSED').length;

  // "Needs your attention" — what's waiting on the auditor right now. In-review
  // first (a decision is pending), then overdue (the schedule slipped).
  const attentionReview = audits.filter((a) => a.status === 'REVIEW');
  const attentionOverdue = audits.filter(isOverdue);
  const attentionCount = attentionReview.length + attentionOverdue.length;

  const vendorCount = audits.filter((a) => a.workflow_type === 'VENDOR_AUDIT').length;
  const investigatorCount = audits.filter(
    (a) => a.workflow_type === 'INVESTIGATOR_SITE_AUDIT',
  ).length;
  const filteredAudits =
    workflowFilter === 'ALL'
      ? audits
      : audits.filter((a) => a.workflow_type === workflowFilter);

  const segmentChip = (active: boolean): string =>
    active
      ? isLight
        ? 'bg-brand-600/10 border-brand-600/40 text-brand-600'
        : 'bg-brand-600/15 border-brand-300/40 text-brand-300'
      : isLight
        ? 'bg-white border-[#E2E8F0] text-[#334155]/65 hover:border-[#CBD5E1]'
        : 'bg-[#0F172A] border-white/10 text-[#CBD5E1]/55 hover:border-white/20';

  const statusTone = (status: AuditStatus): string => {
    switch (status) {
      case 'IN_PROGRESS':
        return isLight
          ? 'bg-brand-600/10 border-brand-600/25 text-brand-600'
          : 'bg-brand-300/15 border-brand-300/30 text-brand-300';
      case 'REVIEW':
        return isLight
          ? 'bg-amber-50 border-amber-200 text-amber-700'
          : 'bg-amber-500/15 border-amber-500/30 text-amber-300';
      case 'CLOSED':
        return isLight
          ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
          : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300';
      default:
        return isLight
          ? 'bg-[#F2F2F2] border-[#CBD5E1] text-[#334155]/65'
          : 'bg-white/[0.06] border-white/10 text-[#CBD5E1]/55';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-5 h-5 border-2 border-brand-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6 overflow-y-auto h-full">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold`}>
            PIQC Clinical · Audit
          </p>
          <h2 className={`${headingColor} text-xl font-semibold mt-1`}>Your audits</h2>
          <p className={`${subColor} text-sm mt-1`}>
            Open an existing audit, or start a new one — protocol upload, vendor or site,
            and scheduling all happen in one step.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap flex-shrink-0">
          {/* Stat chips */}
          {total > 0 && (
            <div className="flex items-center gap-2 flex-wrap text-xs">
              {inProgress > 0 && (
                <span className={`px-2.5 py-1 rounded-lg border font-medium ${isLight ? 'bg-brand-600/10 border-brand-600/25 text-brand-600' : 'bg-brand-300/15 border-brand-300/30 text-brand-300'}`}>
                  {inProgress} in progress
                </span>
              )}
              {closed > 0 && (
                <span className={`px-2.5 py-1 rounded-lg border font-medium ${isLight ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'}`}>
                  {closed} closed
                </span>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={() => setNewAuditOpen(true)}
            className={`inline-flex items-center gap-1.5 text-sm font-semibold px-3.5 py-2 rounded-md transition-colors ${
              isLight
                ? 'bg-brand-600 text-white hover:bg-brand-800'
                : 'bg-brand-300 text-[#0F172A] hover:bg-brand-700'
            }`}
          >
            <Plus size={14} />
            Start a new audit
          </button>
        </div>
      </div>

      {/* Worklist */}
      {error ? (
        // A failed load must not read as "no audits" — the auditor's audits are
        // still there, we just couldn't reach them. Reuses the empty-state card
        // shell so the surface stays familiar; Retry re-runs the fetch. role=alert
        // announces the failure to assistive tech (matches the drawer banner).
        <div role="alert" className={`${cardBg} border rounded-xl px-6 py-12 text-center border-dashed`}>
          <div className={`inline-flex items-center justify-center w-12 h-12 rounded-2xl border mb-4 ${isLight ? 'bg-rose-50 border-rose-200 text-rose-600' : 'bg-rose-500/15 border-rose-500/30 text-rose-300'}`}>
            <AlertTriangle size={20} />
          </div>
          <h3 className={`${headingColor} font-semibold text-base mb-1`}>Couldn't load your audits</h3>
          <p className={`${subColor} text-sm max-w-xs mx-auto mb-4`}>
            {error}
          </p>
          <button
            type="button"
            onClick={() => { void refresh(); }}
            className={`inline-flex items-center gap-1.5 text-sm font-semibold px-3.5 py-2 rounded-md transition-colors ${
              isLight
                ? 'bg-brand-600 text-white hover:bg-brand-800'
                : 'bg-brand-300 text-[#0F172A] hover:bg-brand-700'
            }`}
          >
            <RefreshCw size={14} />
            Retry
          </button>
        </div>
      ) : audits.length === 0 ? (
        <div className={`${cardBg} border rounded-xl px-6 py-12 text-center border-dashed`}>
          <div className={`inline-flex items-center justify-center w-12 h-12 rounded-2xl border mb-4 ${isLight ? 'bg-brand-600/10 border-brand-600/20 text-brand-600' : 'bg-brand-600/15 border-brand-600/30 text-brand-300'}`}>
            <ClipboardList size={20} />
          </div>
          <h3 className={`${headingColor} font-semibold text-base mb-1`}>No audits yet</h3>
          <p className={`${subColor} text-sm max-w-xs mx-auto mb-4`}>
            Start your first audit — upload the protocol, pick the vendor or site, and
            you're in.
          </p>
          <button
            type="button"
            onClick={() => setNewAuditOpen(true)}
            className={`inline-flex items-center gap-1.5 text-sm font-semibold px-3.5 py-2 rounded-md transition-colors ${
              isLight
                ? 'bg-brand-600 text-white hover:bg-brand-800'
                : 'bg-brand-300 text-[#0F172A] hover:bg-brand-700'
            }`}
          >
            <Plus size={14} />
            Start a new audit
          </button>
        </div>
      ) : (
        <>
          {/* Needs your attention — leads the hub. What's waiting on the
              auditor NOW: audits pending review, then overdue ones. */}
          {attentionCount === 0 ? (
            <div className={`${cardBg} border rounded-xl px-4 py-3 flex items-center gap-2`}>
              <CheckCircle2
                size={15}
                className={isLight ? 'text-emerald-600' : 'text-emerald-400'}
              />
              <span className={`${subColor} text-sm`}>
                You're all caught up — nothing needs your attention right now.
              </span>
            </div>
          ) : (
            <section aria-label="Needs your attention">
              <p className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold mb-2`}>
                Needs your attention ({attentionCount})
              </p>
              <div className={`${cardBg} border rounded-xl overflow-hidden`}>
                <div className={`divide-y ${divider}`}>
                  {[...attentionReview, ...attentionOverdue].map((audit) => {
                    const overdue = audit.status !== 'REVIEW';
                    return (
                      <button
                        key={audit.id}
                        type="button"
                        onClick={() => setActiveAudit(audit)}
                        className={`w-full text-left flex items-center gap-3 px-4 py-3 ${rowHover} transition-colors`}
                      >
                        <div className="min-w-0 flex-1">
                          <p className={`${headingColor} text-sm font-semibold truncate`}>
                            {audit.audit_name}
                          </p>
                          <p className={`${subColor} text-xs mt-0.5 truncate`}>
                            {audit.auditee_name} · Stage {stageIndex(audit)} —{' '}
                            {STAGE_LABELS[audit.current_stage]}
                          </p>
                        </div>
                        {overdue ? (
                          <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded border flex-shrink-0 ${
                            isLight
                              ? 'bg-rose-50 border-rose-200 text-rose-700'
                              : 'bg-rose-500/15 border-rose-500/30 text-rose-300'
                          }`}>
                            <Clock size={10} />
                            Overdue{audit.scheduled_date ? ` · ${formatDate(audit.scheduled_date)}` : ''}
                          </span>
                        ) : (
                          <span className={`inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded border flex-shrink-0 ${statusTone('REVIEW')}`}>
                            {AUDIT_STATUS_LABELS.REVIEW}
                          </span>
                        )}
                        <ChevronRight size={15} className={`${mutedColor} flex-shrink-0`} />
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>
          )}

          <div className="space-y-3">
            {/* "All audits" heading owns the segment chips + table below, so the
                chips' scope is unambiguous (they filter the worklist, NOT the
                attention queue above) and this band reads as a peer to
                "Needs your attention". */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold`}>
                All audits
              </p>
              {/* Workflow segmentation — one workspace, two workflows. The
                  Investigator chip stays clickable at 0 so the second workflow
                  is legible before the first site audit exists. */}
              <div className="flex items-center gap-2 flex-wrap" role="group" aria-label="Filter audits by workflow">
              <button
                type="button"
                aria-pressed={workflowFilter === 'ALL'}
                onClick={() => setWorkflowFilter('ALL')}
                className={`text-xs font-medium px-2.5 py-1 rounded-lg border transition-colors ${segmentChip(workflowFilter === 'ALL')}`}
              >
                All ({total})
              </button>
              <button
                type="button"
                aria-pressed={workflowFilter === 'VENDOR_AUDIT'}
                onClick={() => setWorkflowFilter('VENDOR_AUDIT')}
                className={`text-xs font-medium px-2.5 py-1 rounded-lg border transition-colors ${segmentChip(workflowFilter === 'VENDOR_AUDIT')}`}
              >
                {AUDIT_WORKFLOW_TYPE_LABELS.VENDOR_AUDIT}s ({vendorCount})
              </button>
              <button
                type="button"
                aria-pressed={workflowFilter === 'INVESTIGATOR_SITE_AUDIT'}
                onClick={() => setWorkflowFilter('INVESTIGATOR_SITE_AUDIT')}
                className={`text-xs font-medium px-2.5 py-1 rounded-lg border transition-colors ${segmentChip(workflowFilter === 'INVESTIGATOR_SITE_AUDIT')}`}
              >
                {AUDIT_WORKFLOW_TYPE_LABELS.INVESTIGATOR_SITE_AUDIT}s ({investigatorCount})
              </button>
              </div>
            </div>

            {filteredAudits.length === 0 ? (
              <div className={`${cardBg} border rounded-xl px-6 py-8 text-center border-dashed`}>
                <h3 className={`${headingColor} font-semibold text-sm mb-1`}>
                  No {workflowFilter === 'INVESTIGATOR_SITE_AUDIT'
                    ? AUDIT_WORKFLOW_TYPE_LABELS.INVESTIGATOR_SITE_AUDIT.toLowerCase()
                    : AUDIT_WORKFLOW_TYPE_LABELS.VENDOR_AUDIT.toLowerCase()}s yet
                </h3>
                <p className={`${subColor} text-sm max-w-sm mx-auto`}>
                  Start one with the button above.
                </p>
              </div>
            ) : (
        <div className={`${cardBg} border rounded-xl overflow-hidden`}>
          {/* Table header */}
          <div className={`grid grid-cols-[1fr,auto] sm:grid-cols-[2fr,1fr,1fr,auto] gap-3 px-4 py-2.5 border-b ${tableHeaderBg}`}>
            <span className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold`}>Audit</span>
            <span className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold hidden sm:block`}>Stage</span>
            <span className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold hidden sm:block`}>Status</span>
            <span className="sr-only">Open</span>
          </div>

          {/* Rows */}
          <div className={`divide-y ${divider}`}>
            {filteredAudits.map((audit) => {
              const date = formatDate(audit.scheduled_date);
              const stage = stageIndex(audit);
              return (
                <button
                  key={audit.id}
                  type="button"
                  onClick={() => setActiveAudit(audit)}
                  className={`w-full text-left grid grid-cols-[1fr,auto] sm:grid-cols-[2fr,1fr,1fr,auto] items-center gap-3 px-4 py-3.5 ${rowHover} transition-colors`}
                >
                  {/* Name + meta */}
                  <div className="min-w-0">
                    <p className={`${headingColor} text-sm font-semibold truncate`}>
                      {audit.audit_name}
                    </p>
                    <div className={`flex items-center gap-3 mt-0.5 text-xs ${subColor} flex-wrap`}>
                      <span className="flex items-center gap-1 truncate">
                        {audit.workflow_type === 'INVESTIGATOR_SITE_AUDIT' ? (
                          <Stethoscope size={10} className={mutedColor} />
                        ) : (
                          <Building2 size={10} className={mutedColor} />
                        )}
                        {audit.auditee_name}
                      </span>
                      <span className={`${mutedColor} hidden sm:inline`}>·</span>
                      <span className={`${mutedColor} hidden sm:inline truncate`}>
                        {audit.protocol_code}
                      </span>
                      {date && (
                        <>
                          <span className={`${mutedColor} hidden sm:inline`}>·</span>
                          <span className="flex items-center gap-1 hidden sm:flex">
                            <Calendar size={10} className={mutedColor} />
                            {date}
                          </span>
                        </>
                      )}
                      <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded border sm:hidden ${isLight ? 'bg-[#F2F2F2] border-[#E2E8F0] text-[#334155]/70' : 'bg-white/[0.04] border-white/10 text-[#CBD5E1]/55'}`}>
                        {AUDIT_TYPE_LABELS[audit.audit_type]}
                      </span>
                    </div>
                  </div>

                  {/* Stage — desktop */}
                  <div className="hidden sm:flex items-center gap-2">
                    <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-md border ${isLight ? 'bg-[#F2F2F2] border-[#E2E8F0] text-[#334155]/70' : 'bg-white/[0.04] border-white/10 text-[#CBD5E1]/55'}`}>
                      <span className={`font-semibold ${isLight ? 'text-brand-600' : 'text-brand-300'}`}>{stage}</span>
                      <span className="hidden lg:inline">{STAGE_LABELS[audit.current_stage]}</span>
                    </span>
                  </div>

                  {/* Status — desktop */}
                  <div className="hidden sm:flex items-center">
                    <span className={`inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded border ${statusTone(audit.status)}`}>
                      {AUDIT_STATUS_LABELS[audit.status]}
                    </span>
                  </div>

                  {/* Chevron + mobile status */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={`sm:hidden inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded border ${statusTone(audit.status)}`}>
                      {AUDIT_STATUS_LABELS[audit.status]}
                    </span>
                    <ChevronRight size={15} className={mutedColor} />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
            )}
          </div>
        </>
      )}

      {/* New-audit drawer — on creation, the AuditContext is refreshed by the
          drawer; we activate the freshly-created audit so the auditor lands
          inside it at Stage 1. */}
      {newAuditOpen && (
        <NewAuditDrawer
          onClose={() => setNewAuditOpen(false)}
          onCreated={(newAuditId) => {
            setPendingNewAuditId(newAuditId);
            setNewAuditOpen(false);
          }}
        />
      )}
    </div>
  );
}
