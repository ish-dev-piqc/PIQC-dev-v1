// =============================================================================
// Tests: lib/risk-summary.ts
//
// Focus on the invariants downstream artifacts depend on:
//   - getOrCreate is idempotent (won't double-create on race)
//   - approve refuses empty narrative (downstream cannot consume blank)
//   - edit on APPROVED demotes to DRAFT (no silent mid-edit consumption)
// =============================================================================

import { describe, expect, it } from "vitest";
import { RiskSummaryApprovalStatus } from "@prisma/client";
import {
  approveRiskSummary,
  createRiskSummaryStub,
  getOrCreateRiskSummaryStub,
  getRenderedRiskSummary,
  updateRiskSummary,
} from "@/lib/risk-summary";
import { prisma } from "@/lib/prisma";
import { seedAuditWithContext, seedAuditWithVendorService } from "../helpers/factory";

describe("getOrCreateRiskSummaryStub", () => {
  it("creates a DRAFT stub on first call", async () => {
    const { audit, actor } = await seedAuditWithVendorService();

    const created = await getOrCreateRiskSummaryStub({
      auditId: audit.id,
      actorId: actor.id,
    });

    expect(created.approvalStatus).toBe(RiskSummaryApprovalStatus.DRAFT);
    expect(created.vendorRelevanceNarrative.length).toBeGreaterThan(0);
  });

  it("returns the existing stub on subsequent calls (idempotent)", async () => {
    const { audit, actor } = await seedAuditWithVendorService();
    const first  = await getOrCreateRiskSummaryStub({ auditId: audit.id, actorId: actor.id });
    const second = await getOrCreateRiskSummaryStub({ auditId: audit.id, actorId: actor.id });
    expect(second.id).toBe(first.id);
  });

  it("refuses to create twice when called via createRiskSummaryStub directly", async () => {
    const { audit, actor } = await seedAuditWithVendorService();
    await createRiskSummaryStub({ auditId: audit.id, actorId: actor.id });
    await expect(
      createRiskSummaryStub({ auditId: audit.id, actorId: actor.id })
    ).rejects.toThrow(/already exists/i);
  });
});

describe("approveRiskSummary", () => {
  it("refuses to approve a summary with empty narrative", async () => {
    const { audit, actor } = await seedAuditWithContext();
    // Create with empty narrative directly.
    await prisma.vendorRiskSummaryObject.create({
      data: {
        auditId: audit.id,
        studyContext: {},
        vendorRelevanceNarrative: "   ", // whitespace only
        focusAreas: [],
        approvalStatus: RiskSummaryApprovalStatus.DRAFT,
      },
    });

    await expect(
      approveRiskSummary({ auditId: audit.id, actorId: actor.id })
    ).rejects.toThrow(/empty narrative/i);
  });

  it("stamps approvedAt + approvedBy when narrative is present", async () => {
    const { audit, actor } = await seedAuditWithVendorService();
    await getOrCreateRiskSummaryStub({ auditId: audit.id, actorId: actor.id });

    const approved = await approveRiskSummary({ auditId: audit.id, actorId: actor.id });

    expect(approved.approvalStatus).toBe(RiskSummaryApprovalStatus.APPROVED);
    expect(approved.approvedAt).toBeInstanceOf(Date);
    expect(approved.approvedBy).toBe(actor.id);
  });
});

describe("updateRiskSummary — demote-on-edit", () => {
  it("demotes APPROVED to DRAFT when narrative is edited", async () => {
    const { audit, actor } = await seedAuditWithVendorService();
    await getOrCreateRiskSummaryStub({ auditId: audit.id, actorId: actor.id });
    await approveRiskSummary({ auditId: audit.id, actorId: actor.id });

    const updated = await updateRiskSummary({
      auditId: audit.id,
      actorId: actor.id,
      vendorRelevanceNarrative: "Edited narrative.",
    });

    expect(updated.approvalStatus).toBe(RiskSummaryApprovalStatus.DRAFT);
    expect(updated.approvedAt).toBeNull();
    expect(updated.approvedBy).toBeNull();
  });

  it("stays DRAFT when editing a draft (no demotion noise)", async () => {
    const { audit, actor } = await seedAuditWithVendorService();
    await getOrCreateRiskSummaryStub({ auditId: audit.id, actorId: actor.id });

    const updated = await updateRiskSummary({
      auditId: audit.id,
      actorId: actor.id,
      vendorRelevanceNarrative: "Edited from draft.",
    });

    expect(updated.approvalStatus).toBe(RiskSummaryApprovalStatus.DRAFT);
  });

  it("writes a delta with reason when demoting", async () => {
    const { audit, actor } = await seedAuditWithVendorService();
    const stub = await getOrCreateRiskSummaryStub({ auditId: audit.id, actorId: actor.id });
    await approveRiskSummary({ auditId: audit.id, actorId: actor.id });
    await updateRiskSummary({
      auditId: audit.id,
      actorId: actor.id,
      vendorRelevanceNarrative: "Edited.",
    });

    const deltas = await prisma.stateHistoryDelta.findMany({
      where: { objectType: "VENDOR_RISK_SUMMARY_OBJECT", objectId: stub.id },
      orderBy: { createdAt: "asc" },
    });
    // Stub create + approve + edit-with-demote = 3 deltas.
    expect(deltas).toHaveLength(3);
    expect(deltas[2].reason).toMatch(/returned to DRAFT/i);
  });
});

describe("getRenderedRiskSummary", () => {
  it("returns null when no summary exists", async () => {
    const { audit } = await seedAuditWithContext();
    const rendered = await getRenderedRiskSummary(audit.id);
    expect(rendered).toBeNull();
  });

  it("returns ISO date strings + linked protocol risk refs", async () => {
    const { audit, actor } = await seedAuditWithVendorService();
    await getOrCreateRiskSummaryStub({ auditId: audit.id, actorId: actor.id });
    const rendered = await getRenderedRiskSummary(audit.id);
    expect(rendered).not.toBeNull();
    expect(typeof rendered!.createdAt).toBe("string");
    expect(typeof rendered!.updatedAt).toBe("string");
    expect(Array.isArray(rendered!.protocolRiskRefs)).toBe(true);
  });
});
