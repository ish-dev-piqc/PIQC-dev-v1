import { describe, expect, it, beforeAll } from 'vitest';
import { verifySvixSignature, readSvixHeaders } from '../svixVerify';

// =============================================================================
// Svix signature verification — algorithm correctness tests.
//
// Algorithm reference: https://docs.svix.com/receiving/verifying-payloads/how-manual
//   signedPayload = `${id}.${timestamp}.${rawBody}`
//   signature     = HMAC-SHA256(signedPayload, base64Decode(secret))
//   svix-signature header = "v1,<base64(signature)>"
// =============================================================================

const SECRET_RAW = 'this-is-a-secret-key-of-decent-length';

let SECRET_B64: string;
let SECRET_HEADER: string; // with the whsec_ prefix Svix uses

beforeAll(() => {
  const bytes = new TextEncoder().encode(SECRET_RAW);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  SECRET_B64 = btoa(bin);
  SECRET_HEADER = `whsec_${SECRET_B64}`;
});

async function signPayload(id: string, ts: string, body: string): Promise<string> {
  const keyBytes = new TextEncoder().encode(SECRET_RAW);
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${id}.${ts}.${body}`),
  );
  const sigBytes = new Uint8Array(sig);
  let bin = '';
  for (let i = 0; i < sigBytes.length; i++) bin += String.fromCharCode(sigBytes[i]);
  return btoa(bin);
}

function nowTs(): string {
  return String(Math.floor(Date.now() / 1000));
}

describe('verifySvixSignature', () => {
  it('accepts a correctly-signed delivery', async () => {
    const id = 'msg_test_1';
    const ts = nowTs();
    const body = JSON.stringify({ status: 'Completed', job_id: 'job_abc' });
    const sig = await signPayload(id, ts, body);

    const result = await verifySvixSignature(
      body,
      { id, timestamp: ts, signature: `v1,${sig}` },
      SECRET_HEADER,
    );
    expect(result.ok).toBe(true);
  });

  it('accepts when secret is passed without whsec_ prefix', async () => {
    const id = 'msg_test_2';
    const ts = nowTs();
    const body = '{}';
    const sig = await signPayload(id, ts, body);

    const result = await verifySvixSignature(
      body,
      { id, timestamp: ts, signature: `v1,${sig}` },
      SECRET_B64, // no prefix
    );
    expect(result.ok).toBe(true);
  });

  it('accepts when multiple signature tokens are present and one matches', async () => {
    const id = 'msg_test_3';
    const ts = nowTs();
    const body = 'payload';
    const realSig = await signPayload(id, ts, body);

    const result = await verifySvixSignature(
      body,
      {
        id,
        timestamp: ts,
        signature: `v1,wrongsig v1,${realSig} v1,anotherwrong`,
      },
      SECRET_HEADER,
    );
    expect(result.ok).toBe(true);
  });

  it('rejects when body is tampered', async () => {
    const id = 'msg_test_4';
    const ts = nowTs();
    const body = 'original';
    const sig = await signPayload(id, ts, body);

    const result = await verifySvixSignature(
      'tampered',
      { id, timestamp: ts, signature: `v1,${sig}` },
      SECRET_HEADER,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('signature mismatch');
  });

  it('rejects when timestamp is tampered', async () => {
    const id = 'msg_test_5';
    const ts = nowTs();
    const body = '{}';
    const sig = await signPayload(id, ts, body);

    const tamperedTs = String(Number(ts) + 1);
    const result = await verifySvixSignature(
      body,
      { id, timestamp: tamperedTs, signature: `v1,${sig}` },
      SECRET_HEADER,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('signature mismatch');
  });

  it('rejects stale deliveries (timestamp >5min old)', async () => {
    const id = 'msg_test_6';
    const ts = String(Math.floor(Date.now() / 1000) - 600); // 10min ago
    const body = '{}';
    const sig = await signPayload(id, ts, body);

    const result = await verifySvixSignature(
      body,
      { id, timestamp: ts, signature: `v1,${sig}` },
      SECRET_HEADER,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('stale svix-timestamp');
  });

  it('rejects when a header is missing', async () => {
    const result = await verifySvixSignature(
      '{}',
      { id: 'msg', timestamp: null, signature: 'v1,abc' },
      SECRET_HEADER,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('missing svix-* headers');
  });

  it('rejects non-numeric timestamps', async () => {
    const result = await verifySvixSignature(
      '{}',
      { id: 'msg', timestamp: 'not-a-number', signature: 'v1,abc' },
      SECRET_HEADER,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('non-numeric svix-timestamp');
  });

  it('rejects unknown signature versions (only v1 accepted)', async () => {
    const id = 'msg_test_v2';
    const ts = nowTs();
    const body = '{}';
    const sig = await signPayload(id, ts, body);

    const result = await verifySvixSignature(
      body,
      { id, timestamp: ts, signature: `v2,${sig}` }, // wrong version
      SECRET_HEADER,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('signature mismatch');
  });
});

describe('readSvixHeaders', () => {
  it('extracts all three headers (case-insensitive per HTTP spec)', () => {
    const headers = new Headers({
      'svix-id': 'msg_1',
      'svix-timestamp': '1700000000',
      'svix-signature': 'v1,abc',
    });
    const result = readSvixHeaders(headers);
    expect(result.id).toBe('msg_1');
    expect(result.timestamp).toBe('1700000000');
    expect(result.signature).toBe('v1,abc');
  });

  it('returns nulls when headers are missing', () => {
    const headers = new Headers();
    const result = readSvixHeaders(headers);
    expect(result.id).toBeNull();
    expect(result.timestamp).toBeNull();
    expect(result.signature).toBeNull();
  });
});
