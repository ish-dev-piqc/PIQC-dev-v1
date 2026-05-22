// =============================================================================
// contact API — wrapper around the supabase/functions/contact/ edge function.
// Keeps the landing-page Contact.tsx component free of direct supabase imports
// per the "no fetches in components" rule.
// =============================================================================

import { supabase } from '../supabase';

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface ContactSubmission {
  name: string;
  email: string;
  company: string;
  message: string;
  // Honeypot — must be empty for real users. The edge function silently
  // 200s if non-empty, but we still send it so the bot-detection path
  // runs server-side rather than relying on the client.
  website: string;
}

export async function sendContactMessage(payload: ContactSubmission): Promise<Result<void>> {
  const { data, error } = await supabase.functions.invoke('contact', {
    body: payload,
  });

  if (error) {
    return { ok: false, error: error.message };
  }
  if (!data || data.ok !== true) {
    const msg = data && typeof data.error === 'string' ? data.error : 'Submission failed';
    return { ok: false, error: msg };
  }
  return { ok: true, data: undefined };
}
