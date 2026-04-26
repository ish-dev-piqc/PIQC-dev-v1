// =============================================================================
// State history delta writer
//
// All mutations to tracked objects must call writeDelta inside the same
// Prisma transaction as the mutation. This is the only place StateHistoryDelta
// rows are created — do not write deltas directly in route handlers.
//
// The table is append-only. Never call update or delete on it.
// =============================================================================

import { Prisma, TrackedObjectType } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type PrismaTransactionClient = Prisma.TransactionClient;

// A single field's before/after values.
export type FieldDelta = {
  from: unknown;
  to: unknown;
};

// The changed_fields shape stored in the Json column.
export type ChangedFields = Record<string, FieldDelta>;

// Computes changed fields by diffing two plain objects.
// Only includes keys where the value changed. Handles primitive comparison.
// For arrays (e.g. vendorDependencyFlags), does a JSON stringify comparison.
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>
): ChangedFields {
  const delta: ChangedFields = {};
  for (const key of Object.keys(after) as Array<keyof T>) {
    const prev = before[key];
    const next = after[key];
    const prevStr = JSON.stringify(prev);
    const nextStr = JSON.stringify(next);
    if (prevStr !== nextStr) {
      delta[key as string] = { from: prev, to: next };
    }
  }
  return delta;
}

// Reads the history for a single tracked object, newest-first.
// Capped at 100 entries — GxP objects rarely exceed this; prevents runaway reads.
// actorId is NOT used to filter — every auditor can see the full audit trail.
export interface HistoryEntry {
  id: string;
  changedFields: ChangedFields;
  actorName: string;
  reason: string | null;
  createdAt: string; // ISO string — safe for client components
}

export async function getObjectHistory(
  objectType: TrackedObjectType,
  objectId: string,
): Promise<HistoryEntry[]> {
  const rows = await prisma.stateHistoryDelta.findMany({
    where:   { objectType, objectId },
    include: { actor: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take:    100,
  });
  return rows.map((r) => ({
    id:            r.id,
    changedFields: r.changedFields as ChangedFields,
    actorName:     r.actor.name,
    reason:        r.reason,
    createdAt:     r.createdAt.toISOString(),
  }));
}

// Writes a StateHistoryDelta row inside an existing Prisma transaction.
// Call this immediately after the mutation that produced the changed fields.
// If changedFields is empty (no actual change), skips the write.
export async function writeDelta(
  tx: PrismaTransactionClient,
  objectType: TrackedObjectType,
  objectId: string,
  changedFields: ChangedFields,
  actorId: string,
  reason?: string
): Promise<void> {
  if (Object.keys(changedFields).length === 0) return;

  await tx.stateHistoryDelta.create({
    data: {
      objectType,
      objectId,
      changedFields,
      actorId,
      reason,
    },
  });
}
