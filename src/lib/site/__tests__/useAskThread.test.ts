import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAskThread, type ExtendedMessage } from '../useAskThread';

// =============================================================================
// useAskThread — per-protocol, in-session memory for the Ask rail.
// Verifies: sessionStorage persistence, per-protocol scoping, thread swap on
// protocol change, transient-field stripping, and null-protocol no-op.
// =============================================================================

const key = (pid: string) => `piq-site-ask-thread-v1:${pid}`;

describe('useAskThread', () => {
  beforeEach(() => sessionStorage.clear());

  it('starts empty when no thread is stored', () => {
    const { result } = renderHook(() => useAskThread('p1'));
    expect(result.current[0]).toEqual([]);
  });

  it('persists messages to sessionStorage scoped per protocol', () => {
    const { result } = renderHook(() => useAskThread('p1'));
    act(() => result.current[1]([{ role: 'user', content: 'hi' }]));
    expect(JSON.parse(sessionStorage.getItem(key('p1'))!)).toEqual([
      { role: 'user', content: 'hi' },
    ]);
    // Other protocols are untouched.
    expect(sessionStorage.getItem(key('p2'))).toBeNull();
  });

  it('restores a stored thread on mount', () => {
    sessionStorage.setItem(key('p2'), JSON.stringify([{ role: 'assistant', content: 'hello' }]));
    const { result } = renderHook(() => useAskThread('p2'));
    expect(result.current[0]).toEqual([{ role: 'assistant', content: 'hello' }]);
  });

  it('swaps threads when the protocol id changes', () => {
    sessionStorage.setItem(key('a'), JSON.stringify([{ role: 'user', content: 'thread A' }]));
    sessionStorage.setItem(key('b'), JSON.stringify([{ role: 'user', content: 'thread B' }]));
    const { result, rerender } = renderHook(({ pid }) => useAskThread(pid), {
      initialProps: { pid: 'a' },
    });
    expect(result.current[0][0].content).toBe('thread A');
    rerender({ pid: 'b' });
    expect(result.current[0][0].content).toBe('thread B');
  });

  it('strips transient streaming / ragStatus / ragError fields before persisting', () => {
    const { result } = renderHook(() => useAskThread('p3'));
    const msgs: ExtendedMessage[] = [
      { role: 'assistant', content: 'done', streaming: false, ragStatus: 'found', ragError: 'x' },
    ];
    act(() => result.current[1](msgs));
    expect(JSON.parse(sessionStorage.getItem(key('p3'))!)).toEqual([
      { role: 'assistant', content: 'done' },
    ]);
  });

  it('drops still-streaming messages from the persisted thread', () => {
    const { result } = renderHook(() => useAskThread('p4'));
    act(() =>
      result.current[1]([
        { role: 'user', content: 'q' },
        { role: 'assistant', content: 'partial', streaming: true },
      ]),
    );
    expect(JSON.parse(sessionStorage.getItem(key('p4'))!)).toEqual([{ role: 'user', content: 'q' }]);
  });

  it('does not read or write storage when protocolId is null', () => {
    const { result } = renderHook(() => useAskThread(null));
    act(() => result.current[1]([{ role: 'user', content: 'orphan' }]));
    expect(sessionStorage.length).toBe(0);
  });
});
