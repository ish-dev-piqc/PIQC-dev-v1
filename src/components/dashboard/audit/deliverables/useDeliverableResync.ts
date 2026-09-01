import { useEffect } from 'react';

// =============================================================================
// useDeliverableResync — the server-truth resync every deliverable tab runs
// (extracted from four identical copies in PreAuditDraftingWorkspace).
//
// updated_at in the deps: grounded generation mutates the row under the SAME
// id, so keying on id alone would leave stale local editor state — clicking
// Edit after a generation would show (and then Save would clobber it with)
// pre-generation content. The workspace disables Draft/Revise while editing,
// so the resync never fires over unsaved edits.
//
// While a save error is pending the resync SKIPS: the cache reverted to
// server truth (possibly null), but the editor's typed content is the one
// copy the user has — syncing over it is the data loss hardening PR-1
// removed. A failed save instead re-opens the editor over the preserved
// content (forceEdit).
// =============================================================================

export function useDeliverableResync(args: {
  deliverable: { id: string; updated_at: string } | null;
  saveError: string | null;
  /** Re-seed editor state (edit mode + fields) from the deliverable. */
  syncFromServer: () => void;
  /** Re-open the editor over the preserved content after a failed save. */
  forceEdit: () => void;
}): void {
  const { deliverable, saveError, syncFromServer, forceEdit } = args;

  useEffect(() => {
    if (saveError) return;
    syncFromServer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deliverable?.id, deliverable?.updated_at]);

  // A failed save re-opens the editor over the preserved content.
  useEffect(() => {
    if (saveError) forceEdit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveError]);
}
