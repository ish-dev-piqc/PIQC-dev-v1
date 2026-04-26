"use client";

// =============================================================================
// PreAuditDraftingWorkspace (D-010, step 7 + deliverable detail)
//
// Single workspace for the PRE_AUDIT_DRAFTING stage with 3 tabs:
//   - Confirmation Letter (sent to vendor)
//   - Agenda (multi-day audit plan)
//   - Checklist (auditor's working checklist)
//
// All three deliverables share the Revise/Save/Cancel/Approve pattern:
//   - Drafts: editable on mount
//   - Approved: locked, with a "Revise" affordance
//   - Revise clicked: fields enable + "Saving will revert to Draft" warning
//   - Cancel: reverts local edits + re-locks
//   - Save: submits → server demotes APPROVED → DRAFT if needed
//
// Once all three are APPROVED the AUDIT_CONDUCT stage gate opens
// (lib/audit-stage.ts evaluates allDeliverablesApproved).
// =============================================================================

import { useId, useState } from "react";
import { AuditStage, DeliverableApprovalStatus, TrackedObjectType } from "@prisma/client";
import { Button } from "@/components/ui/Button";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { color, radius, space, type as typeScale } from "@/lib/ui/tokens";
import type {
  AgendaContent,
  AgendaDay,
  AgendaItem,
  ChecklistContent,
  ChecklistItem,
  ConfirmationLetterContent,
  DeliverableKind,
  RenderedDeliverable,
} from "@/lib/types/deliverables";
import { useStageActions } from "./AuditWorkspaceShell";
import { HistoryDrawer } from "./HistoryDrawer";

interface Props {
  auditId: string;
  actorId: string;
  initial: Record<DeliverableKind, RenderedDeliverable | null>;
}

interface TabDef {
  kind: DeliverableKind;
  label: string;
  description: string;
}

const TAB_DEFS: TabDef[] = [
  {
    kind: "confirmationLetter",
    label: "Confirmation Letter",
    description: "Sent to the vendor confirming dates, attendees, and scope.",
  },
  {
    kind: "agenda",
    label: "Agenda",
    description: "Multi-day audit plan: time slots, topics, attendees, and evidence to request.",
  },
  {
    kind: "checklist",
    label: "Checklist",
    description: "Auditor's working checklist — what to observe, evidence to collect, checkpoints to verify.",
  },
];

export function PreAuditDraftingWorkspace({ auditId, actorId, initial }: Props) {
  const [active, setActive] = useState<DeliverableKind>("confirmationLetter");
  const [state, setState] = useState(initial);

  const tab = TAB_DEFS.find((t) => t.kind === active)!;
  const deliverable = state[active];

  function applyDeliverable(kind: DeliverableKind, d: RenderedDeliverable | null) {
    setState((prev) => ({ ...prev, [kind]: d }));
  }

  const allApproved =
    state.confirmationLetter?.approvalStatus === DeliverableApprovalStatus.APPROVED &&
    state.agenda?.approvalStatus             === DeliverableApprovalStatus.APPROVED &&
    state.checklist?.approvalStatus          === DeliverableApprovalStatus.APPROVED;

  return (
    <div style={pageStyle}>
      <header style={{ marginBottom: space[4] }}>
        <h2 style={{ ...typeScale.title, margin: 0 }}>Pre-Audit Drafting</h2>
        <p style={{ ...typeScale.body, margin: `${space[1]}px 0 0`, color: color.fgMuted }}>
          Three deliverables cross-reference each other — drift between tabs as you draft.
          All three must be approved before <strong>Audit Conduct</strong>.
        </p>
      </header>

      {allApproved && <AllApprovedBanner />}

      <nav style={tabStripStyle} aria-label="Deliverables">
        {TAB_DEFS.map((t) => {
          const d = state[t.kind];
          const tone = badgeToneFor(d);
          const isActive = active === t.kind;
          return (
            <button
              key={t.kind}
              type="button"
              onClick={() => setActive(t.kind)}
              aria-current={isActive ? "page" : undefined}
              style={{ ...tabBtn, ...(isActive ? tabBtnActive : null) }}
            >
              <span>{t.label}</span>
              <Badge tone={tone}>{badgeLabelFor(d)}</Badge>
            </button>
          );
        })}
      </nav>

      <DeliverablePane
        key={tab.kind}
        auditId={auditId}
        actorId={actorId}
        tab={tab}
        deliverable={deliverable}
        onChange={(d) => applyDeliverable(tab.kind, d)}
      />
    </div>
  );
}

// -----------------------------------------------------------------------------
// All-approved banner
// -----------------------------------------------------------------------------
function AllApprovedBanner() {
  const actions = useStageActions();
  const [error, setError] = useState<string | null>(null);

  const canAdvance =
    actions?.readout.currentStage === AuditStage.PRE_AUDIT_DRAFTING &&
    actions?.readout.canAdvance === true;

  async function advance() {
    if (!actions) return;
    setError(null);
    try {
      await actions.advanceStage(AuditStage.AUDIT_CONDUCT);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to advance stage");
    }
  }

  return (
    <div role="status" style={bannerStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: space[2] }}>
        <span aria-hidden="true">✓</span>
        <strong>All deliverables approved</strong>
        <span style={{ ...typeScale.caption, color: color.successFgSoft }}>
          Ready for Audit Conduct.
        </span>
      </div>
      {canAdvance && (
        <Button variant="approve" onClick={advance} disabled={actions?.busy}>
          {actions?.busy ? "Advancing…" : "Advance to Audit Conduct →"}
        </Button>
      )}
      {error && (
        <span role="alert" style={{ ...typeScale.caption, color: color.dangerFgSoft }}>
          {error}
        </span>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Deliverable pane — paper card chrome + per-kind body editor
// -----------------------------------------------------------------------------

const KIND_OBJECT_TYPE: Record<DeliverableKind, TrackedObjectType> = {
  confirmationLetter: TrackedObjectType.CONFIRMATION_LETTER_OBJECT,
  agenda:             TrackedObjectType.AGENDA_OBJECT,
  checklist:          TrackedObjectType.CHECKLIST_OBJECT,
};

function DeliverablePane({
  auditId,
  actorId,
  tab,
  deliverable,
  onChange,
}: {
  auditId: string;
  actorId: string;
  tab: TabDef;
  deliverable: RenderedDeliverable | null;
  onChange: (d: RenderedDeliverable | null) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const approved = deliverable?.approvalStatus === DeliverableApprovalStatus.APPROVED;

  async function generateStub() {
    await runMutation("generate", () =>
      fetch(`/api/audits/${auditId}/deliverables/${tab.kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorId }),
      })
    );
  }

  async function regenerateFromUpstream() {
    const ok = window.confirm(
      `Re-generate ${tab.label} from upstream?\n\n` +
      "This replaces the current content with a fresh stub composed from " +
      "the audit context and approved risk summary. Any local edits to " +
      "this deliverable will be lost. If it was approved, it will return " +
      "to Draft and require re-approval."
    );
    if (!ok) return;
    await runMutation("regenerate", () =>
      fetch(`/api/audits/${auditId}/deliverables/${tab.kind}/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorId }),
      })
    );
  }

  async function saveContent(content: RenderedDeliverable["content"]) {
    await runMutation("save", () =>
      fetch(`/api/audits/${auditId}/deliverables/${tab.kind}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorId, content }),
      })
    );
  }

  async function approve() {
    await runMutation("approve", () =>
      fetch(`/api/audits/${auditId}/deliverables/${tab.kind}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorId }),
      })
    );
  }

  async function runMutation(label: string, fn: () => Promise<Response>) {
    setBusy(label);
    setError(null);
    try {
      const res = await fn();
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      const data: RenderedDeliverable = await res.json();
      onChange(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : `Failed to ${label}`);
    } finally {
      setBusy(null);
    }
  }

  if (!deliverable) {
    return (
      <article style={paperStyle}>
        <div style={{ padding: space[6], textAlign: "center" }}>
          <h3 style={{ ...typeScale.section, margin: 0 }}>{tab.label}</h3>
          <p style={{ ...typeScale.body, color: color.fgMuted, margin: `${space[2]}px 0 ${space[4]}px` }}>
            No draft yet. Generate a stub from the approved Vendor Risk Summary, vendor service mappings, and audit context — then edit it down.
          </p>
          <Button onClick={generateStub} disabled={!!busy}>
            {busy === "generate" ? "Generating…" : "Generate stub"}
          </Button>
          {error && <ErrorNotice text={error} />}
        </div>
      </article>
    );
  }

  return (
    <article style={paperStyle}>
      {/* Document title + status */}
      <header style={docHeaderStyle}>
        <div>
          <h3 style={{ ...typeScale.title, margin: 0 }}>{tab.label}</h3>
          <p style={{ ...typeScale.caption, color: color.fgMuted, margin: `${space[1]}px 0 0` }}>
            {tab.description}
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: space[1] }}>
          <Badge tone={approved ? "approved" : "draft"}>{approved ? "Approved" : "Draft"}</Badge>
          {deliverable.approvedAt && (
            <span style={{ ...typeScale.micro, color: color.fgMuted }}>
              {new Date(deliverable.approvedAt).toLocaleString()}
            </span>
          )}
        </div>
      </header>

      {/* Per-kind body editor */}
      {tab.kind === "confirmationLetter" && (
        <ConfirmationLetterEditor
          content={deliverable.content as ConfirmationLetterContent}
          approved={approved}
          busy={!!busy}
          saving={busy === "save"}
          onSave={saveContent}
        />
      )}
      {tab.kind === "agenda" && (
        <AgendaEditor
          content={deliverable.content as AgendaContent}
          approved={approved}
          busy={!!busy}
          saving={busy === "save"}
          onSave={saveContent}
        />
      )}
      {tab.kind === "checklist" && (
        <ChecklistEditor
          content={deliverable.content as ChecklistContent}
          approved={approved}
          busy={!!busy}
          saving={busy === "save"}
          onSave={saveContent}
        />
      )}

      {/* Approval + housekeeping footer */}
      <footer style={docFooterStyle}>
        <div style={{ display: "flex", gap: space[2], alignItems: "center", flexWrap: "wrap" }}>
          {!approved && (
            <Button variant="approve" onClick={approve} disabled={!!busy}>
              {busy === "approve" ? "Approving…" : "Approve deliverable"}
            </Button>
          )}
          {approved && (
            <span style={{ ...typeScale.caption, color: color.successFgSoft }}>
              ✓ Approved
            </span>
          )}
          <Button variant="link" onClick={regenerateFromUpstream} disabled={!!busy}>
            {busy === "regenerate" ? "Regenerating…" : "Re-generate from upstream"}
          </Button>
        </div>

        <HistoryDrawer
          auditId={auditId}
          objectType={KIND_OBJECT_TYPE[tab.kind]}
          objectId={deliverable.id}
          label={`${tab.label} history`}
        />
      </footer>

      {error && <ErrorNotice text={error} />}
    </article>
  );
}

// =============================================================================
// Confirmation Letter Editor
// =============================================================================
function ConfirmationLetterEditor({
  content,
  approved,
  busy,
  saving,
  onSave,
}: {
  content: ConfirmationLetterContent;
  approved: boolean;
  busy: boolean;
  saving: boolean;
  onSave: (c: RenderedDeliverable["content"]) => void;
}) {
  const [unlocked, setUnlocked] = useState(!approved);
  const [draft, setDraft] = useState<ConfirmationLetterContent>(content);

  const locked = approved && !unlocked;
  const dirty  = JSON.stringify(draft) !== JSON.stringify(content);

  function set<K extends keyof ConfirmationLetterContent>(
    key: K,
    value: ConfirmationLetterContent[K]
  ) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function handleCancel() {
    setDraft(content);
    if (approved) setUnlocked(false);
  }

  // Pre-audit document list helpers
  function setDoc(i: number, value: string) {
    const docs = [...draft.preAuditDocuments];
    docs[i] = value;
    set("preAuditDocuments", docs);
  }
  function removeDoc(i: number) {
    set("preAuditDocuments", draft.preAuditDocuments.filter((_, j) => j !== i));
  }
  function addDoc() {
    set("preAuditDocuments", [...draft.preAuditDocuments, ""]);
  }

  const SaveCancel = (
    <div style={editActionsStyle}>
      <Button disabled={busy || !dirty} onClick={() => onSave(draft)}>
        {saving ? "Saving…" : "Save"}
      </Button>
      {(approved || dirty) && (
        <Button variant="secondary" onClick={handleCancel} disabled={busy}>
          Cancel
        </Button>
      )}
      {approved && unlocked && (
        <span style={{ ...typeScale.caption, color: color.warningFgSoft }}>
          Saving will revert to Draft.
        </span>
      )}
    </div>
  );

  return (
    <>
      {/* Address block */}
      <section style={metaSectionStyle} aria-label="Letter header">
        <div style={metaGridStyle}>
          <FieldRow
            label="To (name)"
            value={draft.to}
            onChange={(v) => set("to", v)}
            disabled={locked || busy}
          />
          <FieldRow
            label="Title"
            value={draft.vendorContactTitle}
            onChange={(v) => set("vendorContactTitle", v)}
            disabled={locked || busy}
            placeholder="Recipient's job title"
          />
          <FieldArea
            label="Address"
            value={draft.vendorContactAddress}
            onChange={(v) => set("vendorContactAddress", v)}
            disabled={locked || busy}
            rows={3}
            placeholder="Street address&#10;City, State Zip"
          />
          <FieldRow
            label="From"
            value={draft.from}
            onChange={(v) => set("from", v)}
            disabled={locked || busy}
          />
          <FieldRow
            label="Subject"
            value={draft.subject}
            onChange={(v) => set("subject", v)}
            disabled={locked || busy}
          />
          <FieldRow
            label="Start time"
            value={draft.auditStartTime}
            onChange={(v) => set("auditStartTime", v)}
            disabled={locked || busy}
            placeholder="09:00"
          />
          <FieldRow
            label="End time"
            value={draft.auditEndTime}
            onChange={(v) => set("auditEndTime", v)}
            disabled={locked || busy}
            placeholder="16:00"
          />
          <FieldRow
            label="CC"
            value={draft.ccRecipients.join(", ")}
            onChange={(v) =>
              set(
                "ccRecipients",
                v === "" ? [] : v.split(",").map((s) => s.trim()).filter(Boolean)
              )
            }
            disabled={locked || busy}
            placeholder="Comma-separated names or emails"
          />
        </div>
      </section>

      {/* Pre-audit document request list */}
      <section style={metaSectionStyle} aria-label="Pre-audit documents">
        <div style={{ ...typeScale.eyebrow, marginBottom: space[3] }}>
          Documents to prepare before the audit
        </div>
        <ul style={{ margin: 0, paddingLeft: space[4], display: "flex", flexDirection: "column", gap: space[2] }}>
          {draft.preAuditDocuments.map((doc, i) => (
            <li key={i} style={{ display: "flex", gap: space[2], alignItems: "flex-start" }}>
              <input
                type="text"
                value={doc}
                onChange={(e) => setDoc(i, e.target.value)}
                disabled={locked || busy}
                style={{ ...metaInputStyle, flex: 1 }}
              />
              {!locked && (
                <Button variant="link" onClick={() => removeDoc(i)} disabled={busy}>
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
        {!locked && (
          <div style={{ marginTop: space[2] }}>
            <Button variant="secondary" onClick={addDoc} disabled={busy}>
              Add document
            </Button>
          </div>
        )}
      </section>

      {/* Letter body */}
      <section style={bodySectionStyle} aria-label="Letter body">
        <textarea
          value={draft.bodyText}
          onChange={(e) => set("bodyText", e.target.value)}
          rows={16}
          placeholder="Letter body…"
          style={bodyTextareaStyle}
          disabled={locked || busy}
        />

        {locked ? (
          <div style={editActionsStyle}>
            <Button variant="secondary" onClick={() => setUnlocked(true)} disabled={busy}>
              Revise
            </Button>
            <span style={{ ...typeScale.caption, color: color.fgMuted }}>
              Saving revisions will revert this letter to Draft and require re-approval.
            </span>
          </div>
        ) : SaveCancel}
      </section>
    </>
  );
}

// =============================================================================
// Agenda Editor
// =============================================================================
function AgendaEditor({
  content,
  approved,
  busy,
  saving,
  onSave,
}: {
  content: AgendaContent;
  approved: boolean;
  busy: boolean;
  saving: boolean;
  onSave: (c: RenderedDeliverable["content"]) => void;
}) {
  const [unlocked, setUnlocked] = useState(!approved);
  const [draft, setDraft]       = useState<AgendaContent>(content);

  const locked = approved && !unlocked;
  const dirty  = JSON.stringify(draft) !== JSON.stringify(content);

  function set<K extends keyof AgendaContent>(key: K, value: AgendaContent[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function handleCancel() {
    setDraft(content);
    if (approved) setUnlocked(false);
  }

  // Day-level mutations
  function updateDay(dayIndex: number, updater: (d: AgendaDay) => AgendaDay) {
    setDraft((prev) => ({
      ...prev,
      days: prev.days.map((d, i) => (i === dayIndex ? updater(d) : d)),
    }));
  }

  function addDay() {
    setDraft((prev) => ({
      ...prev,
      days: [
        ...prev.days,
        { date: null, label: `Day ${prev.days.length + 1}`, items: [] },
      ],
    }));
  }

  function removeDay(i: number) {
    setDraft((prev) => ({
      ...prev,
      days: prev.days.filter((_, j) => j !== i),
    }));
  }

  // Item-level mutations within a day
  function addItem(dayIndex: number) {
    updateDay(dayIndex, (d) => ({ ...d, items: [...d.items, { topic: "" }] }));
  }

  function removeItem(dayIndex: number, itemIndex: number) {
    updateDay(dayIndex, (d) => ({
      ...d,
      items: d.items.filter((_, i) => i !== itemIndex),
    }));
  }

  function setItemField(
    dayIndex: number,
    itemIndex: number,
    field: keyof AgendaItem,
    value: string
  ) {
    updateDay(dayIndex, (d) => ({
      ...d,
      items: d.items.map((item, i) =>
        i === itemIndex ? { ...item, [field]: value } : item
      ),
    }));
  }

  const SaveCancel = (
    <div style={editActionsStyle}>
      <Button disabled={busy || !dirty} onClick={() => onSave(draft)}>
        {saving ? "Saving…" : "Save"}
      </Button>
      {(approved || dirty) && (
        <Button variant="secondary" onClick={handleCancel} disabled={busy}>
          Cancel
        </Button>
      )}
      {approved && unlocked && (
        <span style={{ ...typeScale.caption, color: color.warningFgSoft }}>
          Saving will revert to Draft.
        </span>
      )}
    </div>
  );

  return (
    <>
      {/* Header info — mirrors template's header table */}
      <section style={metaSectionStyle} aria-label="Agenda header">
        <div style={metaGridStyle}>
          <FieldArea
            label="Auditee address"
            value={draft.auditeeAddress}
            onChange={(v) => set("auditeeAddress", v)}
            disabled={locked || busy}
            rows={2}
            placeholder="Vendor street address, city, country"
          />
          <FieldRow
            label="Projects"
            value={draft.projects}
            onChange={(v) => set("projects", v)}
            disabled={locked || busy}
            placeholder="Protocol / study number(s)"
          />
          <FieldArea
            label="Audit scope"
            value={draft.auditScope}
            onChange={(v) => set("auditScope", v)}
            disabled={locked || busy}
            rows={2}
            placeholder="What is and is not in scope"
          />
          <FieldArea
            label="Conduct summary"
            value={draft.conductSummary}
            onChange={(v) => set("conductSummary", v)}
            disabled={locked || busy}
            rows={2}
            placeholder="How the audit will take place — remote, on-site, documentation plan"
          />
          <TagList
            label="Attendees"
            items={draft.attendees}
            onChange={(v) => set("attendees", v)}
            disabled={locked || busy}
            placeholder="Name, title"
            addLabel="Add attendee"
          />
          <TagList
            label="Objectives"
            items={draft.objectives}
            onChange={(v) => set("objectives", v)}
            disabled={locked || busy}
            placeholder="Audit objective"
            addLabel="Add objective"
          />
        </div>
      </section>

      {/* Days */}
      <section style={bodySectionStyle} aria-label="Agenda days">
        <div style={{ ...typeScale.eyebrow, marginBottom: space[3] }}>
          Schedule
        </div>

        {draft.days.map((day, dayIndex) => (
          <div key={dayIndex} style={dayCardStyle}>
            {/* Day header row */}
            <div style={{ display: "flex", gap: space[2], alignItems: "center", flexWrap: "wrap", marginBottom: space[3] }}>
              <input
                type="text"
                value={day.label ?? ""}
                onChange={(e) =>
                  updateDay(dayIndex, (d) => ({ ...d, label: e.target.value }))
                }
                disabled={locked || busy}
                placeholder="Day 1"
                style={{ ...metaInputStyle, width: 80 }}
                aria-label={`Day ${dayIndex + 1} label`}
              />
              <input
                type="date"
                value={day.date ?? ""}
                onChange={(e) =>
                  updateDay(dayIndex, (d) => ({
                    ...d,
                    date: e.target.value || null,
                  }))
                }
                disabled={locked || busy}
                style={{ ...metaInputStyle, width: 160 }}
                aria-label={`Day ${dayIndex + 1} date`}
              />
              {!locked && draft.days.length > 1 && (
                <Button
                  variant="link"
                  onClick={() => removeDay(dayIndex)}
                  disabled={busy}
                >
                  Remove day
                </Button>
              )}
            </div>

            {/* Items table */}
            <div style={{ overflowX: "auto" }}>
              <table style={agendaTableStyle}>
                <thead>
                  <tr>
                    {["Time", "Topic", "Owner / Participants", "Notes", ""].map((h) => (
                      <th key={h} style={thStyle}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {day.items.length === 0 && (
                    <tr>
                      <td colSpan={5} style={{ ...typeScale.caption, color: color.fgMuted, padding: `${space[2]}px ${space[3]}px` }}>
                        No items yet — add one below.
                      </td>
                    </tr>
                  )}
                  {day.items.map((item, itemIndex) => (
                    <tr key={itemIndex}>
                      <td style={tdStyle}>
                        <input
                          type="text"
                          value={item.time ?? ""}
                          onChange={(e) => setItemField(dayIndex, itemIndex, "time", e.target.value)}
                          disabled={locked || busy}
                          placeholder="09:00–09:30"
                          style={{ ...metaInputStyle, width: 110 }}
                          aria-label="Time slot"
                        />
                      </td>
                      <td style={{ ...tdStyle, minWidth: 220 }}>
                        <input
                          type="text"
                          value={item.topic}
                          onChange={(e) => setItemField(dayIndex, itemIndex, "topic", e.target.value)}
                          disabled={locked || busy}
                          placeholder="Agenda topic"
                          style={{ ...metaInputStyle, width: "100%" }}
                          aria-label="Topic"
                        />
                      </td>
                      <td style={tdStyle}>
                        <input
                          type="text"
                          value={item.owner ?? ""}
                          onChange={(e) => setItemField(dayIndex, itemIndex, "owner", e.target.value)}
                          disabled={locked || busy}
                          placeholder="Lead Auditor / Vendor QA"
                          style={{ ...metaInputStyle, width: 170 }}
                          aria-label="Owner / participants"
                        />
                      </td>
                      <td style={tdStyle}>
                        <input
                          type="text"
                          value={item.notes ?? ""}
                          onChange={(e) => setItemField(dayIndex, itemIndex, "notes", e.target.value)}
                          disabled={locked || busy}
                          placeholder="Optional notes"
                          style={{ ...metaInputStyle, width: 160 }}
                          aria-label="Notes"
                        />
                      </td>
                      <td style={{ ...tdStyle, width: 32 }}>
                        {!locked && (
                          <Button
                            variant="link"
                            onClick={() => removeItem(dayIndex, itemIndex)}
                            disabled={busy}
                          >
                            ×
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {!locked && (
              <div style={{ marginTop: space[2] }}>
                <Button variant="secondary" onClick={() => addItem(dayIndex)} disabled={busy}>
                  Add item
                </Button>
              </div>
            )}
          </div>
        ))}

        {!locked && (
          <Button variant="secondary" onClick={addDay} disabled={busy}>
            Add day
          </Button>
        )}

        {locked ? (
          <div style={editActionsStyle}>
            <Button variant="secondary" onClick={() => setUnlocked(true)} disabled={busy}>
              Revise
            </Button>
            <span style={{ ...typeScale.caption, color: color.fgMuted }}>
              Saving revisions will revert this agenda to Draft and require re-approval.
            </span>
          </div>
        ) : SaveCancel}
      </section>
    </>
  );
}

// =============================================================================
// Checklist Editor
// =============================================================================
function ChecklistEditor({
  content,
  approved,
  busy,
  saving,
  onSave,
}: {
  content: ChecklistContent;
  approved: boolean;
  busy: boolean;
  saving: boolean;
  onSave: (c: RenderedDeliverable["content"]) => void;
}) {
  const [unlocked, setUnlocked] = useState(!approved);
  const [draft, setDraft]       = useState<ChecklistContent>(content);

  const locked = approved && !unlocked;
  const dirty  = JSON.stringify(draft) !== JSON.stringify(content);

  function set<K extends keyof ChecklistContent>(key: K, value: ChecklistContent[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function handleCancel() {
    setDraft(content);
    if (approved) setUnlocked(false);
  }

  function addItem() {
    const id = `item-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    set("items", [...draft.items, { id, prompt: "", evidenceExpected: false }]);
  }

  function removeItem(id: string) {
    set("items", draft.items.filter((item) => item.id !== id));
  }

  function updateItem(id: string, updater: (item: ChecklistItem) => ChecklistItem) {
    set("items", draft.items.map((item) => (item.id === id ? updater(item) : item)));
  }

  const SaveCancel = (
    <div style={{ ...editActionsStyle, marginTop: space[4] }}>
      <Button disabled={busy || !dirty} onClick={() => onSave(draft)}>
        {saving ? "Saving…" : "Save"}
      </Button>
      {(approved || dirty) && (
        <Button variant="secondary" onClick={handleCancel} disabled={busy}>
          Cancel
        </Button>
      )}
      {approved && unlocked && (
        <span style={{ ...typeScale.caption, color: color.warningFgSoft }}>
          Saving will revert to Draft.
        </span>
      )}
    </div>
  );

  return (
    <>
      {/* Context header */}
      <section style={metaSectionStyle} aria-label="Checklist context">
        <div style={metaGridStyle}>
          <FieldRow
            label="Audit context"
            value={draft.auditContext}
            onChange={(v) => set("auditContext", v)}
            disabled={locked || busy}
            placeholder="Vendor — service name"
          />
          <TagList
            label="Focus areas"
            items={draft.focusAreas}
            onChange={(v) => set("focusAreas", v)}
            disabled={locked || busy}
            placeholder="Focus area"
            addLabel="Add focus area"
          />
        </div>
      </section>

      {/* Items */}
      <section style={bodySectionStyle} aria-label="Checklist items">
        <div style={{ ...typeScale.eyebrow, marginBottom: space[3] }}>
          Checklist items
        </div>

        {draft.items.length === 0 && (
          <p style={{ ...typeScale.body, color: color.fgMuted, marginBottom: space[3] }}>
            No items yet. Add one below or re-generate from upstream to seed from the risk summary.
          </p>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: space[3] }}>
          {draft.items.map((item) => (
            <div key={item.id} style={checklistItemEditorStyle}>
              {/* Primary row: prompt + evidence (most important attribute) + remove */}
              <div style={{ display: "flex", gap: space[2], alignItems: "center" }}>
                <input
                  type="text"
                  value={item.prompt}
                  onChange={(e) =>
                    updateItem(item.id, (it) => ({ ...it, prompt: e.target.value }))
                  }
                  disabled={locked || busy}
                  placeholder="Checkpoint prompt…"
                  style={{ ...metaInputStyle, flex: 1 }}
                  aria-label="Checkpoint prompt"
                />
                <label style={{
                  display: "flex", alignItems: "center", gap: space[1],
                  ...typeScale.body, whiteSpace: "nowrap",
                  cursor: locked || busy ? "default" : "pointer",
                }}>
                  <input
                    type="checkbox"
                    checked={item.evidenceExpected}
                    onChange={(e) =>
                      updateItem(item.id, (it) => ({
                        ...it,
                        evidenceExpected: e.target.checked,
                      }))
                    }
                    disabled={locked || busy}
                  />
                  Evidence
                </label>
                {!locked && (
                  <Button
                    variant="link"
                    onClick={() => removeItem(item.id)}
                    disabled={busy}
                  >
                    Remove
                  </Button>
                )}
              </div>

              {/* Secondary row: traceability + notes, each with a visible label */}
              <div style={{ display: "flex", gap: space[4], flexWrap: "wrap", marginTop: space[2] }}>
                <div style={{ display: "flex", alignItems: "center", gap: space[1] }}>
                  <span style={secondaryFieldLabelStyle}>SOP ref</span>
                  <input
                    type="text"
                    value={item.checkpointRef ?? ""}
                    onChange={(e) =>
                      updateItem(item.id, (it) => ({
                        ...it,
                        checkpointRef: e.target.value || undefined,
                      }))
                    }
                    disabled={locked || busy}
                    placeholder="Optional"
                    style={{ ...metaInputStyle, width: 180 }}
                    aria-label="SOP or checkpoint reference"
                  />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: space[1], flex: 1, minWidth: 160 }}>
                  <span style={secondaryFieldLabelStyle}>Notes</span>
                  <input
                    type="text"
                    value={item.notes ?? ""}
                    onChange={(e) =>
                      updateItem(item.id, (it) => ({
                        ...it,
                        notes: e.target.value || undefined,
                      }))
                    }
                    disabled={locked || busy}
                    placeholder="Optional"
                    style={{ ...metaInputStyle, flex: 1 }}
                    aria-label="Item notes"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        {!locked && (
          <div style={{ marginTop: space[3] }}>
            <Button variant="secondary" onClick={addItem} disabled={busy}>
              Add item
            </Button>
          </div>
        )}

        {locked ? (
          <div style={editActionsStyle}>
            <Button variant="secondary" onClick={() => setUnlocked(true)} disabled={busy}>
              Revise
            </Button>
            <span style={{ ...typeScale.caption, color: color.fgMuted }}>
              Saving revisions will revert this checklist to Draft and require re-approval.
            </span>
          </div>
        ) : SaveCancel}
      </section>
    </>
  );
}

// =============================================================================
// Shared form primitives
// =============================================================================

// Single-line label + input in a 2-column meta grid
function FieldRow({
  label,
  value,
  onChange,
  disabled,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <>
      <label htmlFor={id} style={metaLabelStyle}>{label}</label>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        style={metaInputStyle}
      />
    </>
  );
}

// Per-item add/remove list for string[] fields in the 2-column meta grid.
// Used for attendees, objectives, focusAreas — structured arrays that were
// previously rendered as newline-delimited textareas (which produced empty
// strings, no selective removal, and inconsistency with preAuditDocuments).
function TagList({
  label,
  items,
  onChange,
  disabled,
  placeholder,
  addLabel,
}: {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
  disabled: boolean;
  placeholder?: string;
  addLabel?: string;
}) {
  return (
    <>
      <span style={{ ...metaLabelStyle, alignSelf: "flex-start", paddingTop: space[1] + 2 }}>
        {label}
      </span>
      <div>
        {items.length === 0 && disabled && (
          <span style={{ ...typeScale.caption, color: color.fgMuted }}>—</span>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: space[1] }}>
          {items.map((item, i) => (
            <div key={i} style={{ display: "flex", gap: space[1], alignItems: "center" }}>
              <input
                type="text"
                value={item}
                onChange={(e) => {
                  const next = [...items];
                  next[i] = e.target.value;
                  onChange(next);
                }}
                disabled={disabled}
                placeholder={placeholder}
                style={{ ...metaInputStyle, flex: 1 }}
                aria-label={`${label} ${i + 1}`}
              />
              {!disabled && (
                <Button variant="link" onClick={() => onChange(items.filter((_, j) => j !== i))}>
                  Remove
                </Button>
              )}
            </div>
          ))}
        </div>
        {!disabled && (
          <div style={{ marginTop: space[1] }}>
            <Button variant="secondary" onClick={() => onChange([...items, ""])}>
              {addLabel ?? `Add ${label.toLowerCase()}`}
            </Button>
          </div>
        )}
      </div>
    </>
  );
}

// Multi-line label + textarea in the same 2-column meta grid
function FieldArea({
  label,
  value,
  onChange,
  disabled,
  rows = 3,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  rows?: number;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <>
      <label
        htmlFor={id}
        style={{ ...metaLabelStyle, alignSelf: "flex-start", paddingTop: space[1] + 2 }}
      >
        {label}
      </label>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        disabled={disabled}
        placeholder={placeholder}
        style={{ ...metaInputStyle, resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }}
      />
    </>
  );
}

// =============================================================================
// Helpers
// =============================================================================
function ErrorNotice({ text }: { text: string }) {
  return (
    <div
      role="alert"
      style={{
        margin: `${space[3]}px ${space[5]}px ${space[5]}px`,
        background: color.dangerBgSoft,
        border: `1px solid ${color.warningBorder}`,
        padding: space[2],
        borderRadius: radius.sm,
        color: color.dangerFgSoft,
        ...typeScale.caption,
      }}
    >
      {text}
    </div>
  );
}

function badgeToneFor(d: RenderedDeliverable | null): BadgeTone {
  if (!d) return "neutral";
  return d.approvalStatus === DeliverableApprovalStatus.APPROVED ? "approved" : "draft";
}

function badgeLabelFor(d: RenderedDeliverable | null): string {
  if (!d) return "Not started";
  return d.approvalStatus === DeliverableApprovalStatus.APPROVED ? "Approved" : "Draft";
}

// =============================================================================
// Styles
// =============================================================================
const pageStyle: React.CSSProperties = {
  padding: space[5],
  maxWidth: 960,
  margin: "0 auto",
  width: "100%",
  background: color.bgMuted,
  minHeight: "100%",
};

const tabStripStyle: React.CSSProperties = {
  display: "flex",
  gap: space[1],
  borderBottom: `1px solid ${color.border}`,
  marginBottom: space[5],
};

const tabBtn: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: space[2],
  padding: `${space[2] + 2}px ${space[3] + 2}px`,
  border: "none",
  background: "transparent",
  borderBottom: "2px solid transparent",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: 13,
  color: color.fgMuted,
  marginBottom: -1,
};

const tabBtnActive: React.CSSProperties = {
  color: color.fg,
  fontWeight: 600,
  borderBottom: `2px solid ${color.primary}`,
};

const paperStyle: React.CSSProperties = {
  background: color.bg,
  border: `1px solid ${color.border}`,
  borderRadius: radius.md,
  boxShadow: "0 1px 2px rgba(0, 0, 0, 0.04), 0 1px 1px rgba(0, 0, 0, 0.02)",
  overflow: "hidden",
};

const docHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: space[4],
  padding: `${space[5]}px ${space[5]}px ${space[4]}px`,
  borderBottom: `1px solid ${color.borderSubtle}`,
};

const metaSectionStyle: React.CSSProperties = {
  padding: `${space[4]}px ${space[5]}px`,
  borderBottom: `1px solid ${color.borderSubtle}`,
  background: color.bgMuted,
};

const metaGridStyle: React.CSSProperties = {
  margin: 0,
  display: "grid",
  gridTemplateColumns: "140px 1fr",
  gap: `${space[2]}px ${space[3]}px`,
  alignItems: "center",
};

const metaLabelStyle: React.CSSProperties = {
  ...typeScale.eyebrow,
  margin: 0,
};

const metaInputStyle: React.CSSProperties = {
  ...typeScale.body,
  padding: `${space[1] + 2}px ${space[2]}px`,
  fontFamily: "inherit",
  border: `1px solid ${color.borderStrong}`,
  borderRadius: radius.sm,
  background: color.bg,
  color: color.fg,
  width: "100%",
  boxSizing: "border-box",
};

const bodySectionStyle: React.CSSProperties = {
  padding: `${space[4]}px ${space[5]}px`,
};

const bodyTextareaStyle: React.CSSProperties = {
  width: "100%",
  padding: space[3],
  fontFamily: "inherit",
  fontSize: 14,
  lineHeight: 1.6,
  border: `1px solid ${color.border}`,
  borderRadius: radius.sm,
  boxSizing: "border-box",
  background: color.bg,
  resize: "vertical",
};

const docFooterStyle: React.CSSProperties = {
  padding: `${space[3]}px ${space[5]}px ${space[5]}px`,
  borderTop: `1px solid ${color.borderSubtle}`,
  background: color.bgMuted,
};

const bannerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: space[3],
  flexWrap: "wrap",
  padding: `${space[3]}px ${space[4]}px`,
  marginBottom: space[4],
  background: color.successBgSoft,
  border: `1px solid ${color.success}`,
  borderRadius: radius.md,
  color: color.successFgSoft,
  ...typeScale.body,
};

const editActionsStyle: React.CSSProperties = {
  display: "flex",
  gap: space[2],
  alignItems: "center",
  marginTop: space[3],
  flexWrap: "wrap",
};

const dayCardStyle: React.CSSProperties = {
  border: `1px solid ${color.borderSubtle}`,
  borderRadius: radius.sm,
  padding: space[4],
  marginBottom: space[4],
  background: color.bg,
};

const agendaTableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  ...typeScale.body,
};

const thStyle: React.CSSProperties = {
  ...typeScale.eyebrow,
  textAlign: "left",
  padding: `${space[1]}px ${space[2]}px`,
  borderBottom: `1px solid ${color.border}`,
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: `${space[1]}px ${space[2]}px`,
  verticalAlign: "top",
};

const checklistItemEditorStyle: React.CSSProperties = {
  padding: space[3],
  border: `1px solid ${color.borderSubtle}`,
  borderRadius: radius.sm,
  background: color.bgMuted,
};

// Persistent visible label for secondary checklist fields (SOP ref, Notes).
// Uses eyebrow scale so it doesn't compete with the primary prompt text,
// but stays visible after the placeholder disappears on input.
const secondaryFieldLabelStyle: React.CSSProperties = {
  ...typeScale.eyebrow,
  whiteSpace: "nowrap",
  color: color.fgMuted,
};
