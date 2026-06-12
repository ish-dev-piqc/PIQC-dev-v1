// =============================================================================
// chatSearchAdapter — pure helpers for the chat-search panel.
//
//   - escapeIlikePattern(): escape % and _ for safe ILIKE substring queries
//   - buildSnippet(): trim long bodies down to ~140 chars around the first
//     match, with ellipses
//   - splitForHighlight(): split a snippet into [before, match, after]
//     triplets so the panel can wrap matches in <mark>
//
// No Supabase / network imports.
// =============================================================================

/** Escape Postgres ILIKE special characters. The wildcards `%` and `_` need
 *  to be literal in the user's query. Backslash is also escaped because
 *  PostgreSQL's default ESCAPE is `\`. */
export function escapeIlikePattern(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/** Truncate a body around the first case-insensitive occurrence of `query`
 *  with at most `pad` chars of context on each side. Falls back to the
 *  body's first `maxLength` chars if the match isn't found (which can
 *  happen with multi-line escapes / unicode quirks). */
export function buildSnippet(
  body: string,
  query: string,
  options: { pad?: number; maxLength?: number } = {},
): string {
  const pad = options.pad ?? 60;
  const maxLength = options.maxLength ?? 160;
  if (!query) return body.length > maxLength ? body.slice(0, maxLength) + '…' : body;
  const idx = body.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) {
    return body.length > maxLength ? body.slice(0, maxLength) + '…' : body;
  }
  const start = Math.max(0, idx - pad);
  const end = Math.min(body.length, idx + query.length + pad);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < body.length ? '…' : '';
  return prefix + body.slice(start, end) + suffix;
}

/** Split text into alternating [literal, match, literal, match, …] runs
 *  for case-insensitive highlight rendering. Always returns an odd number
 *  of segments when matches exist (literal | match | literal | match | …
 *  | literal); even-indexed entries are literal, odd-indexed are matches.
 *
 *  Returns `[text]` when query is empty or has no match. */
export function splitForHighlight(text: string, query: string): string[] {
  if (!query) return [text];
  const out: string[] = [];
  const q = query.toLowerCase();
  const lower = text.toLowerCase();
  let cursor = 0;
  while (cursor < text.length) {
    const idx = lower.indexOf(q, cursor);
    if (idx < 0) {
      out.push(text.slice(cursor));
      break;
    }
    out.push(text.slice(cursor, idx));
    out.push(text.slice(idx, idx + query.length));
    cursor = idx + query.length;
  }
  return out;
}
