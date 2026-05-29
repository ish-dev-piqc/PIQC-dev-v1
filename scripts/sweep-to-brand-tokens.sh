#!/usr/bin/env bash
# =============================================================================
# scripts/sweep-to-brand-tokens.sh
#
# Sweeps the codebase to replace literal blue/teal color references with
# mode-aware `brand-N` Tailwind tokens and `var(--brand-N)` CSS variable
# references. This is the architectural foundation for treating Site Mode
# (blue) and Audit Mode (teal) as separately-branded products: a single
# CSS class on App's root div flips every brand-colored surface.
#
# What this sweep does:
#  1. Replaces bracketed Tailwind arbitrary hex literals
#     (e.g., `[#017BC8]`) with named `brand-N` tokens
#     (so `bg-[#017BC8]` becomes `bg-brand-600`).
#  2. Replaces named Tailwind blue-/teal- classes
#     (e.g., `bg-blue-600`, `text-teal-400`) with their `brand-` equivalents.
#  3. Replaces rgba() / rgb() calls with blue or teal RGB tuples
#     with the modern `rgb(var(--brand-N) / A)` syntax.
#
# Scope: all .ts/.tsx files in src/, EXCEPT:
#  - src/lib/site/protocolColors.ts (protocol palette is intentionally
#    a separate, mode-independent color system)
#
# Idempotent: running twice produces zero diff. Once a literal becomes
# a brand token, the pattern no longer matches.
#
# Usage:
#   bash scripts/sweep-to-brand-tokens.sh         # do the sweep
#   bash scripts/sweep-to-brand-tokens.sh --dry   # report counts only
# =============================================================================

set -euo pipefail

cd "$(dirname "$0")/.."

DRY_RUN=0
if [[ "${1:-}" == "--dry" ]]; then
  DRY_RUN=1
  echo ">> DRY RUN — no files will be modified."
fi

FILES=$(find src -type f \( -name '*.ts' -o -name '*.tsx' \) \
        ! -path 'src/lib/site/protocolColors.ts')

# -----------------------------------------------------------------------------
# Phase 1 — Bracketed hex literals → named `brand-N` tokens
# Substitutes the value-only portion (`[#XXXXXX]` → `brand-N`); the
# surrounding Tailwind prefix (bg-, text-, border-, etc.) is preserved
# naturally. Both blue and teal scales map to the same brand-N because
# the active mode determines which color the variable resolves to.
# -----------------------------------------------------------------------------
HEX_MAPPINGS=$(cat <<'EOF'
[#F0F9FE]|brand-50
[#ECF7F6]|brand-50
[#D6EFFF]|brand-100
[#DCEDEB]|brand-100
[#AEE0FC]|brand-200
[#9FD7D6]|brand-200
[#74B4DC]|brand-300
[#6FC9C7]|brand-300
[#3CACF4]|brand-400
[#2CCCC8]|brand-400
[#1595D1]|brand-500
[#06BFAD]|brand-500
[#017BC8]|brand-600
[#02BBB8]|brand-600
[#026BBE]|brand-700
[#028E8B]|brand-700
[#0477BF]|brand-800
[#016663]|brand-800
[#033E80]|brand-900
[#014442]|brand-900
[#021F40]|brand-950
[#002221]|brand-950
EOF
)

echo "Phase 1 — bracketed hex literals → brand-N tokens"
echo "$HEX_MAPPINGS" | while IFS='|' read -r OLD NEW; do
  [[ -z "$OLD" || -z "$NEW" ]] && continue
  if (( DRY_RUN )); then
    COUNT=$(echo "$FILES" | xargs grep -ihF -- "$OLD" 2>/dev/null | wc -l | tr -d ' ')
    echo "  $OLD -> $NEW  ($COUNT lines match)"
  else
    echo "$FILES" | xargs perl -i -pe "s/\Q${OLD}\E/${NEW}/gi"
  fi
done
(( DRY_RUN == 0 )) && echo "  (applied all hex-literal mappings)"

# -----------------------------------------------------------------------------
# Phase 2 — Tailwind named blue-/teal- classes → brand-
# Catches any component that referenced the named scale (`bg-blue-600`
# rather than `bg-[#017BC8]`). Both `blue` and `teal` named refs map to
# `brand-` because the mode class swaps the variable values.
# -----------------------------------------------------------------------------
echo ""
echo "Phase 2 — Tailwind named blue/teal classes → brand"
if (( DRY_RUN )); then
  BLUE_COUNT=$(echo "$FILES" | xargs grep -ohE "\b(bg|text|border|ring|from|to|via|fill|stroke|divide|outline|placeholder|accent|caret|decoration)-(blue|teal)-[0-9]+\b" 2>/dev/null | wc -l | tr -d ' ')
  echo "  Found $BLUE_COUNT named blue/teal class references"
else
  echo "$FILES" | xargs perl -i -pe 's/\b(bg|text|border|ring|from|to|via|fill|stroke|divide|outline|placeholder|accent|caret|decoration)-(?:blue|teal)-(\d+)\b/\1-brand-\2/g'
  echo "  (applied all named-class mappings)"
fi

# -----------------------------------------------------------------------------
# Phase 3 — rgba() / rgb() with brand RGB tuples → modern var() syntax
# Converts both blue and teal RGB triplets to mode-aware var() references
# using the modern `rgb(var(--brand-N) / alpha)` syntax. The CSS variables
# in src/index.css are space-separated for compatibility with this syntax.
# -----------------------------------------------------------------------------
RGB_MAPPINGS=$(cat <<'EOF'
240,249,254|--brand-50
236,247,246|--brand-50
214,239,255|--brand-100
220,237,235|--brand-100
174,224,252|--brand-200
159,215,214|--brand-200
116,180,220|--brand-300
111,201,199|--brand-300
60,172,244|--brand-400
44,204,200|--brand-400
21,149,209|--brand-500
6,191,173|--brand-500
1,123,200|--brand-600
2,187,184|--brand-600
2,107,190|--brand-700
2,142,139|--brand-700
4,119,191|--brand-800
1,102,99|--brand-800
3,62,128|--brand-900
1,68,66|--brand-900
2,31,64|--brand-950
0,34,33|--brand-950
EOF
)

echo ""
echo "Phase 3 — rgba()/rgb() RGB tuples → var(--brand-N)"
echo "$RGB_MAPPINGS" | while IFS='|' read -r OLD NEW; do
  [[ -z "$OLD" || -z "$NEW" ]] && continue
  if (( DRY_RUN )); then
    # Count rgba(R,G,B,A) and rgb(R,G,B) occurrences
    COUNT_A=$(echo "$FILES" | xargs grep -ohE "rgba\(${OLD},\s*[0-9.]+\)" 2>/dev/null | wc -l | tr -d ' ')
    COUNT_R=$(echo "$FILES" | xargs grep -ohE "rgb\(${OLD}\)" 2>/dev/null | wc -l | tr -d ' ')
    TOTAL=$((COUNT_A + COUNT_R))
    if (( TOTAL > 0 )); then
      echo "  rgba/rgb($OLD,...) -> rgb(var($NEW) / ...)  ($TOTAL occurrences)"
    fi
  else
    # rgba(R,G,B,A) -> rgb(var(--brand-N) / A)
    echo "$FILES" | xargs perl -i -pe "s/rgba\(${OLD},\s*([0-9.]+)\)/rgb(var(${NEW}) \/ \$1)/g"
    # rgb(R,G,B) -> rgb(var(--brand-N))
    echo "$FILES" | xargs perl -i -pe "s/rgb\(${OLD}\)/rgb(var(${NEW}))/g"
  fi
done
(( DRY_RUN == 0 )) && echo "  (applied all rgba/rgb mappings)"

if (( DRY_RUN == 0 )); then
  echo ""
  echo ">> Sweep complete (3 phases). Run \`git diff --stat\` to see scope."
  echo ">> Run \`npm run build\` to verify TS strict still passes."
  echo ">> Pull the branch locally and verify both light/dark + site/audit modes."
fi
