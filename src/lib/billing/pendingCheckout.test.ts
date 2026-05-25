import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPendingCheckout,
  getPendingCheckout,
  setPendingCheckout,
  __pendingCheckoutInternals,
} from './pendingCheckout';

const { STORAGE_KEY, TTL_MS } = __pendingCheckoutInternals;

describe('pendingCheckout', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useRealTimers();
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.useRealTimers();
  });

  it('round-trips a PlanKind through set → get', () => {
    setPendingCheckout('pilot');
    expect(getPendingCheckout()).toBe('pilot');
  });

  it('returns null when nothing has been set', () => {
    expect(getPendingCheckout()).toBeNull();
  });

  it('clear() wipes the pending intent', () => {
    setPendingCheckout('workspace_monthly');
    clearPendingCheckout();
    expect(getPendingCheckout()).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('returns null and self-clears after the TTL expires', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-24T12:00:00Z'));
    setPendingCheckout('workspace_annual');

    // 1ms past the TTL.
    vi.setSystemTime(new Date(Date.now() + TTL_MS + 1));

    expect(getPendingCheckout()).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('still returns the intent right before the TTL boundary', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-24T12:00:00Z'));
    setPendingCheckout('pilot');

    // 1ms before expiry.
    vi.setSystemTime(new Date(Date.now() + TTL_MS - 1));

    expect(getPendingCheckout()).toBe('pilot');
  });

  it('discards corrupt JSON and returns null', () => {
    window.localStorage.setItem(STORAGE_KEY, '{not json');
    expect(getPendingCheckout()).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('discards payloads with an unknown PlanKind', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ kind: 'not_a_real_plan', savedAt: Date.now() }),
    );
    expect(getPendingCheckout()).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('discards payloads missing required fields', () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ kind: 'pilot' }));
    expect(getPendingCheckout()).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('overwrites the previous intent on a fresh set', () => {
    setPendingCheckout('pilot');
    setPendingCheckout('workspace_annual');
    expect(getPendingCheckout()).toBe('workspace_annual');
  });
});
