# Agency Web Stack

Everything you need to build websites for clients. One command to set up, interactive wizard to choose your tools.

---

## Quick Start

There are three ways to get started. **Cloning the repo alone is not enough** -- you must also install dependencies and run the setup wizard for everything to work.

### Option A -- Clone from GitHub, then set up (most common)

This is what you do if you clicked the green "Code" button on GitHub, or want to clone the repo yourself.

**Step 1.** Open your Terminal app. On Mac, press `Cmd + Space`, type "Terminal", and press Enter.

**Step 2.** Clone (download) the repo and go into the project folder. Replace `my-project` with your project name:

```bash
git clone https://github.com/syedqzaidi/agency-web-stack.git my-project
cd my-project
```

**Step 3.** Install all dependencies. This downloads the libraries your project needs. It takes about 30-60 seconds:

```bash
pnpm install
```

**Step 4.** Run the interactive setup wizard. This walks you through choosing which tools you want (database, CMS, analytics, etc.):

```bash
node scripts/create-project.mjs
```

The wizard will ask you to pick your services using arrow keys and spacebar. When you are done, it removes the tools you do not need and cleans up the project.

**Step 5.** Initialize your services. This generates secure passwords, starts Docker services (database, CRM), and configures everything:

```bash
./scripts/init-project.sh "my-project"
```

Replace `"my-project"` with the same name you used in Step 2.

**Step 6.** Start your development servers (see "Starting Your Servers" section below).

**IMPORTANT:** After cloning, your project will NOT work until you complete Steps 3-5. The repo only contains source code and configuration files -- it does not include the installed libraries or running services.

### Option B -- One command does everything (recommended for speed)

If you want to skip the manual steps above, this single command does Steps 1-5 automatically.

First, navigate to the folder where you want the project created. For example, to create it on your Desktop:

```bash
cd ~/Desktop
```

Then run:

```bash
curl -fsSL https://raw.githubusercontent.com/syedqzaidi/agency-web-stack/main/scripts/bootstrap.sh | bash -s -- my-project
```

This creates a new folder called `my-project` inside your current location (in this example, `~/Desktop/my-project`). It then installs dependencies, launches the wizard, generates passwords, and starts all services. Takes about 5 minutes on first run.

### Option C -- One command with a preset (skip the wizard too)

If you already know which tools you want, add a preset to skip the wizard entirely:

```bash
curl -fsSL https://raw.githubusercontent.com/syedqzaidi/agency-web-stack/main/scripts/bootstrap.sh | bash -s -- my-project --preset=marketing
```

Available presets:

| Preset | Best For | What You Get |
|--------|----------|--------------|
| `marketing` | SEO and marketing websites | Astro + Supabase + Sentry + PostHog |
| `dashboard` | Admin panels and web apps | Next.js + Payload CMS + Supabase + Sentry |
| `full` | Everything included | All 14 tools enabled |
| `minimal` | Simple static website | Just Astro with Tailwind CSS (no backend) |
| `nextjs-minimal` | Simple Next.js app | Just Next.js with Tailwind CSS (no backend) |
| `both-frameworks` | Multi-site projects | Both Astro and Next.js with Supabase and Sentry |

### Summary: What each step does and why

| Step | Command | What It Does | Why It Is Needed |
|------|---------|-------------|-----------------|
| Clone | `git clone ...` | Downloads the project files to your computer | You need the files before anything else |
| Install | `pnpm install` | Downloads all the libraries the code depends on | Code will not run without its libraries |
| Wizard | `node scripts/create-project.mjs` | Lets you pick which tools to include, removes the rest | Customizes the project for your needs |
| Init | `./scripts/init-project.sh "name"` | Generates passwords, starts database and services | Services need secrets and Docker containers to run |
| Dev servers | `pnpm dev:astro` / `pnpm dev:next` | Starts the website so you can see it in your browser | Nothing is visible until the server is running |

---

## Before You Begin (Prerequisites)

You need these programs installed on your computer before starting. If you used Option A or B above, the bootstrap script will check for these and warn you if anything is missing.

### 1. Node.js (version 20 or higher)

Node.js is the engine that runs JavaScript outside of a web browser. Your website's build tools depend on it.

- Download from: https://nodejs.org
- Choose the **LTS** version (the one labeled "Recommended for Most Users")
- To check if it is already installed, open Terminal and type:

  ```bash
  node --version
  ```

  You should see something like `v20.x.x` or higher.

### 2. pnpm (package manager)

pnpm is a tool that downloads and manages the libraries your project uses. It is faster and more efficient than the default `npm`.

- After installing Node.js, open Terminal and run:

  ```bash
  npm install -g pnpm
  ```

- The bootstrap command (Option A/B) will install this automatically if it is missing.

### 3. Docker Desktop

Docker runs small, isolated servers on your computer -- this is how the database, email testing tool, and CRM run locally without you having to install each one separately.

- Download from: https://www.docker.com/products/docker-desktop/
- After installing, open the Docker Desktop app and **wait until it says "Running"** in the bottom-left corner
- Docker is needed for Supabase (database), Mailpit (test emails), and Twenty CRM

### 4. Git

Git is a tool for downloading and tracking changes to code. The bootstrap command uses it behind the scenes.

- Usually pre-installed on Mac. To check, open Terminal and type:

  ```bash
  git --version
  ```

- If not installed, download from: https://git-scm.com

---

## Starting Your Servers

**IMPORTANT: Your websites and services will not be accessible until you start the servers. The URLs shown during setup will not load until you complete this step.**

The init script (step 4 of setup) starts Docker services automatically -- these are the background services like your database and email inbox. However, the development servers where you actually see your website need to be started separately.

### To start your Astro website:

```bash
pnpm dev:astro
```

### To start your Next.js app (includes CMS admin panel):

```bash
pnpm dev:next
```

### To start both at once:

Open two separate Terminal windows. Run one command in each window. Both servers need to stay running while you work.

### What you will see:

When a server starts successfully, it prints a URL in the Terminal. Open that URL in your browser to see your website. The URLs look something like this:

```
http://localhost:4487    (your Astro website)
http://localhost:3187    (your Next.js app)
http://localhost:3187/admin  (your CMS admin panel)
```

**Note:** The exact port numbers (the numbers after `localhost:`) are unique to your project. They are randomly assigned during setup so that multiple projects do not conflict. Check the output when you run the start command, or look in the `.ports` file in your project folder.

---

## Your Service URLs

After running the init script and starting dev servers, these are the services you can access:

| Service | What It Is | How to Access |
|---------|-----------|---------------|
| Astro Website | Your marketing or SEO website | Open the URL shown when you run `pnpm dev:astro` |
| Next.js App | Your dashboard or web application | Open the URL shown when you run `pnpm dev:next` |
| CMS Admin Panel | Where you manage page content, blog posts, etc. | Go to your Next.js URL and add `/admin` to the end |
| Supabase Studio | Visual tool for managing your database tables and users | URL shown during setup (usually includes port 54323) |
| Mailpit | A fake email inbox for testing -- emails your app sends appear here | URL shown during setup (usually includes port 54324) |
| Twenty CRM | Customer relationship manager for tracking contacts and deals | URL shown during setup (usually port 3001) |

All URLs are printed at the end of the setup process and saved in a `.ports` file in your project folder. Open that file any time you need to find a URL.

---

## What's Included

This template bundles 14 tools so you do not have to find, install, and configure them individually.

| Tool | Version | What It Does | Required? |
|------|---------|-------------|-----------|
| Astro | 6.1.4 | Builds fast marketing and SEO websites. Great for content-heavy pages | At least one framework required |
| Next.js | 16.2.2 | Builds interactive web apps, dashboards, and admin panels | At least one framework required |
| Payload CMS | 3.81.0 | Content management system -- lets non-developers edit page content through a visual admin panel | Optional (needs Next.js + Supabase) |
| Tailwind CSS | 4.2.2 | A styling system that lets you design pages by adding class names directly in HTML | Included with frameworks |
| shadcn/ui | 4.1.2 | 16 pre-built interface components (buttons, forms, tables, dialogs, etc.) | Included with frameworks |
| Motion | 12.38.0 | Adds animations and transitions to page elements | Included with frameworks |
| Supabase | CLI 2.85 / JS 2.101 | Database, user login/registration, and file storage -- all running locally on your computer | Optional |
| Sentry | 10.47.0 | Catches and reports errors so you know when something breaks | Optional |
| PostHog | 1.364.7 | Tracks how visitors use your website -- page views, clicks, session recordings | Optional |
| Resend | 6.10.0 | Sends real emails (password resets, notifications, etc.) through a simple API | Optional |
| Vercel CLI | 50.40.0 | Deploys your website to the internet with one command | Optional |
| Twenty CRM | 1.20.0 | A customer relationship manager for tracking leads and deals, runs locally via Docker | Optional |
| `@template/shared` | workspace | Pre-built code for connecting to Supabase, PostHog, and Resend from either framework | Included |
| AI Website Cloner | -- | Tool for cloning and adapting the design of existing websites | Optional |

---

## Presets Reference

Each preset is a pre-selected combination of tools. Use them with the `--preset=` flag to skip the interactive wizard.

| Preset | Command | Frameworks | Backend | Integrations |
|--------|---------|-----------|---------|-------------|
| `full` | `--preset=full` | Astro + Next.js | Supabase + Payload CMS + Twenty CRM | Sentry + PostHog + Resend |
| `marketing` | `--preset=marketing` | Astro | Supabase | Sentry + PostHog |
| `dashboard` | `--preset=dashboard` | Next.js | Supabase + Payload CMS | Sentry |
| `both-frameworks` | `--preset=both-frameworks` | Astro + Next.js | Supabase | Sentry |
| `minimal` | `--preset=minimal` | Astro | None | None |
| `nextjs-minimal` | `--preset=nextjs-minimal` | Next.js | None | None |

---

## CLI Flags Reference

For advanced users who want full control without the wizard. Combine any of these flags:

```
Frameworks:   --astro, --nextjs
Backend:      --supabase, --payload, --twenty
Integrations: --sentry, --posthog, --resend
Options:      --all, --name=<name>, --preset=<name>, --no-install, --no-init, --help
```

Example -- create a project with Astro, Supabase, and Sentry, skipping the wizard:

```bash
node scripts/create-project.mjs my-project --astro --supabase --sentry
```

---

## Stopping Services

### Stop background services (database, CRM, etc.):

```bash
pnpm stop:supabase
cd docker/twenty && docker compose down
```

### Stop a development server:

Press `Ctrl+C` in the Terminal window where it is running.

---

## Troubleshooting

### "I get 'command not found' when I paste the curl command"

You need to open the Terminal app first. On Mac, press `Cmd + Space`, type "Terminal", and press Enter. Then paste the command.

If `curl` itself is not found (rare), install the Xcode command line tools:

```bash
xcode-select --install
```

### "The URL shows 'connection refused' or the page won't load"

Your server is not running. The URLs only work while the server is actively running in a Terminal window.

1. Make sure you ran `pnpm dev:astro` or `pnpm dev:next` and that the Terminal shows it is running
2. Check that you are using the correct URL -- look at what the Terminal printed when the server started
3. If you closed the Terminal window, the server stopped. Open a new Terminal, navigate to your project folder, and start it again

### "Docker won't start" or "Cannot connect to the Docker daemon"

1. Open the Docker Desktop application
2. Wait until the bottom-left corner says "Running" (this can take 30-60 seconds)
3. Try your command again

If Docker Desktop is not installed, download it from https://www.docker.com/products/docker-desktop/

### "Supabase won't start -- another project already running"

Only one Supabase project can run at a time on your computer. Stop the other one first:

```bash
supabase stop --no-backup
pnpm dev:supabase
```

### "Port conflict on startup"

Another program is using the same port. Find out what:

```bash
lsof -i :<port-number>
```

Either close the conflicting program, or change the port in your project configuration.

### "Payload admin shows a blank page or 404"

1. Make sure Supabase is running: `pnpm dev:supabase`
2. Make sure the Next.js server is running: `pnpm dev:next`
3. Visit the admin URL (your Next.js URL + `/admin`) to complete first-run setup if you have not already

### "'@template/shared' import errors"

Run `pnpm install` from the project root folder (not inside a subfolder). This sets up the internal links between packages.

```bash
cd my-project
pnpm install
```

### "Twenty CRM migration errors on first start"

Twenty sometimes fails on first boot. Reset it and try again:

```bash
cd docker/twenty
docker compose down -v
docker compose up -d
docker compose logs -f twenty
```

Note: `down -v` deletes all CRM data. The `start_period: 60s` health check means Twenty may show as unhealthy for up to a minute while it sets up -- this is normal.

### "CSS not loading in Astro"

Tailwind CSS v4 does not use a `tailwind.config.js` file. Check these three things:

1. `@tailwindcss/vite` is listed in the `plugins` array in `astro.config.mjs`
2. Your global CSS file contains `@import "tailwindcss";`
3. That CSS file is imported in your layout

If styles still do not appear, clear the cache:

```bash
rm -rf templates/astro-site/node_modules/.vite
pnpm dev:astro
```

---

## Project Structure

This section is for developers who want to understand how the codebase is organized.

```
agency-web-stack/
├── templates/
│   ├── astro-site/              # Astro marketing/SEO template
│   │   └── src/
│   │       ├── components/ui/   # shadcn/ui components
│   │       ├── layouts/         # Page layout wrappers
│   │       ├── lib/             # Utility functions
│   │       ├── pages/           # Each file becomes a page on your site
│   │       └── styles/          # Global CSS
│   │
│   └── next-app/                # Next.js app/dashboard template
│       └── src/
│           ├── app/
│           │   ├── (app)/       # Your application pages
│           │   ├── (payload)/   # CMS admin panel pages
│           │   └── api/         # Backend API endpoints
│           ├── components/ui/   # shadcn/ui components
│           ├── lib/             # Utility functions
│           └── payload.config.ts
│
├── packages/
│   └── shared/                  # @template/shared -- reusable service clients
│       └── src/
│           ├── supabase/        # Database client
│           ├── posthog/         # Analytics client
│           ├── resend/          # Email client
│           └── types/           # Shared TypeScript types
│
├── supabase/
│   ├── config.toml              # Local database configuration
│   └── migrations/              # Database schema changes
│
├── docker/
│   └── twenty/
│       ├── docker-compose.yml   # Twenty CRM setup
│       └── .env                 # Twenty CRM secrets
│
├── scripts/                     # Setup wizard and init scripts
├── tools/
│   └── ai-website-cloner/       # AI-assisted site cloning tool
├── .env.template                # Reference list of all environment variables
├── .mcp.json                    # AI assistant tool configuration
├── package.json                 # Project scripts and dependencies
└── pnpm-workspace.yaml          # Workspace configuration
```

---

## Environment Variables

Environment variables are settings that your project reads at startup -- things like API keys, database addresses, and secret tokens. The setup wizard fills these in automatically, but you may need to update them later.

The reference file is `.env.template` in the project root. During setup, `.env` files are created in each template directory with the correct values.

### Supabase (Database and Auth)

| Variable | What It Is |
|----------|-----------|
| `NEXT_PUBLIC_SUPABASE_URL` | Address of your Supabase database. Locally: `http://localhost:54321` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public key for browser-side database access (auto-generated) |
| `SUPABASE_SERVICE_ROLE_KEY` | Private admin key for server-side operations (auto-generated) |
| `PUBLIC_SUPABASE_URL` | Same as above, for Astro projects |
| `PUBLIC_SUPABASE_ANON_KEY` | Same as above, for Astro projects |

### Payload CMS

| Variable | What It Is |
|----------|-----------|
| `PAYLOAD_SECRET` | Secret key for signing admin tokens (auto-generated) |
| `DATABASE_URL` | Database connection address. Default: `postgresql://postgres:postgres@localhost:54322/postgres` |
| `NEXT_PUBLIC_SERVER_URL` | Your website's public address. Default: `http://localhost:3100` |

### Sentry (Error Tracking)

| Variable | What It Is |
|----------|-----------|
| `SENTRY_DSN` | Your Sentry project identifier (get from sentry.io) |
| `NEXT_PUBLIC_SENTRY_DSN` | Same, for browser-side error reporting in Next.js |
| `PUBLIC_SENTRY_DSN` | Same, for Astro |
| `SENTRY_AUTH_TOKEN` | Auth token for uploading source maps during builds |
| `SENTRY_ORG` | Your Sentry organization name |
| `SENTRY_PROJECT` | Your Sentry project name |

### PostHog (Analytics)

| Variable | What It Is |
|----------|-----------|
| `NEXT_PUBLIC_POSTHOG_KEY` | Your PostHog project API key (Next.js) |
| `NEXT_PUBLIC_POSTHOG_HOST` | PostHog server address, e.g. `https://us.i.posthog.com` |
| `PUBLIC_POSTHOG_KEY` | Same, for Astro |
| `PUBLIC_POSTHOG_HOST` | Same, for Astro |

### Resend (Email)

| Variable | What It Is |
|----------|-----------|
| `RESEND_API_KEY` | API key from resend.com |

### Twenty CRM

| Variable | What It Is |
|----------|-----------|
| `TWENTY_API_URL` | Address of your Twenty instance. Default: `http://localhost:3001` |
| `TWENTY_API_KEY` | API key from Twenty Settings > API Keys |

---

## Scripts Reference

Commands you can run from the project root:

| Command | What It Does |
|---------|-------------|
| `pnpm dev:astro` | Start the Astro website in development mode |
| `pnpm dev:next` | Start the Next.js app in development mode |
| `pnpm build:astro` | Build the Astro website for production deployment |
| `pnpm build:next` | Build the Next.js app for production deployment |
| `pnpm dev:supabase` | Start the local database and related services |
| `pnpm stop:supabase` | Stop the local database services |

Commands you can run from inside a template folder (`templates/astro-site` or `templates/next-app`):

| Command | What It Does |
|---------|-------------|
| `pnpm dev` | Start the development server |
| `pnpm build` | Build for production |
| `pnpm preview` | Preview the production build locally (Astro only) |

---

## Development Workflow

This section covers common tasks once your project is set up.

### Adding UI Components

Both frameworks include shadcn/ui, a library of pre-built interface components. To add a new one:

```bash
cd templates/astro-site
pnpm dlx shadcn@latest add accordion
```

Or for Next.js:

```bash
cd templates/next-app
pnpm dlx shadcn@latest add accordion
```

Components appear in `src/components/ui/`. 16 are pre-installed: avatar, badge, button, card, dialog, dropdown-menu, form, input, label, navigation-menu, separator, sheet, sonner, table, tabs, and field.

### Creating Content Types in the CMS

Edit `templates/next-app/src/payload.config.ts` and add to the `collections` array:

```typescript
{
  slug: "posts",
  admin: { useAsTitle: "title" },
  fields: [
    { name: "title", type: "text", required: true },
    { name: "content", type: "richText" },
    { name: "publishedAt", type: "date" },
  ],
}
```

Payload automatically creates the database table and API endpoints when you restart the server.

### Using Shared Code Between Frameworks

The `@template/shared` package provides ready-made clients:

```typescript
import { createClient } from "@template/shared/supabase";
import { initPostHog } from "@template/shared/posthog";
import { resend } from "@template/shared/resend";
```

---

## Deployment

### Deploying to Vercel

1. Push your project to a GitHub repository
2. Go to vercel.com and create a new project, then import your repository
3. Set the **Root Directory** to `templates/astro-site` or `templates/next-app`
4. Add your environment variables (copy from your `.env` files but use production values)
5. Deploy

For Next.js + Payload CMS, also set:

- `DATABASE_URL` -- your Supabase cloud connection string
- `PAYLOAD_SECRET` -- generate a new one with `openssl rand -hex 32`
- `NEXT_PUBLIC_SERVER_URL` -- your deployed URL, e.g. `https://my-project.vercel.app`

### Deploying Supabase

```bash
pnpm supabase link --project-ref <your-project-ref>
pnpm supabase db push
```

### Deploying Twenty CRM to a Server

1. Copy `docker/twenty/docker-compose.yml` and `docker/twenty/.env` to your server
2. Generate a new secret: `openssl rand -hex 32` and update `.env`
3. Set `SIGN_IN_PREFILLED=false` and update `SERVER_URL`/`FRONT_BASE_URL` to your domain
4. Run `docker compose up -d`

---

## MCP Servers (AI Assistant Integration)

The `.mcp.json` file includes 10 pre-configured AI tool servers for use with AI coding assistants. These give your AI assistant direct access to documentation and APIs for each service.

| Server | What It Provides |
|--------|-----------------|
| `astro-docs` | Astro documentation search |
| `next-devtools` | Next.js routes, performance, and build analysis |
| `shadcn` | Component documentation and examples |
| `payload` | CMS schema inspection and documentation |
| `supabase-remote` | Database management and SQL generation |
| `vercel` | Deployment and domain management |
| `posthog` | Analytics queries and feature flags |
| `sentry` | Error search and issue management |
| `resend` | Email sending and templates |
| `twenty-crm` | CRM record management |

Servers that need authentication (Supabase, Vercel, PostHog, Sentry, Resend, Twenty) will ask for credentials on first use.

---

## Contributing

1. Fork the repository and create a feature branch
2. Follow the existing code style -- TypeScript, Tailwind CSS v4, no `tailwind.config.js`
3. Test changes against both Astro and Next.js templates where applicable
4. Open a pull request describing what you changed and why

## License

MIT -- see [LICENSE](LICENSE) for details.
