"use client";

// =============================================================================
// AuditWorkspaceShell (D-010)
//
// 3-pane layout for the audit workspace:
//   Left   — StageNav (where am I in the workflow)
//   Center — Per-stage primary artifact (passed in as children by the page)
//   Right  — RiskSummaryPanel (why this vendor matters)
//
// The shell owns the stage readout state and the PATCH /stage call so that
// stage transitions (and the gate flips that follow approvals) remount
// without a full page reload. The center pane is dumb — it's whatever
// component the page wires up for the current stage.
//
// `useStageActions()` exposes { readout, advanceStage } to nested center
// components so they can render their own stage-advance affordances (e.g.
// the "all approved → Audit Conduct" banner in PreAuditDraftingWorkspace)
// without duplicating the transition logic.
// =============================================================================

import { createContext, useContext, useState } from "react";
import { useRouter } from "next/navigation";
import { AuditStage } from "@prisma/client";
import type { StageReadout } from "@/lib/audit-stage";
import type { RenderedRiskSummary } from "@/lib/types/risk-summary";
import { StageNav } from "./StageNav";
import { RiskSummaryPanel } from "./RiskSummaryPanel";
import { color, radius, space, type as typeScale } from "@/lib/ui/tokens";

interface Props {
  auditId: string;
  actorId: string;
  initialReadout: StageReadout;
  initialRiskSummary: RenderedRiskSummary | null;
  /**
   * Optional header rendered above the center pane content. The page wires
   * this with breadcrumb + audit context (study, vendor, audit name).
   * Kept as a slot so the shell stays decoupled from server-fetched audit
   * metadata.
   */
  headerSlot?: React.ReactNode;
  children: React.ReactNode;
}

// Context surface for nested center components that need to drive stage
// transitions (e.g. an "advance to next stage" button inside a deliverable
// workspace). null when used outside the shell.
export interface StageActions {
  readout: StageReadout;
  busy: boolean;
  advanceStage: (toStage: AuditStage) => Promise<void>;
}
const StageActionsContext = createContext<StageActions | null>(null);
export function useStageActions(): StageActions | null {
  return useContext(StageActionsContext);
}

export function AuditWorkspaceShell({
  auditId,
  actorId,
  initialReadout,
  initialRiskSummary,
  headerSlot,
  children,
}: Props) {
  const router = useRouter();
  const [readout, setReadout] = useState<StageReadout>(initialReadout);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function transition(toStage: AuditStage) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/audits/${auditId}/stage`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toStage, actorId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to transition");
      }
      // PATCH returns the post-transition readout — no follow-up GET needed.
      setReadout(await res.json());
      // The center pane is keyed on currentStage at the page level, so swap
      // to the new stage's component requires a server re-render.
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to transition");
    } finally {
      setBusy(false);
    }
  }

  const actions: StageActions = { readout, busy, advanceStage: transition };

  return (
    <StageActionsContext.Provider value={actions}>
      <div style={shellStyle}>
        <StageNav
          currentStage={readout.currentStage}
          canAdvance={readout.canAdvance}
          blockedReason={readout.blockedReason}
          busy={busy}
          onTransition={transition}
        />

        <main style={mainStyle}>
          {headerSlot && <div style={headerSlotStyle}>{headerSlot}</div>}
          <div style={{ flex: 1, overflowY: "auto" }}>
            {error && (
              <div role="alert" style={errorBannerStyle}>
                {error}
              </div>
            )}
            {children}
          </div>
        </main>

        <RiskSummaryPanel
          auditId={auditId}
          actorId={actorId}
          initialSummary={initialRiskSummary}
        />
      </div>
    </StageActionsContext.Provider>
  );
}

const shellStyle: React.CSSProperties = {
  display: "flex",
  flex: 1,
  minHeight: 0, // Required for the inner panes' `overflowY: auto` to work
                // when the shell sits inside a flex-column root layout.
  background: color.bg,
  color: color.fg,
};

const mainStyle: React.CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  minWidth: 0, // Required so child overflow works in a flex row.
  background: color.bg,
};

const headerSlotStyle: React.CSSProperties = {
  padding: `${space[3]}px ${space[5]}px`,
  borderBottom: `1px solid ${color.border}`,
  background: color.bg,
  flexShrink: 0,
};

const errorBannerStyle: React.CSSProperties = {
  background: color.dangerBgSoft,
  color: color.dangerFgSoft,
  padding: space[2],
  margin: space[3],
  borderRadius: radius.sm,
  ...typeScale.body,
};
