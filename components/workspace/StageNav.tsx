"use client";

// =============================================================================
// StageNav (D-010)
//
// Left pane of the audit workspace shell. Renders the 8 stages of the audit
// workflow as a vertical list.
//
// Visual rules (per design critique rec 3):
//   - Only the **next** stage shows a sub-line (the "Advance →" or "🔒 reason").
//     Prior, current, and future-skip stages show only the label.
//   - Dot color encodes state: green = done, blue = current, gray = future.
//   - Current stage gets a left accent border + soft background.
//
// Click semantics (unchanged from D-010):
//   - Next stage: click to advance (forward exactly +1) when ungated
//   - Prior stage: click to revisit (any distance, ungated)
//   - Current / future-skip: not clickable
// =============================================================================

import { AuditStage } from "@prisma/client";
import { STAGE_ORDER, stageIndex } from "@/lib/types/audit-stage";
import { color, layout, space, type as typeScale } from "@/lib/ui/tokens";

const STAGE_LABEL: Record<AuditStage, string> = {
  INTAKE: "Intake",
  VENDOR_ENRICHMENT: "Vendor Enrichment",
  QUESTIONNAIRE_REVIEW: "Questionnaire Review",
  SCOPE_AND_RISK_REVIEW: "Scope & Risk Review",
  PRE_AUDIT_DRAFTING: "Pre-Audit Drafting",
  AUDIT_CONDUCT: "Audit Conduct",
  REPORT_DRAFTING: "Report Drafting",
  FINAL_REVIEW_EXPORT: "Final Review & Export",
};

interface Props {
  currentStage: AuditStage;
  canAdvance: boolean;
  blockedReason: string | null;
  busy: boolean;
  onTransition: (toStage: AuditStage) => void;
}

export function StageNav({ currentStage, canAdvance, blockedReason, busy, onTransition }: Props) {
  const currentIdx = stageIndex(currentStage);
  const nextStage = STAGE_ORDER[currentIdx + 1] ?? null;

  return (
    <nav style={navStyle} aria-label="Audit stages">
      <div style={headerStyle}>
        <div style={{ ...typeScale.eyebrow }}>Audit stage</div>
        <div style={{ ...typeScale.bodyStrong, marginTop: space[1] }}>
          {currentIdx + 1} of {STAGE_ORDER.length} — {STAGE_LABEL[currentStage]}
        </div>
      </div>

      <ol style={{ listStyle: "none", margin: 0, padding: `${space[2]}px 0` }}>
        {STAGE_ORDER.map((stage, idx) => {
          const isCurrent = stage === currentStage;
          const isDone = idx < currentIdx;
          const isNext = stage === nextStage;
          const isFutureSkip = idx > currentIdx + 1;
          const clickable = !busy && !isCurrent && !isFutureSkip && (isDone || (isNext && canAdvance));

          // Sub-line ONLY appears on the next stage. Prior/current/future-skip
          // are label-only. (Design critique rec 3.)
          let subline: { text: string; color: string } | null = null;
          if (isNext) {
            if (canAdvance) {
              subline = { text: "Advance →", color: color.primary };
            } else if (blockedReason) {
              subline = { text: `🔒 ${blockedReason}`, color: color.warning };
            }
          }

          return (
            <li key={stage}>
              <button
                type="button"
                disabled={!clickable}
                onClick={() => clickable && onTransition(stage)}
                aria-current={isCurrent ? "step" : undefined}
                style={{
                  ...stageBtn,
                  cursor: clickable ? "pointer" : "default",
                  background: isCurrent ? color.primaryBgSoft : "transparent",
                  borderLeft: `3px solid ${isCurrent ? color.primary : "transparent"}`,
                  color: isFutureSkip ? color.fgSubtle : color.fg,
                }}
              >
                <span style={dot(isDone, isCurrent)} aria-hidden="true" />
                <span style={{ flex: 1, textAlign: "left" }}>
                  <div style={{ ...typeScale.body, fontWeight: isCurrent ? 600 : 400 }}>
                    {STAGE_LABEL[stage]}
                  </div>
                  {subline && (
                    <div style={{ ...typeScale.micro, color: subline.color, marginTop: 2 }}>
                      {subline.text}
                    </div>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function dot(done: boolean, current: boolean): React.CSSProperties {
  const bg = current ? color.primary : done ? color.success : color.borderStrong;
  return {
    display: "inline-block",
    width: 10,
    height: 10,
    borderRadius: "50%",
    background: bg,
    marginRight: space[2] + 2,
    flexShrink: 0,
  };
}

const navStyle: React.CSSProperties = {
  width: layout.navWidth,
  borderRight: `1px solid ${color.border}`,
  background: color.bgMuted,
  overflowY: "auto",
  flexShrink: 0,
};

const headerStyle: React.CSSProperties = {
  padding: `${space[3]}px ${space[4]}px`,
  borderBottom: `1px solid ${color.border}`,
};

const stageBtn: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: space[1],
  width: "100%",
  padding: `${space[2] + 2}px ${space[4]}px`,
  border: "none",
  background: "transparent",
  fontFamily: "inherit",
};
