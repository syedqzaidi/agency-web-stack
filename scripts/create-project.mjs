#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import prompts from 'prompts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── ANSI Colors ──────────────────────────────────────────────────────────────
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

// ── Argument Parsing ─────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {
    name: null,
    preset: null,
    flags: new Set(),
    noInstall: false,
    noInit: false,
    help: false,
    interactive: true, // true if no service flags or preset given
  };

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') parsed.help = true;
    else if (arg === '--no-install') parsed.noInstall = true;
    else if (arg === '--no-init') parsed.noInit = true;
    else if (arg === '--all') parsed.flags = new Set(['astro', 'nextjs', 'supabase', 'payload', 'twenty', 'sentry', 'posthog', 'resend']);
    else if (arg.startsWith('--preset=')) parsed.preset = arg.split('=')[1];
    else if (arg.startsWith('--name=')) parsed.name = arg.split('=')[1];
    else if (arg.startsWith('--')) parsed.flags.add(arg.slice(2));
    else if (!parsed.name) parsed.name = arg; // positional = project name
  }

  // If any service flags or preset given, it's non-interactive
  if (parsed.flags.size > 0 || parsed.preset) parsed.interactive = false;

  return parsed;
}

// ── Presets ──────────────────────────────────────────────────────────────────

const PRESETS = {
  marketing: {
    description: 'Astro + Supabase + Sentry + PostHog (SEO marketing sites)',
    services: ['astro', 'supabase', 'sentry', 'posthog'],
  },
  dashboard: {
    description: 'Next.js + Payload CMS + Supabase + Sentry (admin panels/apps)',
    services: ['nextjs', 'payload', 'supabase', 'sentry'],
  },
  full: {
    description: 'Everything included',
    services: ['astro', 'nextjs', 'supabase', 'payload', 'twenty', 'sentry', 'posthog', 'resend'],
  },
  minimal: {
    description: 'Astro only — Tailwind + shadcn, no backend',
    services: ['astro'],
  },
  'nextjs-minimal': {
    description: 'Next.js only — Tailwind + shadcn, no CMS or backend',
    services: ['nextjs'],
  },
  'both-frameworks': {
    description: 'Astro + Next.js + Supabase + Sentry (dual framework, no CMS/CRM)',
    services: ['astro', 'nextjs', 'supabase', 'sentry'],
  },
};

// ── Help ─────────────────────────────────────────────────────────────────────

function printHelp() {
  console.log(`
${bold('Website Template — Project Setup')}

${bold('Usage:')}
  node scripts/create-project.mjs                          ${dim('# Interactive wizard')}
  node scripts/create-project.mjs my-project --preset=marketing  ${dim('# Use preset')}
  node scripts/create-project.mjs my-project --astro --supabase  ${dim('# Pick services')}

${bold('Presets:')}
${Object.entries(PRESETS).map(([k, v]) => `  --preset=${k.padEnd(18)} ${v.description}`).join('\n')}

${bold('Frameworks:')}
  --astro              Astro — SEO/marketing sites (port 4400)
  --nextjs             Next.js — Dashboards/apps (port 3100)

${bold('Backend:')}
  --supabase           Supabase — Database + Auth + Storage
  --payload            Payload CMS — Headless CMS (requires --nextjs --supabase)
  --twenty             Twenty CRM — Self-hosted CRM (Docker)

${bold('Integrations:')}
  --sentry             Sentry — Error tracking
  --posthog            PostHog — Product analytics
  --resend             Resend — Transactional email

${bold('Options:')}
  --all                Include everything
  --name=<name>        Project name (or pass as first positional arg)
  --no-install         Skip pnpm install after removal
  --no-init            Skip calling init-project.sh
  --help, -h           Show this help
`);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function remove(relativePath) {
  const full = path.join(ROOT, relativePath);
  try {
    await fs.rm(full, { recursive: true, force: true });
    console.log(`  ${red('Removed:')} ${relativePath}`);
  } catch {
    // File may not exist — that's fine (idempotent)
  }
}

async function modifyJson(relativePath, fn) {
  const full = path.join(ROOT, relativePath);
  try {
    const data = JSON.parse(await fs.readFile(full, 'utf-8'));
    fn(data);
    await fs.writeFile(full, JSON.stringify(data, null, 2) + '\n');
    console.log(`  ${yellow('Modified:')} ${relativePath}`);
  } catch (err) {
    console.log(`  ${dim(`Skipped (not found): ${relativePath}`)}`);
  }
}

async function filterLines(relativePath, filterFn) {
  const full = path.join(ROOT, relativePath);
  try {
    const lines = (await fs.readFile(full, 'utf-8')).split('\n');
    const filtered = lines.filter(filterFn);
    await fs.writeFile(full, filtered.join('\n'));
    console.log(`  ${yellow('Modified:')} ${relativePath}`);
  } catch {
    console.log(`  ${dim(`Skipped (not found): ${relativePath}`)}`);
  }
}

async function replaceInFile(relativePath, search, replacement) {
  const full = path.join(ROOT, relativePath);
  try {
    let content = await fs.readFile(full, 'utf-8');
    content = content.replace(search, replacement);
    await fs.writeFile(full, content);
    console.log(`  ${yellow('Modified:')} ${relativePath}`);
  } catch {
    console.log(`  ${dim(`Skipped (not found): ${relativePath}`)}`);
  }
}

async function removeMcpEntry(key) {
  await modifyJson('.mcp.json', (data) => {
    if (data.mcpServers) {
      delete data.mcpServers[key];
    }
  });
}

async function fileExists(relativePath) {
  try {
    await fs.access(path.join(ROOT, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function dirIsEmpty(relativePath) {
  const full = path.join(ROOT, relativePath);
  try {
    const entries = await fs.readdir(full);
    return entries.length === 0;
  } catch {
    return true;
  }
}

function removeDeps(data, depsToRemove) {
  for (const dep of depsToRemove) {
    if (data.dependencies) delete data.dependencies[dep];
    if (data.devDependencies) delete data.devDependencies[dep];
  }
}

function removeScripts(data, scriptsToRemove) {
  if (!data.scripts) return;
  for (const s of scriptsToRemove) {
    delete data.scripts[s];
  }
}

function removeExports(data, exportsToRemove) {
  if (!data.exports) return;
  for (const e of exportsToRemove) {
    delete data.exports[e];
  }
}

// ── Removal Functions ────────────────────────────────────────────────────────

async function removeAstro() {
  console.log(`\n${bold(cyan('Removing Astro...'))}`);

  await remove('templates/astro-site');

  await modifyJson('package.json', (data) => {
    removeScripts(data, ['dev:astro', 'build:astro']);
  });

  await filterLines('.env.template', (line) => {
    return !line.match(/^PUBLIC_/);
  });

  await removeMcpEntry('astro-docs');
}

async function removeNextJs(selections) {
  console.log(`\n${bold(cyan('Removing Next.js...'))}`);

  await remove('templates/next-app');

  await modifyJson('package.json', (data) => {
    removeScripts(data, ['dev:next', 'build:next']);
  });

  await filterLines('.env.template', (line) => {
    const trimmed = line.trim();
    // Remove NEXT_PUBLIC_* vars
    if (trimmed.startsWith('NEXT_PUBLIC_')) return false;
    // Remove Payload vars (Next.js removal includes Payload)
    if (trimmed.startsWith('DATABASE_URL')) return false;
    if (trimmed.startsWith('PAYLOAD_SECRET')) return false;
    if (trimmed.startsWith('NEXT_PUBLIC_SERVER_URL')) return false;
    return true;
  });

  await removeMcpEntry('next-devtools');
  // Also remove Payload MCP entry since Payload requires Next.js
  await removeMcpEntry('payload');
}

async function removePayload(selections) {
  console.log(`\n${bold(cyan('Removing Payload CMS...'))}`);

  await remove('templates/next-app/src/payload.config.ts');
  await remove('templates/next-app/src/app/(payload)');
  await remove('templates/next-app/src/app/api');

  // Modify next.config.ts based on what's kept
  const keepSentry = selections.integrations.includes('sentry');
  await modifyNextConfig({ keepPayload: false, keepSentry });

  // Remove @payload-config from tsconfig paths
  await modifyJson('templates/next-app/tsconfig.json', (data) => {
    if (data.compilerOptions?.paths) {
      delete data.compilerOptions.paths['@payload-config'];
    }
  });

  // Remove Payload deps from next-app package.json
  await modifyJson('templates/next-app/package.json', (data) => {
    removeDeps(data, [
      'payload',
      '@payloadcms/next',
      '@payloadcms/db-postgres',
      '@payloadcms/richtext-lexical',
    ]);
  });

  // Remove Payload env vars
  await filterLines('.env.template', (line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('PAYLOAD_SECRET')) return false;
    if (trimmed.startsWith('DATABASE_URL')) return false;
    if (trimmed.startsWith('NEXT_PUBLIC_SERVER_URL')) return false;
    return true;
  });

  await removeMcpEntry('payload');
}

async function removeSupabase(selections) {
  console.log(`\n${bold(cyan('Removing Supabase...'))}`);

  await remove('supabase');
  await remove('packages/shared/src/supabase');

  const keepNext = selections.frameworks.includes('next');
  if (keepNext) {
    await remove('templates/next-app/src/proxy.ts');
  }

  await modifyJson('package.json', (data) => {
    removeDeps(data, ['supabase']);
    removeScripts(data, ['dev:supabase', 'stop:supabase']);
  });

  await modifyJson('packages/shared/package.json', (data) => {
    removeDeps(data, ['@supabase/supabase-js', '@supabase/ssr']);
    removeExports(data, ['./supabase']);
  });

  if (keepNext) {
    await modifyJson('templates/next-app/package.json', (data) => {
      removeDeps(data, ['@supabase/ssr']);
    });
  }

  await filterLines('.env.template', (line) => {
    return !line.toUpperCase().includes('SUPABASE');
  });

  await removeMcpEntry('supabase-remote');
}

async function removeTwenty() {
  console.log(`\n${bold(cyan('Removing Twenty CRM...'))}`);

  await remove('docker/twenty');

  // Remove docker/ if empty
  if (await dirIsEmpty('docker')) {
    await remove('docker');
  }

  await filterLines('.env.template', (line) => {
    return !line.trim().startsWith('TWENTY_');
  });

  await removeMcpEntry('twenty-crm');
}

async function removeSentry(selections) {
  console.log(`\n${bold(cyan('Removing Sentry...'))}`);

  const keepAstro = selections.frameworks.includes('astro');
  const keepNext = selections.frameworks.includes('next');

  if (keepAstro) {
    await remove('templates/astro-site/sentry.client.config.ts');
    await remove('templates/astro-site/sentry.server.config.ts');

    // Remove sentry from astro.config.mjs
    await replaceInFile(
      'templates/astro-site/astro.config.mjs',
      /import sentry from '@sentry\/astro';\n/,
      ''
    );
    // Remove the sentry() call from integrations array
    await replaceInFile(
      'templates/astro-site/astro.config.mjs',
      /,?\s*sentry\(\{[\s\S]*?\}\)\s*,?/,
      ''
    );
    // Clean up any trailing comma in integrations array
    await replaceInFile(
      'templates/astro-site/astro.config.mjs',
      /,(\s*\])/,
      '$1'
    );

    await modifyJson('templates/astro-site/package.json', (data) => {
      removeDeps(data, ['@sentry/astro']);
    });
  }

  if (keepNext) {
    await remove('templates/next-app/sentry.client.config.ts');
    await remove('templates/next-app/sentry.server.config.ts');

    const keepPayload = selections.backend.includes('payload');
    await modifyNextConfig({ keepPayload, keepSentry: false });

    await modifyJson('templates/next-app/package.json', (data) => {
      removeDeps(data, ['@sentry/nextjs']);
    });
  }

  await remove('packages/shared/src/sentry');

  await filterLines('.env.template', (line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('SENTRY_')) return false;
    if (trimmed.startsWith('NEXT_PUBLIC_SENTRY_')) return false;
    if (trimmed.startsWith('PUBLIC_SENTRY_')) return false;
    return true;
  });

  await removeMcpEntry('sentry');
}

async function removePosthog() {
  console.log(`\n${bold(cyan('Removing PostHog...'))}`);

  await remove('packages/shared/src/posthog');

  await modifyJson('packages/shared/package.json', (data) => {
    removeDeps(data, ['posthog-js']);
    removeExports(data, ['./posthog']);
  });

  await filterLines('.env.template', (line) => {
    return !line.toUpperCase().includes('POSTHOG');
  });

  await removeMcpEntry('posthog');
}

async function removeResend() {
  console.log(`\n${bold(cyan('Removing Resend...'))}`);

  await remove('packages/shared/src/resend');

  await modifyJson('packages/shared/package.json', (data) => {
    removeDeps(data, ['resend']);
    removeExports(data, ['./resend']);
  });

  await filterLines('.env.template', (line) => {
    return !line.trim().startsWith('RESEND_API_KEY');
  });

  await removeMcpEntry('resend');
}

// ── Next.js Config Rewriting ────────────────────────────────────────────────

async function modifyNextConfig({ keepPayload, keepSentry }) {
  const configPath = 'templates/next-app/next.config.ts';
  if (!(await fileExists(configPath))) return;

  const full = path.join(ROOT, configPath);
  let content = await fs.readFile(full, 'utf-8');

  if (keepPayload && keepSentry) {
    // Both kept — no changes needed
    return;
  }

  if (!keepPayload && !keepSentry) {
    // Remove both — rewrite the whole file
    content = `import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.supabase.co" },
      { protocol: "https", hostname: "**.vercel-storage.com" },
    ],
  },
  devIndicators: false,
};

export default nextConfig;
`;
  } else if (keepPayload && !keepSentry) {
    // Keep Payload, remove Sentry
    content = content.replace(
      /import { withSentryConfig } from "@sentry\/nextjs";\n/,
      ''
    );
    content = content.replace(
      /export default withSentryConfig\(withPayload\(nextConfig\),\s*\{[\s\S]*?\}\);/,
      'export default withPayload(nextConfig);'
    );
  } else if (!keepPayload && keepSentry) {
    // Keep Sentry, remove Payload
    content = content.replace(
      /import { withPayload } from "@payloadcms\/next\/withPayload";\n/,
      ''
    );
    content = content.replace(
      /withSentryConfig\(withPayload\(nextConfig\)/,
      'withSentryConfig(nextConfig'
    );
  }

  await fs.writeFile(full, content);
  console.log(`  ${yellow('Modified:')} ${configPath}`);
}

// ── Clean Up ────────────────────────────────────────────────────────────────

async function cleanUpEmptyEnvSections() {
  const envPath = path.join(ROOT, '.env.template');
  try {
    let content = await fs.readFile(envPath, 'utf-8');
    // Remove consecutive blank lines (keep at most one)
    content = content.replace(/\n{3,}/g, '\n\n');
    // Remove comment-only sections with no vars after them
    // A section header is a line starting with #, followed by blank lines or EOF
    content = content.replace(/(^# .+\n)(\s*\n)+(?=(# |\s*$))/gm, '');
    // Trim trailing whitespace
    content = content.trimEnd() + '\n';
    await fs.writeFile(envPath, content);
  } catch {
    // File may have been fully emptied — that's ok
  }
}

async function cleanUpSharedPackage(selections) {
  // Check if shared package has any exports left
  const pkgPath = path.join(ROOT, 'packages/shared/package.json');
  try {
    const data = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));
    const exports = data.exports || {};
    const exportKeys = Object.keys(exports);
    if (exportKeys.length === 0) {
      // Add a placeholder types-only export
      data.exports = { './types': './src/types/index.ts' };
      await fs.writeFile(pkgPath, JSON.stringify(data, null, 2) + '\n');
      console.log(`  ${yellow('Modified:')} packages/shared/package.json ${dim('(added placeholder export)')}`);
    }
  } catch {
    // Package may have been removed
  }
}

async function cleanUpWorkspace(selections) {
  const keepAstro = selections.frameworks.includes('astro');
  const keepNext = selections.frameworks.includes('next');

  // If no templates remain, update pnpm-workspace.yaml
  if (!keepAstro && !keepNext) {
    const wsPath = path.join(ROOT, 'pnpm-workspace.yaml');
    try {
      let content = await fs.readFile(wsPath, 'utf-8');
      content = content.replace(/\s*- "templates\/\*"/, '');
      await fs.writeFile(wsPath, content);
      console.log(`  ${yellow('Modified:')} pnpm-workspace.yaml`);
    } catch {}
  }

  // Remove templates/ dir if empty
  if (await dirIsEmpty('templates')) {
    await remove('templates');
  }

  // Remove docker/ dir if empty
  if (await dirIsEmpty('docker')) {
    await remove('docker');
  }
}

// ── Prompt Helpers ──────────────────────────────────────────────────────────

function onCancel() {
  console.log(`\n${red('Cancelled.')}`);
  process.exit(1);
}

// ── Build selections from flags/preset ───────────────────────────────────────

function buildSelectionsFromFlags(flags) {
  // Note: CLI flag --nextjs maps to internal value 'next'
  const activeFlags = flags instanceof Set ? flags : new Set(flags);
  return {
    frameworks: [
      ...(activeFlags.has('astro') ? ['astro'] : []),
      ...(activeFlags.has('nextjs') ? ['next'] : []),
    ],
    backend: [
      ...(activeFlags.has('supabase') ? ['supabase'] : []),
      ...(activeFlags.has('payload') ? ['payload'] : []),
      ...(activeFlags.has('twenty') ? ['twenty'] : []),
    ],
    integrations: [
      ...(activeFlags.has('sentry') ? ['sentry'] : []),
      ...(activeFlags.has('posthog') ? ['posthog'] : []),
      ...(activeFlags.has('resend') ? ['resend'] : []),
    ],
  };
}

function validateSelections(selections) {
  const errors = [];

  if (selections.frameworks.length === 0) {
    errors.push('At least one framework is required (--astro or --nextjs).');
  }

  if (selections.backend.includes('payload')) {
    if (!selections.frameworks.includes('next')) {
      errors.push('Payload CMS requires Next.js (--nextjs).');
    }
    if (!selections.backend.includes('supabase')) {
      errors.push('Payload CMS requires Supabase (--supabase).');
    }
  }

  return errors;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const cliArgs = parseArgs();

  // Handle --help
  if (cliArgs.help) {
    printHelp();
    process.exit(0);
  }

  console.log('');
  console.log(bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(bold('  Website Template — Project Creator'));
  console.log(bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log('');

  let projectName;
  let selections;

  // ── Non-interactive mode ──────────────────────────────────────────────────
  if (!cliArgs.interactive) {
    // Validate name
    if (!cliArgs.name) {
      console.error(red('  Error: --name=<project-name> is required in non-interactive mode.'));
      console.error(dim('  Example: node scripts/create-project.mjs --name=my-project --preset=marketing'));
      process.exit(1);
    }
    projectName = cliArgs.name;

    // Resolve preset or flags to a set of service names
    let serviceFlags;
    if (cliArgs.preset) {
      const preset = PRESETS[cliArgs.preset];
      if (!preset) {
        console.error(red(`  Error: Unknown preset "${cliArgs.preset}".`));
        console.error(dim(`  Available presets: ${Object.keys(PRESETS).join(', ')}`));
        process.exit(1);
      }
      // Merge preset services with any additional flags provided
      serviceFlags = new Set([...preset.services, ...cliArgs.flags]);
    } else {
      serviceFlags = cliArgs.flags;
    }

    selections = buildSelectionsFromFlags(serviceFlags);

    // Validate
    const errors = validateSelections(selections);
    if (errors.length > 0) {
      for (const err of errors) {
        console.error(red(`  Error: ${err}`));
      }
      process.exit(1);
    }

    // Show what will be done (non-interactive summary)
    console.log(dim('  Running in non-interactive mode.'));
    console.log('');
    console.log(`  ${bold('Project name:')}  ${projectName}`);
    if (cliArgs.preset) {
      console.log(`  ${bold('Preset:')}        ${cliArgs.preset} ${dim(`— ${PRESETS[cliArgs.preset].description}`)}`);
    }
    console.log(
      `  ${bold('Frameworks:')}    ${selections.frameworks.length > 0 ? selections.frameworks.join(', ') : dim('none')}`
    );
    console.log(
      `  ${bold('Backend:')}       ${selections.backend.length > 0 ? selections.backend.join(', ') : dim('none')}`
    );
    console.log(
      `  ${bold('Integrations:')}  ${selections.integrations.length > 0 ? selections.integrations.join(', ') : dim('none')}`
    );
    console.log('');

  // ── Interactive mode ──────────────────────────────────────────────────────
  } else {
    console.log(dim('  Select which services to include in your project.'));
    console.log(dim('  Everything not selected will be removed.'));
    console.log('');

    // 1. Project name — skip prompt if provided via args
    if (cliArgs.name) {
      projectName = cliArgs.name;
      console.log(`  ${bold('Project name:')} ${projectName} ${dim('(from --name flag)')}`);
      console.log('');
    } else {
      const result = await prompts(
        {
          type: 'text',
          name: 'projectName',
          message: 'Project name',
          validate: (v) => (v.trim().length > 0 ? true : 'Project name is required'),
        },
        { onCancel }
      );
      projectName = result.projectName;
    }

    // 2. Frameworks
    const { frameworks } = await prompts(
      {
        type: 'multiselect',
        name: 'frameworks',
        message: 'Frameworks (at least 1 required)',
        choices: [
          {
            title: `Astro ${dim('— SEO/marketing sites (port 4400)')}`,
            value: 'astro',
            selected: true,
          },
          {
            title: `Next.js ${dim('— Dashboards/apps/admin panels (port 3100)')}`,
            value: 'next',
            selected: true,
          },
        ],
        hint: '- Space to toggle, Enter to confirm',
      },
      { onCancel }
    );

    if (!frameworks || frameworks.length === 0) {
      console.log(red('\n  Error: At least one framework is required.\n'));
      process.exit(1);
    }

    // 3. Backend Services
    const backendChoices = [
      {
        title: `Supabase ${dim('— Database + Auth + Storage')}`,
        value: 'supabase',
        selected: true,
      },
      {
        title: `Payload CMS ${dim('— Headless CMS (requires Next.js + Supabase)')}`,
        value: 'payload',
        selected: false,
      },
      {
        title: `Twenty CRM ${dim('— Self-hosted CRM (Docker)')}`,
        value: 'twenty',
        selected: false,
      },
    ];

    let backend;
    let validBackend = false;

    while (!validBackend) {
      const result = await prompts(
        {
          type: 'multiselect',
          name: 'backend',
          message: 'Backend Services',
          choices: backendChoices,
          hint: '- Space to toggle, Enter to confirm',
        },
        { onCancel }
      );
      backend = result.backend;

      // Validate dependencies
      if (backend.includes('payload') && !frameworks.includes('next')) {
        console.log(red('\n  Error: Payload CMS requires Next.js. Please re-select.\n'));
        continue;
      }
      if (backend.includes('payload') && !backend.includes('supabase')) {
        console.log(
          red('\n  Error: Payload CMS requires Supabase (for Postgres). Please re-select.\n')
        );
        continue;
      }
      validBackend = true;
    }

    // 4. Integrations
    const { integrations } = await prompts(
      {
        type: 'multiselect',
        name: 'integrations',
        message: 'Integrations',
        choices: [
          {
            title: `Sentry ${dim('— Error tracking')}`,
            value: 'sentry',
            selected: true,
          },
          {
            title: `PostHog ${dim('— Product analytics')}`,
            value: 'posthog',
            selected: false,
          },
          {
            title: `Resend ${dim('— Transactional email')}`,
            value: 'resend',
            selected: false,
          },
        ],
        hint: '- Space to toggle, Enter to confirm',
      },
      { onCancel }
    );

    selections = { frameworks, backend, integrations };

    // 5. Confirmation
    console.log('');
    console.log(bold('  Your selections:'));
    console.log('');
    console.log(`  ${bold('Project name:')}  ${projectName}`);
    console.log(
      `  ${bold('Frameworks:')}    ${frameworks.length > 0 ? frameworks.join(', ') : dim('none')}`
    );
    console.log(
      `  ${bold('Backend:')}       ${backend.length > 0 ? backend.join(', ') : dim('none')}`
    );
    console.log(
      `  ${bold('Integrations:')}  ${integrations.length > 0 ? integrations.join(', ') : dim('none')}`
    );
    console.log('');

    // Build removal list for display
    const removing = [];
    if (!frameworks.includes('astro')) removing.push('Astro');
    if (!frameworks.includes('next')) removing.push('Next.js');
    if (!backend.includes('supabase')) removing.push('Supabase');
    if (!backend.includes('payload')) removing.push('Payload CMS');
    if (!backend.includes('twenty')) removing.push('Twenty CRM');
    if (!integrations.includes('sentry')) removing.push('Sentry');
    if (!integrations.includes('posthog')) removing.push('PostHog');
    if (!integrations.includes('resend')) removing.push('Resend');

    if (removing.length > 0) {
      console.log(`  ${bold('Will remove:')}   ${red(removing.join(', '))}`);
      console.log('');
    } else {
      console.log(`  ${green('Keeping everything — no removals needed.')}`);
      console.log('');
    }

    const { confirmed } = await prompts(
      {
        type: 'confirm',
        name: 'confirmed',
        message: 'Proceed with project creation?',
        initial: true,
      },
      { onCancel }
    );

    if (!confirmed) {
      console.log(`\n${red('Cancelled.')}`);
      process.exit(0);
    }

    if (removing.length === 0) {
      console.log(`\n${green('Nothing to remove. Project is ready as-is!')}`);
      await renameProject(projectName);
      printSummary(selections, projectName);
      return;
    }
  }

  // ── Build removal list (shared by both modes) ─────────────────────────────

  const removing = [];
  if (!selections.frameworks.includes('astro')) removing.push('Astro');
  if (!selections.frameworks.includes('next')) removing.push('Next.js');
  if (!selections.backend.includes('supabase')) removing.push('Supabase');
  if (!selections.backend.includes('payload')) removing.push('Payload CMS');
  if (!selections.backend.includes('twenty')) removing.push('Twenty CRM');
  if (!selections.integrations.includes('sentry')) removing.push('Sentry');
  if (!selections.integrations.includes('posthog')) removing.push('PostHog');
  if (!selections.integrations.includes('resend')) removing.push('Resend');

  // In non-interactive mode, show what will be removed before proceeding
  if (!cliArgs.interactive) {
    if (removing.length > 0) {
      console.log(`  ${bold('Will remove:')}   ${red(removing.join(', '))}`);
    } else {
      console.log(`  ${green('Keeping everything — no removals needed.')}`);
    }
    console.log('');
  }

  if (removing.length === 0) {
    console.log(`\n${green('Nothing to remove. Project is ready as-is!')}`);
    await renameProject(projectName);
    printSummary(selections, projectName);
    return;
  }

  // ── Execute Removals ──────────────────────────────────────────────────────
  // Order: integrations first, then backend, then frameworks
  // This ensures dependent files still exist when we need to modify them

  console.log('');
  console.log(bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(bold('  Removing deselected services...'));
  console.log(bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));

  // Integrations
  if (!selections.integrations.includes('sentry')) await removeSentry(selections);
  if (!selections.integrations.includes('posthog')) await removePosthog();
  if (!selections.integrations.includes('resend')) await removeResend();

  // Backend (Payload before Supabase since Payload depends on it)
  if (!selections.backend.includes('payload') && selections.frameworks.includes('next')) {
    await removePayload(selections);
  }
  if (!selections.backend.includes('twenty')) await removeTwenty();
  if (!selections.backend.includes('supabase')) await removeSupabase(selections);

  // Frameworks (Next.js removal also removes Payload)
  if (!selections.frameworks.includes('next')) await removeNextJs(selections);
  if (!selections.frameworks.includes('astro')) await removeAstro();

  // ── Post-Removal Cleanup ──────────────────────────────────────────────────

  console.log('');
  console.log(bold(cyan('Cleaning up...')));

  await cleanUpEmptyEnvSections();
  await cleanUpSharedPackage(selections);
  await cleanUpWorkspace(selections);

  // Rename project
  await renameProject(projectName);

  // Run pnpm install (skip if --no-install)
  if (!cliArgs.noInstall) {
    console.log(`\n${bold(cyan('Running pnpm install...'))}`);
    try {
      execFileSync('pnpm', ['install'], { cwd: ROOT, stdio: 'inherit' });
      console.log(`  ${green('Lockfile updated.')}`);
    } catch {
      console.log(`  ${yellow('Warning: pnpm install had issues. Run it manually.')}`);
    }
  } else {
    console.log(`\n${dim('Skipping pnpm install (--no-install).')}`);
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  printSummary(selections, projectName);
}

async function renameProject(projectName) {
  const slug = projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  await modifyJson('package.json', (data) => {
    data.name = slug;
  });

  // Rename workspace packages too
  const keepAstro = await fileExists('templates/astro-site/package.json');
  const keepNext = await fileExists('templates/next-app/package.json');

  if (keepAstro) {
    await modifyJson('templates/astro-site/package.json', (data) => {
      data.name = `@${slug}/astro-site`;
    });
  }
  if (keepNext) {
    await modifyJson('templates/next-app/package.json', (data) => {
      data.name = `@${slug}/next-app`;
    });
  }

  await modifyJson('packages/shared/package.json', (data) => {
    data.name = `@${slug}/shared`;
  });

  // Update workspace references in template package.json files
  if (keepAstro) {
    await modifyJson('templates/astro-site/package.json', (data) => {
      if (data.dependencies?.['@template/shared']) {
        delete data.dependencies['@template/shared'];
        data.dependencies[`@${slug}/shared`] = 'workspace:*';
      }
    });
  }
  if (keepNext) {
    await modifyJson('templates/next-app/package.json', (data) => {
      if (data.dependencies?.['@template/shared']) {
        delete data.dependencies['@template/shared'];
        data.dependencies[`@${slug}/shared`] = 'workspace:*';
      }
    });
  }
}

function printSummary(selections, projectName) {
  console.log('');
  console.log(bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(bold(green(`  Project "${projectName}" is ready!`)));
  console.log(bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log('');

  console.log(bold('  Included:'));
  if (selections.frameworks.includes('astro')) console.log(`    ${green('+')} Astro (port 4400)`);
  if (selections.frameworks.includes('next')) console.log(`    ${green('+')} Next.js (port 3100)`);
  if (selections.backend.includes('supabase')) console.log(`    ${green('+')} Supabase`);
  if (selections.backend.includes('payload')) console.log(`    ${green('+')} Payload CMS`);
  if (selections.backend.includes('twenty')) console.log(`    ${green('+')} Twenty CRM`);
  if (selections.integrations.includes('sentry')) console.log(`    ${green('+')} Sentry`);
  if (selections.integrations.includes('posthog')) console.log(`    ${green('+')} PostHog`);
  if (selections.integrations.includes('resend')) console.log(`    ${green('+')} Resend`);

  const removed = [];
  if (!selections.frameworks.includes('astro')) removed.push('Astro');
  if (!selections.frameworks.includes('next')) removed.push('Next.js');
  if (!selections.backend.includes('supabase')) removed.push('Supabase');
  if (!selections.backend.includes('payload')) removed.push('Payload CMS');
  if (!selections.backend.includes('twenty')) removed.push('Twenty CRM');
  if (!selections.integrations.includes('sentry')) removed.push('Sentry');
  if (!selections.integrations.includes('posthog')) removed.push('PostHog');
  if (!selections.integrations.includes('resend')) removed.push('Resend');

  if (removed.length > 0) {
    console.log('');
    console.log(bold('  Removed:'));
    for (const r of removed) {
      console.log(`    ${red('-')} ${r}`);
    }
  }

  console.log('');
  console.log(bold('  Next steps (run these commands in your terminal):'));
  console.log('');
  console.log(`    ${bold('Step 1.')} Copy the environment template (creates your local config file):`);
  console.log(`    ${cyan('cp .env.template .env')}`);
  console.log('');
  console.log(`    ${bold('Step 2.')} Start services (generates passwords, starts database and Docker):`);
  console.log(`    ${cyan(`./scripts/init-project.sh "${projectName}"`)}`);
  console.log('');
  if (kept.includes('Astro') && kept.includes('Next.js')) {
    console.log(`    ${bold('Step 3.')} Start your dev servers (open two terminal windows, one for each):`);
    console.log(`    ${cyan('pnpm dev:astro')}    ${dim('# starts your Astro website')}`);
    console.log(`    ${cyan('pnpm dev:next')}     ${dim('# starts your Next.js app + CMS admin')}`);
  } else if (kept.includes('Astro')) {
    console.log(`    ${bold('Step 3.')} Start your development server:`);
    console.log(`    ${cyan('pnpm dev:astro')}`);
  } else if (kept.includes('Next.js')) {
    console.log(`    ${bold('Step 3.')} Start your development server:`);
    console.log(`    ${cyan('pnpm dev:next')}`);
  }
  console.log('');
  console.log(`    After Step 3, your website URL will appear in the terminal.`);
  console.log(`    Open that URL in your browser to see your site.`);
  console.log('');
}

// ── Run ──────────────────────────────────────────────────────────────────────
main().catch((err) => {
  console.error(`\n${red('Fatal error:')} ${err.message}`);
  process.exit(1);
});
