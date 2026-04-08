#!/usr/bin/env bash
# validate-template.sh — Health check for the Website Template monorepo.
# Usage: ./scripts/validate-template.sh [--full] [--fix]
#   --full  Run dev-server smoke tests (starts Astro + Next.js, then stops them)
#   --fix   Auto-fix what can be fixed (e.g. apply RLS to public tables)

set -euo pipefail

# ─── Colors ───────────────────────────────────────────────────────────────────
GREEN="\033[0;32m"
RED="\033[0;31m"
YELLOW="\033[0;33m"
RESET="\033[0m"

# ─── Counters ─────────────────────────────────────────────────────────────────
PASSED=0
FAILED=0
SKIPPED=0

# ─── Flags ────────────────────────────────────────────────────────────────────
RUN_FULL=false
RUN_FIX=false
for arg in "$@"; do
  case "$arg" in
    --full) RUN_FULL=true ;;
    --fix)  RUN_FIX=true  ;;
  esac
done

# ─── Resolve repo root (script lives in scripts/) ─────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ─── Helpers ──────────────────────────────────────────────────────────────────
pass()  { echo -e "  ${GREEN}[PASS]${RESET} $*"; PASSED=$((PASSED + 1));  }
fail()  { echo -e "  ${RED}[FAIL]${RESET} $*"; FAILED=$((FAILED + 1));  }
skip()  { echo -e "  ${YELLOW}[SKIP]${RESET} $*"; SKIPPED=$((SKIPPED + 1)); }

section() { echo -e "\n${YELLOW}▶ $*${RESET}"; }

check_file() {
  local path="$1"
  local label="${2:-$path}"
  if [[ -f "$ROOT/$path" ]]; then
    pass "$label exists"
  else
    fail "$label missing: $ROOT/$path"
  fi
}

# ═══════════════════════════════════════════════════════════════════════════════
# 1. PREREQUISITES
# ═══════════════════════════════════════════════════════════════════════════════
section "1. Prerequisites"

check_node() {
  if ! command -v node &>/dev/null; then
    fail "Node.js not found"
    return
  fi
  local ver
  ver="$(node --version | sed 's/v//')"
  local major="${ver%%.*}"
  if (( major >= 20 )); then
    pass "Node.js >= 20 (found v${ver})"
  else
    fail "Node.js >= 20 required (found v${ver})"
  fi
}

check_pnpm() {
  if command -v pnpm &>/dev/null; then
    pass "pnpm installed ($(pnpm --version))"
  else
    fail "pnpm not found — install with: corepack enable pnpm"
  fi
}

check_docker() {
  if ! command -v docker &>/dev/null; then
    fail "docker CLI not found"
    return
  fi
  if docker info &>/dev/null 2>&1; then
    pass "Docker daemon running"
  else
    fail "Docker daemon not running — start Docker Desktop"
  fi
}

check_node
check_pnpm
check_docker

# ═══════════════════════════════════════════════════════════════════════════════
# 2. DEPENDENCIES
# ═══════════════════════════════════════════════════════════════════════════════
section "2. Dependencies"

check_install() {
  pushd "$ROOT" >/dev/null
  if pnpm install --frozen-lockfile 2>&1 | grep -q "ERR_PNPM"; then
    fail "pnpm install failed"
  else
    pass "pnpm install succeeded"
  fi
  popd >/dev/null
}

check_install

# ═══════════════════════════════════════════════════════════════════════════════
# 3. FILE STRUCTURE
# ═══════════════════════════════════════════════════════════════════════════════
section "3. File Structure — Root"
check_file "package.json"
check_file "pnpm-workspace.yaml"
check_file ".env.template"
check_file ".mcp.json"
check_file ".gitignore"

section "3. File Structure — Astro"
check_file "templates/astro-site/astro.config.mjs"
check_file "templates/astro-site/src/layouts/Layout.astro"
check_file "templates/astro-site/src/styles/global.css"
check_file "templates/astro-site/sentry.client.config.ts" "Astro sentry.client.config.ts"
check_file "templates/astro-site/sentry.server.config.ts" "Astro sentry.server.config.ts"

section "3. File Structure — Next.js"
check_file "templates/next-app/next.config.ts"
check_file "templates/next-app/src/payload.config.ts"
check_file "templates/next-app/src/app/layout.tsx"
check_file "templates/next-app/src/app/(app)/layout.tsx"
check_file "templates/next-app/src/app/(payload)/layout.tsx"
check_file "templates/next-app/src/proxy.ts"
check_file "templates/next-app/sentry.client.config.ts" "Next.js sentry.client.config.ts"
check_file "templates/next-app/sentry.server.config.ts" "Next.js sentry.server.config.ts"

section "3. File Structure — Shared Package"
check_file "packages/shared/src/supabase/client.ts"
check_file "packages/shared/src/posthog/init.ts"
check_file "packages/shared/src/resend/client.ts"

section "3. File Structure — Docker & Supabase"
check_file "docker/twenty/docker-compose.yml"
check_file "supabase/config.toml"

# ═══════════════════════════════════════════════════════════════════════════════
# 4. CONFIGURATION QUALITY
# ═══════════════════════════════════════════════════════════════════════════════
section "4. Configuration Quality"

check_env_template() {
  local file="$ROOT/.env.template"
  [[ -f "$file" ]] || { fail ".env.template missing (skipping var checks)"; return; }
  local required_vars=(
    NEXT_PUBLIC_SUPABASE_URL
    NEXT_PUBLIC_SUPABASE_ANON_KEY
    SUPABASE_SERVICE_ROLE_KEY
    PUBLIC_SUPABASE_URL
    PUBLIC_SUPABASE_ANON_KEY
    NEXT_PUBLIC_POSTHOG_KEY
    NEXT_PUBLIC_POSTHOG_HOST
    PUBLIC_POSTHOG_KEY
    PUBLIC_POSTHOG_HOST
    SENTRY_DSN
    SENTRY_AUTH_TOKEN
    SENTRY_ORG
    SENTRY_PROJECT
    NEXT_PUBLIC_SENTRY_DSN
    PUBLIC_SENTRY_DSN
    RESEND_API_KEY
    TWENTY_API_URL
    TWENTY_API_KEY
    PAYLOAD_SECRET
    DATABASE_URL
    NEXT_PUBLIC_SERVER_URL
  )
  local missing=()
  for var in "${required_vars[@]}"; do
    grep -q "^${var}=" "$file" || missing+=("$var")
  done
  if (( ${#missing[@]} == 0 )); then
    pass ".env.template has all ${#required_vars[@]} required variables"
  else
    fail ".env.template missing vars: ${missing[*]}"
  fi
}

check_next_config() {
  local file="$ROOT/templates/next-app/next.config.ts"
  [[ -f "$file" ]] || { fail "next.config.ts missing"; return; }
  local ok=true
  grep -q "withPayload" "$file"      || { fail "next.config.ts missing withPayload wrapper"; ok=false; }
  grep -q "withSentryConfig" "$file" || { fail "next.config.ts missing withSentryConfig wrapper"; ok=false; }
  [[ "$ok" == true ]] && pass "next.config.ts has withPayload + withSentryConfig wrappers"
}

check_astro_port() {
  local file="$ROOT/templates/astro-site/astro.config.mjs"
  [[ -f "$file" ]] || { fail "astro.config.mjs missing"; return; }
  # Accept any port in the 4400-4499 range (unique per project via hash offset)
  if grep -qE "port.*4[0-9]{3}" "$file"; then
    local port
    port="$(grep -oE "port:\s*[0-9]+" "$file" | grep -oE "[0-9]+" | head -1)"
    pass "astro.config.mjs sets server.port = ${port:-unknown}"
  else
    fail "astro.config.mjs does not set a server.port (expected 4400-4499)"
  fi
}

check_payload_secret() {
  local file="$ROOT/templates/next-app/src/payload.config.ts"
  [[ -f "$file" ]] || { fail "payload.config.ts missing"; return; }
  # Look for a guard that throws/errors when PAYLOAD_SECRET is absent in production
  if grep -qE "throw|process\.exit|error" "$file"; then
    pass "payload.config.ts appears to guard missing PAYLOAD_SECRET"
  else
    fail "payload.config.ts may not throw on missing PAYLOAD_SECRET in production"
  fi
}

check_no_hardcoded_secrets() {
  # Patterns that indicate real secret values committed (not placeholders / empty assignments)
  local suspicious
  suspicious="$(grep -rE \
    "(sk_live_|sk_test_|rk_live_)[A-Za-z0-9]{20,}|eyJhbGci[A-Za-z0-9._-]{40,}" \
    "$ROOT" \
    --include="*.ts" --include="*.tsx" --include="*.mjs" --include="*.js" \
    --exclude-dir=node_modules --exclude-dir=".git" \
    -l 2>/dev/null || true)"
  if [[ -z "$suspicious" ]]; then
    pass "No hardcoded secrets detected in committed source files"
  else
    fail "Possible hardcoded secrets found in: $(echo "$suspicious" | tr '\n' ' ')"
  fi
}

check_env_template
check_next_config
check_astro_port
check_payload_secret
check_no_hardcoded_secrets

# ═══════════════════════════════════════════════════════════════════════════════
# 5. DOCKER SERVICES
# ═══════════════════════════════════════════════════════════════════════════════
section "5. Docker Services"

check_docker_services() {
  if ! docker info &>/dev/null 2>&1; then
    skip "Docker not running — skipping container health checks"
    return
  fi

  # Supabase containers (started via supabase CLI — container names begin with supabase_)
  local supabase_containers
  supabase_containers="$(docker ps --filter "name=supabase" --format "{{.Names}}" 2>/dev/null || true)"
  if [[ -z "$supabase_containers" ]]; then
    skip "Supabase containers not running"
  else
    local unhealthy
    unhealthy="$(docker ps --filter "name=supabase" --filter "health=unhealthy" --format "{{.Names}}" 2>/dev/null || true)"
    if [[ -z "$unhealthy" ]]; then
      pass "Supabase containers running and healthy"
    else
      fail "Unhealthy Supabase containers: $unhealthy"
    fi
  fi

  # Twenty CRM containers
  local twenty_containers
  twenty_containers="$(docker ps --filter "name=twenty" --format "{{.Names}}" 2>/dev/null || true)"
  if [[ -z "$twenty_containers" ]]; then
    skip "Twenty CRM containers not running"
  else
    local twenty_unhealthy
    twenty_unhealthy="$(docker ps --filter "name=twenty" --filter "health=unhealthy" --format "{{.Names}}" 2>/dev/null || true)"
    if [[ -z "$twenty_unhealthy" ]]; then
      pass "Twenty CRM containers running and healthy"
    else
      fail "Unhealthy Twenty CRM containers: $twenty_unhealthy"
    fi
  fi

  # Postgres connection (Supabase local default: port 54322)
  if command -v pg_isready &>/dev/null; then
    if pg_isready -h localhost -p 54322 -q 2>/dev/null; then
      pass "Postgres accepting connections on :54322"
    else
      skip "Postgres not accepting connections on :54322 (Supabase may not be running)"
    fi
  else
    skip "pg_isready not found — skipping Postgres connection check"
  fi
}

check_docker_services

# ═══════════════════════════════════════════════════════════════════════════════
# 6. DATABASE SECURITY
# ═══════════════════════════════════════════════════════════════════════════════
section "6. Database Security"

check_database_security() {
  # Requires psql and a running Supabase local instance
  if ! command -v psql &>/dev/null; then
    skip "psql not found — skipping database security checks"
    return
  fi
  if ! pg_isready -h localhost -p 54322 -q 2>/dev/null; then
    skip "Postgres not reachable on :54322 — skipping database security checks"
    return
  fi

  local conn="postgresql://postgres:postgres@localhost:54322/postgres"

  # Check tables without RLS
  local no_rls_tables
  no_rls_tables="$(psql "$conn" -At -c \
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN (SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relrowsecurity = true);" \
    2>/dev/null || true)"

  if [[ -z "$no_rls_tables" ]]; then
    pass "All public tables have RLS enabled"
  else
    fail "Public tables missing RLS: $(echo "$no_rls_tables" | tr '\n' ', ' | sed 's/,$//')"
    if [[ "$RUN_FIX" == true ]]; then
      echo "  → --fix: enabling RLS on affected tables..."
      while IFS= read -r tbl; do
        [[ -z "$tbl" ]] && continue
        psql "$conn" -c "ALTER TABLE public.\"$tbl\" ENABLE ROW LEVEL SECURITY;" &>/dev/null \
          && echo "    Fixed: $tbl" || echo "    Could not fix: $tbl"
      done <<< "$no_rls_tables"
    fi
  fi

  # Check auto_enable_rls event trigger exists
  local trigger_exists
  trigger_exists="$(psql "$conn" -At -c \
    "SELECT COUNT(*) FROM pg_event_trigger WHERE evtname = 'auto_enable_rls';" \
    2>/dev/null || echo "0")"
  if [[ "$trigger_exists" -ge 1 ]]; then
    pass "auto_enable_rls event trigger exists"
  else
    fail "auto_enable_rls event trigger not found"
  fi

  # Check the trigger function has search_path = ''
  local fn_search_path
  fn_search_path="$(psql "$conn" -At -c \
    "SELECT prosrc FROM pg_proc WHERE proname = 'auto_enable_rls';" \
    2>/dev/null || true)"
  if echo "$fn_search_path" | grep -q "search_path"; then
    pass "auto_enable_rls function references search_path"
  else
    fail "auto_enable_rls function does not set search_path = '' (SQL injection risk)"
  fi
}

check_database_security

# ═══════════════════════════════════════════════════════════════════════════════
# 7. PORT AVAILABILITY
# ═══════════════════════════════════════════════════════════════════════════════
section "7. Port Availability"

check_port() {
  local port="$1"
  local service="$2"
  # lsof returns 0 when something is listening, non-zero when free
  local pid
  pid="$(lsof -ti tcp:"$port" 2>/dev/null || true)"
  if [[ -z "$pid" ]]; then
    pass "Port $port ($service) is free"
  else
    local cmd
    cmd="$(ps -p "$pid" -o comm= 2>/dev/null || echo "unknown")"
    # Warn but don't fail — the port might legitimately be used by our own service
    pass "Port $port ($service) in use by PID $pid ($cmd) — acceptable if our service"
  fi
}

check_port 4400 "Astro"
check_port 3100 "Next.js / Payload"
check_port 3001 "Twenty CRM"

# ═══════════════════════════════════════════════════════════════════════════════
# 8. DEV SERVER SMOKE TESTS  (only with --full)
# ═══════════════════════════════════════════════════════════════════════════════
section "8. Dev Server Smoke Tests"

ASTRO_PID=""
NEXT_PID=""

cleanup_servers() {
  [[ -n "$ASTRO_PID" ]] && kill "$ASTRO_PID" 2>/dev/null || true
  [[ -n "$NEXT_PID"  ]] && kill "$NEXT_PID"  2>/dev/null || true
}
trap cleanup_servers EXIT

wait_for_port() {
  local port="$1"
  local timeout="${2:-30}"
  local elapsed=0
  while ! lsof -ti tcp:"$port" &>/dev/null; do
    sleep 1
    ((elapsed++))
    if (( elapsed >= timeout )); then
      return 1
    fi
  done
  return 0
}

run_smoke_tests() {
  if [[ "$RUN_FULL" != true ]]; then
    skip "Astro smoke test (pass --full to enable)"
    skip "Next.js smoke test (pass --full to enable)"
    skip "Payload /admin smoke test (pass --full to enable)"
    return
  fi

  # Astro ──────────────────────────────────────────────────────────────────────
  echo "  Starting Astro dev server on :4400..."
  pushd "$ROOT/templates/astro-site" >/dev/null
  pnpm dev &>/tmp/astro-validate.log &
  ASTRO_PID=$!
  popd >/dev/null

  if wait_for_port 4400 60; then
    local astro_body
    astro_body="$(curl -s http://localhost:4400 || true)"
    if [[ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:4400)" == "200" ]]; then
      pass "Astro: HTTP 200 on :4400"
    else
      fail "Astro: did not return HTTP 200"
    fi
    local tmpfile
    tmpfile=$(mktemp)
    curl -s "http://localhost:4400" > "$tmpfile" 2>/dev/null
    if grep -qi "tailwind\|bg-background\|--font-sans" "$tmpfile" 2>/dev/null; then
      pass "Astro: Tailwind CSS present in response"
    else
      fail "Astro: no Tailwind CSS evidence in response body"
    fi
    rm -f "$tmpfile"
  else
    fail "Astro: server did not start within 60s"
  fi

  kill "$ASTRO_PID" 2>/dev/null || true
  ASTRO_PID=""

  # Next.js ────────────────────────────────────────────────────────────────────
  echo "  Starting Next.js dev server on :3100..."
  pushd "$ROOT/templates/next-app" >/dev/null
  pnpm dev &>/tmp/next-validate.log &
  NEXT_PID=$!
  popd >/dev/null

  if wait_for_port 3100 90; then
    local next_code
    next_code="$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3100 || echo "000")"
    if [[ "$next_code" == "200" ]]; then
      pass "Next.js: HTTP 200 on :3100"
    else
      fail "Next.js: returned HTTP $next_code (expected 200)"
    fi

    # Payload /admin
    local admin_body
    admin_body="$(curl -s http://localhost:3100/admin || true)"
    local admin_code
    admin_code="$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3100/admin || echo "000")"
    if [[ "$admin_code" == "200" ]]; then
      pass "Payload /admin: HTTP 200"
    else
      fail "Payload /admin: returned HTTP $admin_code (expected 200)"
    fi

    local html_count body_count
    html_count="$(echo "$admin_body" | grep -oi '<html' | wc -l | tr -d ' ')"
    body_count="$(echo "$admin_body" | grep -oi '<body' | wc -l | tr -d ' ')"
    if [[ "$html_count" == "1" ]]; then
      pass "Payload /admin: exactly 1 <html> tag"
    else
      fail "Payload /admin: found $html_count <html> tags (expected 1)"
    fi
    if [[ "$body_count" == "1" ]]; then
      pass "Payload /admin: exactly 1 <body> tag"
    else
      fail "Payload /admin: found $body_count <body> tags (expected 1)"
    fi
  else
    fail "Next.js: server did not start within 90s"
    skip "Payload /admin: Next.js failed to start"
  fi

  kill "$NEXT_PID" 2>/dev/null || true
  NEXT_PID=""
}

run_smoke_tests

# ═══════════════════════════════════════════════════════════════════════════════
# SUMMARY
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo "=== VALIDATION COMPLETE ==="
echo -e "  ${GREEN}Passed:${RESET}  $PASSED"
echo -e "  ${RED}Failed:${RESET}  $FAILED"
echo -e "  ${YELLOW}Skipped:${RESET} $SKIPPED"
echo ""

if (( FAILED > 0 )); then
  echo -e "${RED}One or more checks failed. Fix the issues above and re-run.${RESET}"
  exit 1
else
  echo -e "${GREEN}All checks passed.${RESET}"
  exit 0
fi
