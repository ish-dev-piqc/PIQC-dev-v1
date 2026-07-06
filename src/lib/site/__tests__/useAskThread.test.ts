import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAskThread, type ExtendedMessage } from '../useAskThread';

// =============================================================================
// useAskThread — per-protocol, in-session memory for the Ask bubble.
// Verifies: sessionStorage persistence, per-protocol scoping, thread swap on
// protocol change, the cross-thread guarded setter, clear(), the settled-facts
// persistence rule, write suppression, and null-protocol no-op.
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

  it('drops writes from a setter bound to a previous protocol (no cross-thread leak)', () => {
    sessionStorage.setItem(key('a'), JSON.stringify([{ role: 'user', content: 'A question' }]));
    const { result, rerender } = renderHook(({ pid }) => useAskThread(pid), {
      initialProps: { pid: 'a' },
    });
    const staleSetter = result.current[1]; // bound to protocol 'a'
    rerender({ pid: 'b' });
    expect(result.current[0]).toEqual([]); // b starts empty

    // A late token from the still-running 'a' stream must not land in 'b'.
    act(() => staleSetter([{ role: 'assistant', content: 'late token for A' }]));
    expect(result.current[0]).toEqual([]);
    expect(sessionStorage.getItem(key('b'))).toBeNull();
    // ...and 'a' keeps its unanswered question.
    expect(JSON.parse(sessionStorage.getItem(key('a'))!)).toEqual([
      { role: 'user', content: 'A question' },
    ]);

    // The current setter still works.
    act(() => result.current[1]([{ role: 'user', content: 'B question' }]));
    expect(result.current[0]).toEqual([{ role: 'user', content: 'B question' }]);
  });

  it('clear() empties the active thread and removes only its storage key', () => {
    sessionStorage.setItem(key('p1'), JSON.stringify([{ role: 'user', content: 'x' }]));
    sessionStorage.setItem(key('p2'), JSON.stringify([{ role: 'user', content: 'y' }]));
    const { result } = renderHook(() => useAskThread('p1'));
    expect(result.current[0]).toEqual([{ role: 'user', content: 'x' }]);

    act(() => result.current[2]()); // clear
    expect(result.current[0]).toEqual([]);
    expect(sessionStorage.getItem(key('p1'))).toBeNull();
    expect(JSON.parse(sessionStorage.getItem(key('p2'))!)).toEqual([
      { role: 'user', content: 'y' },
    ]);
  });

  it('persists ragStatus / ragError / sources but strips streaming and error', () => {
    const { result } = renderHook(() => useAskThread('p3'));
    const source = {
      n: 1,
      document_id: 'd',
      document_title: 't',
      page_start: null,
      page_end: null,
      section_heading: null,
      chunk_preview: 'p',
    };
    const msgs: ExtendedMessage[] = [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'done', streaming: false, ragStatus: 'found', ragError: '', sources: [source] },
    ];
    act(() => result.current[1](msgs));
    expect(JSON.parse(sessionStorage.getItem(key('p3'))!)).toEqual([
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'done', ragStatus: 'found', ragError: '', sources: [source] },
    ]);
  });

  it('drops still-streaming and failed-send messages from the persisted thread', () => {
    const { result } = renderHook(() => useAskThread('p4'));
    act(() =>
      result.current[1]([
        { role: 'user', content: 'q' },
        { role: 'assistant', content: 'partial', streaming: true },
        { role: 'assistant', content: '', error: 'failed' },
      ]),
    );
    expect(JSON.parse(sessionStorage.getItem(key('p4'))!)).toEqual([{ role: 'user', content: 'q' }]);
  });

  it('does not re-write storage when the persisted thread is unchanged', () => {
    const { result } = renderHook(() => useAskThread('p6'));
    act(() => result.current[1]([{ role: 'user', content: 'q' }]));

    const spy = vi.spyOn(Storage.prototype, 'setItem');
    // Appending a still-streaming assistant doesn't change the persisted prefix.
    act(() =>
      result.current[1]([
        { role: 'user', content: 'q' },
        { role: 'assistant', content: 'partial', streaming: true },
      ]),
    );
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('does not read or write storage when protocolId is null', () => {
    const { result } = renderHook(() => useAskThread(null));
    act(() => result.current[1]([{ role: 'user', content: 'orphan' }]));
    expect(sessionStorage.length).toBe(0);
  });
});
