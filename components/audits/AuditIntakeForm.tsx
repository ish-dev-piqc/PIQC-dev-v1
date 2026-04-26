"use client";

// =============================================================================
// AuditIntakeForm (D-010, Screen 2)
//
// Auditor's create-an-audit form. Cognitive-load discipline: every field that
// can be derived from upstream is — vendor / protocol / lead auditor are
// chosen from existing rows, never typed as free text. The auditor's only
// novel inputs are audit name + type + scheduled date.
//
// Posts to POST /api/audits. On success → /audits/[id].
// =============================================================================

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AuditType } from "@prisma/client";
import { Button } from "@/components/ui/Button";
import { Field, inputStyle } from "@/components/ui/Field";
import { color, radius, space, type as typeScale } from "@/lib/ui/tokens";

interface VendorOption  { id: string; name: string }
interface ProtocolOption { id: string; label: string; sublabel: string }
interface UserOption     { id: string; name: string; role: string }

interface Props {
  vendors: VendorOption[];
  protocolVersions: ProtocolOption[];
  leadAuditors: UserOption[];
  defaultActorId: string;
}

export function AuditIntakeForm({ vendors, protocolVersions, leadAuditors, defaultActorId }: Props) {
  const router = useRouter();
  const [vendorId, setVendorId] = useState(vendors[0]?.id ?? "");
  const [protocolVersionId, setProtocolVersionId] = useState(protocolVersions[0]?.id ?? "");
  const [auditName, setAuditName] = useState("");
  const [auditType, setAuditType] = useState<AuditType>(AuditType.REMOTE);
  const [leadAuditorId, setLeadAuditorId] = useState(defaultActorId || leadAuditors[0]?.id || "");
  const [scheduledDate, setScheduledDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    !!vendorId && !!protocolVersionId && !!leadAuditorId && auditName.trim().length > 0 && !busy;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/audits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendorId,
          protocolVersionId,
          auditName: auditName.trim(),
          auditType,
          leadAuditorId,
          scheduledDate: scheduledDate || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to create audit");
      }
      const audit = await res.json();
      router.push(`/audits/${audit.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create audit");
      setBusy(false);
    }
  }

  // Empty-state guards: if any lookup list is empty the form can't function.
  // Surface this to the user instead of rendering disabled selects.
  const blockingMessages: string[] = [];
  if (vendors.length === 0)          blockingMessages.push("No vendors exist yet. Seed a vendor before creating an audit.");
  if (protocolVersions.length === 0) blockingMessages.push("No protocol versions exist yet. Ingest a protocol via PIQC before creating an audit.");
  if (leadAuditors.length === 0)     blockingMessages.push("No users with auditor role exist yet. Seed a user before creating an audit.");

  if (blockingMessages.length > 0) {
    return (
      <div
        style={{
          padding: space[4],
          background: color.warningBgSoft,
          border: `1px solid ${color.warningBorder}`,
          borderRadius: radius.md,
        }}
      >
        <strong style={{ display: "block", marginBottom: space[2] }}>Cannot create audit yet</strong>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {blockingMessages.map((m) => (
            <li key={m} style={typeScale.body}>{m}</li>
          ))}
        </ul>
      </div>
    );
  }

  const selectStyle = { ...inputStyle };

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: space[4] }}>
      <Field label="Vendor" hint="The organization being audited.">
        <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} style={selectStyle} disabled={busy}>
          {vendors.map((v) => (
            <option key={v.id} value={v.id}>{v.name}</option>
          ))}
        </select>
      </Field>

      <Field
        label="Protocol version"
        hint="Active protocol version. Risk objects + study context flow downstream from this version."
      >
        <select
          value={protocolVersionId}
          onChange={(e) => setProtocolVersionId(e.target.value)}
          style={selectStyle}
          disabled={busy}
        >
          {protocolVersions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label} — {p.sublabel}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Audit name" hint={<>Internal label used in the worklist. e.g. &ldquo;ACME Central Lab — 2026 routine&rdquo;.</>}>
        <input
          type="text"
          value={auditName}
          onChange={(e) => setAuditName(e.target.value)}
          placeholder="Vendor + service + period"
          style={inputStyle}
          disabled={busy}
          required
        />
      </Field>

      <Field label="Audit type">
        <div style={{ display: "flex", gap: space[3] }}>
          {(["REMOTE", "ONSITE", "HYBRID"] as AuditType[]).map((t) => (
            <label key={t} style={{ display: "flex", alignItems: "center", gap: space[1], ...typeScale.body }}>
              <input
                type="radio"
                name="auditType"
                value={t}
                checked={auditType === t}
                onChange={() => setAuditType(t)}
                disabled={busy}
              />
              {t.charAt(0) + t.slice(1).toLowerCase()}
            </label>
          ))}
        </div>
      </Field>

      <Field label="Lead auditor">
        <select
          value={leadAuditorId}
          onChange={(e) => setLeadAuditorId(e.target.value)}
          style={selectStyle}
          disabled={busy}
        >
          {leadAuditors.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} ({u.role.replace(/_/g, " ").toLowerCase()})
            </option>
          ))}
        </select>
      </Field>

      <Field label="Scheduled date" hint="Tentative — adjust later as needed.">
        <input
          type="date"
          value={scheduledDate}
          onChange={(e) => setScheduledDate(e.target.value)}
          style={inputStyle}
          disabled={busy}
        />
      </Field>

      {error && (
        <div
          style={{
            background: color.dangerBgSoft,
            padding: space[2],
            borderRadius: radius.sm,
            color: color.dangerFgSoft,
            ...typeScale.body,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: space[2], marginTop: space[2] }}>
        <Button type="submit" disabled={!canSubmit}>
          {busy ? "Creating…" : "Create audit"}
        </Button>
        <Button type="button" variant="secondary" onClick={() => router.push("/audits")} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
