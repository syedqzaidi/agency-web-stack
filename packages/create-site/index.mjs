#!/usr/bin/env node

import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

// ── Config ───────────────────────────────────────────────────────────────────
// IMPORTANT: Update this URL before publishing
const TEMPLATE_REPO = 'https://github.com/your-org/website-template.git';

// ── ANSI Colors ──────────────────────────────────────────────────────────────
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

// ── Parse Args ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);

// ── UI Mode ─────────────────────────────────────────────────────────────────
if (args.includes('--ui')) {
  const { startUI } = await import('./ui-server.mjs');
  startUI(args);
} else {
// ── CLI Mode ────────────────────────────────────────────────────────────────

// Find project name (first arg that doesn't start with --)
const projectName = args.find(a => !a.startsWith('-'));
const passthroughArgs = args.filter(a => a !== projectName);
const noInit = passthroughArgs.includes('--no-init');
const showHelp = passthroughArgs.includes('--help') || passthroughArgs.includes('-h');

if (showHelp) {
  console.log(`
${bold('Create Site — Agency Website Template')}

${bold('Usage:')}
  npx @agency/create-site <project-name> [options]

${bold('Examples:')}
  npx @agency/create-site my-project                          ${dim('# Interactive wizard')}
  npx @agency/create-site my-project --preset=marketing       ${dim('# Use preset')}
  npx @agency/create-site my-project --astro --supabase       ${dim('# Pick services')}

All options are passed through to the project setup wizard.
Run with --help after project name to see all service flags and presets.
`);
  process.exit(0);
}

if (!projectName) {
  console.error(red('Error: Project name is required'));
  console.log(`\nUsage: npx @agency/create-site <project-name> [options]`);
  process.exit(1);
}

const targetDir = path.resolve(process.cwd(), projectName);

if (fs.existsSync(targetDir)) {
  console.error(red(`Error: Directory "${projectName}" already exists`));
  process.exit(1);
}

// ── Clone Template ───────────────────────────────────────────────────────────
console.log(`\n${bold('Creating project:')} ${cyan(projectName)}\n`);

// Try degit first (faster, no git history), fall back to git clone
let useDegit = false;
try {
  execSync('npx --version', { stdio: 'ignore' });
  useDegit = true;
} catch {}

try {
  if (useDegit) {
    console.log(`${dim('Downloading template...')}`);
    execSync(`npx --yes degit ${TEMPLATE_REPO.replace('https://github.com/', '').replace('.git', '')} ${projectName}`, {
      stdio: 'inherit',
      cwd: process.cwd(),
    });
  } else {
    console.log(`${dim('Cloning template...')}`);
    execSync(`git clone --depth=1 ${TEMPLATE_REPO} ${projectName}`, {
      stdio: 'inherit',
      cwd: process.cwd(),
    });
    // Remove .git from clone
    fs.rmSync(path.join(targetDir, '.git'), { recursive: true, force: true });
  }
} catch (err) {
  console.error(red(`\nFailed to download template: ${err.message}`));
  console.log(`\nYou can manually clone:`);
  console.log(`  git clone ${TEMPLATE_REPO} ${projectName}`);
  process.exit(1);
}

// ── Run Setup Wizard ─────────────────────────────────────────────────────────
console.log(`\n${bold('Running project setup...')}\n`);

// Pass through all flags + inject --name
const wizardArgs = ['scripts/create-project.mjs', `--name=${projectName}`, ...passthroughArgs.filter(a => a !== '--no-init')];

try {
  const result = spawn('node', wizardArgs, {
    cwd: targetDir,
    stdio: 'inherit',
  });

  result.on('close', (code) => {
    if (code !== 0) {
      console.error(red(`\nSetup wizard exited with code ${code}`));
      process.exit(code);
    }

    // ── Run Init Script ──────────────────────────────────────────────────
    if (!noInit) {
      console.log(`\n${bold('Initializing services...')}\n`);
      try {
        execSync(`bash scripts/init-project.sh "${projectName}"`, {
          cwd: targetDir,
          stdio: 'inherit',
        });
      } catch (err) {
        console.log(dim(`\nInit script failed or was skipped. You can run it manually:`));
        console.log(`  cd ${projectName} && ./scripts/init-project.sh "${projectName}"`);
      }
    }

    // ── Done ─────────────────────────────────────────────────────────────
    console.log(`
${green(bold('Done!'))} Project created at ${cyan(`./${projectName}`)}

${bold('Next steps:')}
  cd ${projectName}
  ${noInit ? `./scripts/init-project.sh "${projectName}"` : 'pnpm dev:astro    # or pnpm dev:next'}
`);
  });
} catch (err) {
  console.error(red(`Failed to run setup: ${err.message}`));
  process.exit(1);
}

} // end CLI mode
