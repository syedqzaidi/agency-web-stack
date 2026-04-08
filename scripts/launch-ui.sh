#!/usr/bin/env bash
# =============================================================================
# launch-ui.sh — One command to launch the Agency Web Stack GUI
#
# Usage:
#   bash <(curl -fsSL https://raw.githubusercontent.com/syedqzaidi/agency-web-stack/main/scripts/launch-ui.sh)
# =============================================================================

set -euo pipefail

BASE_URL="https://raw.githubusercontent.com/syedqzaidi/agency-web-stack/main"

echo ""
echo "  Agency Web Stack — Launching GUI..."
echo ""

# Check Node.js
if ! command -v node &>/dev/null; then
  echo "ERROR: Node.js is not installed. Download from: https://nodejs.org"
  exit 1
fi
NODE_VER=$(node --version | sed 's/v//' | cut -d. -f1)
if [[ "$NODE_VER" -lt 20 ]]; then
  echo "ERROR: Node.js 20+ required (you have v${NODE_VER}). Update: https://nodejs.org"
  exit 1
fi
echo "  OK: Node.js $(node --version)"

# Create temp directory
TMPDIR=$(mktemp -d)
trap "rm -rf $TMPDIR" EXIT

# Download UI files (cache-bust to avoid GitHub's 5-min CDN cache)
BUST="$(date +%s)"
echo "  Downloading UI..."
curl -fsSL "${BASE_URL}/packages/create-site/ui-server.mjs?cb=${BUST}" -o "${TMPDIR}/ui-server.mjs"
curl -fsSL "${BASE_URL}/packages/create-site/ui.html?cb=${BUST}" -o "${TMPDIR}/ui.html"
echo "  OK: UI files ready"
echo ""
echo "  Opening http://localhost:3333 ..."
echo "  Press Ctrl+C to stop"
echo ""

# Launch the server — import the module and call startUI
# Override __dirname so it finds ui.html in the temp dir
cd "${TMPDIR}"
node -e "
import('./ui-server.mjs').then(m => m.startUI(['--ui']));
"
