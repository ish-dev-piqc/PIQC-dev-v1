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


// =============================================================================
// Org-workspaces entitlements (added 2026-05-29).
//
// Guest + viewer caps are per-protocol, not org-wide. Caps are constants
// here; the source of truth is the Stripe addon product's grant metadata
// once Roger creates the products. Until then, defaults documented in
// plans/kiara/org-workspaces.md.
// =============================================================================

/** Free guests allowed per protocol before the org needs addon_guest_seats. */
export const FREE_GUESTS_PER_PROTOCOL = 5;

/** Free read-only viewers allowed per protocol before the org needs addon_viewer_seats. */
export const FREE_VIEWERS_PER_PROTOCOL = 10;

/**
 * Whether the subscription includes a paid-overage addon of the given kind.
 *
 * v1 limitation: the `addon_guest_seats` and `addon_viewer_seats` Stripe
 * products don't exist yet (Roger creates them out-of-band). Until they do,
 * `Subscription` doesn't carry a count for them, so this returns `false`
 * for those kinds — meaning the cap-reached UI always blocks. That's the
 * fail-safe behaviour we want until billing wiring lands.
 *
 * When Roger creates the products:
 *   1. Stripe webhook populates new fields on Subscription (e.g.
 *      addonGuestSeats, addonViewerSeats — see useSubscription.ts).
 *   2. Update this function to read `subscription.addonGuestSeats > 0` etc.
 *   3. The InviteGuestModal cap-warning becomes an upsell instead of a block
 *      for orgs that hold the addon.
 */
function hasAddon(subscription: Subscription | null, kind: PlanKind): boolean {
  if (!subscription) return false;
  // Existing counted addons are already on the Subscription shape; extend
  // here as new ones get wired.
  if (kind === 'addon_seats') return (subscription.addonSeatPacks ?? 0) > 0;
  if (kind === 'addon_protocol') return (subscription.addonProtocols ?? 0) > 0;
  // addon_guest_seats / addon_viewer_seats: not yet wired on Subscription.
  // See TODO in this function's docstring.
  return false;
}

/**
 * Can the caller invite another guest to a protocol?
 * `currentFreeGuestCount` is the count of accepted, non-expired, non-paid guests
 * on the protocol (use countActiveFreeGuests from guestsAdapter).
 */
export function canInviteGuest(
  subscription: Subscription | null,
  currentFreeGuestCount: number,
): EntitlementDecision {
  if (currentFreeGuestCount < FREE_GUESTS_PER_PROTOCOL) {
    return { allowed: true };
  }
  if (hasAddon(subscription, 'addon_guest_seats')) {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason: `This protocol has reached ${FREE_GUESTS_PER_PROTOCOL} free guests. Add a guest seat pack to invite more.`,
    addonProductKind: 'addon_guest_seats',
  };
}

/**
 * Can the caller add another viewer-role member to a protocol?
 * `currentFreeViewerCount` is the count of viewer-role protocol_members.
 */
export function canInviteViewer(
  subscription: Subscription | null,
  currentFreeViewerCount: number,
): EntitlementDecision {
  if (currentFreeViewerCount < FREE_VIEWERS_PER_PROTOCOL) {
    return { allowed: true };
  }
  if (hasAddon(subscription, 'addon_viewer_seats')) {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason: `This protocol has reached ${FREE_VIEWERS_PER_PROTOCOL} free viewers. Add a viewer seat pack to invite more.`,
    addonProductKind: 'addon_viewer_seats',
  };
}

// =============================================================================
// Protocol Deliverable Engine gates (Sponsor + CRA surfaces).
//
// These gate on the REAL `org_entitlements` capability ('deliverable_engine'),
// not on a subscription tier. They previously checked `subscription.kind ===
// 'enterprise'` — a tier with no Stripe price that no code path can ever set,
// so the gate blocked 100% of users while the backend engine was live. The
// capability boolean comes from `useDeliverableEntitlement()`, which reads the
// SECURITY DEFINER `org_has_entitlement()` RPC (the same grant the backend
// RPC/RLS enforces — see #479's ENT-1/MAC-1). The server is the real boundary;
// these functions only decide whether to render the surface or the gate card.
//
// Merged 2026-08-02: CRA/Monitor Mode and Sponsor Mode's Protocol
// Intelligence surface were two gates over the exact same capability
// (`deliverable_engine`) with different copy — the workspaces themselves
// were merged into one (CraWorkspaceShell) the same day, so a single
// entitlement function replaces canUseSponsorMode/canUseCraMode. If a real
// pricing divergence between monitor/sponsor seats ever emerges, split this
// back into two functions then — don't speculatively couple/decouple ahead
// of an actual product decision.
// =============================================================================

/**
 * Can the caller use the (merged) Protocol Intelligence workspace?
 * `hasDeliverableEngine` is the org's `deliverable_engine` capability grant.
 */
export function canUseProtocolIntelligence(
  hasDeliverableEngine: boolean,
): EntitlementDecision {
  if (hasDeliverableEngine) {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason:
      'Protocol Intelligence isn’t enabled for this workspace yet. Talk to PIQC to turn it on.',
    addonProductKind: null,
  };
}
