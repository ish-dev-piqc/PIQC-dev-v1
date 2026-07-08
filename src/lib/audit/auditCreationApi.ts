import { supabase } from '../supabase';
import type {
  AuditStage,
  AuditStatus,
  AuditType,
  AuditWorkflowType,
  ClinicalTrialPhase,
} from '../../types/audit';

// =============================================================================
// Audit Mode onramp API — vendor + protocol + audit creation.
//
// Surfaces the engine to audit contractors without requiring them to enter
// Site Mode. Each call wraps a single SECURITY DEFINER RPC defined in
// supabase/migrations/20260515030000_audit_mode_onramp_rpcs.sql.
//
// PDF ingestion goes through the shared Reducto edge function at
// /functions/v1/ingest. uploadProtocolPdf() is the audit-mode-native
// wrapper — kept here (not borrowed from KnowledgeBase) so the upload
// surface owns its product framing.
// =============================================================================

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

// Read/create results carry the failure reason instead of collapsing it to [] /
// null, so a caller can tell a genuine empty list from a DB error and surface
// the RPC's specific message. Defined locally: mode isolation forbids importing
// Site Mode's Result<T>.
export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface VendorRow {
  id: string;
  name: string;
  legal_name: string | null;
  country: string;
  website: string | null;
}

export interface SiteRow {
  id: string;
  name: string;
  site_number: string | null;
  principal_investigator: string | null;
  country: string;
}

export interface AuditorProtocolRow {
  id: string;                          // protocols.id
  study_number: string | null;
  title: string;
  sponsor: string;
  latest_version_id: string;           // protocol_versions.id (most recent ACTIVE)
  clinical_trial_phase: ClinicalTrialPhase;
}

export interface ProtocolVersionRow {
  id: string;
  protocol_id: string;
  version_number: number;
  status: string;
  clinical_trial_phase: ClinicalTrialPhase;
}

export interface AuditRow {
  id: string;
  audit_name: string;
  audit_type: AuditType;
  workflow_type: AuditWorkflowType;
  status: AuditStatus;
  current_stage: AuditStage;
  vendor_id: string | null;
  site_id: string | null;
  protocol_id: string;
  protocol_version_id: string;
  scheduled_date: string | null;
  lead_auditor_id: string;
}

// -----------------------------------------------------------------------------
// Vendor reads + creates
// -----------------------------------------------------------------------------

export async function listVendors(): Promise<Result<VendorRow[]>> {
  const { data, error } = await supabase
    .from('vendors')
    .select('id, name, legal_name, country, website')
    .order('name', { ascending: true });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? []) as VendorRow[] };
}

export async function createVendor(input: {
  name: string;
  country: string;
  legalName?: string;
  website?: string;
}): Promise<VendorRow | null> {
  const { data, error } = await supabase.rpc('audit_mode_create_vendor', {
    p_name: input.name,
    p_country: input.country,
    p_legal_name: input.legalName ?? null,
    p_website: input.website ?? null,
  });
  if (error) {
    console.error('[auditCreationApi] createVendor error:', error);
    return null;
  }
  return data as VendorRow;
}

// -----------------------------------------------------------------------------
// Site reads + creates (investigator site audit auditee)
//
// Mirrors the vendor functions above. Sites are a shared namespace (SELECT-only
// RLS); creation goes through the SECURITY DEFINER audit_mode_create_site RPC.
// -----------------------------------------------------------------------------

export async function listSites(): Promise<Result<SiteRow[]>> {
  const { data, error } = await supabase
    .from('sites')
    .select('id, name, site_number, principal_investigator, country')
    .order('name', { ascending: true });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? []) as SiteRow[] };
}

export async function createSite(input: {
  name: string;
  country: string;
  siteNumber?: string;
  principalInvestigator?: string;
}): Promise<SiteRow | null> {
  const { data, error } = await supabase.rpc('audit_mode_create_site', {
    p_name: input.name,
    p_country: input.country,
    p_site_number: input.siteNumber ?? null,
    p_principal_investigator: input.principalInvestigator ?? null,
  });
  if (error) {
    console.error('[auditCreationApi] createSite error:', error);
    return null;
  }
  return data as SiteRow;
}

// -----------------------------------------------------------------------------
// Protocol library (auditor-scoped)
//
// The library is the union of:
//   - protocols the auditor uploaded (joined via documents.user_id)
//   - protocols the auditor is already auditing (via audits.lead_auditor_id)
//
// We resolve the union client-side from two queries because RLS already
// scopes documents and audits to the caller — no extra server logic needed.
// -----------------------------------------------------------------------------

export async function listAuditorProtocolLibrary(): Promise<Result<AuditorProtocolRow[]>> {
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) return { ok: true, data: [] };

  const [docRes, auditRes] = await Promise.all([
    supabase
      .from('documents')
      .select('protocol_id')
      .eq('user_id', user.id)
      .not('protocol_id', 'is', null),
    supabase
      .from('audits')
      .select('protocol_id')
      .eq('lead_auditor_id', user.id),
  ]);

  // Either source failing means the union would be silently incomplete — treat
  // that as a load error, not a short library, so the picker can say so.
  if (docRes.error) return { ok: false, error: docRes.error.message };
  if (auditRes.error) return { ok: false, error: auditRes.error.message };

  const ids = new Set<string>();
  for (const row of (docRes.data ?? []) as { protocol_id: string | null }[]) {
    if (row.protocol_id) ids.add(row.protocol_id);
  }
  for (const row of (auditRes.data ?? []) as { protocol_id: string | null }[]) {
    if (row.protocol_id) ids.add(row.protocol_id);
  }
  if (ids.size === 0) return { ok: true, data: [] };

  // One query for the protocol + latest active version + phase, ordered by title.
  const { data, error } = await supabase
    .from('protocols')
    .select(`
      id, study_number, title, sponsor,
      protocol_versions ( id, version_number, status, clinical_trial_phase )
    `)
    .in('id', Array.from(ids))
    .order('title', { ascending: true });

  if (error) return { ok: false, error: error.message };

  const rows = ((data ?? []) as unknown as Array<{
    id: string;
    study_number: string | null;
    title: string;
    sponsor: string;
    protocol_versions: Array<{
      id: string;
      version_number: number;
      status: string;
      clinical_trial_phase: ClinicalTrialPhase;
    }>;
  }>)
    .map((p) => {
      const versions = p.protocol_versions ?? [];
      // Prefer ACTIVE; fall back to highest version_number.
      const sorted = [...versions].sort((a, b) => {
        if ((a.status === 'ACTIVE') !== (b.status === 'ACTIVE')) {
          return a.status === 'ACTIVE' ? -1 : 1;
        }
        return b.version_number - a.version_number;
      });
      const top = sorted[0];
      if (!top) return null;
      return {
        id: p.id,
        study_number: p.study_number,
        title: p.title,
        sponsor: p.sponsor,
        latest_version_id: top.id,
        clinical_trial_phase: top.clinical_trial_phase,
      } satisfies AuditorProtocolRow;
    })
    .filter((p): p is AuditorProtocolRow => p !== null);

  return { ok: true, data: rows };
}

// -----------------------------------------------------------------------------
// Protocol PDF upload (audit-mode-native)
//
// Posts to the shared /functions/v1/ingest edge function. Returns the new
// documents.id on success. The Reducto pipeline runs background extraction;
// extracted_fields may or may not be populated synchronously.
// -----------------------------------------------------------------------------

export interface ProtocolUploadResult {
  document_id: string;
  protocol_id?: string | null;        // populated when autotag matched an existing protocol
  chunks_created?: number;
}

export async function uploadProtocolPdf(file: File, title?: string): Promise<ProtocolUploadResult> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

  const base64 = await fileToBase64(file);
  const body = {
    title: (title ?? file.name.replace(/\.pdf$/i, '')).trim() || 'Untitled protocol',
    source: 'Audit Mode protocol upload',
    pdf_base64: base64,
  };

  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? supabaseAnonKey;

  const res = await fetch(`${supabaseUrl}/functions/v1/ingest`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error((data && data.error) || 'Protocol upload failed');
  }
  return data as ProtocolUploadResult;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// -----------------------------------------------------------------------------
// Protocol promotion (document → protocol + protocol_version)
// -----------------------------------------------------------------------------

export async function createProtocolFromDocument(input: {
  documentId: string;
  title?: string;
  sponsor?: string;
  studyNumber?: string;
  phase?: ClinicalTrialPhase;
}): Promise<ProtocolVersionRow | null> {
  const { data, error } = await supabase.rpc('audit_mode_create_protocol_from_document', {
    p_document_id: input.documentId,
    p_title: input.title ?? null,
    p_sponsor: input.sponsor ?? null,
    p_study_number: input.studyNumber ?? null,
    p_phase: input.phase ?? 'NOT_APPLICABLE',
  });
  if (error) {
    console.error('[auditCreationApi] createProtocolFromDocument error:', error);
    return null;
  }
  return data as ProtocolVersionRow;
}

// -----------------------------------------------------------------------------
// Audit creation
// -----------------------------------------------------------------------------

// Creates an audit for either workflow. Vendor audits pass vendorId; investigator
// site audits pass siteId. The RPC enforces the auditee/workflow pairing and lands
// the audit at the workflow's first stage (INTAKE vs ISA_SITE_INTAKE).
export async function createAudit(input: {
  auditName: string;
  workflowType: AuditWorkflowType;
  vendorId?: string | null;
  siteId?: string | null;
  protocolVersionId: string;
  auditType: AuditType;
  scheduledDate?: string | null;
}): Promise<Result<AuditRow>> {
  const { data, error } = await supabase.rpc('audit_mode_create_audit', {
    p_audit_name: input.auditName,
    p_vendor_id: input.vendorId ?? null,
    p_protocol_version_id: input.protocolVersionId,
    p_audit_type: input.auditType,
    p_scheduled_date: input.scheduledDate ?? null,
    p_workflow_type: input.workflowType,
    p_site_id: input.siteId ?? null,
  });
  // Preserve the RPC's specific reason ("Protocol version % not found", auditee
  // mismatch, etc.) so the drawer can show it instead of a flat failure line.
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as AuditRow };
}
