import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, exec, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3333;

// Track running processes (only process objects: { proc, port })
const processes = {};
// Track the created project path separately from processes
let currentProjectPath = null;
// Track log clients for SSE
let logClients = [];
// Health polling state
let healthInterval = null;
let healthTimeout = null;
let lastHealthSnapshot = '';
// Guard against concurrent project creation / validation
let createInProgress = false;
let validateInProgress = false;

function broadcast(type, data) {
  const msg = `data: ${JSON.stringify({ type, data })}\n\n`;
  logClients.forEach(res => res.write(msg));
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => resolve(body));
  });
}

function getDockerHealth() {
  try {
    const output = execSync(
      'docker ps --format "{{.Names}}|{{.Status}}|{{.Ports}}" 2>/dev/null',
      { encoding: 'utf-8', timeout: 5000 }
    );
    const containers = [];
    for (const line of output.split('\n')) {
      if (!line.includes('|')) continue;
      const [name, status, ports] = line.split('|');
      // Parse health from status like "Up 2 minutes (healthy)" or "(health: starting)"
      let health = 'unknown';
      if (status.includes('(healthy)')) health = 'healthy';
      else if (status.includes('health: starting')) health = 'starting';
      else if (status.includes('Up')) health = 'running'; // up but no healthcheck
      else if (status.includes('Created')) health = 'created';
      else if (status.includes('Exited')) health = 'exited';

      // Classify the service
      let service = 'other';
      if (name.includes('supabase_')) service = 'supabase';
      else if (name.includes('twenty')) service = 'twenty';

      // Extract host port
      let port = null;
      const portMatch = (ports || '').match(/0\.0\.0\.0:(\d+)/);
      if (portMatch) port = parseInt(portMatch[1]);

      containers.push({ name, service, health, port });
    }
    return containers;
  } catch {
    return [];
  }
}

function startHealthPolling() {
  stopHealthPolling();
  healthInterval = setInterval(() => {
    const health = getDockerHealth();
    const snapshot = JSON.stringify(health);
    // Only broadcast when something changes
    if (snapshot !== lastHealthSnapshot) {
      lastHealthSnapshot = snapshot;
      broadcast('health', health);
    }
    // Stop polling once all containers are healthy or running (no more "starting")
    // Also stop if Docker returns nothing after 60s (Docker not running)
    const hasStarting = health.some(c => c.health === 'starting' || c.health === 'created');
    if (health.length > 0 && !hasStarting) {
      stopHealthPolling();
    }
  }, 5000);
  // Safety timeout: stop polling after 5 minutes regardless
  healthTimeout = setTimeout(() => stopHealthPolling(), 300000);
}

function stopHealthPolling() {
  if (healthInterval) {
    clearInterval(healthInterval);
    healthInterval = null;
  }
  if (healthTimeout) {
    clearTimeout(healthTimeout);
    healthTimeout = null;
  }
}

export function startUI(args) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    // CORS headers for local dev
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    // Serve the HTML page
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const html = fs.readFileSync(path.join(__dirname, 'ui.html'), 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
      return;
    }

    // API: Get home directory and common locations
    if (url.pathname === '/api/home') {
      const home = os.homedir();
      const locations = [
        { name: 'Desktop', path: path.join(home, 'Desktop') },
        { name: 'Documents', path: path.join(home, 'Documents') },
        { name: 'Projects', path: path.join(home, 'Projects') },
        { name: 'Home', path: home },
      ].filter(l => fs.existsSync(l.path));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ home, locations }));
      return;
    }

    // API: List folders at path
    if (url.pathname === '/api/folders') {
      const dirPath = url.searchParams.get('path') || os.homedir();
      try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true })
          .filter(e => e.isDirectory() && !e.name.startsWith('.'))
          .map(e => ({ name: e.name, path: path.join(dirPath, e.name) }))
          .sort((a, b) => a.name.localeCompare(b.name));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ current: dirPath, parent: path.dirname(dirPath), folders: entries }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // API: Server-Sent Events for live logs
    if (url.pathname === '/api/logs') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.write('data: {"type":"connected","data":"ok"}\n\n');
      logClients.push(res);
      req.on('close', () => {
        logClients = logClients.filter(c => c !== res);
      });
      return;
    }

    // API: Read ports — from .ports file + detect live Docker container ports
    if (url.pathname === '/api/ports') {
      const projPath = url.searchParams.get('path');
      if (!projPath) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'path parameter required' }));
        return;
      }
      const ports = {};

      // 1. Try reading .ports file
      const portsFile = path.join(projPath, '.ports');
      try {
        const content = fs.readFileSync(portsFile, 'utf-8');
        for (const line of content.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const [key, val] = trimmed.split('=');
          if (key && val) ports[key.trim()] = parseInt(val.trim(), 10);
        }
      } catch {}

      // 2. Detect live Docker ports as fallback/override for accuracy
      try {
        const dockerPs = execSync('docker ps --format "{{.Names}}|{{.Ports}}" 2>/dev/null', { encoding: 'utf-8', timeout: 5000 });
        for (const line of dockerPs.split('\n')) {
          if (!line.includes('|')) continue;
          const [name, portsStr] = line.split('|');
          // Extract host port from "0.0.0.0:PORT->CONTAINER_PORT/tcp"
          const portMatch = portsStr.match(/0\.0\.0\.0:(\d+)->(\d+)/);
          if (!portMatch) continue;
          const hostPort = parseInt(portMatch[1]);
          const containerPort = parseInt(portMatch[2]);

          // Supabase services
          if (name.includes('supabase_kong')) ports.SUPABASE_API = hostPort;
          if (name.includes('supabase_db') && containerPort === 5432) ports.SUPABASE_DB = hostPort;
          if (name.includes('supabase_studio')) ports.SUPABASE_STUDIO = hostPort;
          if (name.includes('supabase_inbucket') || name.includes('supabase_mailpit')) ports.SUPABASE_MAILPIT = hostPort;
          if (name.includes('supabase_analytics')) ports.SUPABASE_ANALYTICS = hostPort;

          // Twenty CRM
          if (name.includes('twenty-twenty-1') && containerPort === 3000) ports.TWENTY = hostPort;
        }
      } catch {}

      // 3. Detect dev server ports from config files if not in .ports
      if (!ports.ASTRO) {
        try {
          const astroConf = fs.readFileSync(path.join(projPath, 'templates/astro-site/astro.config.mjs'), 'utf-8');
          const m = astroConf.match(/port:\s*(\d+)/);
          if (m) ports.ASTRO = parseInt(m[1]);
        } catch {}
      }
      if (!ports.NEXTJS) {
        try {
          const nextPkg = fs.readFileSync(path.join(projPath, 'templates/next-app/package.json'), 'utf-8');
          const m = nextPkg.match(/--port\s+(\d+)/);
          if (m) ports.NEXTJS = parseInt(m[1]);
        } catch {}
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(ports));
      return;
    }

    // API: Create project
    if (url.pathname === '/api/create' && req.method === 'POST') {
      const body = await readBody(req);
      const { projectName, location, services, preset } = JSON.parse(body);

      if (createInProgress) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'A project creation is already in progress' }));
        return;
      }

      // Sanitize project name server-side (defense in depth)
      const safeName = projectName.replace(/[^a-z0-9-]/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
      if (!safeName) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid project name' }));
        return;
      }

      const projectPath = path.join(location, safeName);

      if (fs.existsSync(projectPath)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Directory "${projectPath}" already exists` }));
        return;
      }

      createInProgress = true;
      broadcast('status', 'Creating project...');

      // Build the flags for create-project.mjs (non-interactive mode)
      // Allowlist valid preset/service names to prevent injection
      const VALID_PRESETS = ['full', 'marketing', 'dashboard', 'both-frameworks', 'minimal', 'nextjs-minimal'];
      const VALID_SERVICES = ['astro', 'nextjs', 'supabase', 'payload', 'twenty', 'sentry', 'posthog', 'resend'];
      let flags = '';
      if (preset && VALID_PRESETS.includes(preset)) {
        flags = `--preset=${preset}`;
      } else if (services && services.length) {
        flags = services.filter(s => VALID_SERVICES.includes(s)).map(s => `--${s}`).join(' ');
      }

      // Run steps directly instead of bootstrap.sh (no TTY needed):
      // 1. Clone the repo
      // 2. Run create-project.mjs with flags (non-interactive)
      // 3. Run init-project.sh
      const REPO = 'https://github.com/syedqzaidi/agency-web-stack.git';
      // Use safeName everywhere to prevent shell injection and path mismatches
      const safeLocation = location.replace(/'/g, "'\\''");
      const cmd = [
        `cd '${safeLocation}'`,
        `git clone --depth=1 ${REPO} '${safeName}'`,
        `rm -rf '${safeName}/.git'`,
        `cd '${safeName}'`,
        `pnpm install`,
        `node scripts/create-project.mjs --name='${safeName}' ${flags} --no-install`,
        `bash scripts/init-project.sh '${safeName}'`,
      ].join(' && ');

      const proc = spawn('bash', ['-c', cmd], {
        env: { ...process.env, FORCE_COLOR: '0' },
      });

      proc.stdout.on('data', d => broadcast('log', d.toString()));
      proc.stderr.on('data', d => broadcast('log', d.toString()));
      proc.on('error', err => {
        createInProgress = false;
        broadcast('log', `Failed to start process: ${err.message}\n`);
        broadcast('done', { code: 1, projectPath });
      });
      proc.on('close', code => {
        createInProgress = false;
        broadcast('done', { code, projectPath });
        currentProjectPath = projectPath;
        // Start polling Docker health after project creation
        if (code === 0) startHealthPolling();
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ started: true, projectPath }));
      return;
    }

    // API: Start dev server
    if (url.pathname === '/api/start-server' && req.method === 'POST') {
      const body = await readBody(req);
      const { server: serverName, projectPath } = JSON.parse(body);

      if (processes[serverName]) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `${serverName} is already running` }));
        return;
      }

      const cmd = serverName === 'astro' ? 'pnpm dev:astro' : 'pnpm dev:next';
      const proc = spawn('bash', ['-c', cmd], {
        cwd: projectPath,
        env: { ...process.env, FORCE_COLOR: '0' },
      });

      processes[serverName] = { proc, port: null };

      proc.stdout.on('data', d => {
        const text = d.toString();
        broadcast('server-log', { server: serverName, text });
        const portMatch = text.match(/localhost:(\d+)/);
        if (portMatch) {
          processes[serverName].port = parseInt(portMatch[1]);
          broadcast('server-ready', { server: serverName, port: processes[serverName].port });
        }
      });
      proc.stderr.on('data', d => {
        broadcast('server-log', { server: serverName, text: d.toString() });
      });
      proc.on('close', code => {
        broadcast('server-stopped', { server: serverName, code });
        delete processes[serverName];
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ started: true }));
      return;
    }

    // API: Stop dev server
    if (url.pathname === '/api/stop-server' && req.method === 'POST') {
      const body = await readBody(req);
      const { server: serverName } = JSON.parse(body);
      if (processes[serverName]) {
        processes[serverName].proc.kill('SIGTERM');
        setTimeout(() => {
          if (processes[serverName]) {
            processes[serverName].proc.kill('SIGKILL');
          }
        }, 2000);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ stopped: true }));
      return;
    }

    // API: Get status of running servers
    if (url.pathname === '/api/status') {
      const status = { projectPath: currentProjectPath };
      for (const [key, val] of Object.entries(processes)) {
        status[key] = { running: true, port: val.port };
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status));
      return;
    }

    // API: Get Docker container health status
    if (url.pathname === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(getDockerHealth()));
      return;
    }

    // API: Stop all Docker services for the current project
    if (url.pathname === '/api/stop-all' && req.method === 'POST') {
      const body = await readBody(req);
      const { projectPath: projPath } = JSON.parse(body);
      stopHealthPolling();
      broadcast('status', 'Stopping all services...');

      // Stop dev servers with SIGKILL fallback
      for (const [key, val] of Object.entries(processes)) {
        if (val.proc) {
          val.proc.kill('SIGTERM');
          setTimeout(() => {
            if (processes[key] && processes[key].proc) {
              processes[key].proc.kill('SIGKILL');
            }
          }, 2000);
        }
      }

      // Stop Docker services
      const cmds = [];
      if (projPath) {
        cmds.push(`cd "${projPath}" && pnpm supabase stop 2>/dev/null`);
        const twentyDir = path.join(projPath, 'docker', 'twenty');
        if (fs.existsSync(path.join(twentyDir, 'docker-compose.yml'))) {
          cmds.push(`cd "${twentyDir}" && docker compose down 2>/dev/null`);
        }
      }
      if (cmds.length) {
        const proc = spawn('bash', ['-c', cmds.join(' ; ')], {
          env: { ...process.env, FORCE_COLOR: '0' },
        });
        proc.stdout.on('data', d => broadcast('log', d.toString()));
        proc.stderr.on('data', d => broadcast('log', d.toString()));
        proc.on('close', () => {
          broadcast('all-stopped', {});
          broadcast('status', 'All services stopped.');
        });
      } else {
        broadcast('all-stopped', {});
        broadcast('status', 'All services stopped.');
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ stopping: true }));
      return;
    }

    // API: Validate project (runs validate-template.sh)
    if (url.pathname === '/api/validate' && req.method === 'POST') {
      if (validateInProgress) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Validation already in progress' }));
        return;
      }
      const body = await readBody(req);
      const { projectPath: projPath } = JSON.parse(body);
      if (!projPath || !fs.existsSync(projPath)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid project path' }));
        return;
      }
      const scriptPath = path.join(projPath, 'scripts', 'validate-template.sh');
      if (!fs.existsSync(scriptPath)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'validate-template.sh not found in project' }));
        return;
      }
      validateInProgress = true;
      broadcast('status', 'Running validation...');
      const proc = spawn('bash', [scriptPath], {
        cwd: projPath,
        env: { ...process.env, FORCE_COLOR: '0' },
      });
      proc.stdout.on('data', d => broadcast('validate-log', d.toString()));
      proc.stderr.on('data', d => broadcast('validate-log', d.toString()));
      proc.on('error', err => {
        validateInProgress = false;
        broadcast('validate-log', `Failed: ${err.message}\n`);
        broadcast('validate-done', { code: 1 });
      });
      proc.on('close', code => {
        validateInProgress = false;
        broadcast('validate-done', { code });
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ started: true }));
      return;
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  server.listen(PORT, () => {
    console.log(`\n  Agency Web Stack UI running at: http://localhost:${PORT}\n`);
    // Open browser
    const openCmd =
      process.platform === 'darwin' ? 'open' :
      process.platform === 'win32' ? 'start' : 'xdg-open';
    exec(`${openCmd} http://localhost:${PORT}`);
  });

  // Cleanup on exit
  process.on('SIGINT', () => {
    stopHealthPolling();
    // Close SSE connections cleanly
    logClients.forEach(res => { try { res.end(); } catch {} });
    logClients = [];
    // Kill all dev server processes
    for (const [key, val] of Object.entries(processes)) {
      if (val.proc) val.proc.kill('SIGKILL');
    }
    server.close();
    process.exit();
  });
}
