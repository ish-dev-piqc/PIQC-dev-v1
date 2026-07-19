import { supabase } from '../supabase';
import type { Result } from './auditCreationApi';
import type { AuditNoteObject, IsaDomain } from '../../types/audit';

// =============================================================================
// ISA notes pad API — audit_note_objects CRUD for the ISA_CONDUCT stage.
//
// All mutations route through Postgres RPCs in
// supabase/migrations/20260723000100_audit_mode_isa_notes_rpcs.sql. Each RPC
// mutates + writes a state_history_delta atomically. RLS scopes reads/writes
// to audits where the signed-in user is lead_auditor_id.
//
// Notes are working papers, not findings: editable and soft-deletable
// (deleted_at), unlike the append-only audit_workspace_entry_objects. Reads
// filter deleted notes; the rows and their deltas persist for the trail and
// for S2's evidence chains (findings will cite note ids).
// =============================================================================

export async function fetchIsaNotes(auditId: string): Promise<Result<AuditNoteObject[]>> {
  const { data, error } = await supabase
    .from('audit_note_objects')
    .select('*')
    .eq('audit_id', auditId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[isaNotesApi] fetchIsaNotes error:', error);
    return { ok: false, error: error.message };
  }

  return { ok: true, data: (data ?? []) as AuditNoteObject[] };
}

export interface CreateIsaNoteInput {
  body: string;
  isaDomain?: IsaDomain | null;
  isPositive?: boolean;
}

export async function createIsaNote(
  auditId: string,
  input: CreateIsaNoteInput,
): Promise<Result<AuditNoteObject>> {
  const { data, error } = await supabase.rpc('audit_mode_create_isa_note', {
    p_audit_id: auditId,
    p_body: input.body,
    p_isa_domain: input.isaDomain ?? null,
    p_is_positive: input.isPositive ?? false,
  });

  if (error) {
    console.error('[isaNotesApi] createIsaNote error:', error);
    return { ok: false, error: error.message };
  }

  return { ok: true, data: data as AuditNoteObject };
}

export interface UpdateIsaNoteInput {
  body?: string;
  /** Set to tag/re-tag; use clearIsaDomain to remove the tag. */
  isaDomain?: IsaDomain;
  clearIsaDomain?: boolean;
  isPositive?: boolean;
}

export async function updateIsaNote(
  noteId: string,
  input: UpdateIsaNoteInput,
): Promise<Result<AuditNoteObject>> {
  const { data, error } = await supabase.rpc('audit_mode_update_isa_note', {
    p_id: noteId,
    p_body: input.body ?? null,
    p_isa_domain: input.isaDomain ?? null,
    p_clear_isa_domain: input.clearIsaDomain ?? false,
    p_is_positive: input.isPositive ?? null,
  });

  if (error) {
    console.error('[isaNotesApi] updateIsaNote error:', error);
    return { ok: false, error: error.message };
  }

  return { ok: true, data: data as AuditNoteObject };
}

export async function deleteIsaNote(noteId: string): Promise<Result<AuditNoteObject>> {
  const { data, error } = await supabase.rpc('audit_mode_delete_isa_note', {
    p_id: noteId,
  });

  if (error) {
    console.error('[isaNotesApi] deleteIsaNote error:', error);
    return { ok: false, error: error.message };
  }

  return { ok: true, data: data as AuditNoteObject };
}
