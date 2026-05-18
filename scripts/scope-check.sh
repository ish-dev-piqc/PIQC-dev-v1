#!/usr/bin/env bash
# Pre-tool hook: blocks Edit/Write tools targeting files outside the active plan's Scope.
# Wired in via .claude/settings.json PreToolUse hook.
#
# Contract: receives the tool-use JSON on stdin. Exits 0 to allow, exits 2 with a
# stderr message to block (Claude sees the stderr and reports it to the user).

set -u

if ! command -v jq >/dev/null 2>&1; then
  echo "scope-check: jq not installed; skipping scope enforcement. Run 'brew install jq' to enable." >&2
  exit 0
fi

input=$(cat)
file_path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty' 2>/dev/null || true)
[ -z "$file_path" ] && exit 0

repo_root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || true)}"
[ -z "$repo_root" ] && exit 0

case "$file_path" in
  "$repo_root"/*) rel_path="${file_path#$repo_root/}" ;;
  /*) exit 0 ;;
  *) rel_path="$file_path" ;;
esac

# Always allow editing plan MDs themselves (feature-intake / archive flows)
case "$rel_path" in
  plans/*) exit 0 ;;
esac

dev_raw=$(git -C "$repo_root" config user.name 2>/dev/null || true)
dev=$(printf '%s' "$dev_raw" | tr '[:upper:]' '[:lower:]')
[ -z "$dev" ] && exit 0

# Resolve git user → plans/<folder>. Try in order:
#   1. PIQC_DEV_FOLDER env var (per-machine override)
#   2. Exact folder name match
#   3. Substring match either direction (handles "Ishika13" ↔ "ishika",
#      "Karl LaRocca" ↔ "karl", "ki-dev-piqc" ↔ "kiara" via shared substring)
plan_dir=""
if [ -n "${PIQC_DEV_FOLDER:-}" ] && [ -d "$repo_root/plans/$PIQC_DEV_FOLDER" ]; then
  plan_dir="$repo_root/plans/$PIQC_DEV_FOLDER"
else
  for candidate in "$repo_root"/plans/*/; do
    [ -d "$candidate" ] || continue
    folder=$(basename "$candidate")
    case "$folder" in
      _*) continue ;;
    esac
    folder_lc=$(printf '%s' "$folder" | tr '[:upper:]' '[:lower:]')
    if [[ "$dev" == *"$folder_lc"* ]] || [[ "$folder_lc" == *"$dev"* ]]; then
      plan_dir="${candidate%/}"
      break
    fi
  done
fi

if [ -z "$plan_dir" ]; then
  echo "scope-check: could not map git user '$dev_raw' to a plans/<folder>/." >&2
  echo "Set PIQC_DEV_FOLDER=<your folder> in your shell, or rename plans/<folder> to match your git name." >&2
  exit 0
fi

active_plan=""
for p in "$plan_dir"/*.md; do
  [ -f "$p" ] || continue
  if grep -qE '^status: active$' "$p" 2>/dev/null; then
    active_plan="$p"
    break
  fi
done

# No active plan → nothing to enforce against
[ -z "$active_plan" ] && exit 0

# Extract Scope section bullets
scope_patterns=$(awk '
  /^## Scope/      { in_scope=1; next }
  /^## /            { in_scope=0 }
  in_scope && /^- / { sub(/^- */, ""); gsub(/`/, ""); print }
' "$active_plan")

in_scope=0
while IFS= read -r raw; do
  pattern=$(printf '%s' "$raw" | awk '{$1=$1; print}')
  [ -z "$pattern" ] && continue
  # shellcheck disable=SC2254
  case "$rel_path" in
    $pattern) in_scope=1; break ;;
  esac
  trimmed="${pattern%/}"
  case "$rel_path" in
    "$trimmed"/*) in_scope=1; break ;;
  esac
done <<< "$scope_patterns"

if [ "$in_scope" -eq 1 ]; then
  exit 0
fi

plan_rel="${active_plan#$repo_root/}"
{
  echo "scope-check BLOCK: ${rel_path}"
  echo "Not in the Scope of ${plan_rel}."
  echo ""
  echo "Options:"
  echo "  (a) Add ${rel_path} to the plan's Scope (notify the codeowner if outside your ownership)."
  echo "  (b) Finish the current scope first."
  echo "  (c) Hand this off to the codeowner."
} >&2
exit 2
