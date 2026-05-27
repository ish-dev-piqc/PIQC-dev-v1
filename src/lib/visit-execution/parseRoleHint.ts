// =============================================================================
// parseRoleHint — Sprint 6.
//
// Maps the parser-emitted free-text `VisitExecutionItem.role_hint` string
// into a typed `ExecutionRole[]`. The parser writes hints like:
//
//   "Coordinator"
//   "Nurse"
//   "Phlebotomy nurse"
//   "Pharmacist"
//   "Pharmacist + Coordinator"
//   "Investigator"
//   "Lab tech"
//   "Lab"
//   "Site staff"
//   null
//
// The role-filtered view lens (Sprint 6) needs to answer "which role(s)
// does this requirement belong to?" for each item. The substrings below
// were chosen by surveying real and mock fixture role_hints:
//
//   coordinator | coord            → coordinator
//   nurse       | phleb            → nurse        ("Phlebotomy nurse")
//   investigator| pi               → investigator
//   lab                            → lab          ("Lab tech", "Lab")
//   pharmacist  | pharmacy         → pharmacy
//
// Multi-role: `"Pharmacist + Coordinator"` returns `['pharmacy', 'coordinator']`.
// Unscoped (null, `"Site staff"`, `"Site"`, empty): returns `[]`.
//
// Pure substring matching is deliberate — real parser output mixes compound
// phrases ("Phlebotomy nurse", "Lab tech", "Pharmacist + Coordinator") that
// word-boundary regexes don't catch reliably. Lowercase the input once,
// check each keyword set independently.
//
// SAFETY DEFAULT — empty array means "shows for every role filter." A null
// or unrecognized role_hint is a CLINICAL DEFAULT that any role might need
// to know about; hiding it from filtered views would be unsafe.
// =============================================================================

import type { ExecutionRole } from '../../types/visit-execution';

/**
 * Substring keyword sets per role. Order matters only for documentation —
 * the function checks all sets independently and accumulates matches.
 *
 * Future polish: if a real-data hint surfaces that doesn't match any
 * keyword set (and shouldn't be unscoped), extend the set HERE rather
 * than adding a new role to the ExecutionRole enum.
 */
const ROLE_KEYWORDS: Record<ExecutionRole, readonly string[]> = {
  coordinator:  ['coordinator', 'coord'],
  nurse:        ['nurse', 'phleb'],
  investigator: ['investigator', 'pi'],
  lab:          ['lab'],
  pharmacy:     ['pharmacist', 'pharmacy'],
};

/**
 * Iteration order matches `ExecutionRole` definition — gives the returned
 * array a deterministic shape (`['coordinator', 'nurse', ...]` rather than
 * `['nurse', 'coordinator', ...]` depending on Object.entries ordering).
 */
const ROLE_ORDER: readonly ExecutionRole[] = [
  'coordinator',
  'nurse',
  'investigator',
  'lab',
  'pharmacy',
];

/**
 * Parse a free-text `role_hint` into the set of canonical roles it refers to.
 *
 * Returns an empty array when:
 *   - input is null or empty
 *   - input doesn't match any keyword set (e.g. "Site staff", "Patient")
 *
 * Empty-array semantics: the calling filter treats the item as unscoped
 * and shows it for EVERY role filter (safety default per the plan MD).
 *
 * The function is pure — same input always gives same output. Lowercases
 * input once; substring-matches each keyword set independently.
 *
 * Edge cases handled:
 *   - "PI" → ['investigator']  (case-insensitive via lowercase)
 *   - "Pharmacist + Coordinator" → ['coordinator', 'pharmacy']  (sorted by ROLE_ORDER)
 *   - "Phlebotomy nurse" → ['nurse']
 *   - "Lab tech" → ['lab']
 *   - "  " (whitespace-only) → []
 *
 * Edge cases the function deliberately does NOT try to handle:
 *   - Misspellings ("pharmasist") — would need fuzzy matching; out of scope.
 *   - Negations ("not a nurse") — extremely rare in real parser output.
 *   - Localized terms ("infirmier" / "médecin") — Sprint 6 is English-only
 *     per the rest of the workspace.
 */
export function parseRoleHint(text: string | null | undefined): ExecutionRole[] {
  if (!text) return [];
  const lowered = text.toLowerCase().trim();
  if (lowered.length === 0) return [];

  const matched: ExecutionRole[] = [];
  for (const role of ROLE_ORDER) {
    const keywords = ROLE_KEYWORDS[role];
    if (keywords.some((kw) => lowered.includes(kw))) {
      matched.push(role);
    }
  }
  return matched;
}

/**
 * Convenience predicate: does the item's role_hint match the given filter?
 *
 * Returns `true` when:
 *   - filter is `'all'` (no filtering)
 *   - the item's role_hint parses to a role set including the filter
 *   - the item's role_hint is unscoped (empty array — see safety default)
 */
export function itemMatchesRoleFilter(
  roleHint: string | null | undefined,
  filter: ExecutionRole | 'all',
): boolean {
  if (filter === 'all') return true;
  const roles = parseRoleHint(roleHint);
  if (roles.length === 0) return true; // unscoped → safety default: show for all roles
  return roles.includes(filter);
}
