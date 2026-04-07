import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3333;

// Track running processes
const processes = {};
// Track log clients for SSE
let logClients = [];

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

    // API: Create project
    if (url.pathname === '/api/create' && req.method === 'POST') {
      const body = await readBody(req);
      const { projectName, location, services, preset } = JSON.parse(body);

      const projectPath = path.join(location, projectName);

      if (fs.existsSync(projectPath)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Directory "${projectPath}" already exists` }));
        return;
      }

      broadcast('status', 'Creating project...');

      // Build the flags for create-project.mjs (non-interactive mode)
      let flags = '';
      if (preset) {
        flags = `--preset=${preset}`;
      } else if (services && services.length) {
        flags = services.map(s => `--${s}`).join(' ');
      }

      // Run steps directly instead of bootstrap.sh (no TTY needed):
      // 1. Clone the repo
      // 2. Run create-project.mjs with flags (non-interactive)
      // 3. Run init-project.sh
      const REPO = 'https://github.com/syedqzaidi/agency-web-stack.git';
      const cmd = [
        `cd "${location}"`,
        `git clone --depth=1 ${REPO} "${projectName}"`,
        `rm -rf "${projectPath}/.git"`,
        `cd "${projectPath}"`,
        `pnpm install`,
        `node scripts/create-project.mjs --name="${projectName}" ${flags} --no-install`,
        `bash scripts/init-project.sh "${projectName}"`,
      ].join(' && ');

      const proc = spawn('bash', ['-c', cmd], {
        env: { ...process.env, FORCE_COLOR: '0' },
      });

      proc.stdout.on('data', d => broadcast('log', d.toString()));
      proc.stderr.on('data', d => broadcast('log', d.toString()));
      proc.on('close', code => {
        broadcast('done', { code, projectPath });
        processes.projectPath = projectPath;
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
      const status = {};
      for (const [key, val] of Object.entries(processes)) {
        if (key === 'projectPath') {
          status.projectPath = val;
          continue;
        }
        status[key] = { running: true, port: val.port };
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status));
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
    for (const [key, val] of Object.entries(processes)) {
      if (key !== 'projectPath' && val.proc) val.proc.kill('SIGKILL');
    }
    server.close();
    process.exit();
  });
}
