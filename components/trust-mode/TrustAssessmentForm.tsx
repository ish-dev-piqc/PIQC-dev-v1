"use client";

// =============================================================================
// TrustAssessmentForm
//
// Structured capture of front-end vendor intelligence. Used before the audit
// begins — the auditor records what the vendor claims publicly (certifications,
// regulatory posture) and forms initial risk hypotheses.
//
// This is NOT autonomous web research. It is a structured capture layer for
// auditor judgment. All entries are auditor-authored.
//
// [D-005] The three posture selectors use qualitative labels as placeholders.
// If D-005 resolves to numeric or multi-axis scoring, these fields change.
// =============================================================================

import { useState } from "react";
import { CompliancePosture, MaturityPosture, TrustPosture } from "@prisma/client";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { color, space, type as typeScale, radius } from "@/lib/ui/tokens";
import { inputStyle } from "@/components/ui/Field";
import { TrustAssessmentValues } from "@/lib/types/trust-assessment";

// ── Option sets ──────────────────────────────────────────────────────────────

const COMPLIANCE_OPTIONS: { value: CompliancePosture; label: string; description: string }[] = [
  { value: "STRONG",   label: "Strong",   description: "Multiple current certifications, active regulatory filings" },
  { value: "ADEQUATE", label: "Adequate", description: "Basic compliance claims with some evidence" },
  { value: "WEAK",     label: "Weak",     description: "Few claims, outdated or unverifiable" },
  { value: "UNKNOWN",  label: "Unknown",  description: "Insufficient public information to assess" },
];

const MATURITY_OPTIONS: { value: MaturityPosture; label: string; description: string }[] = [
  { value: "MATURE",     label: "Mature",     description: "Established processes, experienced team, long track record" },
  { value: "DEVELOPING", label: "Developing", description: "Processes in place but evolving" },
  { value: "EARLY",      label: "Early",      description: "Limited history or early-stage processes" },
  { value: "UNKNOWN",    label: "Unknown",    description: "Insufficient information to assess" },
];

const TRUST_OPTIONS: { value: TrustPosture; label: string; bg: string; fg: string }[] = [
  { value: "HIGH",     label: "High",     bg: color.successBgSoft,       fg: color.successFgSoft },
  { value: "MODERATE", label: "Moderate", bg: color.warningBgSoft,       fg: color.warningFgSoft },
  { value: "LOW",      label: "Low",      bg: color.dangerBgSoft,        fg: color.dangerFgSoft },
  { value: "UNKNOWN",  label: "Unknown",  bg: color.bgSubtle,            fg: color.fgMuted },
];

// ── Component ────────────────────────────────────────────────────────────────

interface TrustAssessmentFormProps {
  auditId: string;
  actorId: string;
  initialValues?: Partial<TrustAssessmentValues>;
  isExisting?: boolean;
  onSuccess: (assessment: TrustAssessmentValues & { id: string }) => void;
}

export function TrustAssessmentForm({
  auditId,
  actorId,
  initialValues,
  isExisting = false,
  onSuccess,
}: TrustAssessmentFormProps) {
  const [certInput,       setCertInput]       = useState("");
  const [regClaimInput,   setRegClaimInput]   = useState("");
  const [hypothesisInput, setHypothesisInput] = useState("");

  const [values, setValues] = useState<TrustAssessmentValues>({
    certificationsClaimed:   initialValues?.certificationsClaimed   ?? [],
    regulatoryClaims:        initialValues?.regulatoryClaims        ?? [],
    compliancePosture:       initialValues?.compliancePosture       ?? "UNKNOWN",
    maturityPosture:         initialValues?.maturityPosture         ?? "UNKNOWN",
    provisionalTrustPosture: initialValues?.provisionalTrustPosture ?? "UNKNOWN",
    riskHypotheses:          initialValues?.riskHypotheses          ?? [],
    notes:                   initialValues?.notes                   ?? "",
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError]               = useState<string | null>(null);

  // ── Tag list helpers ─────────────────────────────────────────────────────────

  function addTag(
    field: "certificationsClaimed" | "regulatoryClaims" | "riskHypotheses",
    value: string,
    clear: () => void
  ) {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (!(values[field] as string[]).includes(trimmed)) {
      setValues((v) => ({ ...v, [field]: [...(v[field] as string[]), trimmed] }));
    }
    clear();
  }

  function removeTag(
    field: "certificationsClaimed" | "regulatoryClaims" | "riskHypotheses",
    item: string
  ) {
    setValues((v) => ({ ...v, [field]: (v[field] as string[]).filter((x) => x !== item) }));
  }

  // ── Submit ───────────────────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const method = isExisting ? "PATCH" : "POST";
      const body   = isExisting
        ? { actorId, values }
        : { assessedBy: actorId, ...values };

      const res = await fetch(`/api/audits/${auditId}/trust-assessment`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        setError((await res.json()).error ?? "Failed to save assessment.");
        return;
      }

      onSuccess(await res.json());
    } finally {
      setIsSubmitting(false);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: space[5] }}>

      {/* Certifications claimed */}
      <Section
        title="Certifications claimed"
        hint="List certifications the vendor claims on their public materials (e.g. ISO 13485, 21 CFR Part 11)."
      >
        <TagInput
          value={certInput}
          onChange={setCertInput}
          onAdd={() => addTag("certificationsClaimed", certInput, () => setCertInput(""))}
          placeholder="e.g. ISO 13485"
          tags={values.certificationsClaimed}
          onRemove={(t) => removeTag("certificationsClaimed", t)}
        />
      </Section>

      {/* Regulatory claims */}
      <Section
        title="Regulatory and compliance claims"
        hint="Record compliance statements made by the vendor (e.g. 'FDA 21 CFR Part 11 compliant', 'GDPR compliant')."
      >
        <TagInput
          value={regClaimInput}
          onChange={setRegClaimInput}
          onAdd={() => addTag("regulatoryClaims", regClaimInput, () => setRegClaimInput(""))}
          placeholder="e.g. GDPR compliant"
          tags={values.regulatoryClaims}
          onRemove={(t) => removeTag("regulatoryClaims", t)}
        />
      </Section>

      {/* Compliance posture [D-005] */}
      <Section
        title="Compliance posture"
        hint="Your assessment of the vendor's overall compliance position based on public information."
        badge="D-005"
      >
        <PostureSelector
          options={COMPLIANCE_OPTIONS}
          selected={values.compliancePosture}
          onSelect={(v) => setValues((s) => ({ ...s, compliancePosture: v as CompliancePosture }))}
        />
      </Section>

      {/* Operational maturity [D-005] */}
      <Section
        title="Operational maturity"
        hint="Your assessment of the vendor's process maturity and operational experience."
        badge="D-005"
      >
        <PostureSelector
          options={MATURITY_OPTIONS}
          selected={values.maturityPosture}
          onSelect={(v) => setValues((s) => ({ ...s, maturityPosture: v as MaturityPosture }))}
        />
      </Section>

      {/* Provisional trust posture [D-005] */}
      <Section
        title="Provisional trust posture"
        hint="Your overall provisional trust level entering the audit. Informs questionnaire depth and audit scrutiny."
        badge="D-005"
      >
        <div style={{ display: "flex", gap: space[2], flexWrap: "wrap" }}>
          {TRUST_OPTIONS.map((opt) => {
            const selected = values.provisionalTrustPosture === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setValues((s) => ({ ...s, provisionalTrustPosture: opt.value }))}
                style={{
                  padding: `${space[2]}px ${space[3]}px`,
                  borderRadius: radius.md,
                  border: selected ? `2px solid ${color.fg}` : `1px solid ${color.borderStrong}`,
                  background: selected ? opt.bg : color.bg,
                  color: selected ? opt.fg : color.fg,
                  fontWeight: selected ? 700 : 400,
                  ...typeScale.body,
                  cursor: "pointer",
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </Section>

      {/* Risk hypotheses */}
      <Section
        title="Risk hypotheses"
        hint="State your working risk assumptions entering the audit. Each hypothesis should be a plain, falsifiable statement."
      >
        <div style={{ display: "flex", flexDirection: "column", gap: space[2] }}>
          <div style={{ display: "flex", gap: space[2] }}>
            <input
              type="text"
              value={hypothesisInput}
              onChange={(e) => setHypothesisInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTag("riskHypotheses", hypothesisInput, () => setHypothesisInput(""));
                }
              }}
              placeholder="State a risk hypothesis…"
              style={{ ...inputStyle, flex: 1 }}
            />
            <Button
              type="button"
              variant="secondary"
              onClick={() => addTag("riskHypotheses", hypothesisInput, () => setHypothesisInput(""))}
            >
              Add
            </Button>
          </div>
          {values.riskHypotheses.length > 0 && (
            <ol style={{ margin: 0, paddingLeft: space[5], display: "flex", flexDirection: "column", gap: space[1] }}>
              {values.riskHypotheses.map((h, i) => (
                <li key={i} style={{ ...typeScale.body }}>
                  <span>{h}</span>
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    style={{ marginLeft: space[2] }}
                    onClick={() => removeTag("riskHypotheses", h)}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ol>
          )}
        </div>
      </Section>

      {/* Notes */}
      <Section
        title="Notes"
        hint="Optional. Narrative context that does not fit the structured fields above."
      >
        <textarea
          value={values.notes ?? ""}
          onChange={(e) => setValues((s) => ({ ...s, notes: e.target.value }))}
          rows={4}
          placeholder="Any additional context from public vendor materials or prior interactions…"
          style={{ ...inputStyle, resize: "vertical" }}
        />
      </Section>

      {error && <p style={{ ...typeScale.caption, color: color.danger, margin: 0 }}>{error}</p>}

      <div>
        <Button type="submit" variant="primary" disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : isExisting ? "Update assessment" : "Save assessment"}
        </Button>
      </div>
    </form>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function Section({
  title,
  hint,
  badge,
  children,
}: {
  title: string;
  hint: string;
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: space[2], marginBottom: space[1] }}>
        <h3 style={{ ...typeScale.section, margin: 0 }}>{title}</h3>
        {badge && <Badge tone="draft">{badge} placeholder</Badge>}
      </div>
      <p style={{ ...typeScale.caption, color: color.fgMuted, margin: `0 0 ${space[2]}px` }}>{hint}</p>
      {children}
    </div>
  );
}

function TagInput({
  value,
  onChange,
  onAdd,
  placeholder,
  tags,
  onRemove,
}: {
  value: string;
  onChange: (v: string) => void;
  onAdd: () => void;
  placeholder: string;
  tags: string[];
  onRemove: (t: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: space[2] }}>
      <div style={{ display: "flex", gap: space[2] }}>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onAdd(); } }}
          placeholder={placeholder}
          style={{ ...inputStyle, flex: 1 }}
        />
        <Button type="button" variant="secondary" onClick={onAdd}>Add</Button>
      </div>
      {tags.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: space[1] }}>
          {tags.map((t) => (
            <span
              key={t}
              style={{
                background: color.bgSubtle,
                border: `1px solid ${color.border}`,
                borderRadius: radius.sm,
                padding: `${space[0]}px ${space[2]}px`,
                ...typeScale.body,
                display: "inline-flex",
                alignItems: "center",
                gap: space[1],
              }}
            >
              {t}
              <button
                type="button"
                onClick={() => onRemove(t)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: color.fgMuted,
                  padding: 0,
                  lineHeight: 1,
                }}
                aria-label={`Remove ${t}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function PostureSelector<T extends string>({
  options,
  selected,
  onSelect,
}: {
  options: { value: T; label: string; description: string }[];
  selected: T;
  onSelect: (v: T) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: space[1] }}>
      {options.map((opt) => {
        const isSelected = selected === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onSelect(opt.value)}
            style={{
              textAlign: "left",
              padding: `${space[2]}px ${space[3]}px`,
              borderRadius: radius.md,
              border: isSelected ? `2px solid ${color.primary}` : `1px solid ${color.borderStrong}`,
              background: isSelected ? color.primaryBgSoft : color.bg,
              cursor: "pointer",
              display: "flex",
              flexDirection: "column",
              gap: space[0],
            }}
          >
            <span style={{ ...typeScale.body, fontWeight: isSelected ? 600 : 400 }}>{opt.label}</span>
            <span style={{ ...typeScale.caption, color: color.fgMuted }}>{opt.description}</span>
          </button>
        );
      })}
    </div>
  );
}
