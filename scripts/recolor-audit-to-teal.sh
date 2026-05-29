#!/usr/bin/env bash
# =============================================================================
# scripts/recolor-audit-to-teal.sh
#
# Recolors all Audit Mode components from the new brand blue to the new
# brand teal. Scoped to src/components/dashboard/audit/** only — Site
# Mode and SOTR are not touched.
#
# This is the mode-anchor finishing step on top of the palette overhaul.
# The previous palette PR migrated every component to the new blue/teal/
# slate scales but preserved each component's existing hue. Audit mode
# was rendering with the brand blue; this script swaps it to teal so the
# two modes have the visual identity decided in plans/kiara/brand-palette-overhaul.md.
#
# Idempotent: running twice produces zero diff.
#
# Usage:
#   bash scripts/recolor-audit-to-teal.sh         # do the recolor
#   bash scripts/recolor-audit-to-teal.sh --dry   # report counts only
# =============================================================================

set -euo pipefail

cd "$(dirname "$0")/.."

DRY_RUN=0
if [[ "${1:-}" == "--dry" ]]; then
  DRY_RUN=1
  echo ">> DRY RUN — no files will be modified."
fi

# Scoped to audit-mode components only.
FILES=$(find src/components/dashboard/audit -type f \( -name '*.ts' -o -name '*.tsx' \))

# Phase 1 — Hex literal substitutions across the full 11-shade scale.
# Maps each blue weight to the teal weight at the same depth.
HEX_MAPPINGS=$(cat <<'EOF'
#F0F9FE;#ECF7F6
#D6EFFF;#DCEDEB
#AEE0FC;#9FD7D6
#74B4DC;#6FC9C7
#3CACF4;#2CCCC8
#1595D1;#06BFAD
#017BC8;#02BBB8
#026BBE;#028E8B
#0477BF;#016663
#033E80;#014442
#021F40;#002221
EOF
)

# Phase 2 — RGB component substitutions for rgba()/rgb() values.
# Same blue→teal weight mapping as above, but expressed in decomposed
# RGB so it catches shadow/glow tints that use rgba() syntax.
RGB_MAPPINGS=$(cat <<'EOF'
21,149,209;6,191,173
1,123,200;2,187,184
2,107,190;2,142,139
4,119,191;1,102,99
EOF
)

# Phase 3 — Tailwind class substitutions. If any audit component uses
# named Tailwind blue classes (bg-blue-600, text-blue-400, etc.) instead
# of inline arbitrary values, swap them to teal at the same weight.
# This covers utility classes for backgrounds, text, borders, rings,
# fills, strokes, and gradient stops.
CLASS_PREFIXES="bg text border ring from to via fill stroke divide outline placeholder accent caret"

echo "Phase 1 — hex literals"
echo "$HEX_MAPPINGS" | while IFS=';' read -r OLD NEW; do
  [[ -z "$OLD" || "$OLD" == \#* ]] && continue
  [[ -z "$NEW" ]] && continue
  if (( DRY_RUN )); then
    COUNT=$(echo "$FILES" | xargs grep -ih "$OLD" 2>/dev/null | wc -l | tr -d ' ')
    echo "  $OLD -> $NEW  ($COUNT lines match)"
  else
    echo "$FILES" | xargs perl -i -pe "s/\Q${OLD}\E/${NEW}/gi"
    echo "  $OLD -> $NEW  (applied)"
  fi
done

echo ""
echo "Phase 2 — rgba/rgb decomposed values"
echo "$RGB_MAPPINGS" | while IFS=';' read -r OLD NEW; do
  [[ -z "$OLD" || "$OLD" == \#* ]] && continue
  [[ -z "$NEW" ]] && continue
  if (( DRY_RUN )); then
    COUNT=$(echo "$FILES" | xargs grep -oh "$OLD" 2>/dev/null | wc -l | tr -d ' ')
    echo "  $OLD -> $NEW  ($COUNT occurrences)"
  else
    echo "$FILES" | xargs perl -i -pe "s/\Q${OLD}\E/${NEW}/g"
    echo "  $OLD -> $NEW  (applied)"
  fi
done

echo ""
echo "Phase 3 — Tailwind named-color classes (bg-blue-X -> bg-teal-X, etc.)"
for PREFIX in $CLASS_PREFIXES; do
  for WEIGHT in 50 100 200 300 400 500 600 700 800 900 950; do
    OLD="${PREFIX}-blue-${WEIGHT}"
    NEW="${PREFIX}-teal-${WEIGHT}"
    if (( DRY_RUN )); then
      COUNT=$(echo "$FILES" | xargs grep -oh "\b${OLD}\b" 2>/dev/null | wc -l | tr -d ' ')
      if (( COUNT > 0 )); then
        echo "  $OLD -> $NEW  ($COUNT occurrences)"
      fi
    else
      echo "$FILES" | xargs perl -i -pe "s/\b\Q${OLD}\E\b/${NEW}/g"
    fi
  done
done
if (( DRY_RUN == 0 )); then
  echo "  (applied all bg/text/border/ring/from/to/via/fill/stroke/divide/outline/placeholder/accent/caret -blue-X -> -teal-X swaps in audit/)"
fi

if (( DRY_RUN == 0 )); then
  echo ""
  echo ">> Recolor complete. Run \`git diff --stat src/components/dashboard/audit\`"
  echo "   to see the scope."
  echo ">> Run \`npm run build\` to verify TS strict still passes."
  echo ">> Spot-check that audit-mode surfaces now render teal, and that"
  echo "   site-mode + SOTR remain unchanged (still blue)."
fi
