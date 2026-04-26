"use client";

// =============================================================================
// ServiceMappingPanel
//
// Shows all ProtocolRiskObjects for the audit's current protocol version.
// Auditor selects which ones the vendor service is responsible for.
// On selection, derived criticality is shown immediately (computed server-side
// and returned with the mapping). Auditor can override criticality + add rationale.
// =============================================================================

import { useState } from "react";
import { DerivedCriticality } from "@prisma/client";
import { Button } from "@/components/ui/Button";
import { color, space, type as typeScale, radius } from "@/lib/ui/tokens";
import { inputStyle } from "@/components/ui/Field";
import type { MappingWithRisk, VendorRiskObjectShape } from "@/lib/types/vendor-service";

// Criticality color palette — using token values where available
const CRIT_BG: Record<DerivedCriticality, string> = {
  CRITICAL: color.dangerBgSoft,
  HIGH:     color.warningBgSoft,
  MODERATE: "#fef9c3",
  LOW:      color.successBgSoft,
};
const CRIT_BORDER: Record<DerivedCriticality, string> = {
  CRITICAL: color.danger,
  HIGH:     color.warningBorder,
  MODERATE: "#fde047",
  LOW:      color.success,
};
const CRIT_TEXT: Record<DerivedCriticality, string> = {
  CRITICAL: color.dangerFgSoft,
  HIGH:     color.warningFgSoft,
  MODERATE: "#854d0e",
  LOW:      color.successFgSoft,
};

const CRITICALITY_ORDER: DerivedCriticality[] = ["CRITICAL", "HIGH", "MODERATE", "LOW"];

interface ServiceMappingPanelProps {
  auditId: string;
  actorId: string;
  availableRiskObjects: VendorRiskObjectShape[];
  existingMappings: MappingWithRisk[];
  onMappingsChange: (updated: MappingWithRisk[]) => void;
}

export function ServiceMappingPanel({
  auditId,
  actorId,
  availableRiskObjects,
  existingMappings,
  onMappingsChange,
}: ServiceMappingPanelProps) {
  const [mappings, setMappings]         = useState<MappingWithRisk[]>(existingMappings);
  const [editingId, setEditingId]       = useState<string | null>(null);
  const [editCriticality, setEditCrit]  = useState<DerivedCriticality>("HIGH");
  const [editRationale, setEditRationale] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError]               = useState<string | null>(null);

  const mappedRiskIds = new Set(mappings.map((m) => m.riskObject.id));
  const unmapped = availableRiskObjects.filter((r) => !mappedRiskIds.has(r.id));

  async function handleLink(riskObject: VendorRiskObjectShape) {
    setError(null);
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/audits/${auditId}/vendor-service/mappings`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ protocolRiskId: riskObject.id, actorId }),
      });

      if (!res.ok) {
        setError((await res.json()).error ?? "Failed to create mapping.");
        return;
      }

      const raw = await res.json();
      const newMapping: MappingWithRisk = {
        mappingId:            raw.id,
        derivedCriticality:   raw.derivedCriticality,
        criticalityRationale: raw.criticalityRationale,
        riskObject,
      };

      const updated = [...mappings, newMapping].sort(
        (a, b) => CRITICALITY_ORDER.indexOf(a.derivedCriticality) - CRITICALITY_ORDER.indexOf(b.derivedCriticality)
      );
      setMappings(updated);
      onMappingsChange(updated);
    } finally {
      setIsSubmitting(false);
    }
  }

  function startEdit(mapping: MappingWithRisk) {
    setEditingId(mapping.mappingId);
    setEditCrit(mapping.derivedCriticality);
    setEditRationale(mapping.criticalityRationale ?? "");
  }

  async function saveEdit(mappingId: string) {
    setError(null);
    setIsSubmitting(true);
    try {
      const res = await fetch(
        `/api/audits/${auditId}/vendor-service/mappings/${mappingId}`,
        {
          method:  "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            derivedCriticality:   editCriticality,
            criticalityRationale: editRationale,
            actorId,
            reason: "Auditor override of derived criticality",
          }),
        }
      );

      if (!res.ok) {
        setError((await res.json()).error ?? "Failed to update mapping.");
        return;
      }

      const updated = mappings
        .map((m) =>
          m.mappingId === mappingId
            ? { ...m, derivedCriticality: editCriticality, criticalityRationale: editRationale }
            : m
        )
        .sort(
          (a, b) => CRITICALITY_ORDER.indexOf(a.derivedCriticality) - CRITICALITY_ORDER.indexOf(b.derivedCriticality)
        );

      setMappings(updated);
      onMappingsChange(updated);
      setEditingId(null);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: space[4] }}>

      {/* Mapped sections */}
      {mappings.length > 0 && (
        <section>
          <h3 style={{ ...typeScale.section, margin: `0 0 ${space[3]}px` }}>
            Linked protocol sections ({mappings.length})
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: space[2] }}>
            {mappings.map((m) => (
              <MappingCard
                key={m.mappingId}
                mapping={m}
                isEditing={editingId === m.mappingId}
                editCriticality={editCriticality}
                editRationale={editRationale}
                onStartEdit={() => startEdit(m)}
                onCancelEdit={() => setEditingId(null)}
                onSaveEdit={() => saveEdit(m.mappingId)}
                onEditCriticalityChange={setEditCrit}
                onEditRationaleChange={setEditRationale}
                isSubmitting={isSubmitting}
              />
            ))}
          </div>
        </section>
      )}

      {/* Available (unmapped) sections */}
      {unmapped.length > 0 && (
        <section>
          <h3 style={{ ...typeScale.section, margin: `0 0 ${space[3]}px` }}>
            Available sections — select those the vendor service covers
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: space[1] }}>
            {unmapped.map((risk) => (
              <div
                key={risk.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: `${space[3]}px`,
                  border: `1px solid ${color.border}`,
                  borderRadius: radius.md,
                }}
              >
                <div>
                  <p style={{ ...typeScale.caption, color: color.fgMuted, margin: `0 0 ${space[1]}px` }}>
                    {risk.sectionIdentifier}
                  </p>
                  <p style={{ ...typeScale.body, fontWeight: 500, margin: 0 }}>{risk.sectionTitle}</p>
                  <p style={{ ...typeScale.caption, color: color.fgSubtle, margin: `${space[1]}px 0 0` }}>
                    {risk.endpointTier} · {risk.impactSurface.replace("_", " ")} ·{" "}
                    {risk.timeSensitivity ? "time sensitive" : "not time sensitive"} · {risk.operationalDomainTag}
                  </p>
                </div>
                <Button variant="secondary" size="sm" onClick={() => handleLink(risk)} disabled={isSubmitting}>
                  Link section
                </Button>
              </div>
            ))}
          </div>
        </section>
      )}

      {unmapped.length === 0 && mappings.length === 0 && (
        <p style={{ ...typeScale.body, color: color.fgMuted }}>
          No tagged protocol sections available. Tag sections in the Protocol step first.
        </p>
      )}

      {error && <p style={{ ...typeScale.caption, color: color.danger, margin: 0 }}>{error}</p>}
    </div>
  );
}

// ── MappingCard ───────────────────────────────────────────────────────────────

interface MappingCardProps {
  mapping: MappingWithRisk;
  isEditing: boolean;
  editCriticality: DerivedCriticality;
  editRationale: string;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onEditCriticalityChange: (v: DerivedCriticality) => void;
  onEditRationaleChange: (v: string) => void;
  isSubmitting: boolean;
}

function MappingCard({
  mapping,
  isEditing,
  editCriticality,
  editRationale,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onEditCriticalityChange,
  onEditRationaleChange,
  isSubmitting,
}: MappingCardProps) {
  const crit = mapping.derivedCriticality;

  return (
    <div
      style={{
        padding: space[3],
        borderRadius: radius.md,
        background: CRIT_BG[crit],
        border: `1px solid ${CRIT_BORDER[crit]}`,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: space[2], marginBottom: space[1] }}>
            <CriticalityBadge level={crit} />
            <span style={{ ...typeScale.caption, color: color.fgMuted }}>
              {mapping.riskObject.sectionIdentifier}
            </span>
          </div>
          <p style={{ ...typeScale.body, fontWeight: 500, margin: 0 }}>{mapping.riskObject.sectionTitle}</p>
          <p style={{ ...typeScale.caption, color: color.fgSubtle, margin: `${space[1]}px 0 0` }}>
            {mapping.riskObject.endpointTier} · {mapping.riskObject.impactSurface.replace("_", " ")} ·{" "}
            {mapping.riskObject.timeSensitivity ? "time sensitive" : "not time sensitive"}
          </p>
          {!isEditing && mapping.criticalityRationale && (
            <p style={{ ...typeScale.caption, color: color.fgMuted, fontStyle: "italic", margin: `${space[2]}px 0 0` }}>
              {mapping.criticalityRationale}
            </p>
          )}
        </div>
        {!isEditing && (
          <Button variant="secondary" size="sm" onClick={onStartEdit}>Override</Button>
        )}
      </div>

      {isEditing && (
        <div style={{ marginTop: space[3], display: "flex", flexDirection: "column", gap: space[2] }}>
          <div>
            <p style={{ ...typeScale.eyebrow, color: color.fgMuted, margin: `0 0 ${space[1]}px` }}>Criticality</p>
            <div style={{ display: "flex", gap: space[1] }}>
              {(["CRITICAL", "HIGH", "MODERATE", "LOW"] as DerivedCriticality[]).map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => onEditCriticalityChange(level)}
                  style={{
                    padding: `${space[1]}px ${space[2]}px`,
                    ...typeScale.caption,
                    fontWeight: editCriticality === level ? 700 : 400,
                    cursor: "pointer",
                    border: editCriticality === level ? `2px solid ${CRIT_BORDER[level]}` : `1px solid ${color.borderStrong}`,
                    background: editCriticality === level ? CRIT_BG[level] : color.bg,
                    borderRadius: radius.sm,
                  }}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p style={{ ...typeScale.eyebrow, color: color.fgMuted, margin: `0 0 ${space[1]}px` }}>Rationale for override</p>
            <textarea
              value={editRationale}
              onChange={(e) => onEditRationaleChange(e.target.value)}
              rows={2}
              style={{ ...inputStyle, resize: "vertical" }}
              placeholder="Explain why this criticality was assigned…"
            />
          </div>
          <div style={{ display: "flex", gap: space[2] }}>
            <Button variant="primary" size="sm" onClick={onSaveEdit} disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : "Save"}
            </Button>
            <Button variant="secondary" size="sm" onClick={onCancelEdit}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function CriticalityBadge({ level }: { level: DerivedCriticality }) {
  return (
    <span
      style={{
        background: CRIT_BG[level],
        color: CRIT_TEXT[level],
        border: `1px solid ${CRIT_BORDER[level]}`,
        padding: `1px ${space[1]}px`,
        borderRadius: radius.sm,
        ...typeScale.micro,
        fontWeight: 700,
      }}
    >
      {level}
    </span>
  );
}
