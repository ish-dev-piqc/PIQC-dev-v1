"use client";

// =============================================================================
// HistoryDrawer
//
// Collapsible audit trail for any tracked object. Fetched on first open —
// not on page load — so the initial render stays fast.
//
// GxP context: every write through writeDelta is recorded here. This surfaces
// the complete field-level change log: who changed what, when, and why.
// The auditor can see the full trail without leaving the workspace.
// =============================================================================

import { useState } from "react";
import { TrackedObjectType } from "@prisma/client";
import { Button } from "@/components/ui/Button";
import { color, radius, space, type as typeScale } from "@/lib/ui/tokens";
import type { ChangedFields, HistoryEntry } from "@/lib/state-history";

// ── Types ─────────────────────────────────────────────────────────────────────

interface HistoryDrawerProps {
  auditId: string;         // Scopes the request to an audit — required for auth gating
  objectType: TrackedObjectType;
  objectId: string;
  label?: string; // e.g. "Confirmation Letter history" — defaults to "Change history"
}

// ── Human-readable field name map ─────────────────────────────────────────────
// Covers every field written via writeDelta across all tracked object types.
// Unknown fields fall back to the raw camelCase name.

const FIELD_LABELS: Record<string, string> = {
  // Audit
  currentStage:            "Stage",
  status:                  "Status",
  // Risk summary
  vendorRelevanceNarrative: "Narrative",
  focusAreas:              "Focus areas",
  approvalStatus:          "Approval status",
  approvedAt:              "Approved at",
  approvedBy:              "Approved by",
  // Deliverables
  content:                 "Content",
  // Vendor service
  serviceName:             "Service name",
  serviceType:             "Service type",
  serviceDescription:      "Service description",
  derivedCriticality:      "Criticality",
  criticalityRationale:    "Criticality rationale",
  // Trust assessment
  certificationsClaimed:   "Certifications claimed",
  regulatoryClaims:        "Regulatory claims",
  compliancePosture:       "Compliance posture",
  maturityPosture:         "Operational maturity",
  provisionalTrustPosture: "Provisional trust posture",
  riskHypotheses:          "Risk hypotheses",
  notes:                   "Notes",
  // Questionnaire instance
  instanceStatus:          "Instance status",
  templateVersionId:       "Template version",
  addendaGenerated:        "Addenda generated",
  responses:               "Responses",
  // Protocol risk
  endpointTier:            "Endpoint tier",
  impactSurface:           "Impact surface",
  timeSensitivity:         "Time sensitivity",
  operationalDomainTag:    "Operational domain",
  vendorDependencyFlags:   "Vendor dependency",
  // Workspace entry
  vendorDomain:                  "Vendor domain",
  observationText:               "Observation",
  provisionalImpact:             "Provisional impact",
  provisionalClassification:     "Provisional classification",
  checkpointRef:                 "Checkpoint reference",
  inheritedEndpointTier:         "Inherited endpoint tier",
  inheritedImpactSurface:        "Inherited impact surface",
  inheritedTimeSensitivity:      "Inherited time sensitivity",
  riskContextOutdated:           "Risk context outdated",
  riskContextConfirmedAt:        "Risk context confirmed",
};

function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? key.replace(/([A-Z])/g, " $1").toLowerCase();
}

// ── Value rendering ───────────────────────────────────────────────────────────

function renderValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) {
    if (v.length === 0) return "(empty)";
    const items = v.filter((x) => typeof x === "string" && x.trim());
    if (items.length <= 3) return items.join(", ");
    return `${items.slice(0, 2).join(", ")} + ${items.length - 2} more`;
  }
  if (typeof v === "object") return "(updated)";
  const str = String(v);
  return str.length > 80 ? str.slice(0, 77) + "…" : str;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function HistoryDrawer({ auditId, objectType, objectId, label }: HistoryDrawerProps) {
  const [open, setOpen]       = useState(false);
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  async function toggle() {
    if (open) { setOpen(false); return; }

    setOpen(true);
    if (entries !== null) return; // already loaded

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/audits/${auditId}/history?objectType=${encodeURIComponent(objectType)}&objectId=${encodeURIComponent(objectId)}`
      );
      if (!res.ok) throw new Error(`Failed to load history (${res.status})`);
      setEntries(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load history");
    } finally {
      setLoading(false);
    }
  }

  const toggleLabel = open
    ? "Hide change history"
    : entries === null
      ? `${label ?? "Change history"}`
      : `${label ?? "Change history"} (${entries.length})`;

  return (
    <div style={{ borderTop: `1px solid ${color.borderSubtle}`, marginTop: space[3] }}>
      <Button variant="link" size="sm" onClick={toggle} style={{ marginTop: space[2] }}>
        {toggleLabel}
      </Button>

      {open && (
        <div style={{ marginTop: space[2] }}>
          {loading && (
            <p style={{ ...typeScale.caption, color: color.fgMuted, margin: 0 }}>Loading…</p>
          )}
          {error && (
            <p style={{ ...typeScale.caption, color: color.danger, margin: 0 }}>{error}</p>
          )}
          {entries !== null && entries.length === 0 && (
            <p style={{ ...typeScale.caption, color: color.fgMuted, margin: 0 }}>
              No changes recorded yet.
            </p>
          )}
          {entries !== null && entries.length > 0 && (
            <ol
              style={{
                listStyle: "none",
                margin: 0,
                padding: 0,
                display: "flex",
                flexDirection: "column",
                gap: space[2],
              }}
              aria-label={label ?? "Change history"}
            >
              {entries.map((entry) => (
                <HistoryEntryRow key={entry.id} entry={entry} />
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

// ── HistoryEntryRow ───────────────────────────────────────────────────────────

function HistoryEntryRow({ entry }: { entry: HistoryEntry }) {
  const date = new Date(entry.createdAt);
  const dateStr = date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const timeStr = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

  const fieldKeys = Object.keys(entry.changedFields);

  return (
    <li
      style={{
        borderLeft: `2px solid ${color.border}`,
        paddingLeft: space[3],
        paddingTop: space[1],
        paddingBottom: space[1],
      }}
    >
      {/* Header: who + when */}
      <div style={{ display: "flex", gap: space[2], alignItems: "baseline", flexWrap: "wrap" }}>
        <span style={{ ...typeScale.caption, fontWeight: 600, color: color.fg }}>
          {entry.actorName}
        </span>
        <span style={{ ...typeScale.micro, color: color.fgSubtle }}>
          {dateStr} at {timeStr}
        </span>
      </div>

      {/* Reason (auditor-authored, high value) */}
      {entry.reason && (
        <p style={{ ...typeScale.caption, color: color.fgMuted, margin: `${space[1]}px 0 0`, fontStyle: "italic" }}>
          {entry.reason}
        </p>
      )}

      {/* Field diffs */}
      <div style={{ marginTop: space[1], display: "flex", flexDirection: "column", gap: 2 }}>
        {fieldKeys.map((key) => (
          <FieldDiffRow key={key} fieldKey={key} delta={entry.changedFields[key]} />
        ))}
      </div>
    </li>
  );
}

// ── FieldDiffRow ──────────────────────────────────────────────────────────────

function FieldDiffRow({ fieldKey, delta }: { fieldKey: string; delta: ChangedFields[string] }) {
  const fromStr = renderValue(delta.from);
  const toStr   = renderValue(delta.to);

  // Approval status gets a prominent treatment
  if (fieldKey === "approvalStatus") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: space[1] }}>
        <span style={{ ...typeScale.micro, color: color.fgSubtle }}>{fieldLabel(fieldKey)}:</span>
        <span
          style={{
            ...typeScale.micro,
            fontWeight: 700,
            color: toStr === "APPROVED" ? color.successFgSoft : color.warningFgSoft,
          }}
        >
          {fromStr === "—" ? toStr : `${fromStr} → ${toStr}`}
        </span>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", gap: space[1], flexWrap: "wrap", alignItems: "flex-start" }}>
      <span style={{ ...typeScale.micro, color: color.fgSubtle, whiteSpace: "nowrap" }}>
        {fieldLabel(fieldKey)}:
      </span>
      {delta.from === null || delta.from === undefined ? (
        <span style={{ ...typeScale.micro, color: color.fg }}>{toStr}</span>
      ) : (
        <>
          <span
            style={{
              ...typeScale.micro,
              color: color.fgMuted,
              textDecoration: "line-through",
              maxWidth: 200,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {fromStr}
          </span>
          <span style={{ ...typeScale.micro, color: color.fgSubtle }}>→</span>
          <span style={{ ...typeScale.micro, color: color.fg }}>{toStr}</span>
        </>
      )}
    </div>
  );
}
