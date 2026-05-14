// =============================================================================
// Entitlements — what is this workspace allowed to do based on its plan?
//
// Pure functions over a Subscription. No React, no fetches. Consumers:
//
//   canInviteUser(sub, currentUserCount)
//     Hard gate on the invite-user surface. Returns { allowed, reason?, addonProductKind? }
//     so the UI can either invite, or surface "Buy a seat pack" CTA pointing
//     at the right priceId.
//
//   canAddProtocol(sub, currentProtocolCount)
//     Same shape, gating the add-protocol surface.
//
//   pilotStatus(sub) → 'none' | 'active' | 'expiring_soon' | 'expired'
//     For Dashboard banner / Pricing CTA states.
//
// Per spec's Founder Push Rule, these gates only fire on the *invite* and
// *add protocol* surfaces. Clinical workflows are never blocked by an
// entitlement check.
//
// NOTE: pilot-expiry enforcement is frontend-only right now (decision B(i)
// in the Stripe integration plan). A server-side RPC check on protected
// surfaces is queued for after early launch — see plan.md "Server-side
// entitlement enforcement" TODO.
// =============================================================================

import type { Subscription } from '../hooks/useSubscription';
import type { PlanKind } from '../stripe-config';

export type EntitlementDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason: string;
      // If set, the UI should offer the "Buy this add-on" CTA pointing at
      // the matching catalog product. `null` means there's no add-on path
      // (e.g. pilot can't be upgraded with add-ons, must convert to a plan).
      addonProductKind: PlanKind | null;
    };

export function canInviteUser(
  subscription: Subscription | null,
  currentUserCount: number,
): EntitlementDecision {
  if (!subscription || subscription.kind === null) {
    return {
      allowed: false,
      reason: 'No active plan. Start a Workspace to invite users.',
      addonProductKind: 'workspace_monthly',
    };
  }
  if (subscription.kind === 'pilot') {
    if (currentUserCount < subscription.totalUsers) return { allowed: true };
    return {
      allowed: false,
      reason: `Pilot plan includes ${subscription.totalUsers} users. Upgrade to a Workspace to invite more.`,
      addonProductKind: 'workspace_monthly',
    };
  }
  if (currentUserCount < subscription.totalUsers) return { allowed: true };
  return {
    allowed: false,
    reason: `Your plan includes ${subscription.totalUsers} users. Add a seat pack to invite more.`,
    addonProductKind: 'addon_seats',
  };
}

export function canAddProtocol(
  subscription: Subscription | null,
  currentProtocolCount: number,
): EntitlementDecision {
  if (!subscription || subscription.kind === null) {
    return {
      allowed: false,
      reason: 'No active plan. Start a Workspace to add protocols.',
      addonProductKind: 'workspace_monthly',
    };
  }
  if (subscription.kind === 'pilot') {
    if (currentProtocolCount < subscription.totalProtocols) return { allowed: true };
    return {
      allowed: false,
      reason: 'Pilot plan includes 1 protocol. Upgrade to a Workspace to add more.',
      addonProductKind: 'workspace_monthly',
    };
  }
  if (currentProtocolCount < subscription.totalProtocols) return { allowed: true };
  return {
    allowed: false,
    reason: `Your plan includes ${subscription.totalProtocols} active protocols. Add a protocol pack to add another.`,
    addonProductKind: 'addon_protocol',
  };
}

export type PilotStatus = 'none' | 'active' | 'expiring_soon' | 'expired';

const EXPIRING_SOON_DAYS = 7;

export function pilotStatus(subscription: Subscription | null): PilotStatus {
  if (!subscription || subscription.kind !== 'pilot') return 'none';
  if (!subscription.pilotExpiresAt) return 'active';

  const expires = new Date(subscription.pilotExpiresAt).getTime();
  const now = Date.now();
  if (Number.isNaN(expires)) return 'active';

  if (expires <= now) return 'expired';
  const daysLeft = Math.ceil((expires - now) / (24 * 60 * 60 * 1000));
  if (daysLeft <= EXPIRING_SOON_DAYS) return 'expiring_soon';
  return 'active';
}

// Convenience for banners: days remaining on the pilot, clamped at 0.
export function pilotDaysRemaining(subscription: Subscription | null): number {
  if (!subscription || subscription.kind !== 'pilot' || !subscription.pilotExpiresAt) {
    return 0;
  }
  const expires = new Date(subscription.pilotExpiresAt).getTime();
  if (Number.isNaN(expires)) return 0;
  const diff = expires - Date.now();
  return Math.max(0, Math.ceil(diff / (24 * 60 * 60 * 1000)));
}
