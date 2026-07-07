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
// Matching is mostly substring — real parser output mixes compound phrases
// ("Phlebotomy nurse", "Lab tech", "Pharmacist + Coordinator") that the long,
// unambiguous keywords catch reliably via plain containment. Lowercase the
// input once, check each keyword set independently.
//
// EXCEPTION — the two shortest keywords, 'pi' (investigator) and 'lab', are
// common English substrings ("sam-pi-ling", "ca-pi-llary", "ex-pi-ration";
// "col-lab-orate", "la-bel", "avai-lab-le"). Under bare substring matching
// they fire false-positive role tags on unrelated parser output, wrongly
// adding/removing items from role-filtered views. They are therefore matched
// with a word boundary (/\bpi\b/i, /\blab\b/i) so they only tag when they
// appear as a standalone token ("PI", "Lab", "Lab tech") — never mid-word.
// The longer keywords stay plain substrings; they don't collide.
//
// SAFETY DEFAULT — empty array means "shows for every role filter." A null
// or unrecognized role_hint is a CLINICAL DEFAULT that any role might need
// to know about; hiding it from filtered views would be unsafe.
// =============================================================================

import type { ExecutionRole } from '../../types/visit-execution';

/**
 * Keyword matchers per role. A `string` matcher is a plain (case-insensitive)
 * substring; a `RegExp` matcher is used for the short, collision-prone keywords
 * that must match only as a whole word (see the header EXCEPTION note).
 *
 * Order matters only for documentation — the function checks all sets
 * independently and accumulates matches.
 *
 * Future polish: if a real-data hint surfaces that doesn't match any
 * keyword set (and shouldn't be unscoped), extend the set HERE rather
 * than adding a new role to the ExecutionRole enum.
 */
type RoleMatcher = string | RegExp;

const ROLE_KEYWORDS: Record<ExecutionRole, readonly RoleMatcher[]> = {
  coordinator:  ['coordinator', 'coord'],
  nurse:        ['nurse', 'phleb'],
  investigator: ['investigator', /\bpi\b/i],
  lab:          [/\blab\b/i],
  pharmacy:     ['pharmacist', 'pharmacy'],
};

/**
 * Test a single matcher against the (already-lowercased) hint.
 * Plain strings use substring containment; regexes use `.test`.
 */
function matcherHits(matcher: RoleMatcher, lowered: string): boolean {
  return typeof matcher === 'string' ? lowered.includes(matcher) : matcher.test(lowered);
}

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
 * input once; matches each keyword set independently (substring for the long
 * keywords, whole-word regex for the short collision-prone ones).
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
    if (keywords.some((kw) => matcherHits(kw, lowered))) {
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
