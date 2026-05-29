import { useEffect, useState } from 'react';
import { Building2, CalendarRange, FileText, FlaskConical, RefreshCw, Tag, Upload } from 'lucide-react';
import { useProtocol } from '../../../context/ProtocolContext';
import { useSiteData } from '../../../context/SiteDataContext';
import { useTheme } from '../../../context/ThemeContext';
import { fetchVisitTemplates, materializeVisits } from '../../../lib/site/siteApi';
import type { ProtocolVisitTemplate } from '../../../lib/site/types';
import AnchorDateModal from './AnchorDateModal';
import WorksheetItemsList from '../../sotr/WorksheetItemsList';

// =============================================================================
// ProtocolTab — Protocol metadata + documents tagged to this protocol.
//
// Metadata comes from ProtocolContext (already real). Documents come from
// `documents` rows where protocol_id matches the active protocol — populated
// by the ingest auto-tag trigger that matches extracted_fields.protocol_number
// against protocols.study_number_normalized.
// =============================================================================

export default function ProtocolTab() {
  const { activeProtocol } = useProtocol();
  const { documents, error, refresh } = useSiteData();
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const [templates, setTemplates] = useState<ProtocolVisitTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [showAnchorModal, setShowAnchorModal] = useState(false);
  const [materializing, setMaterializing] = useState(false);
  const [statusToast, setStatusToast] = useState<string | null>(null);

  const pageBg = isLight ? 'bg-[#F8FAFC]' : 'bg-[#020617]';
  const cardBg = isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/5';
  const divideColor = isLight ? 'divide-[#F2F2F2]' : 'divide-white/[0.04]';
  const mutedColor = 'text-fg-muted';
  const subColor = 'text-fg-sub';

  useEffect(() => {
    let cancelled = false;
    if (!activeProtocol) return;
    setTemplatesLoading(true);
    fetchVisitTemplates(activeProtocol.id).then((r) => {
      if (cancelled) return;
      setTemplatesLoading(false);
      if (r.ok) setTemplates(r.data);
    });
    return () => {
      cancelled = true;
    };
  }, [activeProtocol]);

  if (!activeProtocol) return null;

  const docs = documents;

  const latest = docs[0]?.extracted_fields;
  const highlights = collectHighlights(latest);

  const handleMaterialize = async () => {
    setMaterializing(true);
    setStatusToast(null);
    const r = await materializeVisits(activeProtocol.id);
    setMaterializing(false);
    if (!r.ok) {
      setStatusToast(`Failed: ${r.error}`);
      return;
    }
    const skipped = r.data.skipped_no_anchor > 0
      ? ` (${r.data.skipped_no_anchor} participant${r.data.skipped_no_anchor === 1 ? '' : 's'} skipped — no anchor / enrolled_at)`
      : '';
    setStatusToast(`Projected ${r.data.created} visit${r.data.created === 1 ? '' : 's'}${skipped}.`);
    refresh();
  };

  return (
    <div className={`${pageBg} h-full overflow-y-auto`}>
      <div className="p-6 max-w-3xl mx-auto space-y-6">

        {/* Header */}
        <div>
          <p className="text-fg-label text-[10px] uppercase tracking-wider font-semibold">
            {activeProtocol.code}
          </p>
          <h2 className="text-fg-heading text-xl font-semibold mt-0.5">Protocol</h2>
          <p className={`${subColor} text-sm mt-1`}>{activeProtocol.name}</p>
        </div>

        {error && (
          <div
            className={`border rounded-md px-3 py-2 text-xs ${
              isLight ? 'bg-rose-50 border-rose-200 text-rose-700' : 'bg-rose-500/[0.06] border-rose-500/20 text-rose-300'
            }`}
          >
            Failed to load protocol data: {error}
          </div>
        )}

        {/* Metadata rows */}
        <div className={`${cardBg} border rounded-xl divide-y ${divideColor}`}>
          <MetaRow icon={<Tag size={14} />} label="Protocol code" value={activeProtocol.code} isLight={isLight} />
          <MetaRow icon={<Building2 size={14} />} label="Sponsor" value={activeProtocol.sponsor || '—'} isLight={isLight} />
          <MetaRow icon={<FlaskConical size={14} />} label="Phase" value={activeProtocol.phase || '—'} isLight={isLight} />
          {highlights.map((h) => (
            <MetaRow
              key={h.label}
              icon={<FileText size={14} />}
              label={h.label}
              value={h.value}
              isLight={isLight}
            />
          ))}
        </div>

        {/* Schedule (Phase E) */}
        <div className={`${cardBg} border rounded-xl overflow-hidden`}>
          <div
            className={`px-5 py-3.5 border-b flex items-center justify-between gap-3 flex-wrap ${
              isLight ? 'border-[#F2F2F2]' : 'border-white/[0.04]'
            }`}
          >
            <p className="text-fg-label text-[10px] uppercase tracking-wider font-semibold">
              Schedule of events
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowAnchorModal(true)}
                className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-md border transition-colors ${
                  isLight
                    ? 'bg-white border-[#E2E8F0] text-[#334155] hover:bg-[#F8FAFC]'
                    : 'bg-[#0F172A] border-white/10 text-[#CBD5E1] hover:bg-white/[0.04]'
                }`}
              >
                <CalendarRange size={11} />
                {activeProtocol.demoAnchorDate ? 'Change anchor' : 'Set anchor date'}
              </button>
              {templates.length > 0 && activeProtocol.demoAnchorDate && (
                <button
                  type="button"
                  onClick={handleMaterialize}
                  disabled={materializing}
                  className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-md text-white transition-colors disabled:opacity-50 ${
                    isLight ? 'bg-[#017BC8] hover:bg-[#0477BF]' : 'bg-[#74B4DC] hover:bg-[#3CACF4]'
                  }`}
                >
                  <RefreshCw size={11} className={materializing ? 'animate-spin' : ''} />
                  {materializing ? 'Projecting…' : 'Re-project visits'}
                </button>
              )}
            </div>
          </div>

          {/* Anchor + status row */}
          <div className={`px-5 py-3 border-b flex flex-wrap items-center gap-x-6 gap-y-1 ${
            isLight ? 'border-[#F2F2F2]' : 'border-white/[0.04]'
          }`}>
            <div>
              <p className={`${mutedColor} text-[10px] uppercase tracking-wider font-semibold`}>Day 0 anchor</p>
              <p className="text-fg-heading text-sm font-medium">
                {activeProtocol.demoAnchorDate ? formatDate(activeProtocol.demoAnchorDate) : '—'}
              </p>
            </div>
            <div>
              <p className={`${mutedColor} text-[10px] uppercase tracking-wider font-semibold`}>Timezone</p>
              <p className="text-fg-heading text-sm font-medium">
                {activeProtocol.timezone ?? 'Browser default'}
              </p>
            </div>
            <div>
              <p className={`${mutedColor} text-[10px] uppercase tracking-wider font-semibold`}>Templates</p>
              <p className="text-fg-heading text-sm font-medium">
                {templatesLoading ? '…' : `${templates.length} extracted`}
              </p>
            </div>
            {statusToast && (
              <p className={`text-xs ${
                statusToast.startsWith('Failed') ? 'text-rose-500' : isLight ? 'text-emerald-700' : 'text-emerald-400'
              }`}>
                {statusToast}
              </p>
            )}
          </div>

          {/* Templates list / empty states */}
          {templates.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <CalendarRange className={`mx-auto mb-3 ${mutedColor}`} size={22} />
              <p className="text-fg-heading text-sm font-medium">
                {templatesLoading ? 'Loading schedule…' : 'No schedule extracted yet.'}
              </p>
              {!templatesLoading && (
                <p className={`${subColor} text-xs mt-1.5 leading-relaxed max-w-md mx-auto`}>
                  Reducto didn't surface a schedule of events for this protocol. Low-confidence
                  extractions can be reviewed and corrected in the Source of Truth Reviewer.
                </p>
              )}
            </div>
          ) : !activeProtocol.demoAnchorDate ? (
            <div
              className={`px-5 py-3 ${
                isLight ? 'bg-amber-50 border-b border-amber-200' : 'bg-amber-500/[0.06] border-b border-amber-500/20'
              }`}
            >
              <p className={`text-xs font-medium ${isLight ? 'text-amber-800' : 'text-amber-300'}`}>
                {templates.length} template{templates.length === 1 ? '' : 's'} extracted but no anchor date set.
              </p>
              <p className={`text-[11px] mt-0.5 ${isLight ? 'text-amber-700' : 'text-amber-300/80'}`}>
                Set the Day 0 calendar date above to project visits onto the calendar.
              </p>
            </div>
          ) : null}

          {templates.length > 0 && (
            <div className={`divide-y ${divideColor} max-h-72 overflow-y-auto`}>
              {templates.map((t) => (
                <div key={t.id} className="px-5 py-2.5 flex items-center gap-4 flex-wrap">
                  <span className="text-fg-heading text-sm font-medium flex-1 min-w-0 truncate">
                    {t.visit_name}
                  </span>
                  <span className={`${subColor} text-xs font-mono`}>Day {t.study_day}</span>
                  {(t.window_minus_days > 0 || t.window_plus_days > 0) && (
                    <span className={`${mutedColor} text-[11px]`}>
                      ±{Math.max(t.window_minus_days, t.window_plus_days)}d window
                    </span>
                  )}
                  <span className={`${mutedColor} text-[11px]`}>
                    {t.procedures.length} procedure{t.procedures.length === 1 ? '' : 's'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Parsed protocol items — Source Truth Reviewer (PR-3, PR-6 export) */}
        <WorksheetItemsList studyId={activeProtocol.id} studyCode={activeProtocol.code} />

        {/* Documents */}
        <div className={`${cardBg} border rounded-xl overflow-hidden`}>
          <div className={`px-5 py-3.5 border-b ${isLight ? 'border-[#F2F2F2]' : 'border-white/[0.04]'}`}>
            <p className="text-fg-label text-[10px] uppercase tracking-wider font-semibold">
              Documents
            </p>
          </div>
          {docs.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <Upload className={`mx-auto mb-3 ${mutedColor}`} size={22} />
              <p className="text-fg-heading text-sm font-medium">
                No protocol documents uploaded yet.
              </p>
              <p className={`${subColor} text-xs mt-1.5 leading-relaxed max-w-md mx-auto`}>
                Upload a protocol PDF in the document library. Once parsed, documents matching
                the protocol number <span className="font-mono font-semibold">{activeProtocol.code}</span>{' '}
                will appear here automatically.
              </p>
            </div>
          ) : (
            <div className={`divide-y ${divideColor}`}>
              {docs.map((d) => (
                <div key={d.id} className="px-5 py-3.5">
                  <div className="flex items-start gap-3">
                    <FileText
                      size={14}
                      className={`mt-0.5 flex-shrink-0 ${isLight ? 'text-[#334155]/35' : 'text-[#CBD5E1]/30'}`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-fg-heading text-sm font-medium truncate">{d.title || d.source}</p>
                      <p className={`${mutedColor} text-[11px] mt-0.5`}>
                        {d.source} · ingested {formatDate(d.created_at)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>

      {showAnchorModal && (
        <AnchorDateModal
          protocolId={activeProtocol.id}
          protocolCode={activeProtocol.code}
          initialDate={activeProtocol.demoAnchorDate}
          initialTimezone={activeProtocol.timezone}
          onSaved={(r) => {
            const skipped = r.skipped_no_anchor > 0
              ? ` (${r.skipped_no_anchor} skipped — no enrolled_at)`
              : '';
            setStatusToast(`Projected ${r.created} visit${r.created === 1 ? '' : 's'}${skipped}.`);
            refresh();
          }}
          onClose={() => setShowAnchorModal(false)}
        />
      )}
    </div>
  );
}

interface MetaRowProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  isLight: boolean;
}

function MetaRow({ icon, label, value, isLight }: MetaRowProps) {
  return (
    <div className="px-5 py-4 flex items-center gap-4">
      <span className={`flex-shrink-0 ${isLight ? 'text-[#334155]/35' : 'text-[#CBD5E1]/30'}`}>
        {icon}
      </span>
      <div className="flex-1 min-w-0 flex items-center justify-between gap-4 flex-wrap">
        <span className="text-fg-label text-xs uppercase tracking-wider font-semibold">{label}</span>
        <span className={`text-sm ${isLight ? 'text-[#0F172A]' : 'text-[#CBD5E1]'} text-right max-w-[60%] break-words`}>{value}</span>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

interface Highlight {
  label: string;
  value: string;
}

function collectHighlights(extracted: Record<string, unknown> | null | undefined): Highlight[] {
  if (!extracted) return [];
  const fields: { key: string; label: string }[] = [
    { key: 'therapeutic_area', label: 'Therapeutic area' },
    { key: 'study_design',     label: 'Study design' },
    { key: 'dosing_regimen',   label: 'Dosing regimen' },
  ];
  const out: Highlight[] = [];
  for (const f of fields) {
    const raw = extracted[f.key];
    if (typeof raw === 'string' && raw.trim().length > 0) {
      out.push({ label: f.label, value: raw });
    }
  }
  const primary = extracted['primary_endpoints'];
  if (Array.isArray(primary) && primary.length > 0) {
    const first = typeof primary[0] === 'string' ? (primary[0] as string) : '';
    out.push({ label: 'Primary endpoint', value: first || `${primary.length} endpoint(s)` });
  }
  return out;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
