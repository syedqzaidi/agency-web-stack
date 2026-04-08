#!/usr/bin/env bash
# =============================================================================
# init-project.sh — One-shot setup for the Website Template monorepo
#
# Usage:
#   ./scripts/init-project.sh <project-name>
#
# What it does:
#   1. Validates prerequisites (Node >=20, pnpm, Docker)
#   2. Installs pnpm dependencies
#   3. Generates random secrets (PAYLOAD_SECRET, APP_SECRET)
#   4. Creates .env.local from .env.template with secrets filled in
#   5. Writes docker/twenty/.env with the generated APP_SECRET
#   6. Starts Supabase local dev and captures anon/service-role keys
#   7. Starts Twenty CRM via docker compose
#   8. Boots Next.js once to trigger Payload table creation, then stops it
#   9. Applies RLS ALTER TABLE commands on Payload tables
#  10. Runs scripts/validate-template.sh
#  11. Prints a summary of all URLs, keys, and next steps
#
# Idempotent: safe to run multiple times.
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Colours
# ---------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

ok()   { echo -e "${GREEN}✔${RESET}  $*"; }
info() { echo -e "${CYAN}→${RESET}  $*"; }
warn() { echo -e "${YELLOW}⚠${RESET}  $*"; }
fail() { echo -e "${RED}✘${RESET}  $*" >&2; }
section() { echo -e "\n${BOLD}${CYAN}▶ $*${RESET}"; }

# ---------------------------------------------------------------------------
# Resolve project root (the directory that contains this scripts/ folder)
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${PROJECT_ROOT}"

# ---------------------------------------------------------------------------
# Argument handling
# ---------------------------------------------------------------------------
if [[ $# -lt 1 ]]; then
  fail "Usage: $0 <project-name>"
  echo "  Example: $0 acme-corp" >&2
  exit 1
fi

PROJECT_NAME="$1"
info "Project name: ${BOLD}${PROJECT_NAME}${RESET}"

# ---------------------------------------------------------------------------
# Port allocation — unique per project name to avoid collisions when multiple
# projects run simultaneously on the same machine.
# ---------------------------------------------------------------------------
generate_port_offset() {
  local name="$1"
  # Simple hash: sum ASCII values of every character in the project name, mod 100
  local hash=0
  local i char
  for (( i=0; i<${#name}; i++ )); do
    char="${name:$i:1}"
    hash=$(( hash + $(printf '%d' "'${char}") ))
  done
  echo $(( hash % 100 ))
}

PORT_OFFSET=$(generate_port_offset "${PROJECT_NAME}")
# Supabase needs wider spacing because it allocates 4 consecutive ports
SUPABASE_OFFSET=$(( (PORT_OFFSET % 50) * 10 ))

PORT_ASTRO=$(( 4400 + PORT_OFFSET ))
PORT_NEXTJS=$(( 3100 + PORT_OFFSET ))
PORT_TWENTY=$(( 3200 + PORT_OFFSET ))
PORT_SUPABASE_API=$(( 54321 + SUPABASE_OFFSET ))
PORT_SUPABASE_DB=$(( 54322 + SUPABASE_OFFSET ))
PORT_SUPABASE_SHADOW=$(( 54320 + SUPABASE_OFFSET ))
PORT_SUPABASE_STUDIO=$(( 54323 + SUPABASE_OFFSET ))
PORT_SUPABASE_MAILPIT=$(( 54324 + SUPABASE_OFFSET ))
PORT_SUPABASE_ANALYTICS=$(( 54327 + SUPABASE_OFFSET ))
PORT_SUPABASE_POOLER=$(( 54329 + SUPABASE_OFFSET ))
PORT_SUPABASE_INSPECTOR=$(( 8083 + PORT_OFFSET ))

info "Port offset for '${PROJECT_NAME}': ${PORT_OFFSET}"
info "Ports — Astro: ${PORT_ASTRO}  Next.js: ${PORT_NEXTJS}  Twenty: ${PORT_TWENTY}"
info "Supabase — API: ${PORT_SUPABASE_API}  DB: ${PORT_SUPABASE_DB}  Studio: ${PORT_SUPABASE_STUDIO}  Mailpit: ${PORT_SUPABASE_MAILPIT}  Analytics: ${PORT_SUPABASE_ANALYTICS}"

# ---------------------------------------------------------------------------
# STEP 1 — Prerequisites
# ---------------------------------------------------------------------------
section "Checking prerequisites"

# Node.js >= 20
if ! command -v node &>/dev/null; then
  fail "Node.js is not installed. Install Node.js 20+ from https://nodejs.org"
  exit 1
fi

NODE_VERSION=$(node --version | sed 's/v//' | cut -d. -f1)
if [[ "${NODE_VERSION}" -lt 20 ]]; then
  fail "Node.js >= 20 is required (found v${NODE_VERSION}). Upgrade at https://nodejs.org"
  exit 1
fi
ok "Node.js $(node --version)"

# pnpm
if ! command -v pnpm &>/dev/null; then
  fail "pnpm is not installed. Install with: npm install -g pnpm"
  exit 1
fi
ok "pnpm $(pnpm --version)"

# Docker — daemon must be running
if ! command -v docker &>/dev/null; then
  fail "Docker is not installed. Install from https://docs.docker.com/get-docker/"
  exit 1
fi
if ! docker info &>/dev/null; then
  fail "Docker daemon is not running. Start Docker Desktop (or the daemon) and retry."
  exit 1
fi
ok "Docker $(docker --version | awk '{print $3}' | tr -d ',')"

# openssl (for secret generation)
if ! command -v openssl &>/dev/null; then
  fail "openssl is required for secret generation but was not found on PATH."
  exit 1
fi
ok "openssl available"

# ---------------------------------------------------------------------------
# STEP 2 — Install dependencies
# ---------------------------------------------------------------------------
section "Installing dependencies"
info "Running pnpm install…"
pnpm install
ok "Dependencies installed"

# ---------------------------------------------------------------------------
# STEP 3 — Generate secrets
# ---------------------------------------------------------------------------
section "Generating secrets"

PAYLOAD_SECRET=$(openssl rand -hex 32)
APP_SECRET=$(openssl rand -hex 32)

ok "PAYLOAD_SECRET generated (${#PAYLOAD_SECRET} hex chars)"
ok "APP_SECRET generated (${#APP_SECRET} hex chars)"

# ---------------------------------------------------------------------------
# STEP 3b — Apply unique port configuration to all config files
# ---------------------------------------------------------------------------
section "Configuring unique ports"

# Astro port — astro.config.mjs server.port
ASTRO_CONFIG="${PROJECT_ROOT}/templates/astro-site/astro.config.mjs"
if [[ -f "${ASTRO_CONFIG}" ]]; then
  sed -i.tmp "s/port: [0-9]*/port: ${PORT_ASTRO}/" "${ASTRO_CONFIG}"
  rm -f "${ASTRO_CONFIG}.tmp"
  ok "Astro port set to ${PORT_ASTRO}"
else
  warn "astro.config.mjs not found at ${ASTRO_CONFIG} — skipping Astro port update"
fi

# Next.js port — package.json dev script  --port flag
NEXTJS_PKG="${PROJECT_ROOT}/templates/next-app/package.json"
if [[ -f "${NEXTJS_PKG}" ]]; then
  sed -i.tmp "s/--port [0-9]*/--port ${PORT_NEXTJS}/" "${NEXTJS_PKG}"
  rm -f "${NEXTJS_PKG}.tmp"
  ok "Next.js port set to ${PORT_NEXTJS}"
else
  warn "templates/next-app/package.json not found — skipping Next.js port update"
fi

# Twenty CRM port — docker-compose.yml host port mapping and env vars
TWENTY_COMPOSE="${PROJECT_ROOT}/docker/twenty/docker-compose.yml"
if [[ -f "${TWENTY_COMPOSE}" ]]; then
  sed -i.tmp "s/\"[0-9]*:3000\"/\"${PORT_TWENTY}:3000\"/" "${TWENTY_COMPOSE}"
  sed -i.tmp "s|SERVER_URL=http://localhost:[0-9]*|SERVER_URL=http://localhost:${PORT_TWENTY}|" "${TWENTY_COMPOSE}"
  sed -i.tmp "s|FRONT_BASE_URL=http://localhost:[0-9]*|FRONT_BASE_URL=http://localhost:${PORT_TWENTY}|" "${TWENTY_COMPOSE}"
  rm -f "${TWENTY_COMPOSE}.tmp"
  ok "Twenty CRM port set to ${PORT_TWENTY}"
else
  warn "docker/twenty/docker-compose.yml not found — skipping Twenty port update"
fi

# Supabase ports — config.toml (section-aware replacements via Python)
SUPABASE_CONFIG="${PROJECT_ROOT}/supabase/config.toml"
if [[ -f "${SUPABASE_CONFIG}" ]]; then
  # Update project_id to match project name (ensures unique Docker container names)
  sed -i.tmp "s/^project_id = .*/project_id = \"${PROJECT_NAME}\"/" "${SUPABASE_CONFIG}"
  rm -f "${SUPABASE_CONFIG}.tmp"

  # Use Python for all section-aware port replacements in config.toml.
  # BSD sed (macOS) does not support addr1,addr2{compound-cmd} syntax,
  # so Python is the reliable cross-platform approach.
  python3 - "${SUPABASE_CONFIG}" \
    "${PORT_SUPABASE_API}" \
    "${PORT_SUPABASE_DB}" \
    "${PORT_SUPABASE_SHADOW}" \
    "${PORT_SUPABASE_STUDIO}" \
    "${PORT_SUPABASE_MAILPIT}" \
    "${PORT_SUPABASE_ANALYTICS}" \
    "${PORT_SUPABASE_POOLER}" \
    "${PORT_SUPABASE_INSPECTOR}" <<'PYEOF'
import sys, re

config_path    = sys.argv[1]
api_port       = int(sys.argv[2])
db_port        = int(sys.argv[3])
shadow_port    = int(sys.argv[4])
studio_port    = int(sys.argv[5])
inbucket_port  = int(sys.argv[6])
analytics_port = int(sys.argv[7])
pooler_port    = int(sys.argv[8])
inspector_port = int(sys.argv[9])

with open(config_path, 'r') as f:
    lines = f.readlines()

current_section = None
result = []
for line in lines:
    section_match = re.match(r'^\[([^\]]+)\]', line)
    if section_match:
        current_section = section_match.group(1)

    if current_section == 'api' and re.match(r'^port\s*=\s*\d+', line):
        line = re.sub(r'^(port\s*=\s*)\d+', rf'\g<1>{api_port}', line)
    elif current_section == 'db' and re.match(r'^port\s*=\s*\d+', line):
        line = re.sub(r'^(port\s*=\s*)\d+', rf'\g<1>{db_port}', line)
    elif current_section == 'db' and re.match(r'^shadow_port\s*=\s*\d+', line):
        line = re.sub(r'^(shadow_port\s*=\s*)\d+', rf'\g<1>{shadow_port}', line)
    elif current_section == 'db.pooler' and re.match(r'^port\s*=\s*\d+', line):
        line = re.sub(r'^(port\s*=\s*)\d+', rf'\g<1>{pooler_port}', line)
    elif current_section == 'studio' and re.match(r'^port\s*=\s*\d+', line):
        line = re.sub(r'^(port\s*=\s*)\d+', rf'\g<1>{studio_port}', line)
    elif current_section == 'inbucket' and re.match(r'^port\s*=\s*\d+', line):
        line = re.sub(r'^(port\s*=\s*)\d+', rf'\g<1>{inbucket_port}', line)
    elif current_section == 'analytics' and re.match(r'^port\s*=\s*\d+', line):
        line = re.sub(r'^(port\s*=\s*)\d+', rf'\g<1>{analytics_port}', line)
    elif current_section == 'edge_runtime' and re.match(r'^inspector_port\s*=\s*\d+', line):
        line = re.sub(r'^(inspector_port\s*=\s*)\d+', rf'\g<1>{inspector_port}', line)

    result.append(line)

with open(config_path, 'w') as f:
    f.writelines(result)
PYEOF
  if [[ $? -eq 0 ]]; then
    ok "Supabase ports configured (API=${PORT_SUPABASE_API}, DB=${PORT_SUPABASE_DB}, Studio=${PORT_SUPABASE_STUDIO}, Mailpit=${PORT_SUPABASE_MAILPIT})"
  else
    warn "Python port update for Supabase config.toml failed — you may need to edit supabase/config.toml manually"
  fi
else
  warn "supabase/config.toml not found — skipping Supabase port update"
fi

# .env.template — update port references so future copies pick up correct defaults
ENV_TEMPLATE="${PROJECT_ROOT}/.env.template"
if [[ -f "${ENV_TEMPLATE}" ]]; then
  sed -i.tmp "s|TWENTY_API_URL=http://localhost:[0-9]*|TWENTY_API_URL=http://localhost:${PORT_TWENTY}|" "${ENV_TEMPLATE}"
  sed -i.tmp "s|DATABASE_URL=postgresql://postgres:postgres@localhost:[0-9]*/postgres|DATABASE_URL=postgresql://postgres:postgres@localhost:${PORT_SUPABASE_DB}/postgres|" "${ENV_TEMPLATE}"
  sed -i.tmp "s|NEXT_PUBLIC_SERVER_URL=http://localhost:[0-9]*|NEXT_PUBLIC_SERVER_URL=http://localhost:${PORT_NEXTJS}|" "${ENV_TEMPLATE}"
  rm -f "${ENV_TEMPLATE}.tmp"
  ok ".env.template updated with project ports"
fi

# Write a .ports reference file for tooling / scripts to source
cat > "${PROJECT_ROOT}/.ports" <<PORTS
# Auto-generated port assignments for: ${PROJECT_NAME}
# Offset: ${PORT_OFFSET}
# Regenerated each time init-project.sh is run.
ASTRO=${PORT_ASTRO}
NEXTJS=${PORT_NEXTJS}
TWENTY=${PORT_TWENTY}
SUPABASE_API=${PORT_SUPABASE_API}
SUPABASE_DB=${PORT_SUPABASE_DB}
SUPABASE_SHADOW=${PORT_SUPABASE_SHADOW}
SUPABASE_STUDIO=${PORT_SUPABASE_STUDIO}
SUPABASE_MAILPIT=${PORT_SUPABASE_MAILPIT}
SUPABASE_ANALYTICS=${PORT_SUPABASE_ANALYTICS}
SUPABASE_POOLER=${PORT_SUPABASE_POOLER}
SUPABASE_INSPECTOR=${PORT_SUPABASE_INSPECTOR}
PORTS
ok "Port assignments saved to .ports"

# ---------------------------------------------------------------------------
# STEP 4 — Create .env.local from .env.template
# ---------------------------------------------------------------------------
section "Creating .env.local"

ENV_LOCAL="${PROJECT_ROOT}/.env.local"
ENV_TEMPLATE="${PROJECT_ROOT}/.env.template"

if [[ ! -f "${ENV_TEMPLATE}" ]]; then
  warn ".env.template not found — the wizard may have simplified it. Creating a minimal .env.local"
  touch "${ENV_LOCAL}"
fi

if [[ -f "${ENV_LOCAL}" ]]; then
  warn ".env.local already exists — backing up to .env.local.bak"
  cp "${ENV_LOCAL}" "${ENV_LOCAL}.bak"
fi

# Copy template, then substitute the two secrets we own right now.
# Supabase keys will be patched in after `supabase start`.
cp "${ENV_TEMPLATE}" "${ENV_LOCAL}"

# Use | as sed delimiter to avoid issues with / in values
sed -i.tmp "s|^PAYLOAD_SECRET=.*|PAYLOAD_SECRET=${PAYLOAD_SECRET}|" "${ENV_LOCAL}"

# Ensure DATABASE_URL points to the local Supabase DB (template default is correct;
# this line is here explicitly for documentation / override safety)
sed -i.tmp "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:${PORT_SUPABASE_DB}/postgres|" "${ENV_LOCAL}"

rm -f "${ENV_LOCAL}.tmp"

ok ".env.local created at ${ENV_LOCAL}"

# Copy .env.local into each template directory — Next.js and Astro only read
# .env.local from their own directory, not the project root.
if [[ -d "${PROJECT_ROOT}/templates/next-app" ]]; then
  cp "${ENV_LOCAL}" "${PROJECT_ROOT}/templates/next-app/.env.local"
  ok ".env.local copied to templates/next-app/"
fi
if [[ -d "${PROJECT_ROOT}/templates/astro-site" ]]; then
  cp "${ENV_LOCAL}" "${PROJECT_ROOT}/templates/astro-site/.env.local"
  ok ".env.local copied to templates/astro-site/"
fi

# ---------------------------------------------------------------------------
# Write docker/twenty/.env
# ---------------------------------------------------------------------------
section "Writing docker/twenty/.env"

TWENTY_ENV_DIR="${PROJECT_ROOT}/docker/twenty"
TWENTY_ENV_FILE="${TWENTY_ENV_DIR}/.env"

if [[ ! -d "${TWENTY_ENV_DIR}" ]]; then
  warn "docker/twenty/ not found — Twenty CRM was not selected, skipping"
else
  # Overwrite only APP_SECRET; preserve any other existing vars
  if [[ -f "${TWENTY_ENV_FILE}" ]]; then
    # Update the existing APP_SECRET line
    sed -i.tmp "s|^APP_SECRET=.*|APP_SECRET=${APP_SECRET}|" "${TWENTY_ENV_FILE}"
    rm -f "${TWENTY_ENV_FILE}.tmp"
    ok "Updated APP_SECRET in ${TWENTY_ENV_FILE}"
  else
    echo "APP_SECRET=${APP_SECRET}" > "${TWENTY_ENV_FILE}"
    ok "Created ${TWENTY_ENV_FILE}"
  fi
fi

# ---------------------------------------------------------------------------
# STEP 6 — Start Supabase local dev
# ---------------------------------------------------------------------------
section "Starting Supabase local dev"

# Skip if Supabase was not selected (supabase/ directory removed by wizard)
if [[ ! -d "${PROJECT_ROOT}/supabase" ]]; then
  warn "supabase/ not found — Supabase was not selected, skipping"
  SUPABASE_SKIPPED=true
else
  SUPABASE_SKIPPED=false

  # Stop any other Supabase projects that might be running and conflicting.
  # Docker container names include the project_id, so two projects with
  # different names can't run simultaneously without conflicts.
  RUNNING_SUPABASE=$(docker ps --format '{{.Names}}' 2>/dev/null | grep '^supabase_' | head -1 || true)
  if [[ -n "${RUNNING_SUPABASE}" ]]; then
    # Extract the project name from the container name (supabase_<service>_<project>)
    RUNNING_PROJECT=$(echo "${RUNNING_SUPABASE}" | sed 's/supabase_[^_]*_//')
    if [[ "${RUNNING_PROJECT}" != "${PROJECT_NAME}" ]]; then
      warn "Another Supabase project '${RUNNING_PROJECT}' is running — stopping it first"
      supabase stop --no-backup 2>/dev/null || docker ps --format '{{.Names}}' | grep '^supabase_' | xargs -r docker stop 2>/dev/null || true
      sleep 2
      ok "Previous Supabase project stopped"
    fi
  fi

  # Check if THIS project's Supabase is already running
  SUPABASE_ALREADY_RUNNING=false
  if pnpm supabase status &>/dev/null 2>&1; then
    warn "Supabase appears to already be running for this project — skipping start"
    SUPABASE_ALREADY_RUNNING=true
  else
    info "Running pnpm supabase start (this may take a minute on first run)…"
    if ! pnpm supabase start; then
      warn "Supabase start failed. Attempting to stop conflicting containers and retry..."
      # Force stop all supabase containers and retry
      docker ps --format '{{.Names}}' | grep '^supabase_' | xargs -r docker stop 2>/dev/null || true
      docker ps -a --format '{{.Names}}' | grep '^supabase_' | xargs -r docker rm -f 2>/dev/null || true
      sleep 3
      if ! pnpm supabase start; then
        fail "Supabase start failed after retry. Check Docker is running and ports are free."
        exit 1
      fi
    fi
    ok "Supabase started"
  fi
fi

# Capture keys from supabase status output (only if Supabase is active)
if [[ "${SUPABASE_SKIPPED}" != "true" ]]; then
  info "Capturing Supabase connection details…"
  SUPABASE_STATUS=$(pnpm supabase status 2>&1 || true)

  # Extract values from supabase status table output.
  # Output uses Unicode box-drawing │ as column separator: │ Label │ Value │
  # We use awk to split on │ and take the 3rd field (the value column).
  extract_supabase_value() {
    local key="$1"
    local exclude="${2:-}"
    local val
    if [[ -n "${exclude}" ]]; then
      val=$(echo "${SUPABASE_STATUS}" | grep -i "${key}" | grep -iv "${exclude}" | awk -F'│' '{print $3}' | tr -d '[:space:]' | head -1 || true)
    else
      val=$(echo "${SUPABASE_STATUS}" | grep -i "${key}" | awk -F'│' '{print $3}' | tr -d '[:space:]' | head -1 || true)
    fi
    echo "${val}"
  }

  SUPABASE_ANON_KEY=$(extract_supabase_value "Publishable" || true)
  SUPABASE_SERVICE_ROLE_KEY=$(extract_supabase_value "Secret" "Secret Key" || true)
  SUPABASE_API_URL=$(extract_supabase_value "Project URL" || true)

  # Fallback if the URL line differs by pnpm wrapper output
  if [[ -z "${SUPABASE_API_URL}" ]]; then
    SUPABASE_API_URL="http://127.0.0.1:${PORT_SUPABASE_API}"
  fi

  if [[ -z "${SUPABASE_ANON_KEY}" ]]; then
    warn "Could not extract anon key from supabase status — you may need to add it to .env.local manually"
  else
    ok "anon key captured"
  fi
  if [[ -z "${SUPABASE_SERVICE_ROLE_KEY}" ]]; then
    warn "Could not extract service_role key — you may need to add it to .env.local manually"
  else
    ok "service_role key captured"
  fi
  ok "API URL: ${SUPABASE_API_URL}"

  # Patch keys into .env.local if it exists
  if [[ -f "${ENV_LOCAL}" ]]; then
    sed -i.tmp "s|^NEXT_PUBLIC_SUPABASE_URL=.*|NEXT_PUBLIC_SUPABASE_URL=${SUPABASE_API_URL}|"       "${ENV_LOCAL}"
    sed -i.tmp "s|^NEXT_PUBLIC_SUPABASE_ANON_KEY=.*|NEXT_PUBLIC_SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}|" "${ENV_LOCAL}"
    sed -i.tmp "s|^SUPABASE_SERVICE_ROLE_KEY=.*|SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY}|" "${ENV_LOCAL}"
    sed -i.tmp "s|^PUBLIC_SUPABASE_URL=.*|PUBLIC_SUPABASE_URL=${SUPABASE_API_URL}|"                 "${ENV_LOCAL}"
    sed -i.tmp "s|^PUBLIC_SUPABASE_ANON_KEY=.*|PUBLIC_SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}|"     "${ENV_LOCAL}"
    rm -f "${ENV_LOCAL}.tmp"
    ok ".env.local patched with Supabase keys"
    # Re-copy to template directories with the updated keys
    if [[ -d "${PROJECT_ROOT}/templates/next-app" ]]; then
      cp "${ENV_LOCAL}" "${PROJECT_ROOT}/templates/next-app/.env.local"
    fi
    if [[ -d "${PROJECT_ROOT}/templates/astro-site" ]]; then
      cp "${ENV_LOCAL}" "${PROJECT_ROOT}/templates/astro-site/.env.local"
    fi
    ok ".env.local synced to template directories"
  fi
fi

# ---------------------------------------------------------------------------
# STEP 7 — Start Twenty CRM
# ---------------------------------------------------------------------------
section "Starting Twenty CRM"

TWENTY_COMPOSE_FILE="${TWENTY_ENV_DIR}/docker-compose.yml"

# Accept docker-compose.yml or compose.yml
if [[ ! -f "${TWENTY_COMPOSE_FILE}" ]]; then
  TWENTY_COMPOSE_FILE="${TWENTY_ENV_DIR}/compose.yml"
fi

if [[ ! -f "${TWENTY_COMPOSE_FILE}" ]]; then
  warn "No docker-compose.yml / compose.yml found in docker/twenty/ — skipping Twenty CRM start"
else
  # Stop and remove any existing Twenty containers from previous projects
  # to avoid port conflicts and stale containers
  EXISTING_TWENTY=$(docker ps -a --format '{{.Names}}' 2>/dev/null | grep '^twenty-' | head -1 || true)
  if [[ -n "${EXISTING_TWENTY}" ]]; then
    warn "Found existing Twenty CRM containers — stopping them first"
    docker ps -a --format '{{.Names}}' | grep '^twenty-' | xargs -r docker stop 2>/dev/null || true
    docker ps -a --format '{{.Names}}' | grep '^twenty-' | xargs -r docker rm -f 2>/dev/null || true
    sleep 2
    ok "Old Twenty CRM containers removed"
  fi

  info "Starting Twenty CRM via docker compose…"
  if ! docker compose -f "${TWENTY_COMPOSE_FILE}" up -d; then
    warn "docker compose up for Twenty CRM failed. Check Docker logs. Continuing..."
  else
    ok "Twenty CRM started (port ${PORT_TWENTY})"
  fi
fi

# ---------------------------------------------------------------------------
# STEP 8 — Boot Next.js once to trigger Payload table creation
# ---------------------------------------------------------------------------
section "Booting Next.js to trigger Payload CMS table creation"

# Skip if Payload config doesn't exist (Payload or Next.js was not selected)
NEXTJS_APP_DIR="${PROJECT_ROOT}/templates/next-app"
PAYLOAD_CONFIG="${NEXTJS_APP_DIR}/src/payload.config.ts"
NEXTJS_LOG="/tmp/${PROJECT_NAME}-nextjs-boot.log"
NEXTJS_PID_FILE="/tmp/${PROJECT_NAME}-nextjs.pid"

if [[ ! -f "${PAYLOAD_CONFIG}" ]]; then
  warn "Payload CMS was not selected — skipping Next.js boot step"
elif [[ ! -d "${NEXTJS_APP_DIR}" ]]; then
  warn "Next.js template not found — skipping Payload boot step"
elif [[ "${SUPABASE_SKIPPED}" == "true" ]]; then
  warn "Supabase not running — Payload needs a database. Skipping boot step"
else
  info "Found Next.js app at: ${NEXTJS_APP_DIR}"
  info "Starting Next.js in dev mode (logging to ${NEXTJS_LOG})…"
  info "Waiting for Payload to finish creating tables (up to 120 seconds)…"

  # Start Next.js dev server in background
  (cd "${NEXTJS_APP_DIR}" && pnpm dev --port "${PORT_NEXTJS}" >> "${NEXTJS_LOG}" 2>&1) &
  NEXTJS_PID=$!
  echo "${NEXTJS_PID}" > "${NEXTJS_PID_FILE}"

  # Poll for either the "ready" or "started" log line from Next.js / Payload
  BOOT_TIMEOUT=120
  ELAPSED=0
  BOOT_SUCCESS=false

  while [[ ${ELAPSED} -lt ${BOOT_TIMEOUT} ]]; do
    if grep -qiE "(ready|started server|payload cms|migrations complete)" "${NEXTJS_LOG}" 2>/dev/null; then
      BOOT_SUCCESS=true
      break
    fi
    if ! kill -0 "${NEXTJS_PID}" 2>/dev/null; then
      fail "Next.js process exited unexpectedly. Check ${NEXTJS_LOG}"
      break
    fi
    sleep 3
    ELAPSED=$((ELAPSED + 3))
    echo -n "."
  done
  echo ""

  # Give Payload an extra moment to finish any remaining migrations after the
  # "ready" signal, then shut down
  sleep 5

  info "Stopping Next.js dev server (PID ${NEXTJS_PID})…"
  # Kill the entire process group — Next.js/Turbopack spawns child processes
  # that don't die with a simple kill of the parent PID
  kill "${NEXTJS_PID}" 2>/dev/null || true
  sleep 2
  # Force kill anything still on the port
  lsof -ti:"${PORT_NEXTJS}" 2>/dev/null | xargs kill -9 2>/dev/null || true
  wait "${NEXTJS_PID}" 2>/dev/null || true
  rm -f "${NEXTJS_PID_FILE}"

  if [[ "${BOOT_SUCCESS}" == true ]]; then
    ok "Next.js booted and Payload tables should be created"
  else
    warn "Next.js boot timed out after ${BOOT_TIMEOUT}s — Payload tables may not be fully created"
    warn "Check ${NEXTJS_LOG} and re-run if needed"
  fi
fi

# ---------------------------------------------------------------------------
# STEP 9 — Apply RLS on Payload CMS tables
# ---------------------------------------------------------------------------
section "Applying Row-Level Security on Payload CMS tables"

# Skip if Supabase was not selected
if [[ "${SUPABASE_SKIPPED}" == "true" ]]; then
  warn "Supabase was not selected — skipping RLS step"
else

# Payload tables are created outside Supabase migrations, so RLS must be
# applied separately. We discover all tables created in the public schema
# that do not already have RLS enabled.
info "Connecting to Supabase DB at 127.0.0.1:${PORT_SUPABASE_DB}…"

DB_URL="postgresql://postgres:postgres@127.0.0.1:${PORT_SUPABASE_DB}/postgres"

# List all public schema tables
PAYLOAD_TABLES=$(psql "${DB_URL}" -t -c \
  "SELECT tablename FROM pg_tables WHERE schemaname = 'public';" 2>/dev/null \
  | tr -s ' ' | sed 's/^ //' | grep -v '^$' || true)

if [[ -z "${PAYLOAD_TABLES}" ]]; then
  warn "No tables found in public schema — skipping RLS step (tables may not exist yet)"
else
  RLS_APPLIED=0
  RLS_SKIPPED=0
  while IFS= read -r TABLE; do
    [[ -z "${TABLE}" ]] && continue

    # Check if RLS is already enabled
    RLS_STATUS=$(psql "${DB_URL}" -t -c \
      "SELECT rowsecurity FROM pg_class WHERE relname = '${TABLE}' AND relnamespace = 'public'::regnamespace;" \
      2>/dev/null | tr -s ' ' | sed 's/^ //' | tr -d '[:space:]' || true)

    if [[ "${RLS_STATUS}" == "t" ]]; then
      RLS_SKIPPED=$((RLS_SKIPPED + 1))
    else
      psql "${DB_URL}" -c "ALTER TABLE public.\"${TABLE}\" ENABLE ROW LEVEL SECURITY;" &>/dev/null || \
        warn "Could not enable RLS on table: ${TABLE}"
      RLS_APPLIED=$((RLS_APPLIED + 1))
    fi
  done <<< "${PAYLOAD_TABLES}"

  ok "RLS: enabled on ${RLS_APPLIED} table(s), already enabled on ${RLS_SKIPPED} table(s)"
fi

fi  # end Supabase RLS guard

# ---------------------------------------------------------------------------
# STEP 10 — Run validation script
# ---------------------------------------------------------------------------
section "Running template validation"

VALIDATE_SCRIPT="${SCRIPT_DIR}/validate-template.sh"

if [[ -f "${VALIDATE_SCRIPT}" ]]; then
  if bash "${VALIDATE_SCRIPT}"; then
    ok "Template validation passed"
  else
    warn "Template validation reported issues — review output above"
  fi
else
  warn "validate-template.sh not found at ${VALIDATE_SCRIPT} — skipping validation"
fi

# ---------------------------------------------------------------------------
# STEP 11 — Summary
# ---------------------------------------------------------------------------
section "Setup Complete — Summary for: ${BOLD}${PROJECT_NAME}${RESET}"

echo ""
echo -e "${BOLD}URLs (only for services you selected)${RESET}"
[[ -f "${PROJECT_ROOT}/templates/astro-site/astro.config.mjs" ]] && \
  echo -e "  Astro (marketing site)      http://localhost:${PORT_ASTRO}"
[[ -f "${PROJECT_ROOT}/templates/next-app/next.config.ts" ]] && \
  echo -e "  Next.js (app/dashboard)     http://localhost:${PORT_NEXTJS}"
[[ -f "${PROJECT_ROOT}/templates/next-app/src/payload.config.ts" ]] && \
  echo -e "  Payload CMS Admin           http://localhost:${PORT_NEXTJS}/admin"
[[ -d "${PROJECT_ROOT}/supabase" ]] && \
  echo -e "  Supabase Studio             http://localhost:${PORT_SUPABASE_STUDIO}"
[[ -d "${PROJECT_ROOT}/supabase" ]] && \
  echo -e "  Supabase API                ${SUPABASE_API_URL:-http://127.0.0.1:${PORT_SUPABASE_API}}"
[[ -d "${PROJECT_ROOT}/supabase" ]] && \
  echo -e "  Supabase Mailpit            http://localhost:${PORT_SUPABASE_MAILPIT}"
[[ -d "${PROJECT_ROOT}/docker/twenty" ]] && \
  echo -e "  Twenty CRM                  http://localhost:${PORT_TWENTY}"

echo ""
echo -e "${BOLD}Generated Secrets${RESET}"
[[ -f "${PROJECT_ROOT}/templates/next-app/src/payload.config.ts" ]] && \
  echo -e "  PAYLOAD_SECRET              ${PAYLOAD_SECRET:0:16}…  (truncated)"
[[ -d "${PROJECT_ROOT}/docker/twenty" ]] && \
  echo -e "  APP_SECRET (Twenty CRM)     ${APP_SECRET:0:16}…  (truncated)"
[[ "${SUPABASE_SKIPPED}" != "true" ]] && [[ -n "${SUPABASE_ANON_KEY:-}" ]] && \
  echo -e "  SUPABASE_ANON_KEY           ${SUPABASE_ANON_KEY:0:20}…  (truncated)"
[[ "${SUPABASE_SKIPPED}" != "true" ]] && [[ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ]] && \
  echo -e "  SUPABASE_SERVICE_ROLE_KEY   ${SUPABASE_SERVICE_ROLE_KEY:0:20}…  (truncated)"

echo ""
echo -e "${BOLD}Next Steps${RESET}"
echo -e "  1. Fill in optional keys in .env.local (PostHog, Sentry, Resend, etc.)"
HAS_ASTRO=false; HAS_NEXT=false
[[ -f "${PROJECT_ROOT}/templates/astro-site/astro.config.mjs" ]] && HAS_ASTRO=true
[[ -f "${PROJECT_ROOT}/templates/next-app/next.config.ts" ]] && HAS_NEXT=true
if [[ "${HAS_ASTRO}" == true ]]; then
  echo -e "  2. Start Astro dev server:    ${CYAN}pnpm dev:astro${RESET}"
fi
if [[ "${HAS_NEXT}" == true ]]; then
  echo -e "  $([[ "${HAS_ASTRO}" == true ]] && echo "3" || echo "2"). Start Next.js dev server:  ${CYAN}pnpm dev:next${RESET}"
fi
[[ -f "${PROJECT_ROOT}/templates/next-app/src/payload.config.ts" ]] && \
  echo -e "  Open Payload Admin and create your first user: http://localhost:${PORT_NEXTJS}/admin"
[[ -d "${PROJECT_ROOT}/docker/twenty" ]] && \
  echo -e "  Configure Twenty CRM at: http://localhost:${PORT_TWENTY}"
echo ""
echo -e "${GREEN}${BOLD}Project '${PROJECT_NAME}' is ready to go!${RESET}"
