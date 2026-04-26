"use client";

// =============================================================================
// RiskTaggingForm
//
// Suggestion-aware form for tagging a protocol section as a ProtocolRiskObject.
// Works across all three phases with the same component:
//   Phase 1 — MANUAL:        suggestions prop absent. All fields start empty.
//   Phase 2 — PIQC_ASSISTED: suggestions pre-populate fields. Auditor confirms/edits.
//   Phase 3 — LLM_ASSISTED:  same as Phase 2, source badge reads "AI Proposed".
//
// When a field has a suggestion, it renders with a visual indicator and an
// "Accept" shortcut. Editing the field marks it as overridden.
// All judgment is auditor-driven — suggestions are never auto-accepted.
// =============================================================================

import { useState } from "react";
import {
  RiskTagFormValues,
  RiskTagSuggestions,
} from "@/lib/types/risk-tagging";
import { EndpointTier, ImpactSurface, TaggingMode } from "@prisma/client";
import { Button } from "@/components/ui/Button";
import { color, radius, space, type as typeScale } from "@/lib/ui/tokens";

const ENDPOINT_TIER_OPTIONS: { value: EndpointTier; label: string }[] = [
  { value: "PRIMARY", label: "Primary" },
  { value: "SECONDARY", label: "Secondary" },
  { value: "SAFETY", label: "Safety" },
  { value: "SUPPORTIVE", label: "Supportive" },
];

const IMPACT_SURFACE_OPTIONS: { value: ImpactSurface; label: string }[] = [
  { value: "DATA_INTEGRITY", label: "Data integrity" },
  { value: "PATIENT_SAFETY", label: "Patient safety" },
  { value: "BOTH", label: "Both" },
];

const DOMAIN_OPTIONS = [
  "ECG",
  "imaging",
  "ePRO",
  "randomization",
  "central_lab",
  "IVRS",
  "other",
];

interface RiskTaggingFormProps {
  // The section being tagged
  sectionIdentifier: string;
  sectionTitle: string;

  // Optional — present in Phase 2/3. Absent in Phase 1 manual mode.
  suggestions?: RiskTagSuggestions;

  // Existing values — populated when editing a previously tagged section
  initialValues?: Partial<RiskTagFormValues>;

  // Called on successful submit with confirmed values + tagging metadata
  onSubmit: (data: {
    values: RiskTagFormValues;
    suggestions?: RiskTagSuggestions;
    taggingMode: TaggingMode;
  }) => Promise<void>;

  onCancel?: () => void;
  isSubmitting?: boolean;
}

export function RiskTaggingForm({
  sectionIdentifier,
  sectionTitle,
  suggestions,
  initialValues,
  onSubmit,
  onCancel,
  isSubmitting = false,
}: RiskTaggingFormProps) {
  const hasSuggestions = !!suggestions && Object.keys(suggestions).length > 0;
  const taggingMode: TaggingMode = hasSuggestions
    ? suggestions?.endpointTier?.source === "llm"
      ? "LLM_ASSISTED"
      : "PIQC_ASSISTED"
    : "MANUAL";

  // Initialise form state — suggestions populate fields if no existing values
  const [values, setValues] = useState<Partial<RiskTagFormValues>>({
    endpointTier: initialValues?.endpointTier ?? suggestions?.endpointTier?.suggested,
    impactSurface: initialValues?.impactSurface ?? suggestions?.impactSurface?.suggested,
    timeSensitivity: initialValues?.timeSensitivity ?? suggestions?.timeSensitivity?.suggested,
    vendorDependencyFlags: initialValues?.vendorDependencyFlags ?? suggestions?.vendorDependencyFlags?.suggested ?? [],
    operationalDomainTag: initialValues?.operationalDomainTag ?? suggestions?.operationalDomainTag?.suggested ?? "",
  });

  const [vendorFlagInput, setVendorFlagInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  function isValid(): boolean {
    return !!(
      values.endpointTier &&
      values.impactSurface &&
      values.timeSensitivity !== undefined &&
      values.vendorDependencyFlags &&
      values.vendorDependencyFlags.length > 0 &&
      values.operationalDomainTag
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!isValid()) {
      setError("All fields are required before submitting.");
      return;
    }

    await onSubmit({
      values: values as RiskTagFormValues,
      suggestions: hasSuggestions ? suggestions : undefined,
      taggingMode,
    });
  }

  function addVendorFlag() {
    const flag = vendorFlagInput.trim();
    if (!flag) return;
    const current = values.vendorDependencyFlags ?? [];
    if (!current.includes(flag)) {
      setValues((v) => ({ ...v, vendorDependencyFlags: [...current, flag] }));
    }
    setVendorFlagInput("");
  }

  function removeVendorFlag(flag: string) {
    setValues((v) => ({
      ...v,
      vendorDependencyFlags: (v.vendorDependencyFlags ?? []).filter((f) => f !== flag),
    }));
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: space[5] }}>
      {/* Section header */}
      <div>
        <p style={{ ...typeScale.eyebrow, marginTop: 0, marginBottom: space[1] }}>{sectionIdentifier}</p>
        <h2 style={{ ...typeScale.section, margin: 0 }}>{sectionTitle}</h2>
        {hasSuggestions && (
          <SuggestionBadge source={suggestions?.endpointTier?.source ?? "piqc"} />
        )}
      </div>

      {/* Endpoint tier */}
      <FieldGroup
        label="Endpoint tier"
        suggestion={suggestions?.endpointTier}
        onAccept={() =>
          setValues((v) => ({ ...v, endpointTier: suggestions?.endpointTier?.suggested }))
        }
      >
        <div style={{ display: "flex", gap: space[2], flexWrap: "wrap" }}>
          {ENDPOINT_TIER_OPTIONS.map((opt) => (
            <ToggleButton
              key={opt.value}
              label={opt.label}
              active={values.endpointTier === opt.value}
              isSuggested={suggestions?.endpointTier?.suggested === opt.value}
              onClick={() => setValues((v) => ({ ...v, endpointTier: opt.value }))}
            />
          ))}
        </div>
      </FieldGroup>

      {/* Impact surface */}
      <FieldGroup
        label="Impact surface"
        suggestion={suggestions?.impactSurface}
        onAccept={() =>
          setValues((v) => ({ ...v, impactSurface: suggestions?.impactSurface?.suggested }))
        }
      >
        <div style={{ display: "flex", gap: space[2], flexWrap: "wrap" }}>
          {IMPACT_SURFACE_OPTIONS.map((opt) => (
            <ToggleButton
              key={opt.value}
              label={opt.label}
              active={values.impactSurface === opt.value}
              isSuggested={suggestions?.impactSurface?.suggested === opt.value}
              onClick={() => setValues((v) => ({ ...v, impactSurface: opt.value }))}
            />
          ))}
        </div>
      </FieldGroup>

      {/* Time sensitivity */}
      <FieldGroup
        label="Time sensitive"
        suggestion={suggestions?.timeSensitivity}
        onAccept={() =>
          setValues((v) => ({ ...v, timeSensitivity: suggestions?.timeSensitivity?.suggested }))
        }
      >
        <div style={{ display: "flex", gap: space[2] }}>
          {[
            { value: true, label: "Yes" },
            { value: false, label: "No" },
          ].map((opt) => (
            <ToggleButton
              key={String(opt.value)}
              label={opt.label}
              active={values.timeSensitivity === opt.value}
              isSuggested={suggestions?.timeSensitivity?.suggested === opt.value}
              onClick={() => setValues((v) => ({ ...v, timeSensitivity: opt.value }))}
            />
          ))}
        </div>
      </FieldGroup>

      {/* Operational domain */}
      <FieldGroup
        label="Operational domain"
        suggestion={suggestions?.operationalDomainTag}
        onAccept={() =>
          setValues((v) => ({ ...v, operationalDomainTag: suggestions?.operationalDomainTag?.suggested }))
        }
      >
        <select
          value={values.operationalDomainTag ?? ""}
          onChange={(e) => setValues((v) => ({ ...v, operationalDomainTag: e.target.value }))}
          style={selectStyle}
        >
          <option value="">Select domain…</option>
          {DOMAIN_OPTIONS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </FieldGroup>

      {/* Vendor dependency flags */}
      <FieldGroup
        label="Vendor dependency types"
        suggestion={suggestions?.vendorDependencyFlags}
        onAccept={() =>
          setValues((v) => ({
            ...v,
            vendorDependencyFlags: suggestions?.vendorDependencyFlags?.suggested ?? [],
          }))
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: space[2] }}>
          <div style={{ display: "flex", gap: space[2] }}>
            <input
              type="text"
              value={vendorFlagInput}
              onChange={(e) => setVendorFlagInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addVendorFlag(); } }}
              placeholder="e.g. ECG, central_lab"
              style={flagInputStyle}
            />
            <Button type="button" variant="secondary" onClick={addVendorFlag}>Add</Button>
          </div>
          <div style={{ display: "flex", gap: space[1] + 2, flexWrap: "wrap" }}>
            {(values.vendorDependencyFlags ?? []).map((flag) => (
              <span key={flag} style={flagChipStyle}>
                <span style={{ ...typeScale.caption, color: color.fg }}>{flag}</span>
                <button
                  type="button"
                  onClick={() => removeVendorFlag(flag)}
                  style={flagRemoveStyle}
                  aria-label={`Remove ${flag}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>
      </FieldGroup>

      {error && (
        <p role="alert" style={{ ...typeScale.caption, color: color.dangerFgSoft, margin: 0 }}>
          {error}
        </p>
      )}

      <div style={{ display: "flex", gap: space[2] }}>
        <Button type="submit" disabled={isSubmitting || !isValid()}>
          {isSubmitting ? "Saving…" : "Confirm tagging"}
        </Button>
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function SuggestionBadge({ source }: { source: "piqc" | "llm" }) {
  const label = source === "llm" ? "AI Proposed" : "PIQC Suggested";
  return (
    <span style={{
      ...typeScale.micro,
      background: color.statusInfoBgSoft,
      color: color.statusInfoFgSoft,
      borderRadius: radius.sm,
      padding: "2px 6px",
      display: "inline-block",
      marginTop: space[1],
    }}>
      {label}
    </span>
  );
}

interface FieldGroupProps {
  label: string;
  suggestion?: { suggested: unknown; source: "piqc" | "llm"; confidence?: number };
  onAccept?: () => void;
  children: React.ReactNode;
}

function FieldGroup({ label, suggestion, onAccept, children }: FieldGroupProps) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: space[2], marginBottom: space[1] + 2 }}>
        <label style={{ ...typeScale.bodyStrong }}>{label}</label>
        {suggestion && onAccept && (
          <button
            type="button"
            onClick={onAccept}
            style={{
              ...typeScale.micro,
              background: color.statusInfoBgSoft,
              border: "none",
              borderRadius: radius.sm,
              padding: "2px 6px",
              cursor: "pointer",
              color: color.statusInfoFgSoft,
            }}
          >
            Accept suggestion
          </button>
        )}
        {suggestion?.confidence !== undefined && (
          <span style={{ ...typeScale.micro, color: color.fgSubtle }}>
            {Math.round(suggestion.confidence * 100)}% confidence
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

interface ToggleButtonProps {
  label: string;
  active: boolean;
  isSuggested: boolean;
  onClick: () => void;
}

function ToggleButton({ label, active, isSuggested, onClick }: ToggleButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        ...typeScale.caption,
        padding: `${space[1] + 2}px ${space[3]}px`,
        borderRadius: radius.sm,
        border: active
          ? `2px solid ${color.primaryFgSoft}`
          : isSuggested
          ? `2px dashed ${color.primary}`
          : `1px solid ${color.borderStrong}`,
        background: active ? color.primaryBgSoft : color.bg,
        color: active ? color.primaryFgSoft : color.fg,
        cursor: "pointer",
        fontWeight: active ? 600 : 400,
      }}
    >
      {label}
      {isSuggested && !active && (
        <span style={{ marginLeft: space[1], ...typeScale.micro, color: color.primary }}>↑</span>
      )}
    </button>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const selectStyle: React.CSSProperties = {
  ...typeScale.body,
  padding: `${space[1] + 2}px ${space[2]}px`,
  minWidth: 160,
  border: `1px solid ${color.borderStrong}`,
  borderRadius: radius.sm,
  background: color.bg,
  color: color.fg,
};

const flagInputStyle: React.CSSProperties = {
  ...typeScale.body,
  flex: 1,
  padding: `${space[1] + 2}px ${space[2]}px`,
  border: `1px solid ${color.borderStrong}`,
  borderRadius: radius.sm,
  background: color.bg,
  color: color.fg,
};

const flagChipStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: space[1],
  background: color.bgSubtle,
  border: `1px solid ${color.border}`,
  borderRadius: radius.sm,
  padding: `2px ${space[2]}px`,
};

const flagRemoveStyle: React.CSSProperties = {
  cursor: "pointer",
  background: "none",
  border: "none",
  color: color.fgSubtle,
  fontSize: 14,
  lineHeight: 1,
  padding: 0,
};
