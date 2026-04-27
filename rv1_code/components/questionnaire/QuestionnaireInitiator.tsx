"use client";

// =============================================================================
// QuestionnaireInitiator
//
// Rendered in QUESTIONNAIRE_REVIEW when no QuestionnaireInstance exists yet.
// POSTs to /api/audits/[auditId]/questionnaire to fork the canonical template,
// then reloads the page so the server component re-fetches with the new instance.
//
// This is intentionally thin — the only decision the auditor makes here is
// "start the questionnaire". All configuration (vendor contact, addenda) happens
// inside QuestionnaireWorkspace after initiation.
// =============================================================================

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { color, radius, space, type as typeScale } from "@/lib/ui/tokens";

interface Props {
  auditId: string;
  actorId: string;
}

export function QuestionnaireInitiator({ auditId, actorId }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function initiate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/audits/${auditId}/questionnaire`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to initiate questionnaire");
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to initiate questionnaire");
      setBusy(false);
    }
  }

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <div style={typeScale.eyebrow}>QUESTIONNAIRE REVIEW</div>
        <h2 style={{ ...typeScale.title, margin: `${space[2]}px 0 ${space[3]}px` }}>
          Initiate questionnaire
        </h2>
        <p style={{ ...typeScale.body, color: color.fgMuted, margin: `0 0 ${space[2]}px` }}>
          This forks the canonical GCP vendor questionnaire template into a working
          instance for this audit. You&apos;ll then pre-fill responses from desk research,
          add service-specific addenda (§5.3.x) from your vendor service mappings,
          and optionally send the questionnaire to the vendor for their input.
        </p>
        <p style={{ ...typeScale.body, color: color.fgMuted, margin: `0 0 ${space[5]}px` }}>
          One instance per audit. This action cannot be undone, but all edits are
          delta-tracked — the full history is visible from the audit trail.
        </p>

        {error && (
          <div role="alert" style={errorStyle}>
            {error}
          </div>
        )}

        <Button onClick={initiate} disabled={busy}>
          {busy ? "Initiating…" : "Initiate questionnaire"}
        </Button>
      </div>
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  flex: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: space[6],
};

const cardStyle: React.CSSProperties = {
  maxWidth: 480,
  background: color.bg,
  border: `1px solid ${color.border}`,
  borderRadius: 8,
  padding: space[5],
};

const errorStyle: React.CSSProperties = {
  ...typeScale.caption,
  background: color.dangerBgSoft,
  color: color.dangerFgSoft,
  borderRadius: 4,
  padding: space[2],
  marginBottom: space[3],
};
