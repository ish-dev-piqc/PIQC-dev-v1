import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Pencil,
  Plus,
  X,
  ArrowRight,
  AlertTriangle,
  Sparkles,
  FileText,
  CalendarDays,
  ListChecks,
} from 'lucide-react';
import { useTheme } from '../../../../context/ThemeContext';
import { useAudit } from '../../../../context/AuditContext';
import { useAuditData } from '../../../../context/AuditDataContext';
import {
  type MockAgendaItem,
  type MockChecklistItem,
  type MockConfirmationLetter,
  type MockAgenda,
  type MockChecklist,
  type MockPreAuditBundle,
} from '../../../../lib/audit/mockPreAudit';
import type { DeliverableApprovalStatus } from '../../../../types/audit';

// =============================================================================
// PreAuditDraftingWorkspace — PRE_AUDIT_DRAFTING stage center pane.
//
// Three tabs sharing the Revise / Save / Cancel / Approve pattern:
//   - Confirmation Letter (sent to vendor)
//   - Agenda (multi-item audit plan)
//   - Checklist (auditor's working checklist)
//
// All three deliverables follow D-010 step 7 lifecycle:
//   - DRAFT until explicitly Approved
//   - Editing an APPROVED deliverable demotes it to DRAFT (re-approval needed)
//   - When all three are APPROVED, AUDIT_CONDUCT unlocks
// =============================================================================

type TabKey = 'confirmation_letter' | 'agenda' | 'checklist';

interface TabDef {
  key: TabKey;
  label: string;
  description: string;
  icon: typeof FileText;
}

const TAB_DEFS: TabDef[] = [
  {
    key: 'confirmation_letter',
    label: 'Confirmation letter',
    description: 'Sent to the vendor confirming dates, attendees, and scope.',
    icon: FileText,
  },
  {
    key: 'agenda',
    label: 'Agenda',
    description: 'Multi-day audit plan: time slots, topics, owners, and notes.',
    icon: CalendarDays,
  },
  {
    key: 'checklist',
    label: 'Checklist',
    description: "The auditor's working checklist — what to observe, evidence to collect, checkpoints to verify.",
    icon: ListChecks,
  },
];

export default function PreAuditDraftingWorkspace() {
  const { theme } = useTheme();
  const { activeAudit, advanceStage } = useAudit();
  const isLight = theme === 'light';

  const { preAuditBundles: bundles, setPreAuditBundles: setBundles } = useAuditData();
  const [activeTab, setActiveTab] = useState<TabKey>('confirmation_letter');

  useEffect(() => {
    setActiveTab('confirmation_letter');
  }, [activeAudit?.id]);

  if (!activeAudit) return null;

  const auditId = activeAudit.id;
  const bundle: MockPreAuditBundle = bundles[auditId] ?? {
    confirmation_letter: null,
    agenda: null,
    checklist: null,
  };

  // ---------------------------------------------------------------------------
  // Mutations (mock-backed)
  // ---------------------------------------------------------------------------
  const setBundle = (next: MockPreAuditBundle) => {
    setBundles((prev) => ({ ...prev, [auditId]: next }));
  };

  const generateAllStubs = () => {
    setBundle({
      confirmation_letter: createConfirmationStub(auditId),
      agenda: createAgendaStub(auditId),
      checklist: createChecklistStub(auditId),
    });
  };

  // ---------------------------------------------------------------------------
  // Theme tokens
  // ---------------------------------------------------------------------------
  const headingColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';
  const mutedColor = 'text-fg-muted';
  const sectionHeader = 'text-fg-label';
  const cardBg = isLight ? 'bg-white border-[#e2e8ee]' : 'bg-[#131a22] border-white/5';
  const tabRail = isLight ? 'border-[#e2e8ee]' : 'border-white/5';
  const tabActive = isLight
    ? 'border-[#4a6fa5] text-[#4a6fa5]'
    : 'border-[#6e8fb5] text-[#6e8fb5]';
  const tabInactive = isLight
    ? 'border-transparent text-[#374152]/60 hover:text-[#1a1f28]'
    : 'border-transparent text-[#d2d7e0]/55 hover:text-white';
  const buttonPrimary = isLight
    ? 'bg-[#4a6fa5] text-white hover:bg-[#3d5e8f]'
    : 'bg-[#6e8fb5] text-[#1a1f28] hover:bg-[#5e7fa5]';
  const buttonApprove = isLight
    ? 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-[#cbd2db]'
    : 'bg-emerald-500 text-[#0d1118] hover:bg-emerald-400 disabled:bg-white/10 disabled:text-white/35';

  // ---------------------------------------------------------------------------
  // Empty state — all three deliverables missing
  // ---------------------------------------------------------------------------
  const allMissing =
    !bundle.confirmation_letter && !bundle.agenda && !bundle.checklist;

  if (allMissing) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <p className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold`}>
          Stage 5 · Pre-audit drafting
        </p>
        <h2 className={`${headingColor} text-xl font-semibold mt-1`}>
          Draft pre-audit deliverables
        </h2>
        <p className={`${subColor} text-sm mt-1.5 leading-relaxed max-w-2xl`}>
          The three deliverables — confirmation letter, agenda, and checklist — are drafted
          here from your approved risk summary and vendor service mappings. Generate stubs
          to start, then edit each down to your judgment.
        </p>
        <button
          type="button"
          onClick={generateAllStubs}
          className={`mt-5 inline-flex items-center gap-2 text-sm font-semibold px-3.5 py-2 rounded-md transition-colors ${buttonPrimary}`}
        >
          <Sparkles size={14} />
          Generate all three stubs
        </button>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Per-tab approval signals + advance gate
  // ---------------------------------------------------------------------------
  const approvalStatuses: Record<TabKey, DeliverableApprovalStatus | null> = {
    confirmation_letter: bundle.confirmation_letter?.approval_status ?? null,
    agenda: bundle.agenda?.approval_status ?? null,
    checklist: bundle.checklist?.approval_status ?? null,
  };
  const allApproved =
    approvalStatuses.confirmation_letter === 'APPROVED' &&
    approvalStatuses.agenda === 'APPROVED' &&
    approvalStatuses.checklist === 'APPROVED';

  const alreadyAdvanced = ['AUDIT_CONDUCT', 'REPORT_DRAFTING', 'FINAL_REVIEW_EXPORT'].includes(
    activeAudit.current_stage,
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <p className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold`}>
          Stage 5 · Pre-audit drafting
        </p>
        <h2 className={`${headingColor} text-xl font-semibold mt-1`}>
          Draft pre-audit deliverables
        </h2>
        <p className={`${subColor} text-sm mt-1.5 leading-relaxed max-w-2xl`}>
          Three deliverables share this stage. All must be Approved before audit conduct unlocks.
          Editing an Approved deliverable reverts it to Draft.
        </p>
      </div>

      {/* Tab rail with per-tab approval indicator */}
      <div className={`border-b ${tabRail}`}>
        <div className="flex items-stretch gap-1 overflow-x-auto">
          {TAB_DEFS.map((t) => {
            const Icon = t.icon;
            const status = approvalStatuses[t.key];
            const isActive = activeTab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setActiveTab(t.key)}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  isActive ? tabActive : tabInactive
                }`}
              >
                <Icon size={14} />
                {t.label}
                <ApprovalDot status={status} isLight={isLight} />
              </button>
            );
          })}
        </div>
      </div>

      {/* Active tab content */}
      {activeTab === 'confirmation_letter' && (
        <ConfirmationLetterTab
          deliverable={bundle.confirmation_letter}
          isLight={isLight}
          onChange={(next) => setBundle({ ...bundle, confirmation_letter: next })}
        />
      )}
      {activeTab === 'agenda' && (
        <AgendaTab
          deliverable={bundle.agenda}
          isLight={isLight}
          onChange={(next) => setBundle({ ...bundle, agenda: next })}
        />
      )}
      {activeTab === 'checklist' && (
        <ChecklistTab
          deliverable={bundle.checklist}
          isLight={isLight}
          onChange={(next) => setBundle({ ...bundle, checklist: next })}
        />
      )}

      {/* Stage advance */}
      <div className={`${cardBg} border rounded-xl p-5`}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <p className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold`}>
              Stage transition
            </p>
            <p className={`${headingColor} text-sm font-semibold mt-1`}>
              {alreadyAdvanced
                ? 'Audit has already advanced past this stage'
                : allApproved
                ? 'All deliverables approved — ready to advance'
                : 'Approve all three deliverables to advance'}
            </p>
            {!alreadyAdvanced && !allApproved && (
              <ul className={`${subColor} text-xs mt-2 space-y-1`}>
                {TAB_DEFS.map((t) => {
                  const s = approvalStatuses[t.key];
                  const ok = s === 'APPROVED';
                  return (
                    <li key={t.key} className="flex items-center gap-1.5">
                      {ok ? (
                        <CheckCircle2 size={11} className="text-emerald-600" />
                      ) : (
                        <span className={`inline-block w-2.5 h-2.5 rounded-full border ${
                          isLight ? 'border-[#cbd2db]' : 'border-white/15'
                        }`} />
                      )}
                      <span className={ok ? subColor : mutedColor}>{t.label}</span>
                      <span className={`${mutedColor} text-[10px] uppercase tracking-wider`}>
                        {s === 'APPROVED' ? 'approved' : s === 'DRAFT' ? 'draft' : 'not started'}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            {alreadyAdvanced && (
              <p className={`${subColor} text-xs mt-1`}>
                Current stage: {activeAudit.current_stage.replace(/_/g, ' ').toLowerCase()}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => advanceStage('AUDIT_CONDUCT')}
            disabled={!allApproved || alreadyAdvanced}
            className={`inline-flex items-center gap-1.5 text-sm font-semibold px-3.5 py-2 rounded-md transition-colors ${buttonApprove}`}
          >
            Advance to Audit conduct
            <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// ApprovalDot — small marker shown next to each tab label
// ============================================================================

function ApprovalDot({
  status,
  isLight,
}: {
  status: DeliverableApprovalStatus | null;
  isLight: boolean;
}) {
  if (status === 'APPROVED') {
    return (
      <span className={isLight ? 'text-emerald-600' : 'text-emerald-400'}>
        <CheckCircle2 size={12} />
      </span>
    );
  }
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${
        status === 'DRAFT'
          ? 'bg-amber-500'
          : isLight
          ? 'bg-[#cbd2db]'
          : 'bg-white/15'
      }`}
    />
  );
}

// ============================================================================
// Confirmation Letter tab
// ============================================================================

interface ConfirmationLetterTabProps {
  deliverable: MockConfirmationLetter | null;
  isLight: boolean;
  onChange: (next: MockConfirmationLetter | null) => void;
}

function ConfirmationLetterTab({ deliverable, isLight, onChange }: ConfirmationLetterTabProps) {
  const [editing, setEditing] = useState(!deliverable);
  const [body, setBody] = useState(deliverable?.content.body_text ?? '');
  const [recipients, setRecipients] = useState<string[]>(
    deliverable?.content.recipients ?? [],
  );
  const [scope, setScope] = useState<string[]>(deliverable?.content.scope ?? []);

  useEffect(() => {
    setEditing(!deliverable);
    setBody(deliverable?.content.body_text ?? '');
    setRecipients(deliverable?.content.recipients ?? []);
    setScope(deliverable?.content.scope ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deliverable?.id]);

  const save = () => {
    onChange({
      id: deliverable?.id ?? `cl-${Date.now()}`,
      audit_id: deliverable?.audit_id ?? '',
      content: { body_text: body, recipients, scope },
      // Editing demotes APPROVED → DRAFT
      approval_status: 'DRAFT',
      approved_by_name: null,
      approved_at: null,
    });
    setEditing(false);
  };

  const approve = () => {
    if (!deliverable) return;
    onChange({
      ...deliverable,
      approval_status: 'APPROVED',
      approved_at: new Date().toISOString(),
      approved_by_name: 'You',
    });
  };

  const cancel = () => {
    setBody(deliverable?.content.body_text ?? '');
    setRecipients(deliverable?.content.recipients ?? []);
    setScope(deliverable?.content.scope ?? []);
    setEditing(false);
  };

  return (
    <DeliverableShell
      kind="Confirmation letter"
      description="Sent to the vendor confirming dates, attendees, and scope. Sponsor branding is added externally on export."
      deliverable={deliverable}
      isLight={isLight}
      editing={editing}
      onBeginEdit={() => setEditing(true)}
      onSave={save}
      onCancel={cancel}
      onApprove={approve}
      canSave={!!body.trim()}
    >
      {!editing && deliverable ? (
        <div className="space-y-4">
          <SubSection label="Body" isLight={isLight}>
            <p className={`text-sm whitespace-pre-wrap leading-relaxed ${isLight ? 'text-[#1a1f28]' : 'text-white'}`}>
              {deliverable.content.body_text}
            </p>
          </SubSection>
          {deliverable.content.recipients.length > 0 && (
            <SubSection label="Recipients" isLight={isLight}>
              <div className="flex flex-wrap gap-1.5">
                {deliverable.content.recipients.map((r, i) => (
                  <Chip key={i} isLight={isLight}>{r}</Chip>
                ))}
              </div>
            </SubSection>
          )}
          {deliverable.content.scope.length > 0 && (
            <SubSection label="Scope" isLight={isLight}>
              <ul className="space-y-1">
                {deliverable.content.scope.map((s, i) => (
                  <li
                    key={i}
                    className={`text-sm flex items-start gap-2 ${isLight ? 'text-[#1a1f28]' : 'text-white'}`}
                  >
                    <span
                      className={`mt-1.5 w-1 h-1 rounded-full flex-shrink-0 ${
                        isLight ? 'bg-[#4a6fa5]/55' : 'bg-[#6e8fb5]/55'
                      }`}
                    />
                    {s}
                  </li>
                ))}
              </ul>
            </SubSection>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <FieldLabel label="Body text" isLight={isLight}>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              placeholder="Confirm dates, attendees, and scope. Keep it sponsor-name-free."
              className={textareaClass(isLight)}
            />
          </FieldLabel>
          <ChipListEditor
            label="Recipients"
            placeholder='e.g. "Maya Khoury (Quality Director)"'
            items={recipients}
            onChange={setRecipients}
            isLight={isLight}
          />
          <ChipListEditor
            label="Scope"
            placeholder="One scope item per entry"
            items={scope}
            onChange={setScope}
            isLight={isLight}
            multiline
          />
        </div>
      )}
    </DeliverableShell>
  );
}

// ============================================================================
// Agenda tab
// ============================================================================

interface AgendaTabProps {
  deliverable: MockAgenda | null;
  isLight: boolean;
  onChange: (next: MockAgenda | null) => void;
}

function AgendaTab({ deliverable, isLight, onChange }: AgendaTabProps) {
  const [editing, setEditing] = useState(!deliverable);
  const [items, setItems] = useState<MockAgendaItem[]>(
    deliverable?.content.items ?? [],
  );

  useEffect(() => {
    setEditing(!deliverable);
    setItems(deliverable?.content.items ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deliverable?.id]);

  const save = () => {
    onChange({
      id: deliverable?.id ?? `ag-${Date.now()}`,
      audit_id: deliverable?.audit_id ?? '',
      content: { items },
      approval_status: 'DRAFT',
      approved_by_name: null,
      approved_at: null,
    });
    setEditing(false);
  };

  const approve = () => {
    if (!deliverable) return;
    onChange({
      ...deliverable,
      approval_status: 'APPROVED',
      approved_at: new Date().toISOString(),
      approved_by_name: 'You',
    });
  };

  const cancel = () => {
    setItems(deliverable?.content.items ?? []);
    setEditing(false);
  };

  const addItem = () => {
    setItems((prev) => [
      ...prev,
      { id: `ai-${Date.now()}-${prev.length}`, time: '', topic: '', owner: '', notes: null },
    ]);
  };

  const updateItem = (id: string, patch: Partial<MockAgendaItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
  };

  return (
    <DeliverableShell
      kind="Agenda"
      description="Day-by-day audit plan. Each row is one slot — time, topic, owner, optional notes."
      deliverable={deliverable}
      isLight={isLight}
      editing={editing}
      onBeginEdit={() => setEditing(true)}
      onSave={save}
      onCancel={cancel}
      onApprove={approve}
      canSave={items.length > 0 && items.every((it) => it.time.trim() && it.topic.trim())}
    >
      {!editing && deliverable && deliverable.content.items.length > 0 ? (
        <div className="space-y-2">
          {deliverable.content.items.map((it) => (
            <AgendaItemRow key={it.id} item={it} isLight={isLight} />
          ))}
        </div>
      ) : !editing && deliverable ? (
        <p className={`text-sm italic ${isLight ? 'text-[#374152]/55' : 'text-[#d2d7e0]/45'}`}>
          No agenda items.
        </p>
      ) : (
        <div className="space-y-2">
          {items.length === 0 && (
            <p className={`text-sm italic ${isLight ? 'text-[#374152]/55' : 'text-[#d2d7e0]/45'}`}>
              No agenda items yet. Add one below.
            </p>
          )}
          {items.map((it) => (
            <AgendaItemEditRow
              key={it.id}
              item={it}
              isLight={isLight}
              onUpdate={(patch) => updateItem(it.id, patch)}
              onRemove={() => removeItem(it.id)}
            />
          ))}
          <button
            type="button"
            onClick={addItem}
            className={`inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-md transition-colors ${
              isLight
                ? 'bg-white border border-[#e2e8ee] text-[#374152] hover:bg-[#f5f7fa]'
                : 'bg-[#131a22] border border-white/10 text-[#d2d7e0] hover:bg-white/[0.04]'
            }`}
          >
            <Plus size={14} />
            Add agenda item
          </button>
        </div>
      )}
    </DeliverableShell>
  );
}

function AgendaItemRow({ item, isLight }: { item: MockAgendaItem; isLight: boolean }) {
  const headingColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';
  const mutedColor = 'text-fg-muted';
  const cardBg = isLight ? 'bg-white border-[#e2e8ee]' : 'bg-white/[0.02] border-white/[0.04]';
  return (
    <div className={`${cardBg} border rounded-md px-3 py-2.5`}>
      <p className={`text-[11px] uppercase tracking-wider font-semibold ${mutedColor}`}>
        {item.time}
      </p>
      <p className={`${headingColor} text-sm font-semibold mt-0.5`}>{item.topic}</p>
      <p className={`${subColor} text-xs mt-0.5`}>Owner: {item.owner}</p>
      {item.notes && (
        <p className={`${subColor} text-xs mt-1.5 leading-relaxed`}>{item.notes}</p>
      )}
    </div>
  );
}

function AgendaItemEditRow({
  item,
  isLight,
  onUpdate,
  onRemove,
}: {
  item: MockAgendaItem;
  isLight: boolean;
  onUpdate: (patch: Partial<MockAgendaItem>) => void;
  onRemove: () => void;
}) {
  const headingColor = 'text-fg-heading';
  const cardBg = isLight ? 'bg-white border-[#e2e8ee]' : 'bg-[#131a22] border-white/5';
  const buttonGhost = isLight
    ? 'text-[#374152]/55 hover:text-red-600'
    : 'text-[#d2d7e0]/55 hover:text-red-400';
  return (
    <div className={`${cardBg} border rounded-md p-3 space-y-2`}>
      <div className="flex items-start gap-2">
        <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-2">
          <input
            type="text"
            value={item.time}
            onChange={(e) => onUpdate({ time: e.target.value })}
            placeholder='Day 1 · 09:00 – 10:00'
            className={inputClass(isLight)}
          />
          <input
            type="text"
            value={item.topic}
            onChange={(e) => onUpdate({ topic: e.target.value })}
            placeholder="Topic"
            className={`${inputClass(isLight)} sm:col-span-2`}
          />
          <input
            type="text"
            value={item.owner}
            onChange={(e) => onUpdate({ owner: e.target.value })}
            placeholder="Owner (auditor / vendor team)"
            className={`${inputClass(isLight)} sm:col-span-3`}
          />
          <textarea
            value={item.notes ?? ''}
            onChange={(e) => onUpdate({ notes: e.target.value || null })}
            rows={2}
            placeholder="Notes (optional)"
            className={`${inputClass(isLight)} ${headingColor} sm:col-span-3`}
          />
        </div>
        <button
          type="button"
          onClick={onRemove}
          className={`flex-shrink-0 p-1.5 rounded-md ${buttonGhost}`}
          aria-label="Remove agenda item"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Checklist tab
// ============================================================================

interface ChecklistTabProps {
  deliverable: MockChecklist | null;
  isLight: boolean;
  onChange: (next: MockChecklist | null) => void;
}

function ChecklistTab({ deliverable, isLight, onChange }: ChecklistTabProps) {
  const [editing, setEditing] = useState(!deliverable);
  const [items, setItems] = useState<MockChecklistItem[]>(
    deliverable?.content.items ?? [],
  );

  useEffect(() => {
    setEditing(!deliverable);
    setItems(deliverable?.content.items ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deliverable?.id]);

  const save = () => {
    onChange({
      id: deliverable?.id ?? `ch-${Date.now()}`,
      audit_id: deliverable?.audit_id ?? '',
      content: { items },
      approval_status: 'DRAFT',
      approved_by_name: null,
      approved_at: null,
    });
    setEditing(false);
  };

  const approve = () => {
    if (!deliverable) return;
    onChange({
      ...deliverable,
      approval_status: 'APPROVED',
      approved_at: new Date().toISOString(),
      approved_by_name: 'You',
    });
  };

  const cancel = () => {
    setItems(deliverable?.content.items ?? []);
    setEditing(false);
  };

  const addItem = () => {
    setItems((prev) => [
      ...prev,
      {
        id: `ci-${Date.now()}-${prev.length}`,
        prompt: '',
        checkpoint_ref: null,
        evidence_expected: false,
      },
    ]);
  };

  const updateItem = (id: string, patch: Partial<MockChecklistItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
  };

  const headingColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';
  const mutedColor = 'text-fg-muted';
  const cardBg = isLight ? 'bg-white border-[#e2e8ee]' : 'bg-white/[0.02] border-white/[0.04]';
  const buttonGhost = isLight
    ? 'text-[#374152]/55 hover:text-red-600'
    : 'text-[#d2d7e0]/55 hover:text-red-400';

  return (
    <DeliverableShell
      kind="Checklist"
      description="The auditor's working checklist for the audit day. Each item: a prompt, optional SOP/section reference, and whether evidence is expected on the spot."
      deliverable={deliverable}
      isLight={isLight}
      editing={editing}
      onBeginEdit={() => setEditing(true)}
      onSave={save}
      onCancel={cancel}
      onApprove={approve}
      canSave={items.length > 0 && items.every((it) => it.prompt.trim())}
    >
      {!editing && deliverable && deliverable.content.items.length > 0 ? (
        <div className="space-y-2">
          {deliverable.content.items.map((it, idx) => (
            <div key={it.id} className={`${cardBg} border rounded-md px-3 py-2.5 flex items-start gap-3`}>
              <span className={`text-[11px] font-semibold ${mutedColor} w-5 flex-shrink-0`}>
                {idx + 1}.
              </span>
              <div className="flex-1 min-w-0">
                <p className={`text-sm ${headingColor}`}>{it.prompt}</p>
                <div className="flex items-center gap-3 mt-1 flex-wrap">
                  {it.checkpoint_ref && (
                    <span className={`text-[11px] font-mono ${subColor}`}>{it.checkpoint_ref}</span>
                  )}
                  {it.evidence_expected && (
                    <span
                      className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
                        isLight
                          ? 'bg-[#4a6fa5]/10 border-[#4a6fa5]/25 text-[#4a6fa5]'
                          : 'bg-[#6e8fb5]/15 border-[#6e8fb5]/30 text-[#6e8fb5]'
                      }`}
                    >
                      Evidence expected
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : !editing && deliverable ? (
        <p className={`text-sm italic ${subColor}`}>No checklist items.</p>
      ) : (
        <div className="space-y-2">
          {items.length === 0 && (
            <p className={`text-sm italic ${subColor}`}>No checklist items yet. Add one below.</p>
          )}
          {items.map((it, idx) => (
            <div key={it.id} className={`${cardBg.replace('bg-white/[0.02]', 'bg-[#131a22]')} border rounded-md p-3`}>
              <div className="flex items-start gap-2">
                <span className={`text-[11px] font-semibold ${mutedColor} w-5 flex-shrink-0 mt-2`}>
                  {idx + 1}.
                </span>
                <div className="flex-1 grid grid-cols-1 gap-2">
                  <textarea
                    value={it.prompt}
                    onChange={(e) => updateItem(it.id, { prompt: e.target.value })}
                    placeholder="Checklist prompt"
                    rows={2}
                    className={inputClass(isLight)}
                  />
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr,auto] gap-2 items-center">
                    <input
                      type="text"
                      value={it.checkpoint_ref ?? ''}
                      onChange={(e) =>
                        updateItem(it.id, { checkpoint_ref: e.target.value || null })
                      }
                      placeholder="SOP / section reference (optional)"
                      className={inputClass(isLight)}
                    />
                    <label className={`flex items-center gap-2 text-xs ${headingColor}`}>
                      <input
                        type="checkbox"
                        checked={it.evidence_expected}
                        onChange={(e) =>
                          updateItem(it.id, { evidence_expected: e.target.checked })
                        }
                        className="rounded"
                      />
                      Evidence expected
                    </label>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => removeItem(it.id)}
                  className={`flex-shrink-0 p-1.5 rounded-md ${buttonGhost}`}
                  aria-label="Remove checklist item"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={addItem}
            className={`inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-md transition-colors ${
              isLight
                ? 'bg-white border border-[#e2e8ee] text-[#374152] hover:bg-[#f5f7fa]'
                : 'bg-[#131a22] border border-white/10 text-[#d2d7e0] hover:bg-white/[0.04]'
            }`}
          >
            <Plus size={14} />
            Add checklist item
          </button>
        </div>
      )}
    </DeliverableShell>
  );
}

// ============================================================================
// Shared deliverable shell (header + actions)
// ============================================================================

interface DeliverableShellProps {
  kind: string;
  description: string;
  deliverable: { approval_status: DeliverableApprovalStatus; approved_at: string | null; approved_by_name: string | null } | null;
  isLight: boolean;
  editing: boolean;
  onBeginEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onApprove: () => void;
  canSave: boolean;
  children: React.ReactNode;
}

function DeliverableShell({
  kind,
  description,
  deliverable,
  isLight,
  editing,
  onBeginEdit,
  onSave,
  onCancel,
  onApprove,
  canSave,
  children,
}: DeliverableShellProps) {
  const subColor = 'text-fg-sub';
  const mutedColor = 'text-fg-muted';
  const sectionHeader = 'text-fg-label';
  const cardBg = isLight ? 'bg-white border-[#e2e8ee]' : 'bg-[#131a22] border-white/5';
  const buttonPrimary = isLight
    ? 'bg-[#4a6fa5] text-white hover:bg-[#3d5e8f]'
    : 'bg-[#6e8fb5] text-[#1a1f28] hover:bg-[#5e7fa5]';
  const buttonSecondary = isLight
    ? 'bg-white border border-[#e2e8ee] text-[#374152] hover:bg-[#f5f7fa]'
    : 'bg-[#131a22] border border-white/10 text-[#d2d7e0] hover:bg-white/[0.04]';
  const buttonApprove = isLight
    ? 'bg-emerald-600 text-white hover:bg-emerald-700'
    : 'bg-emerald-500 text-[#0d1118] hover:bg-emerald-400';

  const approved = deliverable?.approval_status === 'APPROVED';

  return (
    <div className={`${cardBg} border rounded-xl p-5 space-y-4`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold`}>
              {kind}
            </p>
            <StatusBadge
              status={deliverable?.approval_status ?? null}
              isLight={isLight}
            />
          </div>
          <p className={`${subColor} text-xs mt-1 leading-relaxed`}>{description}</p>
          {approved && deliverable?.approved_at && (
            <p className={`${mutedColor} text-[11px] mt-1`}>
              Approved {formatTimestamp(deliverable.approved_at)}
              {deliverable.approved_by_name ? ` · ${deliverable.approved_by_name}` : ''}
            </p>
          )}
        </div>
        {!editing && deliverable && (
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={onBeginEdit}
              className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors ${buttonSecondary}`}
            >
              <Pencil size={12} />
              {approved ? 'Revise' : 'Edit'}
            </button>
            {!approved && (
              <button
                type="button"
                onClick={onApprove}
                className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md transition-colors ${buttonApprove}`}
              >
                <CheckCircle2 size={12} />
                Approve
              </button>
            )}
          </div>
        )}
      </div>

      {editing && approved && (
        <div
          className={`flex items-start gap-2 px-3 py-2 rounded-md border ${
            isLight
              ? 'bg-amber-50/60 border-amber-200/80 text-amber-700'
              : 'bg-amber-500/[0.06] border-amber-500/20 text-amber-300'
          }`}
        >
          <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
          <p className="text-[11px] leading-relaxed">
            This deliverable is approved. Saving any change will revert it to Draft and require
            re-approval before this stage can advance.
          </p>
        </div>
      )}

      <div>{children}</div>

      {editing && (
        <div className={`flex items-center gap-2 pt-3 border-t ${isLight ? 'border-[#e2e8ee]' : 'border-white/5'}`}>
          <button
            type="button"
            onClick={onSave}
            disabled={!canSave}
            className={`text-sm font-semibold px-3.5 py-2 rounded-md transition-colors ${buttonPrimary} disabled:opacity-50`}
          >
            Save
          </button>
          {deliverable && (
            <button
              type="button"
              onClick={onCancel}
              className={`text-sm font-medium px-3.5 py-2 rounded-md transition-colors ${buttonSecondary}`}
            >
              Cancel
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function StatusBadge({
  status,
  isLight,
}: {
  status: DeliverableApprovalStatus | null;
  isLight: boolean;
}) {
  if (status === 'APPROVED') {
    return (
      <span
        className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border ${
          isLight
            ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
            : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
        }`}
      >
        <CheckCircle2 size={10} />
        Approved
      </span>
    );
  }
  if (status === 'DRAFT') {
    return (
      <span
        className={`inline-flex items-center text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border ${
          isLight
            ? 'bg-amber-50 border-amber-200 text-amber-700'
            : 'bg-amber-500/15 border-amber-500/30 text-amber-400'
        }`}
      >
        Draft
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border ${
        isLight
          ? 'bg-[#eef2f6] border-[#cbd2db] text-[#374152]/55'
          : 'bg-white/[0.06] border-white/10 text-[#d2d7e0]/45'
      }`}
    >
      Not started
    </span>
  );
}

// ============================================================================
// Form helpers
// ============================================================================

function FieldLabel({
  label,
  isLight,
  children,
}: {
  label: string;
  isLight: boolean;
  children: React.ReactNode;
}) {
  const labelColor = 'text-fg-heading';
  return (
    <div>
      <label className={`block text-sm font-medium mb-1.5 ${labelColor}`}>{label}</label>
      {children}
    </div>
  );
}

function SubSection({
  label,
  isLight,
  children,
}: {
  label: string;
  isLight: boolean;
  children: React.ReactNode;
}) {
  const sectionHeader = 'text-fg-label';
  return (
    <div>
      <p className={`text-[10px] uppercase tracking-wider font-semibold mb-1.5 ${sectionHeader}`}>
        {label}
      </p>
      {children}
    </div>
  );
}

function Chip({
  isLight,
  children,
}: {
  isLight: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center text-xs px-2 py-1 rounded border ${
        isLight
          ? 'bg-[#eef2f6] border-[#cbd2db] text-[#1a1f28]'
          : 'bg-white/[0.06] border-white/10 text-[#d2d7e0]'
      }`}
    >
      {children}
    </span>
  );
}

interface ChipListEditorProps {
  label: string;
  placeholder: string;
  items: string[];
  onChange: (next: string[]) => void;
  isLight: boolean;
  multiline?: boolean;
}

function ChipListEditor({ label, placeholder, items, onChange, isLight, multiline }: ChipListEditorProps) {
  const [draft, setDraft] = useState('');
  const labelColor = 'text-fg-heading';

  const add = () => {
    const v = draft.trim();
    if (!v) return;
    onChange([...items, v]);
    setDraft('');
  };

  const remove = (idx: number) => {
    onChange(items.filter((_, i) => i !== idx));
  };

  return (
    <div>
      <label className={`block text-sm font-medium mb-2 ${labelColor}`}>{label}</label>
      {items.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {items.map((it, i) => (
            <span
              key={`${it}-${i}`}
              className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded border ${
                isLight
                  ? 'bg-[#eef2f6] border-[#cbd2db] text-[#1a1f28]'
                  : 'bg-white/[0.06] border-white/10 text-[#d2d7e0]'
              }`}
            >
              {it}
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label="Remove"
                className={`flex-shrink-0 ${
                  isLight ? 'text-[#374152]/55 hover:text-red-600' : 'text-[#d2d7e0]/55 hover:text-red-400'
                }`}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-start gap-2">
        {multiline ? (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            placeholder={placeholder}
            className={`flex-1 ${inputClass(isLight)}`}
          />
        ) : (
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                add();
              }
            }}
            placeholder={placeholder}
            className={`flex-1 ${inputClass(isLight)}`}
          />
        )}
        <button
          type="button"
          onClick={add}
          disabled={!draft.trim()}
          className={`flex-shrink-0 inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-md transition-colors ${
            isLight
              ? 'bg-[#4a6fa5] text-white hover:bg-[#3d5e8f]'
              : 'bg-[#6e8fb5] text-[#1a1f28] hover:bg-[#5e7fa5]'
          } disabled:opacity-50`}
        >
          <Plus size={12} />
          Add
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function inputClass(isLight: boolean): string {
  return `w-full rounded-md border px-2.5 py-1.5 text-sm ${
    isLight ? 'bg-white' : 'bg-[#131a22]'
  } ${
    isLight
      ? 'border-[#cbd2db] focus:border-[#4a6fa5] focus:ring-1 focus:ring-[#4a6fa5]/30'
      : 'border-white/15 focus:border-[#6e8fb5] focus:ring-1 focus:ring-[#6e8fb5]/30'
  } ${isLight ? 'text-[#1a1f28]' : 'text-white'} focus:outline-none transition-colors`;
}

function textareaClass(isLight: boolean): string {
  return inputClass(isLight);
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// ============================================================================
// Stub generators
// ============================================================================

function createConfirmationStub(auditId: string): MockConfirmationLetter {
  return {
    id: `cl-${auditId}-${Date.now()}`,
    audit_id: auditId,
    content: {
      body_text:
        'Stub draft generated from your approved risk summary and vendor service category. Edit the body, recipients, and scope below to fit this engagement. Sponsor branding is added externally on export.',
      recipients: [],
      scope: [],
    },
    approval_status: 'DRAFT',
    approved_by_name: null,
    approved_at: null,
  };
}

function createAgendaStub(auditId: string): MockAgenda {
  return {
    id: `ag-${auditId}-${Date.now()}`,
    audit_id: auditId,
    content: {
      items: [
        {
          id: `ai-${Date.now()}-1`,
          time: 'Day 1 · 09:00 – 09:30',
          topic: 'Opening meeting',
          owner: 'Auditor + Vendor leadership',
          notes: null,
        },
        {
          id: `ai-${Date.now()}-2`,
          time: 'Day 1 · 09:30 – 12:00',
          topic: '[Edit] Topic from approved risk summary focus areas',
          owner: 'Vendor SME',
          notes: null,
        },
      ],
    },
    approval_status: 'DRAFT',
    approved_by_name: null,
    approved_at: null,
  };
}

function createChecklistStub(auditId: string): MockChecklist {
  return {
    id: `ch-${auditId}-${Date.now()}`,
    audit_id: auditId,
    content: {
      items: [
        {
          id: `ci-${Date.now()}-1`,
          prompt: '[Edit] Verification step from approved risk summary',
          checkpoint_ref: null,
          evidence_expected: true,
        },
      ],
    },
    approval_status: 'DRAFT',
    approved_by_name: null,
    approved_at: null,
  };
}
