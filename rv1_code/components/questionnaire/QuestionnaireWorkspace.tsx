"use client";

// =============================================================================
// QuestionnaireWorkspace (D-003)
//
// The auditor's working surface for one QuestionnaireInstance. Renders all
// questions grouped by section, shows response provenance per item, and
// supports the linear workflow:
//   1. Pre-fill from web research (auditor types in answer + source URL)
//   2. Generate 5.3.x addenda after vendor service mappings exist
//   3. Mark instance ready to send → SENT_TO_VENDOR
//   4. Ingest vendor return (separate flow, hits /vendor-return)
//   5. Review + complete
//
// This is the auditor's draft workspace. Final document polish (header/footer,
// brand styling) happens in Word/Google Docs after export — not here.
// =============================================================================

import { useMemo, useState } from "react";
import {
  QuestionAnswerType,
  QuestionnaireInstanceStatus,
  QuestionOrigin,
  ResponseSource,
  ResponseStatus,
} from "@prisma/client";
import type { RenderedQuestion } from "@/lib/types/questionnaire";
import { Button } from "@/components/ui/Button";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { HistoryDrawer } from "@/components/workspace/HistoryDrawer";
import { color, radius, space, type as typeScale } from "@/lib/ui/tokens";

interface RenderedInstance {
  id: string;
  auditId: string;
  templateVersionId: string;
  status: QuestionnaireInstanceStatus;
  vendorContactName: string | null;
  vendorContactEmail: string | null;
  vendorContactTitle: string | null;
  addendaGeneratedAt: string | null;
  sentToVendorAt: string | null;
  vendorRespondedAt: string | null;
  completedAt: string | null;
}

interface Props {
  auditId: string;
  actorId: string;
  initialInstance: RenderedInstance;
  initialQuestions: RenderedQuestion[];
}

// Maps response provenance to a Badge tone. Keeps palette decisions in one
// place (the Badge component) rather than duplicating colors here.
const SOURCE_TONE: Record<ResponseSource, BadgeTone> = {
  PENDING:                     "neutral",
  AUDITOR_PREFILL_WEB:         "info",
  AUDITOR_PREFILL_PRIOR_AUDIT: "info",
  AUDITOR_AUTHORED:            "draft",
  VENDOR:                      "approved",
  NOT_APPLICABLE:              "muted",
};

const SOURCE_LABEL: Record<ResponseSource, string> = {
  PENDING:                     "Pending",
  AUDITOR_PREFILL_WEB:         "Web pre-fill",
  AUDITOR_PREFILL_PRIOR_AUDIT: "Prior audit",
  AUDITOR_AUTHORED:            "Auditor",
  VENDOR:                      "Vendor",
  NOT_APPLICABLE:              "N/A",
};

const STATUS_ORDER: QuestionnaireInstanceStatus[] = [
  "DRAFT",
  "PREFILL_IN_PROGRESS",
  "READY_TO_SEND",
  "SENT_TO_VENDOR",
  "VENDOR_RESPONDED",
  "COMPLETE",
];

export function QuestionnaireWorkspace({
  auditId,
  actorId,
  initialInstance,
  initialQuestions,
}: Props) {
  const [instance, setInstance] = useState(initialInstance);
  const [questions, setQuestions] = useState(initialQuestions);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const grouped = useMemo(() => groupBySection(questions), [questions]);

  const counts = useMemo(() => {
    let pending = 0;
    let prefilled = 0;
    let vendor = 0;
    let na = 0;
    for (const q of questions) {
      const s = q.response?.source ?? ResponseSource.PENDING;
      if (s === ResponseSource.PENDING) pending++;
      else if (s === ResponseSource.VENDOR) vendor++;
      else if (s === ResponseSource.NOT_APPLICABLE) na++;
      else prefilled++;
    }
    return { pending, prefilled, vendor, na, total: questions.length };
  }, [questions]);

  async function patchResponse(question: RenderedQuestion, patch: Partial<NonNullable<RenderedQuestion["response"]>> & { source: ResponseSource }) {
    setBusy(question.id);
    setError(null);
    try {
      const res = await fetch(
        `/api/audits/${auditId}/questionnaire/responses`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            questionId: question.id,
            actorId,
            source: patch.source,
            responseText: patch.responseText ?? undefined,
            sourceReference: patch.sourceReference ?? undefined,
            confidenceFlag: patch.confidenceFlag ?? undefined,
            inconsistencyFlag: patch.inconsistencyFlag ?? undefined,
            inconsistencyNote: patch.inconsistencyNote ?? undefined,
            respondedBy: actorId,
            responseStatus:
              patch.source === ResponseSource.NOT_APPLICABLE
                ? ResponseStatus.DEFERRED
                : patch.responseText
                  ? ResponseStatus.ANSWERED
                  : ResponseStatus.UNANSWERED,
          }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to update response");
      }
      const updated = await res.json();
      setQuestions((prev) =>
        prev.map((q) =>
          q.id === question.id
            ? {
                ...q,
                response: {
                  id: updated.id,
                  responseText: updated.responseText,
                  responseStatus: updated.responseStatus,
                  source: updated.source,
                  sourceReference: updated.sourceReference,
                  confidenceFlag: updated.confidenceFlag,
                  inconsistencyFlag: updated.inconsistencyFlag,
                  inconsistencyNote: updated.inconsistencyNote,
                },
              }
            : q
        )
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update response");
    } finally {
      setBusy(null);
    }
  }

  async function generateAddenda(replaceExisting: boolean) {
    setBusy("addenda");
    setError(null);
    try {
      const res = await fetch(
        `/api/audits/${auditId}/questionnaire/addenda`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ actorId, replaceExisting }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to generate addenda");
      }
      // Reload questionnaire to pick up new addendum questions.
      const refresh = await fetch(`/api/audits/${auditId}/questionnaire`);
      if (refresh.ok) {
        const data = await refresh.json();
        setInstance(data.instance);
        setQuestions(data.questions);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate addenda");
    } finally {
      setBusy(null);
    }
  }

  async function transitionStatus(toStatus: QuestionnaireInstanceStatus) {
    setBusy("status");
    setError(null);
    try {
      const res = await fetch(
        `/api/audits/${auditId}/questionnaire/status`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ toStatus, actorId }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to transition status");
      }
      const updated = await res.json();
      setInstance(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to transition status");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ maxWidth: 960, padding: space[4], width: "100%", margin: "0 auto" }}>
      <header style={{ marginBottom: space[5] }}>
        <h2 style={{ ...typeScale.title, margin: 0 }}>Vendor Questionnaire</h2>
        <p style={{ ...typeScale.body, color: color.fgMuted, margin: `${space[1]}px 0 ${space[3]}px` }}>
          Pre-fill from public research, generate service-specific addenda, then send to vendor for the remaining items.
        </p>
        <StatusBar status={instance.status} onTransition={transitionStatus} disabled={!!busy} />
        <Counts counts={counts} />
        <div style={{ marginTop: space[3] }}>
          <a
            href={`/api/audits/${auditId}/questionnaire/export`}
            download="questionnaire-draft.md"
            style={{
              ...typeScale.caption,
              color: color.primary,
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: space[1],
            }}
          >
            ↓ Export draft (Markdown)
          </a>
          <span style={{ ...typeScale.micro, color: color.fgSubtle, marginLeft: space[2] }}>
            First draft for polish in Word / Google Docs
          </span>
        </div>
        <HistoryDrawer
          auditId={auditId}
          objectType="QUESTIONNAIRE_INSTANCE"
          objectId={instance.id}
          label="Questionnaire history"
        />
      </header>

      <section style={addendaSectionStyle} aria-label="Section 5.3 addenda">
        <strong style={{ display: "block", marginBottom: space[2] }}>Section 5.3 — Service-specific addenda</strong>
        <p style={{ ...typeScale.caption, color: color.fgMuted, margin: `${space[1]}px 0 ${space[2]}px` }}>
          Generates from this audit&apos;s vendor service mappings. Add or update service mappings first, then click below.
        </p>
        <div style={{ display: "flex", gap: space[2], flexWrap: "wrap" }}>
          <Button onClick={() => generateAddenda(false)} disabled={!!busy}>
            {busy === "addenda" ? "Generating…" : "Generate / Update addenda"}
          </Button>
          <Button variant="secondary" onClick={() => generateAddenda(true)} disabled={!!busy}>
            Replace from scratch
          </Button>
        </div>
        {instance.addendaGeneratedAt && (
          <div style={{ ...typeScale.micro, color: color.fgMuted, marginTop: space[2] }}>
            Last generated: {new Date(instance.addendaGeneratedAt).toLocaleString()}
          </div>
        )}
      </section>

      {error && (
        <div role="alert" style={errorStyle}>
          {error}
        </div>
      )}

      {grouped.map(({ sectionCode, sectionTitle, items }) => (
        <section key={sectionCode} style={{ marginBottom: space[6] }}>
          <h3 style={sectionHeadingStyle}>
            {sectionCode} — {sectionTitle}
          </h3>
          {items.map((q) => (
            <QuestionRow
              key={q.id}
              question={q}
              busy={busy === q.id}
              onPatch={(patch) => patchResponse(q, patch)}
            />
          ))}
        </section>
      ))}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Subcomponents
// -----------------------------------------------------------------------------

function StatusBar({
  status,
  onTransition,
  disabled,
}: {
  status: QuestionnaireInstanceStatus;
  onTransition: (s: QuestionnaireInstanceStatus) => void;
  disabled: boolean;
}) {
  const idx = STATUS_ORDER.indexOf(status);
  const next = STATUS_ORDER[idx + 1];

  return (
    <div style={{ display: "flex", alignItems: "center", gap: space[2], marginBottom: space[3] }}>
      <span style={{ ...typeScale.caption, color: color.fgMuted }}>Status:</span>
      <Badge tone="info">{status.replace(/_/g, " ")}</Badge>
      {next && (
        <Button variant="secondary" size="sm" onClick={() => onTransition(next)} disabled={disabled}>
          → {next.replace(/_/g, " ")}
        </Button>
      )}
    </div>
  );
}

function Counts({
  counts,
}: {
  counts: { pending: number; prefilled: number; vendor: number; na: number; total: number };
}) {
  return (
    <div style={{ display: "flex", gap: space[3], ...typeScale.caption, color: color.fg }}>
      <span>Total: {counts.total}</span>
      <span style={{ color: color.fgMuted }}>Pending: {counts.pending}</span>
      <span style={{ color: color.statusInfoFgSoft }}>Pre-filled: {counts.prefilled}</span>
      <span style={{ color: color.successFgSoft }}>Vendor: {counts.vendor}</span>
      <span style={{ color: color.fgMuted }}>N/A: {counts.na}</span>
    </div>
  );
}

function QuestionRow({
  question,
  busy,
  onPatch,
}: {
  question: RenderedQuestion;
  busy: boolean;
  onPatch: (patch: { source: ResponseSource; responseText?: string; sourceReference?: string }) => void;
}) {
  const [responseText, setResponseText] = useState(question.response?.responseText ?? "");
  const [sourceReference, setSourceReference] = useState(question.response?.sourceReference ?? "");
  const source = question.response?.source ?? ResponseSource.PENDING;

  return (
    <div
      style={{
        border: `1px solid ${color.border}`,
        borderRadius: radius.md,
        padding: space[3],
        marginBottom: space[2],
        background: source === ResponseSource.PENDING ? color.bg : color.bgMuted,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: space[3] }}>
        <div style={{ flex: 1 }}>
          <div style={{ ...typeScale.caption, color: color.fgMuted, display: "flex", flexWrap: "wrap", gap: space[2], alignItems: "center" }}>
            <span>{question.questionNumber}</span>
            {question.origin === QuestionOrigin.ADDENDUM && <Badge tone="draft">Addendum</Badge>}
            {question.evidenceExpected && <Badge tone="info">Evidence requested</Badge>}
            <Badge tone="neutral">{labelForAnswerType(question.answerType)}</Badge>
          </div>
          <div style={{ ...typeScale.body, fontWeight: 500, marginTop: space[1] }}>{question.prompt}</div>
        </div>
        <Badge tone={SOURCE_TONE[source]}>{SOURCE_LABEL[source]}</Badge>
      </div>

      <div style={{ marginTop: space[2] + 2 }}>
        <textarea
          value={responseText}
          onChange={(e) => setResponseText(e.target.value)}
          placeholder="Auditor pre-fill from public research, or vendor response"
          rows={3}
          style={textareaStyle}
          disabled={busy}
        />
        <input
          type="text"
          value={sourceReference}
          onChange={(e) => setSourceReference(e.target.value)}
          placeholder="Source URL or citation (for web pre-fill)"
          style={inputStyle}
          disabled={busy}
        />
      </div>

      <div style={{ display: "flex", gap: space[1] + 2, marginTop: space[2], flexWrap: "wrap" }}>
        <Button
          variant="secondary"
          size="sm"
          disabled={busy || !responseText}
          onClick={() => onPatch({ source: ResponseSource.AUDITOR_PREFILL_WEB, responseText, sourceReference })}
        >
          Save as web pre-fill
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={busy || !responseText}
          onClick={() => onPatch({ source: ResponseSource.AUDITOR_AUTHORED, responseText, sourceReference })}
        >
          Save as auditor-authored
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={() => onPatch({ source: ResponseSource.NOT_APPLICABLE, responseText: "N/A" })}
        >
          Mark N/A
        </Button>
        <Button
          variant="link"
          size="sm"
          disabled={busy}
          onClick={() => onPatch({ source: ResponseSource.PENDING, responseText: "", sourceReference: "" })}
        >
          Reset to pending
        </Button>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function groupBySection(questions: RenderedQuestion[]) {
  const map = new Map<string, { sectionCode: string; sectionTitle: string; items: RenderedQuestion[] }>();
  const sorted = [...questions].sort((a, b) => a.ordinal - b.ordinal);
  for (const q of sorted) {
    const key = `${q.sectionCode}|${q.sectionTitle}`;
    if (!map.has(key)) {
      map.set(key, { sectionCode: q.sectionCode, sectionTitle: q.sectionTitle, items: [] });
    }
    map.get(key)!.items.push(q);
  }
  return Array.from(map.values());
}

function labelForAnswerType(t: QuestionAnswerType): string {
  switch (t) {
    case "NARRATIVE": return "Narrative";
    case "YES_NO_QUALIFY": return "Yes/No + qualify";
    case "EVIDENCE_REQUEST": return "Evidence";
    case "LIST": return "List";
    case "NUMERIC": return "Number";
  }
}

// -----------------------------------------------------------------------------
// Styles
// -----------------------------------------------------------------------------

const addendaSectionStyle: React.CSSProperties = {
  marginBottom: space[5],
  padding: space[3],
  background: color.bgMuted,
  border: `1px solid ${color.borderSubtle}`,
  borderRadius: radius.md,
};

const sectionHeadingStyle: React.CSSProperties = {
  ...typeScale.section,
  margin: `${space[4]}px 0 ${space[2]}px`,
  borderBottom: `1px solid ${color.border}`,
  paddingBottom: space[1],
};

const errorStyle: React.CSSProperties = {
  background: color.dangerBgSoft,
  color: color.dangerFgSoft,
  padding: space[2],
  borderRadius: radius.sm,
  marginBottom: space[4],
  ...typeScale.body,
};

const textareaStyle: React.CSSProperties = {
  width: "100%",
  padding: space[2] - 2,
  fontFamily: "inherit",
  fontSize: 13,
  boxSizing: "border-box",
  border: `1px solid ${color.borderStrong}`,
  borderRadius: radius.sm,
  background: color.bg,
  color: color.fg,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: space[2] - 2,
  marginTop: space[1],
  fontSize: 12,
  fontFamily: "inherit",
  boxSizing: "border-box",
  border: `1px solid ${color.borderStrong}`,
  borderRadius: radius.sm,
  background: color.bg,
  color: color.fg,
};
