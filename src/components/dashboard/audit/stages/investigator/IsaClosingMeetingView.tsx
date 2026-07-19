import { useRef } from 'react';
import { ThumbsUp, X as XIcon } from 'lucide-react';
import { useTheme } from '../../../../../context/ThemeContext';
import { useAudit } from '../../../../../context/AuditContext';
import { useOverlay } from '../../../../../hooks/useOverlay';
import { ISA_DOMAIN_LABELS } from '../../../../../lib/audit/labels';
import PiqcMark from '../../PiqcMark';
import type {
  AuditNoteObject,
  IsaFindingObject,
  IsaSeverity,
} from '../../../../../types/audit';

// =============================================================================
// IsaClosingMeetingView — the closing-meeting presentation, generated free.
//
// Every ISA template describes the same closing-meeting ritual: preliminary
// findings presented by severity, positive observations acknowledged, CAPA
// expectations set. All of that already exists as data by the end of conduct —
// this view is a read-only, present-on-the-shared-screen arrangement of it.
// Read-only is doctrine, not laziness: the closing meeting presents state;
// edits happen in the workspace behind it.
//
// Centered wide modal (not the right-drawer pattern) — this surface is shown
// to a room, not glanced at by one reviewer. useOverlay still owns ESC /
// scroll lock / focus trap.
// =============================================================================

const SEVERITY_ORDER: IsaSeverity[] = ['CRITICAL', 'MAJOR', 'MINOR', 'RECOMMENDATION'];
const SEVERITY_HEADINGS: Record<IsaSeverity, string> = {
  CRITICAL: 'Critical observations',
  MAJOR: 'Major observations',
  MINOR: 'Minor observations',
  RECOMMENDATION: 'Recommendations',
};

function longDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')} ${d.toLocaleString('en', { month: 'short' })} ${d.getFullYear()}`;
}

interface Props {
  findings: IsaFindingObject[];
  positiveNotes: AuditNoteObject[];
  onClose: () => void;
}

export default function IsaClosingMeetingView({ findings, positiveNotes, onClose }: Props) {
  const { theme } = useTheme();
  const { activeAudit } = useAudit();
  const isLight = theme === 'light';

  const panelRef = useRef<HTMLDivElement>(null);
  useOverlay({ isOpen: true, onClose, containerRef: panelRef });

  if (!activeAudit) return null;

  const overlay = isLight ? 'bg-black/30' : 'bg-black/50';
  const panelBg = isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/5';
  const divider = isLight ? 'border-[#E2E8F0]' : 'border-white/5';
  const brandText = isLight ? 'text-brand-600' : 'text-brand-300';

  const severityHeading = (s: IsaSeverity) => {
    switch (s) {
      case 'CRITICAL':
        return isLight ? 'text-red-700' : 'text-red-300';
      case 'MAJOR':
        return isLight ? 'text-amber-700' : 'text-amber-300';
      case 'MINOR':
        return isLight ? 'text-sky-700' : 'text-sky-300';
      case 'RECOMMENDATION':
        return 'text-fg-sub';
    }
  };

  const groups = SEVERITY_ORDER.map((severity) => ({
    severity,
    items: findings.filter((f) => f.severity === severity),
  }));
  const hasCapaSeverities = groups.some(
    (g) => (g.severity === 'CRITICAL' || g.severity === 'MAJOR') && g.items.length > 0,
  );

  return (
    <div
      className={`fixed inset-0 z-50 ${overlay} flex items-center justify-center p-4 animate-fade-in`}
      onClick={onClose}
      role="presentation"
      aria-hidden="true"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Closing meeting — preliminary findings"
        className={`w-full max-w-3xl max-h-[92vh] ${panelBg} border rounded-lg shadow-xl flex flex-col`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`flex items-start justify-between gap-4 px-6 py-4 border-b ${divider} flex-shrink-0`}>
          <div>
            <p className="text-fg-label text-[10px] uppercase tracking-wider font-semibold">
              Closing meeting · {longDate(new Date())}
            </p>
            <h2 className="text-fg-heading text-lg font-semibold mt-0.5">
              Preliminary audit observations
            </h2>
            <p className="text-fg-sub text-xs mt-1">
              {activeAudit.auditee_name}
              {activeAudit.site_number ? ` · Site ${activeAudit.site_number}` : ''}
              {activeAudit.principal_investigator ? ` · ${activeAudit.principal_investigator}` : ''}
              {activeAudit.protocol_code ? ` · ${activeAudit.protocol_code}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-fg-sub hover:opacity-75 transition-opacity flex-shrink-0 mt-1"
            aria-label="Close"
          >
            <XIcon size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-6 py-5 space-y-6">
          <p className="text-fg-muted text-xs">
            Preliminary — observations are subject to final review and will be detailed
            in the written audit report.
          </p>

          {findings.length === 0 && (
            <p className="text-fg-sub text-sm">
              No observations recorded. The closing summary will note the areas reviewed
              and the positive observations below.
            </p>
          )}

          {groups.map(
            ({ severity, items }) =>
              items.length > 0 && (
                <section key={severity}>
                  <h3 className={`text-sm font-semibold ${severityHeading(severity)}`}>
                    {SEVERITY_HEADINGS[severity]} ({items.length})
                  </h3>
                  <ul className="mt-2 space-y-3">
                    {items.map((f) => (
                      <li key={f.id} className={`border-l-2 pl-3 ${divider}`}>
                        <p className="text-fg-heading text-sm font-medium">{f.title}</p>
                        <p className="text-fg-body text-sm mt-0.5">{f.observation}</p>
                        <p className="text-fg-muted text-[11px] mt-1">
                          {ISA_DOMAIN_LABELS[f.isa_domain]}
                          {f.reference ? ` · ${f.reference}` : ''}
                          {` · ${f.evidence.length} evidence ${f.evidence.length === 1 ? 'item' : 'items'}`}
                        </p>
                      </li>
                    ))}
                  </ul>
                </section>
              ),
          )}

          {positiveNotes.length > 0 && (
            <section>
              <h3 className={`flex items-center gap-1.5 text-sm font-semibold ${
                isLight ? 'text-emerald-700' : 'text-emerald-300'
              }`}>
                <ThumbsUp size={13} />
                Positive observations ({positiveNotes.length})
              </h3>
              <ul className="mt-2 space-y-1.5">
                {positiveNotes.map((n) => (
                  <li key={n.id} className="text-fg-body text-sm">
                    {n.body}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {hasCapaSeverities && (
            <p className={`text-xs text-fg-sub border-t pt-4 ${divider}`}>
              Critical and Major observations require a written response including root
              cause, correction, and a corrective action plan with responsible person(s)
              and target dates. Minor observations expect correction; recommendations are
              optional to address.
            </p>
          )}
        </div>

        {/* Footer */}
        <div className={`flex items-center gap-1.5 px-6 py-3 border-t ${divider} flex-shrink-0`}>
          <PiqcMark size={11} className={brandText} />
          <span className="text-fg-muted text-[11px]">
            Assembled by PIQC from the auditor's accepted findings — presentation view only.
          </span>
        </div>
      </div>
    </div>
  );
}
