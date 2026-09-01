import { supabase } from '../supabase';
import type { Result } from './auditCreationApi';
import type { AuditNoteObject } from '../../types/audit';

// =============================================================================
// Vendor-audit notes pad API — audit_note_objects CRUD for the AUDIT_CONDUCT
// stage (fieldwork lane, slice 1). Sibling of isaNotesApi: same table, the
// vendor RPCs in 20260908000000_audit_vendor_notes.sql (the applied ISA RPCs
// raise on vendor audits, so they are mirrored additively, not reused).
//
// Notes are working papers, not findings: editable and soft-deletable,
// unlike the append-only audit_workspace_entry_objects. Reads filter deleted
// notes; rows and deltas persist for the trail and for slice 2's candidate
// evidence chains (candidates cite note ids; accepted ones stamp
// promoted_entry_id). No domain at capture — the drafting engine proposes
// vendor_domain on candidates.
//
// fetchVendorNotes is the second copy of the 12-line RLS read (fetchIsaNotes
// is the first); consolidate to a shared read at the third caller.
// =============================================================================

export async function fetchVendorNotes(auditId: string): Promise<Result<AuditNoteObject[]>> {
  const { data, error } = await supabase
    .from('audit_note_objects')
    .select('*')
    .eq('audit_id', auditId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[vendorNotesApi] fetchVendorNotes error:', error);
    return { ok: false, error: error.message };
  }

  return { ok: true, data: (data ?? []) as AuditNoteObject[] };
}

export interface CreateVendorNoteInput {
  body: string;
  isPositive?: boolean;
}

export async function createVendorNote(
  auditId: string,
  input: CreateVendorNoteInput,
): Promise<Result<AuditNoteObject>> {
  const { data, error } = await supabase.rpc('audit_mode_create_vendor_note', {
    p_audit_id: auditId,
    p_body: input.body,
    p_is_positive: input.isPositive ?? false,
  });

  if (error) {
    console.error('[vendorNotesApi] createVendorNote error:', error);
    return { ok: false, error: error.message };
  }

  return { ok: true, data: data as AuditNoteObject };
}

/** Omitted fields are left alone (null → RPC COALESCE keeps the current value). */
export interface UpdateVendorNoteInput {
  body?: string;
  isPositive?: boolean;
}

export async function updateVendorNote(
  noteId: string,
  input: UpdateVendorNoteInput,
): Promise<Result<AuditNoteObject>> {
  const { data, error } = await supabase.rpc('audit_mode_update_vendor_note', {
    p_id: noteId,
    p_body: input.body ?? null,
    p_is_positive: input.isPositive ?? null,
  });

  if (error) {
    console.error('[vendorNotesApi] updateVendorNote error:', error);
    return { ok: false, error: error.message };
  }

  return { ok: true, data: data as AuditNoteObject };
}

export async function deleteVendorNote(noteId: string): Promise<Result<AuditNoteObject>> {
  const { data, error } = await supabase.rpc('audit_mode_delete_vendor_note', {
    p_id: noteId,
  });

  if (error) {
    console.error('[vendorNotesApi] deleteVendorNote error:', error);
    return { ok: false, error: error.message };
  }

  return { ok: true, data: data as AuditNoteObject };
}
