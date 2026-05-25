// =============================================================================
// pendingCheckout — persists a "user wanted to buy this" intent across the
// auth round trip.
//
// When an unauthenticated visitor clicks a Pricing CTA we don't have a
// session yet, so we can't call the stripe-checkout edge function. We stash
// the intended PlanKind in localStorage, send them to login, and on the way
// back Pricing.tsx auto-resumes the checkout call.
//
// localStorage (not sessionStorage) because magic-link auth lands in a
// potentially fresh tab where sessionStorage would be empty. The 15-minute
// TTL keeps stale intents from firing days later if the user signs in for
// some unrelated reason.
// =============================================================================

import type { PlanKind } from '../../stripe-config';

const STORAGE_KEY = 'piq-pending-checkout-v1';
const TTL_MS = 15 * 60 * 1000; // 15 minutes

interface PendingCheckout {
  kind: PlanKind;
  savedAt: number; // epoch ms
}

function isPlanKind(value: unknown): value is PlanKind {
  return (
    value === 'pilot' ||
    value === 'workspace_monthly' ||
    value === 'workspace_annual' ||
    value === 'addon_protocol' ||
    value === 'addon_seats' ||
    value === 'enterprise'
  );
}

function hasStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function setPendingCheckout(kind: PlanKind): void {
  if (!hasStorage()) return;
  const payload: PendingCheckout = { kind, savedAt: Date.now() };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Quota exceeded or storage disabled (private browsing in some browsers).
    // Swallow — the auto-resume is a UX nicety, not a correctness invariant.
  }
}

export function getPendingCheckout(): PlanKind | null {
  if (!hasStorage()) return null;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    clearPendingCheckout();
    return null;
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !('kind' in parsed) ||
    !('savedAt' in parsed)
  ) {
    clearPendingCheckout();
    return null;
  }

  const { kind, savedAt } = parsed as { kind: unknown; savedAt: unknown };
  if (!isPlanKind(kind) || typeof savedAt !== 'number') {
    clearPendingCheckout();
    return null;
  }

  if (Date.now() - savedAt > TTL_MS) {
    clearPendingCheckout();
    return null;
  }

  return kind;
}

export function clearPendingCheckout(): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Same swallow as setPendingCheckout — best-effort.
  }
}

// Exposed for unit tests only.
export const __pendingCheckoutInternals = {
  STORAGE_KEY,
  TTL_MS,
};
