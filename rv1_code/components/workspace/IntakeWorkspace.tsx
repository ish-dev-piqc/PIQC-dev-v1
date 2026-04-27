"use client";

// =============================================================================
// IntakeWorkspace (INTAKE stage center pane)
//
// Phase 1 — manual protocol section tagging. Auditor types the section
// identifier + title, then completes the risk classification fields.
//
// Phase 2 — PIQC-assisted: sections will arrive pre-populated from rawPiqcPayload;
// this component stays unchanged — the form is already suggestion-aware.
//
// Each submit fires POST /api/protocols/[protocolVersionId]/risk-objects (create)
// or PATCH /api/protocols/[protocolVersionId]/risk-objects/[id] (re-tag).
// Both calls delta-track the write.
// =============================================================================

import { useState } from "react";
import { EndpointTier, ImpactSurface, TaggingMode } from "@prisma/client";
import type { RiskTagFormValues } from "@/lib/types/risk-tagging";
import { RiskTaggingForm } from "@/components/risk-tagging/RiskTaggingForm";
import { HistoryDrawer } from "@/components/workspace/HistoryDrawer";
import { Button } from "@/components/ui/Button";
import { color, radius, space, type as typeScale } from "@/lib/ui/tokens";

export interface TaggedSection {
  id: string;
  sectionIdentifier: string;
  sectionTitle: string;
  endpointTier: EndpointTier;
  impactSurface: ImpactSurface;
  timeSensitivity: boolean;
  vendorDependencyFlags: string[];
  operationalDomainTag: string;
  taggingMode: TaggingMode;
}

interface Props {
  auditId: string;
  protocolVersionId: string;
  actorId: string;
  initialSections: TaggedSection[];
}

type FormMode = "list" | "add" | "edit";

export function IntakeWorkspace({ auditId, protocolVersionId, actorId, initialSections }: Props) {
  const [sections, setSections] = useState<TaggedSection[]>(initialSections);
  const [mode, setMode] = useState<FormMode>("list");
  const [editTarget, setEditTarget] = useState<TaggedSection | null>(null);

  // Section identifier + title are free-text in Phase 1 (manual input above the form)
  const [draftIdentifier, setDraftIdentifier] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [sectionError, setSectionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function openAdd() {
    setEditTarget(null);
    setDraftIdentifier("");
    setDraftTitle("");
    setSectionError(null);
    setMode("add");
  }

  function openEdit(section: TaggedSection) {
    setEditTarget(section);
    setDraftIdentifier(section.sectionIdentifier);
    setDraftTitle(section.sectionTitle);
    setSectionError(null);
    setMode("edit");
  }

  function cancel() {
    setMode("list");
    setEditTarget(null);
    setSectionError(null);
  }

  async function handleAdd(data: {
    values: RiskTagFormValues;
    taggingMode: TaggingMode;
  }) {
    if (!draftIdentifier.trim() || !draftTitle.trim()) {
      setSectionError("Section identifier and title are required.");
      return;
    }
    setSectionError(null);
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/protocols/${protocolVersionId}/risk-objects`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sectionIdentifier: draftIdentifier.trim(),
            sectionTitle: draftTitle.trim(),
            taggedBy: actorId,
            taggingMode: data.taggingMode,
            values: data.values,
          }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to tag section");
      }
      const created: TaggedSection = await res.json();
      setSections((prev) => [...prev, created]);
      setMode("list");
    } catch (e) {
      setSectionError(e instanceof Error ? e.message : "Failed to tag section");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleEdit(data: {
    values: RiskTagFormValues;
    taggingMode: TaggingMode;
  }) {
    if (!editTarget) return;
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/protocols/${protocolVersionId}/risk-objects/${editTarget.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            actorId,
            reason: "Section re-tagged by auditor",
            values: data.values,
          }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to update section");
      }
      const updated: TaggedSection = await res.json();
      setSections((prev) =>
        prev.map((s) => (s.id === updated.id ? { ...s, ...updated } : s))
      );
      setMode("list");
      setEditTarget(null);
    } catch (e) {
      setSectionError(e instanceof Error ? e.message : "Failed to update section");
    } finally {
      setSubmitting(false);
    }
  }

  const inForm = mode === "add" || mode === "edit";

  return (
    <div style={containerStyle}>
      <header style={headerStyle}>
        <div>
          <div style={typeScale.eyebrow}>INTAKE</div>
          <h2 style={{ ...typeScale.title, margin: `${space[1]}px 0 ${space[1]}px` }}>
            Protocol section tagging
          </h2>
          <p style={{ ...typeScale.body, color: color.fgMuted, margin: 0 }}>
            Tag each protocol section your vendor is responsible for. The endpoint tier,
            impact surface, and operational domain you record here anchor criticality
            scoring, questionnaire addenda, and the risk summary downstream.
          </p>
        </div>
        {!inForm && (
          <Button onClick={openAdd} style={{ flexShrink: 0 }}>
            Tag a section
          </Button>
        )}
      </header>

      {/* Inline tagging form */}
      {inForm && (
        <div style={formCardStyle}>
          <div style={typeScale.eyebrow}>
            {mode === "add" ? "New section" : "Edit section"}
          </div>

          {/* Section identifier + title — manual input in Phase 1 */}
          <div style={{ display: "flex", flexDirection: "column", gap: space[3], marginTop: space[3], marginBottom: space[5] }}>
            <div>
              <label style={{ ...typeScale.bodyStrong, display: "block", marginBottom: space[1] }}>
                Section identifier
              </label>
              <input
                type="text"
                value={draftIdentifier}
                onChange={(e) => setDraftIdentifier(e.target.value)}
                placeholder="e.g. §5.3.2"
                style={textInputStyle}
                disabled={mode === "edit"} // identifier is immutable on edit
              />
              {mode === "edit" && (
                <span style={{ ...typeScale.micro, color: color.fgSubtle, display: "block", marginTop: space[1] }}>
                  Section identifier cannot be changed after tagging.
                </span>
              )}
            </div>
            <div>
              <label style={{ ...typeScale.bodyStrong, display: "block", marginBottom: space[1] }}>
                Section title
              </label>
              <input
                type="text"
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                placeholder="e.g. Central Laboratory Services"
                style={textInputStyle}
                disabled={mode === "edit"} // title is immutable on edit
              />
            </div>
          </div>

          {sectionError && (
            <p role="alert" style={{ ...typeScale.caption, color: color.dangerFgSoft, margin: `0 0 ${space[3]}px` }}>
              {sectionError}
            </p>
          )}

          <RiskTaggingForm
            sectionIdentifier={draftIdentifier || "—"}
            sectionTitle={draftTitle || "Untitled section"}
            initialValues={
              editTarget
                ? {
                    endpointTier: editTarget.endpointTier,
                    impactSurface: editTarget.impactSurface,
                    timeSensitivity: editTarget.timeSensitivity,
                    vendorDependencyFlags: editTarget.vendorDependencyFlags,
                    operationalDomainTag: editTarget.operationalDomainTag,
                  }
                : undefined
            }
            onSubmit={mode === "add" ? handleAdd : handleEdit}
            onCancel={cancel}
            isSubmitting={submitting}
          />
        </div>
      )}

      {/* Tagged sections list */}
      {sections.length === 0 && !inForm && (
        <div style={emptyStyle}>
          <p style={{ ...typeScale.body, color: color.fgMuted, margin: 0 }}>
            No sections tagged yet. Use &ldquo;Tag a section&rdquo; to record the first protocol risk.
          </p>
        </div>
      )}

      {sections.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: space[2] }}>
          <div style={{ ...typeScale.eyebrow, marginBottom: space[1] }}>
            {sections.length} section{sections.length !== 1 ? "s" : ""} tagged
          </div>
          {sections.map((s) => (
            <SectionRow
              key={s.id}
              auditId={auditId}
              section={s}
              onEdit={() => openEdit(s)}
              disabled={inForm}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── SectionRow ────────────────────────────────────────────────────────────────

interface SectionRowProps {
  auditId: string;
  section: TaggedSection;
  onEdit: () => void;
  disabled: boolean;
}

function SectionRow({ auditId, section, onEdit, disabled }: SectionRowProps) {
  return (
    <div style={rowStyle}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: space[2] }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: space[2], flexWrap: "wrap" }}>
            <span style={{ ...typeScale.eyebrow }}>{section.sectionIdentifier}</span>
            <span style={{ ...typeScale.bodyStrong, color: color.fg }}>{section.sectionTitle}</span>
          </div>
          <Button variant="secondary" onClick={onEdit} disabled={disabled}>
            Edit
          </Button>
        </div>
        <div style={{ display: "flex", gap: space[2], marginTop: space[1], flexWrap: "wrap" }}>
          <TierChip tier={section.endpointTier} />
          <SurfaceChip surface={section.impactSurface} />
          <span style={domainChipStyle}>{section.operationalDomainTag.replace(/_/g, " ")}</span>
          {section.timeSensitivity && (
            <span style={timeSensChipStyle}>Time-sensitive</span>
          )}
        </div>
        <div style={{ marginTop: space[2] }}>
          <HistoryDrawer
            auditId={auditId}
            objectType="PROTOCOL_RISK_OBJECT"
            objectId={section.id}
            label={`${section.sectionIdentifier} tagging history`}
          />
        </div>
      </div>
    </div>
  );
}

function TierChip({ tier }: { tier: EndpointTier }) {
  const styles: Record<EndpointTier, React.CSSProperties> = {
    PRIMARY:   { background: color.dangerBgSoft, color: color.dangerFgSoft },
    SAFETY:    { background: color.warningBgSoft, color: color.warningFgSoft },
    SECONDARY: { background: color.primaryBgSoft, color: color.primaryFgSoft },
    SUPPORTIVE:{ background: color.bgSubtle, color: color.fgMuted },
  };
  const labels: Record<EndpointTier, string> = {
    PRIMARY: "Primary", SAFETY: "Safety", SECONDARY: "Secondary", SUPPORTIVE: "Supportive",
  };
  return <span style={{ ...chipBase, ...styles[tier] }}>{labels[tier]}</span>;
}

function SurfaceChip({ surface }: { surface: ImpactSurface }) {
  const styles: Record<ImpactSurface, React.CSSProperties> = {
    BOTH:            { background: color.dangerBgSoft, color: color.dangerFgSoft },
    PATIENT_SAFETY:  { background: color.warningBgSoft, color: color.warningFgSoft },
    DATA_INTEGRITY:  { background: color.primaryBgSoft, color: color.primaryFgSoft },
  };
  const labels: Record<ImpactSurface, string> = {
    BOTH: "Both", PATIENT_SAFETY: "Patient safety", DATA_INTEGRITY: "Data integrity",
  };
  return <span style={{ ...chipBase, ...styles[surface] }}>{labels[surface]}</span>;
}

// ── Styles ────────────────────────────────────────────────────────────────────

const containerStyle: React.CSSProperties = {
  padding: space[5],
  display: "flex",
  flexDirection: "column",
  gap: space[5],
  overflowY: "auto",
  flex: 1,
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: space[4],
};

const formCardStyle: React.CSSProperties = {
  background: color.bgMuted,
  border: `1px solid ${color.border}`,
  borderRadius: radius.md,
  padding: space[4],
};

const emptyStyle: React.CSSProperties = {
  border: `1px dashed ${color.border}`,
  borderRadius: radius.md,
  padding: `${space[6]}px ${space[4]}px`,
  textAlign: "center",
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: space[3],
  background: color.bg,
  border: `1px solid ${color.border}`,
  borderRadius: radius.md,
  padding: `${space[3]}px ${space[4]}px`,
};

const chipBase: React.CSSProperties = {
  ...typeScale.micro,
  borderRadius: radius.sm,
  padding: "2px 6px",
  fontWeight: 600,
};

const domainChipStyle: React.CSSProperties = {
  ...chipBase,
  background: color.bgSubtle,
  color: color.fgMuted,
};

const timeSensChipStyle: React.CSSProperties = {
  ...chipBase,
  background: color.warningBgSoft,
  color: color.warningFgSoft,
};

const textInputStyle: React.CSSProperties = {
  ...typeScale.body,
  width: "100%",
  boxSizing: "border-box",
  padding: `${space[1] + 2}px ${space[2]}px`,
  border: `1px solid ${color.borderStrong}`,
  borderRadius: radius.sm,
  background: color.bg,
  color: color.fg,
};
