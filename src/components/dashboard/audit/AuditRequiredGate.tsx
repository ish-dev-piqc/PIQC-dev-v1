import { useEffect, useState } from 'react';
import { ClipboardList, ChevronRight, Calendar, Building2, Plus } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useAudit, type AuditWithContext } from '../../../context/AuditContext';
import {
  STAGE_LABELS,
  AUDIT_STATUS_LABELS,
  AUDIT_TYPE_LABELS,
} from '../../../lib/audit/labels';
import { AUDIT_STAGES } from '../../../types/audit';
import type { AuditStatus } from '../../../types/audit';
import NewAuditDrawer from './onboarding/NewAuditDrawer';

// =============================================================================
// AuditRequiredGate — audit worklist shown when no audit is selected.
// Clicking a row sets it as the active audit and the workspace opens.
// =============================================================================

function stageIndex(audit: AuditWithContext): number {
  return AUDIT_STAGES.indexOf(audit.current_stage) + 1;
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function AuditRequiredGate() {
  const { theme } = useTheme();
  const { audits, loading, setActiveAudit } = useAudit();
  const isLight = theme === 'light';
  const [newAuditOpen, setNewAuditOpen] = useState(false);
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
  const inProgress = audits.filter((a) => a.status === 'IN_PROGRESS').length;
  const inReview = audits.filter((a) => a.status === 'REVIEW').length;
  const closed = audits.filter((a) => a.status === 'CLOSED').length;

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
            Open an existing audit, or start a new one — protocol upload, vendor, and
            scheduling all happen in one step.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap flex-shrink-0">
          {/* Stat chips */}
          {total > 0 && (
            <div className="flex items-center gap-2 flex-wrap text-xs">
              <span className={`px-2.5 py-1 rounded-lg border font-medium ${isLight ? 'bg-white border-[#E2E8F0] text-[#334155]/70' : 'bg-[#0F172A] border-white/10 text-[#CBD5E1]/60'}`}>
                {total} total
              </span>
              {inProgress > 0 && (
                <span className={`px-2.5 py-1 rounded-lg border font-medium ${isLight ? 'bg-brand-600/10 border-brand-600/25 text-brand-600' : 'bg-brand-300/15 border-brand-300/30 text-brand-300'}`}>
                  {inProgress} in progress
                </span>
              )}
              {inReview > 0 && (
                <span className={`px-2.5 py-1 rounded-lg border font-medium ${isLight ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-amber-500/15 border-amber-500/30 text-amber-300'}`}>
                  {inReview} in review
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
      {audits.length === 0 ? (
        <div className={`${cardBg} border rounded-xl px-6 py-12 text-center border-dashed`}>
          <div className={`inline-flex items-center justify-center w-12 h-12 rounded-2xl border mb-4 ${isLight ? 'bg-brand-600/10 border-brand-600/20 text-brand-600' : 'bg-brand-600/15 border-brand-600/30 text-brand-300'}`}>
            <ClipboardList size={20} />
          </div>
          <h3 className={`${headingColor} font-semibold text-base mb-1`}>No audits yet</h3>
          <p className={`${subColor} text-sm max-w-xs mx-auto mb-4`}>
            Start your first audit — upload the protocol, pick the vendor, and you're in.
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
            {audits.map((audit) => {
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
                        <Building2 size={10} className={mutedColor} />
                        {audit.vendor_name}
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
