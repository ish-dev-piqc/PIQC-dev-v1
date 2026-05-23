// =============================================================================
// Svix webhook signature verification — Deno (Web Crypto) implementation.
//
// Reducto delivers webhook callbacks via Svix. Svix uses three headers:
//   svix-id         — unique message id
//   svix-timestamp  — unix seconds, used to reject stale deliveries
//   svix-signature  — space-separated list of "v1,<base64-sig>" tokens
//
// Algorithm: HMAC-SHA256 over `${id}.${timestamp}.${rawBody}` using the
// base64-decoded webhook secret. We accept the delivery if ANY token in the
// signature header matches (Svix supports key rotation by sending multiple
// signatures, only one of which has to verify).
//
// Reference: https://docs.svix.com/receiving/verifying-payloads/how-manual
// =============================================================================

const TOLERANCE_SECONDS = 5 * 60; // reject deliveries with timestamps older
                                  // than 5 minutes (replay-attack guard)

export interface SvixHeaders {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}

export interface SvixVerifyResult {
  ok: boolean;
  /** Populated on failure. Safe to log; never contains the secret. */
  reason?: string;
}

/**
 * Extract the three Svix headers from a Headers object.
 * Headers are lowercased per the standard.
 */
export function readSvixHeaders(headers: Headers): SvixHeaders {
  return {
    id:        headers.get("svix-id"),
    timestamp: headers.get("svix-timestamp"),
    signature: headers.get("svix-signature"),
  };
}

/**
 * Verify a Svix-signed delivery against the webhook secret.
 *
 * @param rawBody - the request body as a string (NOT parsed JSON — the
 *   signature is computed over the raw bytes)
 * @param headers - the three svix-* headers from the request
 * @param secret - the webhook signing secret, in Svix's standard
 *   "whsec_<base64>" format. The "whsec_" prefix is stripped before decoding.
 */
export async function verifySvixSignature(
  rawBody: string,
  headers: SvixHeaders,
  secret: string,
): Promise<SvixVerifyResult> {
  if (!headers.id || !headers.timestamp || !headers.signature) {
    return { ok: false, reason: "missing svix-* headers" };
  }

  // Replay guard — reject deliveries with stale timestamps.
  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts)) {
    return { ok: false, reason: "non-numeric svix-timestamp" };
  }
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > TOLERANCE_SECONDS) {
    return { ok: false, reason: "stale svix-timestamp" };
  }

  // Strip the "whsec_" prefix Svix uses, then base64-decode to get the key.
  const cleanSecret = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  let keyBytes: Uint8Array;
  try {
    keyBytes = base64Decode(cleanSecret);
  } catch {
    return { ok: false, reason: "invalid secret format" };
  }

  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signedPayload = `${headers.id}.${headers.timestamp}.${rawBody}`;
  const signatureBytes = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signedPayload),
  );
  const expectedSig = base64Encode(new Uint8Array(signatureBytes));

  // svix-signature is space-separated "v1,<sig>" tokens — try each.
  const tokens = headers.signature.split(" ");
  for (const token of tokens) {
    const [version, sig] = token.split(",", 2);
    if (version !== "v1" || !sig) continue;
    if (constantTimeEquals(sig, expectedSig)) {
      return { ok: true };
    }
  }
  return { ok: false, reason: "signature mismatch" };
}

// -----------------------------------------------------------------------------
// Helpers — kept here so the module is self-contained (no Deno std imports).
// -----------------------------------------------------------------------------

function base64Decode(input: string): Uint8Array {
  const bin = atob(input);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function base64Encode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/**
 * Constant-time string comparison to avoid timing-attack leaks on the
 * signature compare. Short-circuiting `===` could leak the prefix length
 * an attacker has guessed correctly; this scans the full string.
 */
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
