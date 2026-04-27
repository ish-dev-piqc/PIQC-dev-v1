"use client";

// Defines the vendor service under audit — name, type, description.
// One per Audit. Submitted to POST /api/audits/[auditId]/vendor-service.

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, inputStyle } from "@/components/ui/Field";
import { color, space, type as typeScale } from "@/lib/ui/tokens";

const SERVICE_TYPE_OPTIONS = [
  { value: "ECG",            label: "ECG" },
  { value: "central_lab",    label: "Central lab" },
  { value: "ePRO",           label: "ePRO" },
  { value: "IVRS",           label: "IVRS / IXRS" },
  { value: "imaging",        label: "Imaging" },
  { value: "randomization",  label: "Randomization" },
  { value: "other",          label: "Other" },
];

interface VendorServiceFormProps {
  auditId: string;
  actorId: string;
  onSuccess: (service: { id: string; serviceName: string; serviceType: string; serviceDescription: string | null }) => void;
}

export function VendorServiceForm({ auditId, actorId, onSuccess }: VendorServiceFormProps) {
  const [serviceName, setServiceName]             = useState("");
  const [serviceType, setServiceType]             = useState("");
  const [serviceDescription, setServiceDescription] = useState("");
  const [isSubmitting, setIsSubmitting]           = useState(false);
  const [error, setError]                         = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!serviceName.trim() || !serviceType) {
      setError("Service name and type are required.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/audits/${auditId}/vendor-service`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceName:        serviceName.trim(),
          serviceType,
          serviceDescription: serviceDescription.trim() || undefined,
          actorId,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Failed to save service.");
        return;
      }

      const service = await res.json();
      onSuccess(service);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: space[4] }}>
      <Field label="Service name" htmlFor="vs-name">
        <input
          id="vs-name"
          type="text"
          value={serviceName}
          onChange={(e) => setServiceName(e.target.value)}
          placeholder="e.g. Central ECG Reading Service"
          style={inputStyle}
        />
      </Field>

      <Field label="Service type" htmlFor="vs-type">
        <select
          id="vs-type"
          value={serviceType}
          onChange={(e) => setServiceType(e.target.value)}
          style={{ ...inputStyle, width: "auto", minWidth: 200 }}
        >
          <option value="">Select type…</option>
          {SERVICE_TYPE_OPTIONS.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </Field>

      <Field label="Description" hint="Optional — scope of the vendor service in this trial." htmlFor="vs-desc">
        <textarea
          id="vs-desc"
          value={serviceDescription}
          onChange={(e) => setServiceDescription(e.target.value)}
          placeholder="Describe the scope of the vendor service in this trial…"
          rows={3}
          style={{ ...inputStyle, resize: "vertical" }}
        />
      </Field>

      {error && (
        <p style={{ ...typeScale.caption, color: color.danger, margin: 0 }}>{error}</p>
      )}

      <div>
        <Button type="submit" variant="primary" disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : "Save service"}
        </Button>
      </div>
    </form>
  );
}
