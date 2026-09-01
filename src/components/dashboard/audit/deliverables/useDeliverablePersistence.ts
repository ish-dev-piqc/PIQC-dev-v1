import { useCallback, useState } from 'react';
import type { DeliverableApprovalStatus } from '../../../../types/audit';
import type { DeliverableApproveResult } from '../../../../lib/audit/preAuditApi';

// =============================================================================
// useDeliverablePersistence — one persist flow for every deliverable tab
// (the 4th copy was the rule-of-three moment; extracted in PR-6 so PR-D4's
// 6th kind doesn't become the 7th).
//
// Persist honesty (hardening PR-1). A failed save used to be console-only:
// the optimistic row reverted and typed content vanished. Each tab carries
// its own save state — a failed save banners, keeps the user's content, and
// blocks Approve until it clears (Approve over a cache/server mismatch is
// the CAS-latch hole the old silent revert was guarding).
//
// The DATA-GUARDING states (save errors and the unsaved drafts they protect)
// are keyed by auditId like the bundle cache — async completions write under
// their captured audit, so a slow response can never leak into another
// audit's view, and switching audits doesn't discard a preserved draft. The
// transient UX states (saving spinners, approve/stale notices) stay flat;
// the surface resets them on audit switch via resetTransient().
//
// Approval transitions CAS on the row version the reviewer saw — the latch
// attests to exactly the content they reviewed. An upsert that FAILS (null;
// the API layer already logged it) REVERTS the optimistic row: the UI must
// never show unsaved content as saved, because a later Approve would
// CAS-pass against the unchanged server row and latch content the reviewer
// never wrote. The revert is the CACHE's story only — the tab keeps the
// typed content in its editor (its resync skips while a save error is
// pending) and the banner + blocked Approve say so.
//
// Typing note: internal state is string-keyed (TS widens generic computed
// keys in object literals, so per-K mapped state wouldn't compile). The
// RETURN type narrows every map back to the bundle's keys, so consumer
// reads are typo-checked; persistDeliverable ties `key` to that key's own
// row type, which is what makes unsavedDraftFor's narrowing cast sound.
// =============================================================================

/** Structural floor every persistable deliverable row shares. */
interface PersistableDeliverable {
  id: string;
  approval_status: DeliverableApprovalStatus;
  updated_at: string;
}

/** Any bundle-shaped map: every member is a persistable row or null. A
 *  mapped-type constraint (`B extends BundleShape<B>`) so plain interfaces
 *  qualify — an interface never extends `Record<string, …>`. */
type BundleShape<B> = { [K in keyof B]: PersistableDeliverable | null };

interface UseDeliverablePersistenceArgs<B extends BundleShape<B>> {
  auditId: string;
  /** Fold one field into the LATEST cache state — must be a functional
   *  per-field merge (see the workspace's setBundleField) so interleaved
   *  persists can't clobber each other. */
  setField: (key: keyof B & string, value: B[keyof B] | null) => void;
  /** THE refetch path — never throws; false = refresh failed. */
  refresh: () => Promise<boolean>;
  /** Console tag, e.g. 'PreAuditDraftingWorkspace' — keeps log lines
   *  attributable to the surface, not this shared hook. */
  logTag: string;
}

interface DeliverablePersistence<B extends BundleShape<B>> {
  // Bundle-keyed on the way out (the typo-proofing the pre-extraction
  // TabKey-typed state gave the workspace's twenty read sites).
  savingTabs: Partial<Record<keyof B & string, boolean>>;
  persistErrors: Record<string, Partial<Record<keyof B & string, string>>>;
  approveErrors: Partial<Record<keyof B & string, string>>;
  staleReloadNotices: Partial<Record<keyof B & string, string>>;
  /** The exact row a failed upsert could not save, per audit — the one copy
   *  of the user's content. Survives tab unmounts and audit switches. */
  unsavedDraftFor: <K extends keyof B & string>(
    aid: string,
    key: K,
  ) => NonNullable<B[K]> | null;
  persistDeliverable: <K extends keyof B & string>(
    key: K,
    noun: string,
    prev: NonNullable<B[K]> | null,
    next: NonNullable<B[K]> | null,
    ops: {
      upsert: (n: NonNullable<B[K]>) => Promise<NonNullable<B[K]> | null>;
      approve: (p: NonNullable<B[K]>) => Promise<DeliverableApproveResult<NonNullable<B[K]>>>;
    },
  ) => Promise<void>;
  /** An explicit discard (Cancel) or a resolved retry clears both the error
   *  and the draft it was protecting — always together. */
  dismissSaveError: (key: keyof B & string) => void;
  /** Audit-switch reset of the transient UX states only. Stable identity. */
  resetTransient: () => void;
}

export function useDeliverablePersistence<B extends BundleShape<B>>({
  auditId,
  setField,
  refresh,
  logTag,
}: UseDeliverablePersistenceArgs<B>): DeliverablePersistence<B> {
  type Key = keyof B & string;

  const [savingTabs, setSavingTabs] = useState<Partial<Record<string, boolean>>>({});
  // Two failure channels, deliberately separate: a failed UPSERT means we
  // hold the only copy of the content (banner + editor re-opens over the
  // preserved draft + Approve blocks until it clears); a failed APPROVE
  // means the content is safely saved and only the latch didn't move
  // (banner only — cache matches server, so Approve stays retryable).
  const [persistErrors, setPersistErrors] = useState<
    Record<string, Partial<Record<string, string>>>
  >({});
  // The exact `next` a failed upsert could not save. Tab components seed
  // their editors from this on (re)mount — the tab unmounting on a tab
  // switch must not destroy the content the banner promises is preserved.
  const [unsavedDrafts, setUnsavedDrafts] = useState<
    Record<string, Partial<Record<string, PersistableDeliverable>>>
  >({});
  const [approveErrors, setApproveErrors] = useState<Partial<Record<string, string>>>({});
  // Informational, never blocking: the approve CAS rejected because the row
  // changed since review; server truth was reloaded for re-review.
  const [staleReloadNotices, setStaleReloadNotices] = useState<
    Partial<Record<string, string>>
  >({});

  // NOTE for future readers: the error/draft maps use value-writes of
  // `undefined` to clear keys — reads must be value-based (`m[k] ?? null`),
  // never key-based (`'k' in m` / Object.keys length).
  const setTabPersistError = (aid: string, tab: Key, msg: string | undefined) =>
    setPersistErrors((p) => ({ ...p, [aid]: { ...p[aid], [tab]: msg } }));
  const setTabUnsavedDraft = (
    aid: string,
    tab: Key,
    draft: PersistableDeliverable | undefined,
  ) =>
    setUnsavedDrafts((p) => ({ ...p, [aid]: { ...p[aid], [tab]: draft } }));

  // Sound because persistDeliverable's signature ties `key` to that key's
  // own row type — only a `NonNullable<B[K]>` can ever be stored under K.
  // The cast just recovers the precision the string-keyed storage dropped.
  const unsavedDraftFor = <K extends Key>(aid: string, key: K): NonNullable<B[K]> | null =>
    (unsavedDrafts[aid]?.[key] ?? null) as NonNullable<B[K]> | null;

  // Approve rejected by the server's compare-and-swap: the deliverable
  // (STALE_CONTENT), or the derived basis it is built from (STALE_BASIS —
  // a kind with a basis pin, e.g. the findings report's entry set), changed
  // since this tab rendered it. Reload server truth so the reviewer looks at
  // the current state — invitational, not an alarm, and SAID OUT LOUD via
  // the per-tab notice (an unexplained content swap read as "Approve did
  // nothing"). Never throws — a failed reload must not fall into the persist
  // catch and masquerade as a save failure.
  const reloadAfterStaleApprove = async (
    key: Key,
    scope: string,
    error: string,
    hint: 'STALE_CONTENT' | 'STALE_BASIS',
  ) => {
    console.error(`[${logTag}] ${scope} rejected:`, error);
    const refreshed = await refresh();
    const what =
      hint === 'STALE_BASIS'
        ? 'What this deliverable is built from changed since you reviewed it'
        : 'This deliverable changed since you reviewed it';
    setStaleReloadNotices((prev) => ({
      ...prev,
      [key]: refreshed
        ? `${what} — the latest version is shown. Re-review and approve.`
        : `${what}, and reloading it failed — reload the page to see the latest before approving.`,
    }));
  };

  // The row type is INDEXED BY the key (NonNullable<B[K]>), not a free
  // union member: passing key 'agenda' with a letter row (and its letter
  // upsert) is a compile error, not a runtime cache corruption. Every
  // member carries the id/approval_status/updated_at the flow relies on.
  async function persistDeliverable<K extends Key>(
    key: K,
    noun: string,
    prev: NonNullable<B[K]> | null,
    next: NonNullable<B[K]> | null,
    ops: {
      upsert: (n: NonNullable<B[K]>) => Promise<NonNullable<B[K]> | null>;
      approve: (p: NonNullable<B[K]>) => Promise<DeliverableApproveResult<NonNullable<B[K]>>>;
    },
  ): Promise<void> {
    if (!next) return;
    setSavingTabs((p) => ({ ...p, [key]: true }));
    setTabPersistError(auditId, key, undefined);
    setTabUnsavedDraft(auditId, key, undefined);
    setApproveErrors((p) => ({ ...p, [key]: undefined }));
    setStaleReloadNotices((p) => ({ ...p, [key]: undefined }));
    try {
      const isApprovalTransition =
        !!prev &&
        prev.approval_status !== 'APPROVED' &&
        next.approval_status === 'APPROVED';

      if (prev && isApprovalTransition) {
        const result = await ops.approve(prev);
        const hint = result.ok ? undefined : result.errorHint;
        if (result.ok) {
          setField(key, result.data);
        } else if (hint === 'STALE_CONTENT' || hint === 'STALE_BASIS') {
          // A real CAS miss: the row (or its derived basis) moved on. Reload
          // is correct here — and ONLY here. Routing every failure through it
          // made a missing RPC look like "Approve did nothing".
          await reloadAfterStaleApprove(key, `approve${noun}`, result.error, hint);
        } else {
          console.error(`[${logTag}] approve${noun} failed:`, result.error);
          setField(key, prev); // roll back the optimistic APPROVED flip
          setApproveErrors((p) => ({
            ...p,
            [key]: `Approval didn't save — nothing was approved; your content is unaffected. Retry when ready. (${result.error})`,
          }));
        }
        return;
      }

      const persisted = await ops.upsert(next);
      if (persisted) {
        setField(key, persisted);
      } else {
        // Error + draft BEFORE revert: the tab's resync guard must already
        // see the error when the cache write lands, or an unbatched render
        // between the two would sync the editor over the user's only copy.
        // The draft stash is what survives a tab switch (tabs unmount).
        setTabPersistError(
          auditId,
          key,
          'Save failed — your text is preserved in the editor. Retry, or Cancel to discard it.',
        );
        setTabUnsavedDraft(auditId, key, next);
        setField(key, prev);
      }
    } catch (err) {
      console.error(`[${logTag}] persist${noun} error:`, err);
      setTabPersistError(
        auditId,
        key,
        'Save failed — your text is preserved in the editor. Retry, or Cancel to discard it.',
      );
      setTabUnsavedDraft(auditId, key, next);
      setField(key, prev);
    } finally {
      setSavingTabs((p) => ({ ...p, [key]: false }));
    }
  }

  const dismissSaveError = (key: Key) => {
    setTabPersistError(auditId, key, undefined);
    setTabUnsavedDraft(auditId, key, undefined);
  };

  // Only the TRANSIENT UX states reset on audit switch. The data-guarding
  // states (persistErrors, unsavedDrafts) are keyed by audit and
  // deliberately survive it — a preserved draft must still be there when
  // the auditor comes back.
  const resetTransient = useCallback(() => {
    setSavingTabs({});
    setApproveErrors({});
    setStaleReloadNotices({});
  }, []);

  return {
    savingTabs,
    persistErrors,
    approveErrors,
    staleReloadNotices,
    unsavedDraftFor,
    persistDeliverable,
    dismissSaveError,
    resetTransient,
  };
}
