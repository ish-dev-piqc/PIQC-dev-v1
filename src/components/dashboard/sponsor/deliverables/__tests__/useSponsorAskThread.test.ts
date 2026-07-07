import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSponsorAskThread } from '../useSponsorAskThread';
import type { ExtendedMessage } from '../../../../../lib/supabase';

// =============================================================================
// useSponsorAskThread — per-protocol, in-session memory for the Sponsor Ask
// panel. A deliberate mirror of src/lib/site/useAskThread (see the hook header
// for why it isn't imported), so this suite pins the same contract — plus the
// one property that justifies the copy: a distinct storage NAMESPACE, so the
// sponsor thread never reads or writes the Site Ask's keys.
// =============================================================================

const key = (pid: string) => `piq-sponsor-ask-thread-v1:${pid}`;
const siteKey = (pid: string) => `piq-site-ask-thread-v1:${pid}`;

describe('useSponsorAskThread', () => {
  beforeEach(() => sessionStorage.clear());

  it('starts empty when no thread is stored', () => {
    const { result } = renderHook(() => useSponsorAskThread('p1'));
    expect(result.current[0]).toEqual([]);
  });

  it('persists messages to sessionStorage scoped per protocol', () => {
    const { result } = renderHook(() => useSponsorAskThread('p1'));
    act(() => result.current[1]([{ role: 'user', content: 'hi' }]));
    expect(JSON.parse(sessionStorage.getItem(key('p1'))!)).toEqual([
      { role: 'user', content: 'hi' },
    ]);
    expect(sessionStorage.getItem(key('p2'))).toBeNull();
  });

  it('is namespace-isolated from the Site Ask thread (never reads or writes its key)', () => {
    // A Site Ask thread for the SAME protocol must be invisible here…
    sessionStorage.setItem(siteKey('p1'), JSON.stringify([{ role: 'user', content: 'site q' }]));
    const { result } = renderHook(() => useSponsorAskThread('p1'));
    expect(result.current[0]).toEqual([]);

    // …and writing the sponsor thread must not touch the site key.
    act(() => result.current[1]([{ role: 'user', content: 'sponsor q' }]));
    expect(JSON.parse(sessionStorage.getItem(siteKey('p1'))!)).toEqual([
      { role: 'user', content: 'site q' },
    ]);
    expect(JSON.parse(sessionStorage.getItem(key('p1'))!)).toEqual([
      { role: 'user', content: 'sponsor q' },
    ]);
  });

  it('restores a stored thread on mount', () => {
    sessionStorage.setItem(key('p2'), JSON.stringify([{ role: 'assistant', content: 'hello' }]));
    const { result } = renderHook(() => useSponsorAskThread('p2'));
    expect(result.current[0]).toEqual([{ role: 'assistant', content: 'hello' }]);
  });

  it('swaps threads when the protocol id changes', () => {
    sessionStorage.setItem(key('a'), JSON.stringify([{ role: 'user', content: 'thread A' }]));
    sessionStorage.setItem(key('b'), JSON.stringify([{ role: 'user', content: 'thread B' }]));
    const { result, rerender } = renderHook(({ pid }) => useSponsorAskThread(pid), {
      initialProps: { pid: 'a' },
    });
    expect(result.current[0][0].content).toBe('thread A');
    rerender({ pid: 'b' });
    expect(result.current[0][0].content).toBe('thread B');
  });

  it('drops writes from a setter bound to a previous protocol (no cross-thread leak)', () => {
    sessionStorage.setItem(key('a'), JSON.stringify([{ role: 'user', content: 'A question' }]));
    const { result, rerender } = renderHook(({ pid }) => useSponsorAskThread(pid), {
      initialProps: { pid: 'a' },
    });
    const staleSetter = result.current[1]; // bound to protocol 'a'
    rerender({ pid: 'b' });
    expect(result.current[0]).toEqual([]);

    // A late token from the still-running 'a' stream must not land in 'b'.
    act(() => staleSetter([{ role: 'assistant', content: 'late token for A' }]));
    expect(result.current[0]).toEqual([]);
    expect(sessionStorage.getItem(key('b'))).toBeNull();
    expect(JSON.parse(sessionStorage.getItem(key('a'))!)).toEqual([
      { role: 'user', content: 'A question' },
    ]);

    act(() => result.current[1]([{ role: 'user', content: 'B question' }]));
    expect(result.current[0]).toEqual([{ role: 'user', content: 'B question' }]);
  });

  it('clear() empties the active thread and removes only its storage key', () => {
    sessionStorage.setItem(key('p1'), JSON.stringify([{ role: 'user', content: 'x' }]));
    sessionStorage.setItem(key('p2'), JSON.stringify([{ role: 'user', content: 'y' }]));
    const { result } = renderHook(() => useSponsorAskThread('p1'));
    expect(result.current[0]).toEqual([{ role: 'user', content: 'x' }]);

    act(() => result.current[2]()); // clear
    expect(result.current[0]).toEqual([]);
    expect(sessionStorage.getItem(key('p1'))).toBeNull();
    expect(JSON.parse(sessionStorage.getItem(key('p2'))!)).toEqual([
      { role: 'user', content: 'y' },
    ]);
  });

  it('persists ragStatus / ragError / sources but strips streaming and error', () => {
    const { result } = renderHook(() => useSponsorAskThread('p3'));
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
    const { result } = renderHook(() => useSponsorAskThread('p4'));
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
    const { result } = renderHook(() => useSponsorAskThread('p6'));
    act(() => result.current[1]([{ role: 'user', content: 'q' }]));

    const spy = vi.spyOn(Storage.prototype, 'setItem');
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
    const { result } = renderHook(() => useSponsorAskThread(null));
    act(() => result.current[1]([{ role: 'user', content: 'orphan' }]));
    expect(sessionStorage.length).toBe(0);
  });
});
