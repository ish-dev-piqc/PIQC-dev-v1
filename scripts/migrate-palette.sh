#!/usr/bin/env bash
# =============================================================================
# scripts/migrate-palette.sh
#
# Mechanical sweep of inline hex literals to the new brand palette per
# plans/kiara/brand-palette-overhaul.md.
#
# Touches every .ts and .tsx file under src/, EXCEPT
# src/lib/site/protocolColors.ts which is intentionally preserved.
#
# Idempotent: running twice produces zero diff (no OLD value matches any
# NEW value in the mapping table).
#
# Uses perl (not BSD sed) so the script works the same on macOS and Linux.
#
# Usage:
#   bash scripts/migrate-palette.sh         # do the sweep
#   bash scripts/migrate-palette.sh --dry   # report counts only, don't modify
# =============================================================================

set -euo pipefail

cd "$(dirname "$0")/.."

DRY_RUN=0
if [[ "${1:-}" == "--dry" ]]; then
  DRY_RUN=1
  echo ">> DRY RUN — no files will be modified."
fi

# Files in scope: all .ts and .tsx under src/, minus the protocol palette.
FILES=$(find src -type f \( -name '*.ts' -o -name '*.tsx' \) \
        ! -path 'src/lib/site/protocolColors.ts')

# Mapping table — OLD;NEW pairs, one per line. Keep ordered by category
# for readability. Case-insensitive matching is used so uppercase variants
# get caught too (e.g. `#4A6FA5` as well as `#4a6fa5`).
MAPPINGS=$(cat <<'EOF'
# --- Existing brand-blue family → new blue scale ---
#4a6fa5;#017BC8
#5b82b8;#1595D1
#5e7fa5;#026BBE
#3d5e8f;#0477BF
#5a7fa5;#017BC8
#6e8fb5;#74B4DC
#7e9fc5;#3CACF4
#3a5f95;#0477BF
#3d6ba5;#017BC8
# --- Old "navy" dark surfaces → new slate scale ---
#0d1118;#020617
#131a22;#0F172A
#1a1f28;#0F172A
#161d25;#0F172A
#141c22;#0F172A
#0e141b;#020617
#1f2937;#1E293B
#111827;#0F172A
#1a2230;#1E293B
#1a2a32;#1E293B
#2a3a45;#334155
# --- Text / muted grays → new slate scale ---
#374152;#334155
#d2d7e0;#CBD5E1
#8a9ab0;#94A3B8
#9aa6b5;#94A3B8
#3c3c3c;#334155
#e5e7eb;#E2E8F0
# --- Light backgrounds / surfaces → new slate scale ---
#f5f7fa;#F8FAFC
#f9fafc;#F8FAFC
#eef2f6;#F2F2F2
#f0f3f6;#F2F2F2
#f0f4f8;#F2F2F2
#e2e8ee;#E2E8F0
#cbd2db;#CBD5E1
#dce4ed;#E2E8F0
#d8dfe8;#E2E8F0
#d8e4ee;#E2E8F0
#dce8f0;#E2E8F0
#c8d8e4;#CBD5E1
#c8d4e0;#CBD5E1
# --- Error reds → Tailwind rose scale ---
#742a2a;#881337
#5a2e2e;#881337
#3b1f1f;#4C0519
#f3c7c7;#FECDD3
#f5b8b8;#FECDD3
#fdecec;#FFF1F2
EOF
)

# For each mapping, run a perl substitution across all in-scope files.
# Perl `-i` does in-place edit. `/gi` flags = global + case-insensitive.
# `\Q...\E` quotemeta-escapes the pattern so the `#` and hex characters
# are matched literally (no regex interpretation).
echo "$MAPPINGS" | while IFS=';' read -r OLD NEW; do
  # Skip comment lines and blanks
  [[ -z "$OLD" || "$OLD" == \#\ * || "$OLD" == \#--* ]] && continue
  # Sanity: both fields populated
  [[ -z "$OLD" || -z "$NEW" ]] && continue

  if (( DRY_RUN )); then
    COUNT=$(echo "$FILES" | xargs grep -ihE "$(printf '%s' "$OLD" | sed 's/[][\\^$*+?.|(){}]/\\&/g')" 2>/dev/null | wc -l | tr -d ' ')
    echo "  $OLD -> $NEW  ($COUNT occurrences)"
  else
    echo "$FILES" | xargs perl -i -pe "s/\Q${OLD}\E/${NEW}/gi"
    echo "  $OLD -> $NEW  (applied)"
  fi
done

# =============================================================================
# Phase 2 — rgba() form sweep
#
# The bracketed-hex sweep above catches `[#4a6fa5]` (Tailwind arbitrary
# values) and `'#4a6fa5'` (string literals in inline styles), but it does
# NOT catch the same color expressed as `rgba(74,111,165,X)` — which is
# used for box-shadows, glow gradients, and semi-transparent borders.
#
# This phase rewrites the RGB component of rgba()/rgb() calls. Alphas are
# preserved (we replace the substring "74,111,165" wherever it appears,
# leaving the alpha argument and the surrounding parens intact).
#
# Mapping rationale:
#  - 74,111,165 (old brand blue #4a6fa5) → 1,123,200 (new blue-600 #017BC8)
#    matches the bracketed-hex sweep for visual consistency.
#  - 55,65,82 (old body text #374152) → 51,65,85 (new slate-700 #334155).
#  - 210,215,224 (old dark text #d2d7e0) → 203,213,225 (new slate-300 #CBD5E1).
#  - 37,99,235 (old Tailwind default blue #2563eb) → 1,123,200. This appears
#    only in src/tailwind.config.js which is a stale duplicate; the script
#    still rewrites the values for hygiene even though that file is
#    scheduled for deletion.
# =============================================================================

RGBA_MAPPINGS=$(cat <<'EOF'
74,111,165;1,123,200
55,65,82;51,65,85
210,215,224;203,213,225
37,99,235;1,123,200
EOF
)

# Phase 2 uses a wider file scope so it also touches .js (the stale
# src/tailwind.config.js, if still present) and .css files.
FILES_PHASE2=$(find src -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.css' \) \
               ! -path 'src/lib/site/protocolColors.ts')

echo "$RGBA_MAPPINGS" | while IFS=';' read -r OLD NEW; do
  [[ -z "$OLD" || "$OLD" == \#* ]] && continue
  [[ -z "$NEW" ]] && continue

  if (( DRY_RUN )); then
    COUNT=$(echo "$FILES_PHASE2" | xargs grep -oh "$OLD" 2>/dev/null | wc -l | tr -d ' ')
    echo "  rgba/rgb $OLD -> $NEW  ($COUNT occurrences)"
  else
    echo "$FILES_PHASE2" | xargs perl -i -pe "s/\Q${OLD}\E/${NEW}/g"
    echo "  rgba/rgb $OLD -> $NEW  (applied)"
  fi
done

if (( DRY_RUN == 0 )); then
  echo ""
  echo ">> Sweep complete (Phase 1 + Phase 2). Run \`git diff --stat\` to see"
  echo "   the scope of changes."
  echo ">> Run \`npm run build\` to verify TS strict still passes."
  echo ">> Run \`grep -rE '\\[#[0-9a-fA-F]{6}\\]' src/\` and spot-check any"
  echo "   remaining hex literals against the brand palette."
  echo ">> If src/tailwind.config.js still exists, remove it — it's a stale"
  echo "   duplicate of the root tailwind.config.js (Vite doesn't read it)."
fi
