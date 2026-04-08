#!/usr/bin/env bash
# e2e-test.sh — Clean-slate end-to-end test for the Agency Web Stack.
# Creates a fresh project via the CLI (not GUI), validates it, then cleans up.
#
# Usage: bash scripts/e2e-test.sh [--keep]
#   --keep   Don't delete the test project after (for manual inspection)
#
# This script:
# 1. Stops all running Docker containers from previous test runs
# 2. Removes any existing test project
# 3. Creates a new full-stack project using create-project.mjs
# 4. Runs init-project.sh to start all services
# 5. Runs validate-template.sh --full to verify everything
# 6. Cleans up (unless --keep)

set -euo pipefail

# ─── Colors ───────────────────────────────────────────────────────────────────
GREEN="\033[0;32m"
RED="\033[0;31m"
YELLOW="\033[0;33m"
CYAN="\033[0;36m"
RESET="\033[0m"

# ─── Config ───────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TEST_DIR="$HOME/Desktop/AI Projects/testing"
PROJECT_NAME="e2e-test-$(date +%s)"
PROJECT_PATH="$TEST_DIR/$PROJECT_NAME"

KEEP=false
for arg in "$@"; do
  case "$arg" in
    --keep) KEEP=true ;;
  esac
done

# ─── Helpers ──────────────────────────────────────────────────────────────────
step()  { echo -e "\n${CYAN}━━━ $* ━━━${RESET}"; }
ok()    { echo -e "  ${GREEN}✓${RESET} $*"; }
fail()  { echo -e "  ${RED}✗${RESET} $*"; }
warn()  { echo -e "  ${YELLOW}!${RESET} $*"; }

cleanup() {
  if [[ "$KEEP" == false && -d "$PROJECT_PATH" ]]; then
    step "Cleaning up test project"
    # Stop Docker services
    cd "$PROJECT_PATH" 2>/dev/null && pnpm supabase stop 2>/dev/null || true
    local twenty_dir="$PROJECT_PATH/docker/twenty"
    if [[ -f "$twenty_dir/docker-compose.yml" ]]; then
      cd "$twenty_dir" && docker compose down 2>/dev/null || true
    fi
    rm -rf "$PROJECT_PATH"
    ok "Removed $PROJECT_PATH"
  elif [[ "$KEEP" == true ]]; then
    warn "Keeping test project at: $PROJECT_PATH"
  fi
}
trap cleanup EXIT

# ═══════════════════════════════════════════════════════════════════════════════
# 1. PREREQUISITES CHECK
# ═══════════════════════════════════════════════════════════════════════════════
step "1. Checking prerequisites"

command -v node &>/dev/null || { fail "Node.js not found"; exit 1; }
command -v pnpm &>/dev/null || { fail "pnpm not found"; exit 1; }
command -v docker &>/dev/null || { fail "Docker not found"; exit 1; }
docker info &>/dev/null 2>&1 || { fail "Docker daemon not running"; exit 1; }

ok "Node.js $(node --version)"
ok "pnpm $(pnpm --version)"
ok "Docker running"

# ═══════════════════════════════════════════════════════════════════════════════
# 2. CLEAN SLATE
# ═══════════════════════════════════════════════════════════════════════════════
step "2. Preparing clean slate"

# Stop any existing Supabase/Twenty containers that might conflict
echo "  Stopping any existing test containers..."
existing=$(docker ps --format "{{.Names}}" 2>/dev/null | grep -E "supabase_|twenty" || true)
if [[ -n "$existing" ]]; then
  while read -r name; do
    docker stop "$name" 2>/dev/null && ok "Stopped $name" || true
  done <<< "$existing"
else
  ok "No conflicting containers running"
fi

# Create test directory
mkdir -p "$TEST_DIR"
if [[ -d "$PROJECT_PATH" ]]; then
  warn "Removing existing $PROJECT_PATH"
  rm -rf "$PROJECT_PATH"
fi
ok "Test directory ready: $TEST_DIR"

# ═══════════════════════════════════════════════════════════════════════════════
# 3. CLONE AND CREATE PROJECT
# ═══════════════════════════════════════════════════════════════════════════════
step "3. Creating project: $PROJECT_NAME"

# Copy the template (exclude node_modules, .git, and other heavy dirs)
cd "$TEST_DIR"
rsync -a \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='.next' \
  --exclude='.astro' \
  --exclude='.turbo' \
  "$TEMPLATE_ROOT/" "$PROJECT_NAME/"
ok "Copied template to $PROJECT_PATH"

# Install dependencies
cd "$PROJECT_PATH"
pnpm install 2>&1 | tail -5
ok "Dependencies installed"

# Run create-project.mjs with full preset
node scripts/create-project.mjs --name="$PROJECT_NAME" --preset=full --no-install
ok "Project created with 'full' preset"

# ═══════════════════════════════════════════════════════════════════════════════
# 4. INITIALIZE PROJECT (start services)
# ═══════════════════════════════════════════════════════════════════════════════
step "4. Initializing project (starting services)"

bash scripts/init-project.sh "$PROJECT_NAME"
ok "init-project.sh completed"

# Give services time to fully boot (Twenty CRM needs 60-90s for first migration)
echo "  Waiting 90s for services to stabilize (Twenty CRM first-boot migrations)..."
sleep 90

# ═══════════════════════════════════════════════════════════════════════════════
# 5. VALIDATE
# ═══════════════════════════════════════════════════════════════════════════════
step "5. Running validation"

if bash scripts/validate-template.sh; then
  ok "All validation checks passed"
else
  fail "Some validation checks failed (see output above)"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# 6. SMOKE TEST: Check key URLs
# ═══════════════════════════════════════════════════════════════════════════════
step "6. Smoke testing URLs"

# Read ports
if [[ -f "$PROJECT_PATH/.ports" ]]; then
  source "$PROJECT_PATH/.ports" 2>/dev/null || true
fi

check_url() {
  local label="$1" url="$2"
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$url" 2>/dev/null || echo "000")"
  if [[ "$code" =~ ^(200|301|302|303|307|308)$ ]]; then
    ok "$label: HTTP $code at $url"
  else
    fail "$label: HTTP $code at $url"
  fi
}

# Check Supabase Studio (if port known)
if [[ -n "${SUPABASE_STUDIO:-}" ]]; then
  check_url "Supabase Studio" "http://localhost:$SUPABASE_STUDIO"
fi

# Check Twenty CRM (if port known)
if [[ -n "${TWENTY:-}" ]]; then
  check_url "Twenty CRM" "http://localhost:$TWENTY"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# SUMMARY
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${GREEN}━━━ E2E TEST COMPLETE ━━━${RESET}"
echo "  Project: $PROJECT_PATH"
if [[ "$KEEP" == true ]]; then
  echo "  Status: Kept for inspection (use 'rm -rf $PROJECT_PATH' to clean up)"
else
  echo "  Status: Will be cleaned up on exit"
fi
echo ""
