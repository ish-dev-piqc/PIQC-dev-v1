import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDemoStore } from '../store';

const STORAGE_KEY = 'piq-demo-store-v1';

describe('createDemoStore', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it('seeds from fixtures when sessionStorage is empty', () => {
    const store = createDemoStore();
    const s = store.getState();
    expect(s.protocols.length).toBeGreaterThanOrEqual(3);
    expect(s.participants.length).toBeGreaterThanOrEqual(8);
    expect(s.visits.length).toBeGreaterThanOrEqual(10);
    expect(s.teamMembers.length).toBeGreaterThanOrEqual(5);
    expect(s.documents.length).toBeGreaterThanOrEqual(3);
    expect(s.visitTemplates.length).toBeGreaterThanOrEqual(10);
  });

  it('mutate updates state and notifies subscribers', () => {
    const store = createDemoStore();
    const listener = vi.fn();
    const unsub = store.subscribe(listener);

    store.mutate((s) => ({ ...s, participants: s.participants.slice(0, 1) }));

    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getState().participants.length).toBe(1);
    unsub();
  });

  it('mutate persists to sessionStorage', () => {
    const store = createDemoStore();
    store.mutate((s) => ({ ...s, participants: [] }));

    const raw = sessionStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.participants).toEqual([]);
  });

  it('subscribe returns an unsubscribe function', () => {
    const store = createDemoStore();
    const listener = vi.fn();
    const unsub = store.subscribe(listener);
    unsub();

    store.mutate((s) => ({ ...s }));
    expect(listener).not.toHaveBeenCalled();
  });

  it('rehydrates from sessionStorage on next instantiation', () => {
    const first = createDemoStore();
    first.mutate((s) => ({ ...s, participants: [] }));

    // New store reads the persisted state, not the fixtures.
    const second = createDemoStore();
    expect(second.getState().participants.length).toBe(0);
  });

  it('falls back to fixtures when sessionStorage payload is malformed', () => {
    sessionStorage.setItem(STORAGE_KEY, 'not json');
    const store = createDemoStore();
    expect(store.getState().protocols.length).toBeGreaterThanOrEqual(3);
  });

  it('falls back to fixtures when sessionStorage payload has wrong shape', () => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ protocols: 'oops' }));
    const store = createDemoStore();
    expect(Array.isArray(store.getState().protocols)).toBe(true);
    expect(store.getState().protocols.length).toBeGreaterThanOrEqual(3);
  });

  it('reset restores fixtures, clears sessionStorage, and notifies', () => {
    const store = createDemoStore();
    store.mutate((s) => ({ ...s, participants: [] }));
    expect(store.getState().participants.length).toBe(0);

    const listener = vi.fn();
    const unsub = store.subscribe(listener);

    store.reset();

    expect(store.getState().participants.length).toBeGreaterThanOrEqual(8);
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
  });
});
