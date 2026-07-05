// =============================================================================
// Site Mode — DB-mirror types shared by siteApi and SiteDataContext.
//
// These mirror the schema in:
//   - supabase/migrations/20260502000000_site_mode_schema.sql
//   - supabase/migrations/20260506000100_add_protocol_id_to_documents.sql
//   - supabase/migrations/20260507000000_protocol_visit_templates.sql
//   - supabase/migrations/20260508000100_visit_template_cross_references.sql
//
// The visit type matches the existing CalendarVisit shape (camelCase) so the
// calendar UI in TodayTab and the Reports table can keep their consumer code.
// Conversion from DB snake_case happens inside siteApi.fetchVisitsForProtocol.
// =============================================================================

export type ParticipantStatus =
  | 'SCREENING'
  | 'SCREEN_FAILURE'
  | 'ACTIVE'
  | 'COMPLETED'
  | 'WITHDRAWN';

export interface SiteParticipant {
  id: string;                       // participant_code, e.g. "P-0023" (NOT the UUID PK)
  uuid: string;                     // the actual UUID PK — used for FK joins
  protocol_id: string;              // protocol UUID
  status: ParticipantStatus;
  enrolled_at: string | null;
  current_study_day: number | null;
  next_visit_date: string | null;
  next_visit_name: string | null;
  assigned_coordinator: string;
  open_deviations: number;
  notes: string | null;
}

// -----------------------------------------------------------------------------
// Visits — camelCase shape that matches CalendarVisit so existing UIs keep
// compiling. participantId is the participant_code (e.g. "P-0023"), not the
// UUID, so existing calendar lookups still work.
// -----------------------------------------------------------------------------

export type VisitStatus =
  | 'scheduled'
  | 'completed'
  | 'missed'
  | 'deviation'
  | 'overdue'
  | 'closing_soon'
  | 'cancelled';

// One additional mention of a visit found elsewhere in the protocol's
// documents — populated by the ingest pipeline (Phase B) and rendered in
// the visit drawer's "From the protocol documents" section.
export interface VisitCrossReference {
  source_section: string;       // e.g. "7.4 Safety monitoring"
  snippet: string;              // verbatim passage that adds context
  page?: number;                // page number if known
  document_id?: string | null;  // source doc; null = same doc that produced SoA
  document_title?: string;      // populated frontend-side via documents join
}

// Reducto/SOTR extraction confidence for the visit, inherited from the source
// protocol_visit_templates row. Mirrors the SOTR confidence_state enum but kept
// site-local per mode-isolation (no cross-mode import).
export type SiteVisitConfidence = 'high' | 'medium' | 'low' | 'needs_review';

export interface SiteVisit {
  id: string;
  date: string;             // yyyy-mm-dd
  time?: string;            // "9:00 AM"; undefined = day-event
  protocolId: string;       // protocol UUID
  participantId: string;    // participant_code, e.g. "P-0023"
  studyDay: number;
  visitName: string;
  windowCloses?: string;    // ISO datetime
  status: VisitStatus;
  procedures?: string[];
  priorNote?: string;
  deviationReason?: string;
  crossReferences?: VisitCrossReference[];  // Phase B — joined from template
  // Extraction confidence from the source template (populated at ingest from
  // the matching SOTR visit item). undefined when no template/confidence.
  confidenceState?: SiteVisitConfidence;
}

// -----------------------------------------------------------------------------
// Team
// -----------------------------------------------------------------------------

export type TeamRole =
  | 'PI'
  | 'SUB_I'
  | 'COORDINATOR'
  | 'NURSE'
  | 'PHARMACIST'
  | 'MONITOR';

export type TeamMemberStatus = 'ACTIVE' | 'INACTIVE';

export interface SiteTeamMember {
  id: string;
  protocol_id: string;
  name: string;
  role: TeamRole;
  email: string;
  delegated_tasks: string[];
  certified_through: string;     // yyyy-mm-dd
  added_at: string;              // yyyy-mm-dd
  status: TeamMemberStatus;
  notes: string | null;
}

// -----------------------------------------------------------------------------
// Visit templates — extracted from protocol PDFs by Reducto and stored in
// protocol_visit_templates. Used to project visits onto the calendar via
// the materialize_protocol_visits RPC. cross_references is populated by
// Phase B (intra-doc + cross-doc fan-out).
// -----------------------------------------------------------------------------

export interface ProtocolVisitTemplate {
  id: string;
  protocol_id: string;
  visit_name: string;
  study_day: number;
  window_minus_days: number;
  window_plus_days: number;
  procedures: string[];
  source_document_id: string | null;
  cross_references: VisitCrossReference[];
}

export interface MaterializeResult {
  created: number;
  skipped_no_anchor: number;
}

// -----------------------------------------------------------------------------
// Documents — slim shape used by Protocol tab + Ask tab. The full documents
// row has more fields; we surface only what the UI needs.
// -----------------------------------------------------------------------------

export interface ProtocolDocument {
  id: string;
  title: string;
  source: string;
  filename: string | null;
  created_at: string;
  status: 'pending' | 'ready' | 'failed';
  error_message: string | null;
  extracted_fields: Record<string, unknown> | null;
}
