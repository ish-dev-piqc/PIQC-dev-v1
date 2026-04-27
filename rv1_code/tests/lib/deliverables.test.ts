// =============================================================================
// Tests: lib/deliverables.ts
//
// The deliverable layer is kind-generic via a DISPATCH table. Tests cover:
//   - all three kinds receive a DRAFT stub from createDeliverableStub
//   - per-kind approval validity (empty body / no items refused)
//   - update demotes APPROVED → DRAFT
//   - INVALID_CONTENT_SHAPE thrown on malformed PATCH content
//   - INVALID_CONTENT_SHAPE carries Zod issues so callers can diagnose
//
// Each "for every kind" assertion runs the same scenario across all three
// deliverable kinds — the dispatch table's primary purpose is uniformity.
// =============================================================================

import { describe, expect, it } from "vitest";
import { DeliverableApprovalStatus } from "@prisma/client";
import {
  DeliverableError,
  approveDeliverable,
  createDeliverableStub,
  getRenderedDeliverable,
  updateDeliverable,
} from "@/lib/deliverables";
import {
  DELIVERABLE_KINDS,
  type AgendaContent,
  type ChecklistContent,
  type ConfirmationLetterContent,
  type DeliverableKind,
} from "@/lib/types/deliverables";
import { prisma } from "@/lib/prisma";
import { seedAuditWithVendorService, seedDeliverable } from "../helpers/factory";

describe("createDeliverableStub", () => {
  it.each(DELIVERABLE_KINDS)("creates a DRAFT stub for kind=%s", async (kind) => {
    const { audit, actor } = await seedAuditWithVendorService();

    const stub = await createDeliverableStub({ auditId: audit.id, kind, actorId: actor.id });

    expect(stub.approvalStatus).toBe(DeliverableApprovalStatus.DRAFT);
    expect(stub.auditId).toBe(audit.id);
    expect(stub.content).toBeTypeOf("object");
  });

  it("refuses to create twice for the same audit + kind", async () => {
    const { audit, actor } = await seedAuditWithVendorService();
    await createDeliverableStub({ auditId: audit.id, kind: "agenda", actorId: actor.id });
    await expect(
      createDeliverableStub({ auditId: audit.id, kind: "agenda", actorId: actor.id })
    ).rejects.toMatchObject({ code: "ALREADY_EXISTS" });
  });

  it("rejects creation against a missing audit", async () => {
    await expect(
      createDeliverableStub({
        auditId: "00000000-0000-0000-0000-000000000000",
        kind: "checklist",
        actorId: "00000000-0000-0000-0000-000000000000",
      })
    ).rejects.toMatchObject({ code: "AUDIT_NOT_FOUND" });
  });
});

describe("approveDeliverable — per-kind validity", () => {
  it("refuses to approve confirmation letter with empty body", async () => {
    const { audit, actor } = await seedAuditWithVendorService();
    await prisma.confirmationLetterObject.create({
      data: {
        auditId: audit.id,
        content: {
          to: "v", vendorContactTitle: "", vendorContactAddress: "",
          from: "a", subject: "s",
          auditStartTime: "09:00", auditEndTime: "16:00",
          preAuditDocuments: [], bodyText: "   ", ccRecipients: [],
        },
        approvalStatus: DeliverableApprovalStatus.DRAFT,
      },
    });
    await expect(
      approveDeliverable({ auditId: audit.id, kind: "confirmationLetter", actorId: actor.id })
    ).rejects.toMatchObject({ code: "INVALID_FOR_APPROVAL" });
  });

  it("refuses to approve agenda with no items having a topic", async () => {
    const { audit, actor } = await seedAuditWithVendorService();
    await prisma.agendaObject.create({
      data: {
        auditId: audit.id,
        content: {
          auditeeAddress: "", projects: "", auditScope: "", conductSummary: "",
          attendees: [], objectives: [],
          days: [{ date: null, label: "Day 1", items: [{ topic: "  " }] }],
        },
        approvalStatus: DeliverableApprovalStatus.DRAFT,
      },
    });
    await expect(
      approveDeliverable({ auditId: audit.id, kind: "agenda", actorId: actor.id })
    ).rejects.toMatchObject({ code: "INVALID_FOR_APPROVAL" });
  });

  it("refuses to approve checklist with no items having a prompt", async () => {
    const { audit, actor } = await seedAuditWithVendorService();
    await prisma.checklistObject.create({
      data: {
        auditId: audit.id,
        content: {
          auditContext: "test",
          focusAreas: [],
          items: [{ id: "i1", prompt: "", evidenceExpected: false }],
        },
        approvalStatus: DeliverableApprovalStatus.DRAFT,
      },
    });
    await expect(
      approveDeliverable({ auditId: audit.id, kind: "checklist", actorId: actor.id })
    ).rejects.toMatchObject({ code: "INVALID_FOR_APPROVAL" });
  });

  it("approves and stamps approvedAt/approvedBy when valid", async () => {
    const { audit, actor } = await seedAuditWithVendorService();
    await createDeliverableStub({ auditId: audit.id, kind: "confirmationLetter", actorId: actor.id });

    const approved = await approveDeliverable({
      auditId: audit.id,
      kind: "confirmationLetter",
      actorId: actor.id,
    });

    expect(approved.approvalStatus).toBe(DeliverableApprovalStatus.APPROVED);
    expect(approved.approvedBy).toBe(actor.id);
    expect(approved.approvedAt).toBeInstanceOf(Date);
  });

  it("returns DELIVERABLE_NOT_FOUND when nothing exists", async () => {
    const { audit, actor } = await seedAuditWithVendorService();
    await expect(
      approveDeliverable({ auditId: audit.id, kind: "agenda", actorId: actor.id })
    ).rejects.toMatchObject({ code: "DELIVERABLE_NOT_FOUND" });
  });
});

describe("updateDeliverable — demote-on-edit", () => {
  it("demotes APPROVED → DRAFT and clears approvedAt/approvedBy", async () => {
    const { audit, actor } = await seedAuditWithVendorService();
    await seedDeliverable(audit.id, "confirmationLetter", { approved: true, approvedBy: actor.id });

    const newContent: ConfirmationLetterContent = {
      to: "Vendor", vendorContactTitle: "", vendorContactAddress: "",
      from: "Auditor", subject: "Updated",
      auditStartTime: "09:00", auditEndTime: "16:00",
      preAuditDocuments: [], bodyText: "New body.", ccRecipients: [],
    };
    const updated = await updateDeliverable({
      auditId: audit.id,
      kind: "confirmationLetter",
      actorId: actor.id,
      content: newContent,
    });

    expect(updated.approvalStatus).toBe(DeliverableApprovalStatus.DRAFT);
    expect(updated.approvedAt).toBeNull();
    expect(updated.approvedBy).toBeNull();
  });

  it("rejects content that does not match the kind's schema", async () => {
    const { audit, actor } = await seedAuditWithVendorService();
    await seedDeliverable(audit.id, "agenda", { approved: false });

    const err = await updateDeliverable({
      auditId: audit.id,
      kind: "agenda",
      // Confirmation letter shape passed to agenda — should be rejected.
      content: { to: "x", from: "y", subject: "z", bodyText: "b", ccRecipients: [] } as never,
      actorId: actor.id,
    }).catch((e) => e as DeliverableError);

    expect(err.code).toBe("INVALID_CONTENT_SHAPE");
    // Issues array carries Zod paths so the auditor can see what's wrong.
    expect(err.issues?.length ?? 0).toBeGreaterThan(0);
  });
});

describe("getRenderedDeliverable", () => {
  it.each(DELIVERABLE_KINDS)("returns null when no row exists for kind=%s", async (kind) => {
    const { audit } = await seedAuditWithVendorService();
    const rendered = await getRenderedDeliverable(audit.id, kind);
    expect(rendered).toBeNull();
  });

  it("returns the kind discriminator on the rendered shape", async () => {
    const { audit, actor } = await seedAuditWithVendorService();
    await createDeliverableStub({ auditId: audit.id, kind: "checklist", actorId: actor.id });
    const rendered = await getRenderedDeliverable(audit.id, "checklist");
    expect(rendered?.kind).toBe<DeliverableKind>("checklist");
  });
});
