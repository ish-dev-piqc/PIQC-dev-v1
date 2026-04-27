"use client";

// =============================================================================
// AuditConductWorkspace
//
// AUDIT_CONDUCT stage center pane. Auditors record structured observations
// during the audit day — each as an AuditWorkspaceEntryObject.
//
// Layout:
//   - Header + "New entry" button
//   - Inline entry form (shown when creating or editing)
//   - Entry list — each card shows domain, observation, impact/classification
//     chips, optional linked section, and risk-outdated warning
//
// D-008 (decided 2026-04-26): only human-governed fields exposed.
// No coherence proposals or automated flags in Phase 1.
// =============================================================================

import { useId, useState } from "react";
import { ProvisionalClassification, ProvisionalImpact, TrackedObjectType } from "@prisma/client";
import { Button } from "@/components/ui/Button";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Field, inputStyle } from "@/components/ui/Field";
import { HistoryDrawer } from "@/components/workspace/HistoryDrawer";
import { color, radius, space, type as typeScale } from "@/lib/ui/tokens";
import type { RenderedWorkspaceEntry } from "@/lib/types/workspace-entries";
import type { VendorRiskObjectShape } from "@/lib/types/vendor-service";

// ── Constants ─────────────────────────────────────────────────────────────────

const IMPACT_LABELS: Record<ProvisionalImpact, string> = {
  CRITICAL:    "Critical",
  MAJOR:       "Major",
  MINOR:       "Minor",
  OBSERVATION: "Observation",
  NONE:        "None",
};

const CLASSIFICATION_LABELS: Record<ProvisionalClassification, string> = {
  FINDING:                    "Finding",
  OBSERVATION:                "Observation",
  OPPORTUNITY_FOR_IMPROVEMENT: "OFI",
  NOT_YET_CLASSIFIED:         "Not classified",
};

function impactTone(impact: ProvisionalImpact): BadgeTone {
  switch (impact) {
    case "CRITICAL":    return "danger";
    case "MAJOR":       return "draft";
    case "MINOR":       return "info";
    case "OBSERVATION": return "info";
    case "NONE":        return "neutral";
  }
}

function classificationTone(c: ProvisionalClassification): BadgeTone {
  switch (c) {
    case "FINDING":                    return "draft";
    case "OBSERVATION":                return "info";
    case "OPPORTUNITY_FOR_IMPROVEMENT": return "neutral";
    case "NOT_YET_CLASSIFIED":         return "neutral";
  }
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  auditId:               string;
  actorId:               string;
  initialEntries:        RenderedWorkspaceEntry[];
  availableRiskObjects:  VendorRiskObjectShape[];
}

// ── Entry form state ───────────────────────────────────────────────────────────

interface EntryFormState {
  vendorDomain:             string;
  observationText:          string;
  provisionalImpact:        ProvisionalImpact;
  provisionalClassification: ProvisionalClassification;
  checkpointRef:            string;
  protocolRiskId:           string;
}

const EMPTY_FORM: EntryFormState = {
  vendorDomain:             "",
  observationText:          "",
  provisionalImpact:        ProvisionalImpact.NONE,
  provisionalClassification: ProvisionalClassification.NOT_YET_CLASSIFIED,
  checkpointRef:            "",
  protocolRiskId:           "",
};

// ── Component ─────────────────────────────────────────────────────────────────

export function AuditConductWorkspace({
  auditId,
  actorId,
  initialEntries,
  availableRiskObjects,
}: Props) {
  const [entries, setEntries] = useState(initialEntries);
  const [showNewForm, setShowNewForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(form: EntryFormState) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/audits/${auditId}/workspace`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actorId,
          vendorDomain:             form.vendorDomain.trim(),
          observationText:          form.observationText.trim(),
          provisionalImpact:        form.provisionalImpact,
          provisionalClassification: form.provisionalClassification,
          checkpointRef:            form.checkpointRef.trim() || undefined,
          protocolRiskId:           form.protocolRiskId || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? "Failed to save");
      }
      const created: RenderedWorkspaceEntry = await res.json();
      setEntries((prev) => [...prev, created]);
      setShowNewForm(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate(entryId: string, form: EntryFormState) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/audits/${auditId}/workspace/${entryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actorId,
          observationText:          form.observationText.trim(),
          provisionalImpact:        form.provisionalImpact,
          provisionalClassification: form.provisionalClassification,
          checkpointRef:            form.checkpointRef.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? "Failed to save");
      }
      const updated: RenderedWorkspaceEntry = await res.json();
      setEntries((prev) => prev.map((e) => (e.id === entryId ? updated : e)));
      setEditingId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmRisk(entryId: string) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/audits/${auditId}/workspace/${entryId}/confirm-risk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? "Failed to confirm");
      }
      const updated: RenderedWorkspaceEntry = await res.json();
      setEntries((prev) => prev.map((e) => (e.id === entryId ? updated : e)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        background: color.bgMuted,
        padding: space[5],
        display: "flex",
        flexDirection: "column",
        gap: space[4],
      }}
    >
      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h2 style={{ ...typeScale.title, margin: 0 }}>Audit workspace</h2>
          <p style={{ ...typeScale.caption, color: color.fgMuted, marginTop: space[1] }}>
            Record observations and provisional classifications as the audit progresses.
          </p>
        </div>
        {!showNewForm && (
          <Button
            variant="primary"
            size="sm"
            onClick={() => { setShowNewForm(true); setEditingId(null); setError(null); }}
          >
            + New entry
          </Button>
        )}
      </div>

      {error && (
        <div
          style={{
            ...typeScale.caption,
            color: color.dangerFgSoft,
            background: color.dangerBgSoft,
            border: `1px solid ${color.danger}`,
            borderRadius: radius.md,
            padding: `${space[2]}px ${space[3]}px`,
          }}
        >
          {error}
        </div>
      )}

      {/* ── New entry form ── */}
      {showNewForm && (
        <EntryForm
          mode="create"
          availableRiskObjects={availableRiskObjects}
          saving={saving}
          onSubmit={handleCreate}
          onCancel={() => { setShowNewForm(false); setError(null); }}
        />
      )}

      {/* ── Entry list ── */}
      {entries.length === 0 && !showNewForm ? (
        <EmptyState />
      ) : (
        entries.map((entry) =>
          editingId === entry.id ? (
            <EntryForm
              key={entry.id}
              mode="edit"
              initial={entry}
              availableRiskObjects={availableRiskObjects}
              saving={saving}
              onSubmit={(form) => handleUpdate(entry.id, form)}
              onCancel={() => { setEditingId(null); setError(null); }}
            />
          ) : (
            <EntryCard
              key={entry.id}
              auditId={auditId}
              entry={entry}
              onEdit={() => { setEditingId(entry.id); setShowNewForm(false); setError(null); }}
              onConfirmRisk={() => handleConfirmRisk(entry.id)}
              confirmingRisk={saving}
            />
          )
        )
      )}
    </div>
  );
}

// ── Entry card ────────────────────────────────────────────────────────────────

function EntryCard({
  auditId,
  entry,
  onEdit,
  onConfirmRisk,
  confirmingRisk,
}: {
  auditId: string;
  entry: RenderedWorkspaceEntry;
  onEdit: () => void;
  onConfirmRisk: () => void;
  confirmingRisk: boolean;
}) {
  return (
    <div
      style={{
        background: color.bg,
        border: `1px solid ${entry.riskContextOutdated ? color.warningBorder : color.border}`,
        borderRadius: radius.md,
        padding: space[4],
        display: "flex",
        flexDirection: "column",
        gap: space[3],
      }}
    >
      {/* Row 1: domain + chips + edit */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: space[3] }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
            <span style={{ ...typeScale.bodyStrong, color: color.fg }}>{entry.vendorDomain}</span>
            <Badge tone={impactTone(entry.provisionalImpact)}>
              {IMPACT_LABELS[entry.provisionalImpact]}
            </Badge>
            <Badge tone={classificationTone(entry.provisionalClassification)}>
              {CLASSIFICATION_LABELS[entry.provisionalClassification]}
            </Badge>
            {entry.riskContextOutdated && (
              <Badge tone="draft" style={{ background: color.warningBgSoft, color: color.warningFgSoft }}>
                ⚠ Risk context outdated
              </Badge>
            )}
          </div>

          {entry.protocolRisk && (
            <div style={{ ...typeScale.caption, color: color.fgMuted, marginTop: space[1] }}>
              {entry.protocolRisk.sectionIdentifier} — {entry.protocolRisk.sectionTitle}
              {entry.riskAttrsInherited && entry.inheritedEndpointTier && (
                <span style={{ marginLeft: space[2] }}>
                  · {entry.inheritedEndpointTier} · {entry.inheritedImpactSurface}
                </span>
              )}
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: space[2], flexShrink: 0 }}>
          {entry.riskContextOutdated && (
            <Button variant="secondary" size="sm" onClick={onConfirmRisk} disabled={confirmingRisk}>
              Confirm risk context
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={onEdit}>Edit</Button>
          <HistoryDrawer
            auditId={auditId}
            objectType={TrackedObjectType.AUDIT_WORKSPACE_ENTRY_OBJECT}
            objectId={entry.id}
            label="Entry history"
          />
        </div>
      </div>

      {/* Row 2: observation text */}
      <p
        style={{
          ...typeScale.body,
          color: color.fg,
          margin: 0,
          whiteSpace: "pre-wrap",
          lineHeight: 1.6,
        }}
      >
        {entry.observationText}
      </p>

      {/* Row 3: checkpoint ref + meta */}
      <div style={{ display: "flex", gap: space[4], flexWrap: "wrap" }}>
        {entry.checkpointRef && (
          <span style={{ ...typeScale.caption, color: color.fgMuted }}>
            Checkpoint: {entry.checkpointRef}
          </span>
        )}
        <span style={{ ...typeScale.caption, color: color.fgSubtle }}>
          Recorded by {entry.creatorName} ·{" "}
          {new Date(entry.createdAt).toLocaleDateString(undefined, {
            month: "short", day: "numeric", year: "numeric",
          })}
        </span>
      </div>
    </div>
  );
}

// ── Entry form ────────────────────────────────────────────────────────────────

function EntryForm({
  mode,
  initial,
  availableRiskObjects,
  saving,
  onSubmit,
  onCancel,
}: {
  mode: "create" | "edit";
  initial?: RenderedWorkspaceEntry;
  availableRiskObjects: VendorRiskObjectShape[];
  saving: boolean;
  onSubmit: (form: EntryFormState) => void;
  onCancel: () => void;
}) {
  const domainId = useId();
  const obsId    = useId();
  const riskId   = useId();
  const cpId     = useId();

  const [form, setForm] = useState<EntryFormState>(() =>
    initial
      ? {
          vendorDomain:             initial.vendorDomain,
          observationText:          initial.observationText,
          provisionalImpact:        initial.provisionalImpact,
          provisionalClassification: initial.provisionalClassification,
          checkpointRef:            initial.checkpointRef ?? "",
          protocolRiskId:           initial.protocolRisk?.id ?? "",
        }
      : EMPTY_FORM
  );

  const canSubmit = form.vendorDomain.trim().length > 0 && form.observationText.trim().length > 0;

  return (
    <div
      style={{
        background: color.bg,
        border: `1px solid ${color.primary}`,
        borderRadius: radius.md,
        padding: space[4],
        display: "flex",
        flexDirection: "column",
        gap: space[3],
      }}
    >
      <span style={{ ...typeScale.bodyStrong }}>
        {mode === "create" ? "New observation entry" : "Edit entry"}
      </span>

      {/* Vendor domain */}
      <Field
        label="Vendor domain"
        htmlFor={domainId}
        required={mode === "create"}
        hint={mode === "edit" ? "Locked after creation — create a new entry to change domain." : undefined}
      >
        <input
          id={domainId}
          value={form.vendorDomain}
          onChange={(e) => setForm((p) => ({ ...p, vendorDomain: e.target.value }))}
          placeholder="e.g. Sample handling, QMS, Data management"
          style={{
            ...inputStyle,
            width: "100%",
            ...(mode === "edit" ? { opacity: 0.55, cursor: "not-allowed" } : {}),
          }}
          disabled={mode === "edit"}
        />
      </Field>

      {/* Observation text */}
      <Field label="Observation" htmlFor={obsId} required>
        <textarea
          id={obsId}
          value={form.observationText}
          onChange={(e) => setForm((p) => ({ ...p, observationText: e.target.value }))}
          placeholder="Describe the observation in specific, factual terms."
          rows={4}
          style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
        />
      </Field>

      {/* Impact + classification — side by side */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: space[3] }}>
        <Field label="Provisional impact" htmlFor={`${domainId}-impact`}>
          <select
            id={`${domainId}-impact`}
            value={form.provisionalImpact}
            onChange={(e) =>
              setForm((p) => ({ ...p, provisionalImpact: e.target.value as ProvisionalImpact }))
            }
            style={inputStyle}
          >
            {Object.entries(IMPACT_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </Field>

        <Field label="Provisional classification" htmlFor={`${domainId}-class`}>
          <select
            id={`${domainId}-class`}
            value={form.provisionalClassification}
            onChange={(e) =>
              setForm((p) => ({
                ...p,
                provisionalClassification: e.target.value as ProvisionalClassification,
              }))
            }
            style={inputStyle}
          >
            {Object.entries(CLASSIFICATION_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </Field>
      </div>

      {/* Protocol risk link — only on create */}
      {mode === "create" && availableRiskObjects.length > 0 && (
        <Field label="Link to protocol section (optional)" htmlFor={riskId}>
          <select
            id={riskId}
            value={form.protocolRiskId}
            onChange={(e) => setForm((p) => ({ ...p, protocolRiskId: e.target.value }))}
            style={inputStyle}
          >
            <option value="">— No link —</option>
            {availableRiskObjects.map((r) => (
              <option key={r.id} value={r.id}>
                {r.sectionIdentifier} — {r.sectionTitle}
              </option>
            ))}
          </select>
          <span style={{ ...typeScale.micro, color: color.fgMuted, marginTop: 2 }}>
            Inherits endpoint tier, impact surface, and time sensitivity as a snapshot.
          </span>
        </Field>
      )}

      {/* Checkpoint ref */}
      <Field label="Checkpoint reference (optional)" htmlFor={cpId}>
        <input
          id={cpId}
          value={form.checkpointRef}
          onChange={(e) => setForm((p) => ({ ...p, checkpointRef: e.target.value }))}
          placeholder="e.g. SOP-QC-014 §3.2"
          style={inputStyle}
        />
      </Field>

      {/* Actions */}
      <div style={{ display: "flex", gap: space[2], justifyContent: "flex-end" }}>
        <Button variant="secondary" size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={() => onSubmit(form)}
          disabled={!canSubmit || saving}
        >
          {saving ? "Saving…" : mode === "create" ? "Add entry" : "Save changes"}
        </Button>
      </div>
    </div>
  );
}

// ── Small helpers ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div
      style={{
        background: color.bg,
        border: `1px dashed ${color.border}`,
        borderRadius: radius.md,
        padding: space[6],
        textAlign: "center",
      }}
    >
      <p style={{ ...typeScale.body, color: color.fgMuted, margin: 0 }}>
        No observations recorded yet.
      </p>
      <p style={{ ...typeScale.caption, color: color.fgSubtle, marginTop: space[1] }}>
        Use the <strong>+ New entry</strong> button to record your first audit observation.
      </p>
    </div>
  );
}

