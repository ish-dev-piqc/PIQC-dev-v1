#!/usr/bin/env bash
# =============================================================================
# Audit-mode RPC integration smoke test.
#
# Exercises the full auth → REST → RPC → delta chain via curl against the
# local Supabase REST endpoint. Mirrors what the React UI does at runtime.
#
# Defaults to local (`supabase status -o env`). Pass --cloud + env vars to
# target cloud instead. Usage:
#
#   bash scripts/smoke-rpcs.sh                     # local
#   SUPABASE_URL=https://<ref>.supabase.co \
#   SUPABASE_ANON_KEY=<anon> \
#   SUPABASE_SERVICE_ROLE_KEY=<service> \
#   SUPABASE_ACCESS_TOKEN=<bearer> \
#     bash scripts/smoke-rpcs.sh --cloud
# =============================================================================

set -uo pipefail

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

AUDITOR_EMAIL="ishika@piqclinical.com"
AUDITOR_ID="00000000-1111-2222-3333-444444444444"
SMOKE_PASSWORD="${SMOKE_PASSWORD:-smoke-test-pw}"
SMOKE_REASON_TAG="(smoke test $(date +%s))"

# Seeded UUIDs (from 20260429120000_seed_audit_mock_data.sql)
AUDIT_001="55555555-5555-5555-5555-555555555501"  # QUESTIONNAIRE_REVIEW
AUDIT_002="55555555-5555-5555-5555-555555555502"  # INTAKE
AUDIT_003="55555555-5555-5555-5555-555555555503"  # PRE_AUDIT_DRAFTING
VS_001="77777777-7777-7777-7777-770000000001"      # vendor_service for audit-001
PR_001_01="66666666-6666-6666-6666-660000000101"   # PRIMARY/DATA_INTEGRITY/time=false
RS_001="aaaaaaaa-aaaa-aaaa-aaaa-aa0000000001"      # vendor_risk_summary for audit-001
PV_002=""  # protocol_version_id for audit-002 — looked up at runtime

# ---------------------------------------------------------------------------
# Source local Supabase config unless --cloud
# ---------------------------------------------------------------------------

CLOUD_MODE=0
for arg in "$@"; do
  case "$arg" in
    --cloud) CLOUD_MODE=1 ;;
  esac
done

if [[ $CLOUD_MODE -eq 0 ]]; then
  echo "[setup] Loading local Supabase config..."
  if ! command -v supabase >/dev/null; then
    echo "[FAIL] supabase CLI not found"; exit 1
  fi
  eval "$(supabase status -o env 2>/dev/null | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=')"
  SUPABASE_URL="$API_URL"
  SUPABASE_ANON_KEY="$ANON_KEY"
  SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY"
else
  # Cloud mode. URL + anon key default to .env.local; service role + password
  # are required and not auto-discoverable.
  if [[ -z "${SUPABASE_URL:-}" || -z "${SUPABASE_ANON_KEY:-}" ]]; then
    if [[ -f .env.local ]]; then
      SUPABASE_URL="${SUPABASE_URL:-$(grep '^VITE_SUPABASE_URL=' .env.local | head -1 | cut -d= -f2- | tr -d '"')}"
      SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:-$(grep '^VITE_SUPABASE_ANON_KEY=' .env.local | head -1 | cut -d= -f2- | tr -d '"')}"
    fi
  fi
  : "${SUPABASE_URL:?SUPABASE_URL required (or set VITE_SUPABASE_URL in .env.local)}"
  : "${SUPABASE_ANON_KEY:?SUPABASE_ANON_KEY required (or set VITE_SUPABASE_ANON_KEY in .env.local)}"

  if [[ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
    echo "[setup] Need cloud SERVICE ROLE key for cleanup."
    echo "        Get it from Supabase Dashboard → Project Settings → API → service_role (secret)."
    read -rsp "Paste service role key (input hidden): " SUPABASE_SERVICE_ROLE_KEY
    echo
  fi
  : "${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY required}"

  # No password / token prompt here. The auth section below will:
  #   - use SUPABASE_ACCESS_TOKEN if set, else
  #   - use SUPABASE_PASSWORD if set, else
  #   - fall through to admin/generate_link (service-role-only, no password)
fi

REST="$SUPABASE_URL/rest/v1"
AUTH="$SUPABASE_URL/auth/v1"

echo "[setup] Target: $SUPABASE_URL"
echo

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

PASS_COUNT=0
FAIL_COUNT=0
declare -a CREATED_DELTA_REASONS=()  # for cleanup

pass() { echo "[PASS] $1"; PASS_COUNT=$((PASS_COUNT+1)); }
fail() { echo "[FAIL] $1"; echo "       detail: $2"; FAIL_COUNT=$((FAIL_COUNT+1)); }

# rpc_call <function> <json_body>
# Writes HTTP code to global HTTP_CODE and body to global RESP.
# (Writing to globals — not stdout — avoids the bash subshell trap where
#  $(rpc_call …) loses HTTP_CODE assignments made inside.)
rpc_call() {
  local fn="$1"; local body="$2"
  local tmp; tmp=$(mktemp)
  HTTP_CODE=$(curl -s -o "$tmp" -w "%{http_code}" \
    -X POST "$REST/rpc/$fn" \
    -H "apikey: $SUPABASE_ANON_KEY" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$body")
  RESP=$(cat "$tmp")
  rm -f "$tmp"
}

# admin_rpc_call <function> <json_body>  → uses service-role key, bypasses RLS
admin_rpc_call() {
  local fn="$1"; local body="$2"
  curl -s -X POST "$REST/rpc/$fn" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d "$body"
}

# ---------------------------------------------------------------------------
# Auth setup
# ---------------------------------------------------------------------------

if [[ $CLOUD_MODE -eq 0 ]]; then
  echo "[auth] Resetting local password for $AUDITOR_EMAIL..."
  RESET_RESP=$(curl -s -X PUT "$AUTH/admin/users/$AUDITOR_ID" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"password\":\"$SMOKE_PASSWORD\"}")
  if ! echo "$RESET_RESP" | jq -e '.id' >/dev/null 2>&1; then
    fail "password reset" "$RESET_RESP"; exit 1
  fi
  pass "password reset for $AUDITOR_EMAIL"

  echo "[auth] Signing in to get access token..."
  TOKEN_RESP=$(curl -s -X POST "$AUTH/token?grant_type=password" \
    -H "apikey: $SUPABASE_ANON_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$AUDITOR_EMAIL\",\"password\":\"$SMOKE_PASSWORD\"}")
  ACCESS_TOKEN=$(echo "$TOKEN_RESP" | jq -r '.access_token // empty')
  if [[ -z "$ACCESS_TOKEN" || "$ACCESS_TOKEN" == "null" ]]; then
    fail "sign-in" "$TOKEN_RESP"; exit 1
  fi
  pass "sign-in (got access_token)"
else
  if [[ -n "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
    ACCESS_TOKEN="$SUPABASE_ACCESS_TOKEN"
    pass "using user-supplied access token"
  elif [[ -n "${SUPABASE_PASSWORD:-}" ]]; then
    echo "[auth] Signing in to cloud as $AUDITOR_EMAIL via password grant..."
    TOKEN_RESP=$(curl -s -X POST "$AUTH/token?grant_type=password" \
      -H "apikey: $SUPABASE_ANON_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"email\":\"$AUDITOR_EMAIL\",\"password\":\"$SUPABASE_PASSWORD\"}")
    ACCESS_TOKEN=$(echo "$TOKEN_RESP" | jq -r '.access_token // empty')
    if [[ -z "$ACCESS_TOKEN" || "$ACCESS_TOKEN" == "null" ]]; then
      fail "cloud password grant" "$TOKEN_RESP"; exit 1
    fi
    unset SUPABASE_PASSWORD
    pass "cloud sign-in (password grant)"
  else
    echo "[auth] Minting access token via admin/generate_link (no password needed)..."
    # Step 1: ask GoTrue to mint a magiclink for this user. With service-role
    # auth, the response includes the OTP/hashed_token directly — no email is
    # actually sent. This works whether or not the user has a password set.
    LINK_RESP=$(curl -s -X POST "$AUTH/admin/generate_link" \
      -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
      -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"type\":\"magiclink\",\"email\":\"$AUDITOR_EMAIL\"}")
    # The response has email_otp (6-digit OTP for POST /verify) and hashed_token
    # (longer hash for GET /verify URL flow). POST /verify wants email_otp.
    EMAIL_OTP=$(echo "$LINK_RESP" | jq -r '.email_otp // .properties.email_otp // empty')
    if [[ -z "$EMAIL_OTP" || "$EMAIL_OTP" == "null" ]]; then
      fail "admin/generate_link (no email_otp in response)" "$LINK_RESP"
      echo "       (this user may not exist on cloud — create them first or use SUPABASE_ACCESS_TOKEN)"
      exit 1
    fi
    # Step 2: exchange the OTP for a session via POST /verify.
    VERIFY_RESP=$(curl -s -X POST "$AUTH/verify" \
      -H "apikey: $SUPABASE_ANON_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"type\":\"magiclink\",\"token\":\"$EMAIL_OTP\",\"email\":\"$AUDITOR_EMAIL\"}")
    ACCESS_TOKEN=$(echo "$VERIFY_RESP" | jq -r '.access_token // empty')
    if [[ -z "$ACCESS_TOKEN" || "$ACCESS_TOKEN" == "null" ]]; then
      fail "auth/verify magiclink" "$VERIFY_RESP"; exit 1
    fi
    pass "minted access token via admin magiclink (no user password used)"
  fi
fi
echo

# ---------------------------------------------------------------------------
# Look up dynamic IDs (protocol_version_id for audit-002, etc.)
# ---------------------------------------------------------------------------

PV_002=$(curl -s "$REST/audits?id=eq.$AUDIT_002&select=protocol_version_id" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $ACCESS_TOKEN" | jq -r '.[0].protocol_version_id')

if [[ -z "$PV_002" || "$PV_002" == "null" ]]; then
  fail "lookup pv_002" "audit-002 not visible to this user"
  echo
  echo "Note: this likely means the test user doesn't have RLS access to the seeded audits."
  echo "Aborting before mutations."
  exit 1
fi
pass "RLS visibility — audit-002 readable, pv_id=$PV_002"
echo

# ---------------------------------------------------------------------------
# Test 1 — Stage 1 Intake: create_protocol_risk
# ---------------------------------------------------------------------------

echo "════════════════════════════════════════════════════════════════"
echo "  Test 1 — Stage 1: create_protocol_risk"
echo "════════════════════════════════════════════════════════════════"

REASON_T1="t1 create_protocol_risk $SMOKE_REASON_TAG"
CREATED_DELTA_REASONS+=("$REASON_T1")
rpc_call audit_mode_create_protocol_risk "$(jq -n \
  --arg pv "$PV_002" \
  --arg reason "$REASON_T1" \
  '{p_protocol_version_id:$pv, p_section_identifier:"5.7", p_section_title:"Smoke t1",
    p_endpoint_tier:"PRIMARY", p_impact_surface:"BOTH", p_time_sensitivity:true,
    p_vendor_dependency_flags:["EDC"], p_operational_domain_tag:"EDC",
    p_version_change_type:"ADDED", p_reason:$reason}')"
NEW_PR_ID=$(echo "$RESP" | jq -r '.id // empty')
if [[ -n "$NEW_PR_ID" && "$HTTP_CODE" == "200" ]]; then
  pass "T1: protocol_risk created id=$NEW_PR_ID"
else
  fail "T1: create_protocol_risk" "code=$HTTP_CODE body=$RESP"
fi
echo

# ---------------------------------------------------------------------------
# Test 2 — Stage 2: update_vendor_service
# ---------------------------------------------------------------------------

echo "════════════════════════════════════════════════════════════════"
echo "  Test 2 — Stage 2: update_vendor_service"
echo "════════════════════════════════════════════════════════════════"

REASON_T2="t2 update_vendor_service $SMOKE_REASON_TAG"
CREATED_DELTA_REASONS+=("$REASON_T2")
ORIG_NAME=$(curl -s "$REST/vendor_service_objects?id=eq.$VS_001&select=service_name" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $ACCESS_TOKEN" | jq -r '.[0].service_name')

NEW_NAME="$ORIG_NAME (smoke t2)"
rpc_call audit_mode_update_vendor_service "$(jq -n \
  --arg id "$VS_001" --arg name "$NEW_NAME" --arg reason "$REASON_T2" \
  '{p_id:$id, p_service_name:$name, p_service_type:null, p_service_description:null, p_reason:$reason}')"
RETURNED_NAME=$(echo "$RESP" | jq -r '.service_name // empty')
if [[ "$RETURNED_NAME" == "$NEW_NAME" && "$HTTP_CODE" == "200" ]]; then
  pass "T2: vendor_service name updated"
else
  fail "T2: update_vendor_service" "code=$HTTP_CODE body=$RESP"
fi

# Restore original name (so other tests don't see the smoke value)
rpc_call audit_mode_update_vendor_service "$(jq -n \
  --arg id "$VS_001" --arg name "$ORIG_NAME" --arg reason "t2 restore $SMOKE_REASON_TAG" \
  '{p_id:$id, p_service_name:$name, p_service_type:null, p_service_description:null, p_reason:$reason}')" >/dev/null
CREATED_DELTA_REASONS+=("t2 restore $SMOKE_REASON_TAG")
echo

# ---------------------------------------------------------------------------
# Test 3 — Stage 2: derive_criticality (server-side determinism)
# ---------------------------------------------------------------------------

echo "════════════════════════════════════════════════════════════════"
echo "  Test 3 — Stage 2: server-side criticality derivation"
echo "════════════════════════════════════════════════════════════════"

check_derive() {
  local tier="$1"; local surface="$2"; local time_sens="$3"; local expected="$4"
  rpc_call audit_mode_derive_criticality \
    "$(jq -n --arg t "$tier" --arg s "$surface" --argjson ts "$time_sens" \
       '{p_endpoint_tier:$t, p_impact_surface:$s, p_time_sensitivity:$ts}')"
  local got; got=$(echo "$RESP" | tr -d '"')
  if [[ "$got" == "$expected" ]]; then
    pass "T3: $tier × $surface × time=$time_sens → $expected"
  else
    fail "T3: $tier × $surface × time=$time_sens" "expected $expected, got $got"
  fi
}
check_derive "PRIMARY"    "DATA_INTEGRITY" false "HIGH"
check_derive "PRIMARY"    "DATA_INTEGRITY" true  "CRITICAL"
check_derive "SUPPORTIVE" "DATA_INTEGRITY" false "LOW"
check_derive "SAFETY"     "BOTH"           false "CRITICAL"
echo

# ---------------------------------------------------------------------------
# Test 4 — Stage 3: upsert_questionnaire_response
# ---------------------------------------------------------------------------

echo "════════════════════════════════════════════════════════════════"
echo "  Test 4 — Stage 3: upsert_questionnaire_response"
echo "════════════════════════════════════════════════════════════════"

QI_001=$(curl -s "$REST/questionnaire_instances?audit_id=eq.$AUDIT_001&select=id" \
  -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $ACCESS_TOKEN" | jq -r '.[0].id')
Q_FIRST=$(curl -s "$REST/questionnaire_questions?template_version_id=eq.44444444-4444-4444-4444-444444444411&order=ordinal.asc&limit=1&select=id" \
  -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $ACCESS_TOKEN" | jq -r '.[0].id')

REASON_T4="t4 upsert_response $SMOKE_REASON_TAG"
CREATED_DELTA_REASONS+=("$REASON_T4")
rpc_call audit_mode_upsert_questionnaire_response "$(jq -n \
  --arg inst "$QI_001" --arg q "$Q_FIRST" --arg reason "$REASON_T4" \
  '{p_instance_id:$inst, p_question_id:$q, p_response_text:"Smoke response",
    p_response_status:null, p_source:"AUDITOR_AUTHORED", p_source_reference:null, p_reason:$reason}')"
STATUS=$(echo "$RESP" | jq -r '.response_status // empty')
NEW_RESP_ID=$(echo "$RESP" | jq -r '.id // empty')
if [[ "$STATUS" == "ANSWERED" && "$HTTP_CODE" == "200" ]]; then
  pass "T4: response upserted, status auto-derived to ANSWERED"
else
  fail "T4: upsert_questionnaire_response" "code=$HTTP_CODE body=$RESP"
fi
echo

# ---------------------------------------------------------------------------
# Test 5 — Stage 3: set_questionnaire_inconsistency
# ---------------------------------------------------------------------------

echo "════════════════════════════════════════════════════════════════"
echo "  Test 5 — Stage 3: set_questionnaire_inconsistency"
echo "════════════════════════════════════════════════════════════════"

REASON_T5="t5 inconsistency $SMOKE_REASON_TAG"
CREATED_DELTA_REASONS+=("$REASON_T5")
rpc_call audit_mode_set_questionnaire_inconsistency "$(jq -n \
  --arg id "$NEW_RESP_ID" --arg reason "$REASON_T5" \
  '{p_response_id:$id, p_flag:true, p_note:"Conflicts with cert claim", p_reason:$reason}')"
FLAG=$(echo "$RESP" | jq -r '.inconsistency_flag // empty')
if [[ "$FLAG" == "true" && "$HTTP_CODE" == "200" ]]; then
  pass "T5: inconsistency flag set"
else
  fail "T5: set_questionnaire_inconsistency" "code=$HTTP_CODE body=$RESP"
fi

# Reset flag back to false
rpc_call audit_mode_set_questionnaire_inconsistency "$(jq -n \
  --arg id "$NEW_RESP_ID" --arg reason "t5 reset $SMOKE_REASON_TAG" \
  '{p_response_id:$id, p_flag:false, p_note:null, p_reason:$reason}')" >/dev/null
CREATED_DELTA_REASONS+=("t5 reset $SMOKE_REASON_TAG")
echo

# ---------------------------------------------------------------------------
# Test 6 — Stage 4: approve + revoke risk_summary
# ---------------------------------------------------------------------------

echo "════════════════════════════════════════════════════════════════"
echo "  Test 6 — Stage 4: approve + revoke risk_summary"
echo "════════════════════════════════════════════════════════════════"

REASON_T6A="t6a approve_risk_summary $SMOKE_REASON_TAG"
REASON_T6B="t6b revoke_risk_summary $SMOKE_REASON_TAG"
CREATED_DELTA_REASONS+=("$REASON_T6A" "$REASON_T6B")
rpc_call audit_mode_approve_risk_summary "$(jq -n \
  --arg id "$RS_001" --arg reason "$REASON_T6A" '{p_id:$id, p_reason:$reason}')"
STATUS_AFTER_APPROVE=$(echo "$RESP" | jq -r '.approval_status // empty')

rpc_call audit_mode_revoke_risk_summary_approval "$(jq -n \
  --arg id "$RS_001" --arg reason "$REASON_T6B" '{p_id:$id, p_reason:$reason}')"
STATUS_AFTER_REVOKE=$(echo "$RESP" | jq -r '.approval_status // empty')

if [[ "$STATUS_AFTER_APPROVE" == "APPROVED" && "$STATUS_AFTER_REVOKE" == "DRAFT" ]]; then
  pass "T6: DRAFT → APPROVED → DRAFT round trip"
else
  fail "T6: approve/revoke cycle" "approve=$STATUS_AFTER_APPROVE revoke=$STATUS_AFTER_REVOKE"
fi
echo

# ---------------------------------------------------------------------------
# Test 7 — Stage 5: agenda lifecycle (create → approve → no-op → edit-demote)
# ---------------------------------------------------------------------------

echo "════════════════════════════════════════════════════════════════"
echo "  Test 7 — Stage 5: agenda lifecycle"
echo "════════════════════════════════════════════════════════════════"

CONTENT_A='{"items":[{"id":"a1","time":"09:00","topic":"Kickoff (smoke)"}]}'
CONTENT_B='{"items":[{"id":"a1","time":"10:00","topic":"Kickoff (smoke edit)"}]}'

# Step 1 — create
rpc_call audit_mode_upsert_agenda "$(jq -n \
  --arg id "$AUDIT_001" --argjson c "$CONTENT_A" --arg reason "t7s1 $SMOKE_REASON_TAG" \
  '{p_audit_id:$id, p_content:$c, p_reason:$reason}')"
S1=$(echo "$RESP" | jq -r '.approval_status // empty')
AGENDA_ID=$(echo "$RESP" | jq -r '.id // empty')

# Step 2 — approve
rpc_call audit_mode_approve_agenda "$(jq -n \
  --arg id "$AGENDA_ID" --arg reason "t7s2 $SMOKE_REASON_TAG" '{p_id:$id, p_reason:$reason}')"
S2=$(echo "$RESP" | jq -r '.approval_status // empty')

# Step 3 — same content (no-op, status preserved)
rpc_call audit_mode_upsert_agenda "$(jq -n \
  --arg id "$AUDIT_001" --argjson c "$CONTENT_A" --arg reason "t7s3 $SMOKE_REASON_TAG" \
  '{p_audit_id:$id, p_content:$c, p_reason:$reason}')"
S3=$(echo "$RESP" | jq -r '.approval_status // empty')

# Step 4 — different content (auto-demote to DRAFT)
rpc_call audit_mode_upsert_agenda "$(jq -n \
  --arg id "$AUDIT_001" --argjson c "$CONTENT_B" --arg reason "t7s4 $SMOKE_REASON_TAG" \
  '{p_audit_id:$id, p_content:$c, p_reason:$reason}')"
S4=$(echo "$RESP" | jq -r '.approval_status // empty')

CREATED_DELTA_REASONS+=("t7s1 $SMOKE_REASON_TAG" "t7s2 $SMOKE_REASON_TAG" "t7s3 $SMOKE_REASON_TAG" "t7s4 $SMOKE_REASON_TAG")

if [[ "$S1" == "DRAFT" && "$S2" == "APPROVED" && "$S3" == "APPROVED" && "$S4" == "DRAFT" ]]; then
  pass "T7: lifecycle DRAFT → APPROVED → APPROVED (noop) → DRAFT (edit demote)"
else
  fail "T7: agenda lifecycle" "s1=$S1 s2=$S2 s3=$S3 s4=$S4"
fi
echo

# ---------------------------------------------------------------------------
# Test 8 — Stage 6: workspace entry inherits linked risk attrs
# ---------------------------------------------------------------------------

echo "════════════════════════════════════════════════════════════════"
echo "  Test 8 — Stage 6: workspace_entry risk inheritance"
echo "════════════════════════════════════════════════════════════════"

REASON_T8="t8 create_workspace_entry $SMOKE_REASON_TAG"
CREATED_DELTA_REASONS+=("$REASON_T8")
rpc_call audit_mode_create_workspace_entry "$(jq -n \
  --arg id "$AUDIT_001" --arg pr "$PR_001_01" --arg reason "$REASON_T8" \
  '{p_audit_id:$id, p_vendor_domain:"Validation (smoke)", p_observation_text:"Smoke obs",
    p_provisional_impact:"NONE", p_provisional_classification:"NOT_YET_CLASSIFIED",
    p_checkpoint_ref:null, p_protocol_risk_id:$pr,
    p_vendor_service_mapping_id:null, p_questionnaire_response_id:null, p_reason:$reason}')"
INHERITED=$(echo "$RESP" | jq -r '.risk_attrs_inherited // empty')
TIER=$(echo "$RESP" | jq -r '.inherited_endpoint_tier // empty')
SURFACE=$(echo "$RESP" | jq -r '.inherited_impact_surface // empty')
NEW_WE_ID=$(echo "$RESP" | jq -r '.id // empty')

if [[ "$INHERITED" == "true" && "$TIER" == "PRIMARY" && "$SURFACE" == "DATA_INTEGRITY" ]]; then
  pass "T8: workspace_entry inherited PRIMARY/DATA_INTEGRITY from linked risk"
else
  fail "T8: workspace_entry inheritance" "inherited=$INHERITED tier=$TIER surface=$SURFACE"
fi
echo

# ---------------------------------------------------------------------------
# Test 9 — Stage advancement: forward-by-1 OK, forward-skip-2 must fail
# ---------------------------------------------------------------------------

echo "════════════════════════════════════════════════════════════════"
echo "  Test 9 — Stage advancement gates"
echo "════════════════════════════════════════════════════════════════"

# 9a — forward by 1 (audit-002: INTAKE → VENDOR_ENRICHMENT)
rpc_call audit_mode_advance_audit_stage "$(jq -n \
  --arg id "$AUDIT_002" '{p_audit_id:$id, p_to_stage:"VENDOR_ENRICHMENT"}')"
NEW_STAGE=$(echo "$RESP" | jq -r '.current_stage // empty')
if [[ "$NEW_STAGE" == "VENDOR_ENRICHMENT" && "$HTTP_CODE" == "200" ]]; then
  pass "T9a: advance INTAKE → VENDOR_ENRICHMENT OK"
else
  fail "T9a: forward-by-1" "code=$HTTP_CODE body=$RESP"
fi

# 9b — forward by 2 (skip-ahead from VENDOR_ENRICHMENT → QUESTIONNAIRE_REVIEW is +1, OK;
# we want skip 2: VENDOR_ENRICHMENT → SCOPE_AND_RISK_REVIEW). Should fail.
rpc_call audit_mode_advance_audit_stage "$(jq -n \
  --arg id "$AUDIT_002" '{p_audit_id:$id, p_to_stage:"SCOPE_AND_RISK_REVIEW"}')"
ERR_MSG=$(echo "$RESP" | jq -r '.message // .hint // .details // .error // empty')
if [[ "$HTTP_CODE" =~ ^4|^5 ]] && echo "$ERR_MSG" | grep -qi "exactly one stage"; then
  pass "T9b: skip-2 correctly blocked"
else
  fail "T9b: skip-2 should have been blocked" "code=$HTTP_CODE body=$RESP"
fi

# Restore audit-002 back to INTAKE
rpc_call audit_mode_advance_audit_stage "$(jq -n \
  --arg id "$AUDIT_002" '{p_audit_id:$id, p_to_stage:"INTAKE"}')" >/dev/null
echo

# ---------------------------------------------------------------------------
# Test 10 — public history RPC returns deltas with correct actor
# ---------------------------------------------------------------------------

echo "════════════════════════════════════════════════════════════════"
echo "  Test 10 — audit_mode_get_object_history returns recent delta"
echo "════════════════════════════════════════════════════════════════"

rpc_call audit_mode_get_object_history "$(jq -n \
  --arg type "VENDOR_SERVICE_OBJECT" --arg id "$VS_001" \
  '{p_object_type:$type, p_object_id:$id}')"

# Look for the t2 delta we just wrote
COUNT=$(echo "$RESP" | jq "[.[] | select(.reason | contains(\"t2 update_vendor_service\"))] | length")
ACTOR=$(echo "$RESP" | jq -r ".[] | select(.reason | contains(\"t2 update_vendor_service\")) | .actor_name" | head -1)

if [[ "$COUNT" -ge 1 && -n "$ACTOR" && "$ACTOR" != "(unknown user)" ]]; then
  pass "T10: history RPC returned t2 delta, actor_name=$ACTOR"
else
  fail "T10: history RPC" "count=$COUNT actor=$ACTOR (expected ≥1 with real actor name)"
fi
echo

# ---------------------------------------------------------------------------
# Cleanup — delete all smoke-test deltas + the rows we created
# ---------------------------------------------------------------------------

echo "════════════════════════════════════════════════════════════════"
echo "  Cleanup"
echo "════════════════════════════════════════════════════════════════"

# Delete the protocol_risk we created in T1 (cascades not configured so direct DELETE)
if [[ -n "${NEW_PR_ID:-}" ]]; then
  curl -s -X DELETE "$REST/protocol_risk_objects?id=eq.$NEW_PR_ID" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" >/dev/null
fi

# Delete the workspace_entry we created in T8
if [[ -n "${NEW_WE_ID:-}" ]]; then
  curl -s -X DELETE "$REST/audit_workspace_entry_objects?id=eq.$NEW_WE_ID" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" >/dev/null
fi

# Delete the agenda we created in T7
curl -s -X DELETE "$REST/agenda_objects?audit_id=eq.$AUDIT_001" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" >/dev/null

# Delete every state_history_deltas row whose reason contains our smoke tag
curl -s -X DELETE "$REST/state_history_deltas?reason=like.*$(printf '%s' "$SMOKE_REASON_TAG" | sed 's/ /%20/g')*" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" >/dev/null

# Delete the questionnaire_response we created in T4 (also cleans T5)
if [[ -n "${NEW_RESP_ID:-}" ]]; then
  curl -s -X DELETE "$REST/questionnaire_response_objects?id=eq.$NEW_RESP_ID" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" >/dev/null
fi

echo "[cleanup] smoke-test rows deleted"
echo

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

echo "════════════════════════════════════════════════════════════════"
echo "  RESULT: $PASS_COUNT passed, $FAIL_COUNT failed"
echo "════════════════════════════════════════════════════════════════"

if [[ $FAIL_COUNT -gt 0 ]]; then
  exit 1
fi
exit 0
