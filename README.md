<div align="center">

<img src="apps/web/public/logo.png" alt="Meally logo" width="88" />

# Meally

**A modern, self-hostable recipe manager, meal planner and shopping list, written in TypeScript.**

[![CI](https://github.com/bachtly/Meally/actions/workflows/ci.yml/badge.svg)](https://github.com/bachtly/Meally/actions/workflows/ci.yml)
[![Deploy](https://github.com/bachtly/Meally/actions/workflows/deploy.yml/badge.svg)](https://github.com/bachtly/Meally/actions/workflows/deploy.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![Node 24](https://img.shields.io/badge/node-%3E%3D24-339933.svg?logo=node.js&logoColor=white)](package.json)

<p>
  <img src="docs/assets/recipe.png" alt="Recipe page on a phone, with servings scaling and a metric/US toggle" width="250" />
  &nbsp;
  <img src="docs/assets/plan.png" alt="Weekly meal plan on a phone, with breakfast and dinner for each day" width="250" />
  &nbsp;
  <img src="docs/assets/shopping.png" alt="Shopping list on a phone, built from the week's plan and grouped by aisle" width="250" />
</p>
<sub>Recipe → weekly plan → shopping list, on an iPhone-sized screen.</sub>

</div>

## What is Meally?

Meally keeps your recipes, your weekly meal plan and your shopping list in one place. You import a recipe from any
link, drop it onto a day, and Meally turns the week into a shopping list grouped by aisle. You can also snap a photo
of what you cooked and share it with friends.

It is a clean TypeScript rewrite **inspired by [Mealie](https://github.com/mealie-recipes/mealie)** and
[RecipeSage](https://github.com/julianpoy/RecipeSage). No code is copied from either. It exists for two reasons:

- **A fresher UI.** Light and dark themes, mobile-first layout, cook mode and a command-palette search. Each UI
  decision has a short research note in [`docs/design`](docs/design).
- **Free to host publicly.** Meally is plain **AGPL-3.0** with no "personal use only" clause, so you can run it for
  yourself, your family or a community.

> **Status:** early. Meally is built as a stack of small, reviewable pull requests, so expect rough edges.

## Features

Everything outside the core can be switched off with a [feature flag](docs/design/03-architecture.md#feature-flags)
(flag keys in brackets). [`02-features.md`](docs/design/02-features.md) maps each Mealie and RecipeSage feature to its
place in Meally.

| Area | What you get |
| --- | --- |
| **Recipes** | Library with full-text search, editor with live ingredient parsing, images, favourites and ratings (`ratings`), tags and categories (`organizers`), cookbooks (`cookbooks`), nutrition (`nutrition`) |
| **Importing** | From a URL or bookmarklet (`import-url`), from other apps and files (`import-files`), foods and units (`foods-units`) |
| **Cooking** | Scale servings and convert metric/US (`scaling`), step-by-step cook mode with timers (`cook-mode`), print view (`print`), timeline and comments (`timeline`) |
| **Planning** | Weekly meal plan with suggestion rules and a calendar (iCal) feed (`meal-plan`), shopping lists by aisle with live updates when self-hosted (`shopping-lists`) |
| **Social** | Snap a photo of what you cooked (`snaps`), friends and a feed (`friends`), reactions, push notifications (`push`), public share links (`share-links`) |
| **Running it** | Admin console, export and backups (`backups`), installable offline app (`pwa`), API tokens and [API docs](docs/api.md), webhooks, AI helpers (`ai`, off by default) |

## Quickstart

Build and run the Docker image from source (needs Docker):

```sh
git clone https://github.com/bachtly/Meally.git && cd Meally
docker build -t meally .
docker run -d -p 8080:8080 -v meally-data:/data -e BASE_URL=http://localhost:8080 meally
```

Open <http://localhost:8080>. The first visit shows a setup page that creates the admin account. Docker Compose, an
external Postgres, reverse proxies, every environment variable, backups and upgrades are in
[`docs/self-hosting.md`](docs/self-hosting.md).

<details>
<summary>Run from source without Docker (Node 24)</summary>

```sh
npm install
npm run dev      # API on :8080, web app with hot reload on :5173
npm test
npm run e2e      # Playwright flows (first run: npx playwright install chromium)
```

`npm run seed -w apps/server` adds a demo user (`demo@meally.local` / `demo-password`) with six sample recipes.

</details>

## How it works

The main journey: get a recipe in, plan the week, shop, cook, share.

```mermaid
flowchart LR
    A["Paste a link<br/>or bookmarklet"] -->|"server reads the<br/>page's recipe data"| B["Recipe<br/>(ingredients parsed)"]
    A2["Type it in or<br/>import a file"] --> B
    B -->|"add to a day"| C["Weekly meal plan"]
    C -->|"Add week to<br/>shopping list"| D["Shopping list<br/>merged and grouped by aisle"]
    D -->|"live updates for everyone<br/>on the list (self-hosted)"| D
    B -->|"Start cooking"| E["Cook mode<br/>one step at a time"]
    E -->|"snap a photo"| F["Snap shared<br/>to friends' feed"]
```

Ingredients are parsed into quantity, unit and food when you save a recipe (shared parser in `packages/shared`). That
is what lets Meally scale servings, convert units and merge "3 onions" from two recipes into one shopping-list line.

## Architecture

One TypeScript codebase, two ways to run it. The same Hono API runs as a Node server in a single Docker container,
or as a Supabase Edge Function behind Cloudflare Pages.

```mermaid
flowchart TB
    user(["Browser or installed PWA"])

    subgraph self["Self-hosted: one Docker container"]
        node["Hono API on Node 24<br/>also serves the built SPA"]
        pglite[("Embedded Postgres (PGlite)<br/>or your own Postgres")]
        disk[("/data/images<br/>WebP via sharp")]
        node --> pglite
        node --> disk
    end

    subgraph hosted["Hosted: Supabase + Cloudflare"]
        pages["Cloudflare Pages<br/>React SPA"]
        proxy["Pages Function<br/>proxies /api/*"]
        edge["Supabase Edge Function<br/>same Hono API"]
        pg[("Supabase Postgres")]
        bucket[("Storage bucket<br/>meally-images")]
        cron["pg_cron<br/>webhook retries, digests, cleanup"]
        pages --- proxy --> edge
        edge --> pg
        edge --> bucket
        cron --> edge
    end

    user --> node
    user --> pages
```

The browser always talks to one origin, so the session cookie stays first-party. For the hosted setup, a GitHub
Actions workflow deploys `main` after CI passes: the Supabase CLI pushes migrations, cron jobs and the function,
and Terraform ([`infra/main.tf`](infra/main.tf)) manages the Pages project, custom domain and DNS record. Details
are in [`docs/deploy.md`](docs/deploy.md).

| Layer | Stack |
| --- | --- |
| Web app (`apps/web`) | React 19, Vite, TypeScript, Tailwind CSS v4, Radix primitives, TanStack Query, React Router |
| API (`apps/server`) | Hono, Drizzle ORM, zod, our own session auth (scrypt, httpOnly cookie), sharp for images |
| Shared (`packages/shared`) | zod schemas and API types, feature-flag registry, ingredient parser, unit conversion |
| Database | Postgres: embedded PGlite by default, any Postgres via `DATABASE_URL`, Supabase when hosted |
| Hosting | Docker (self-host), or Supabase (DB, storage, cron, Edge Function) + Cloudflare Pages, with Terraform for Pages and DNS |
| Testing | Vitest, Testing Library, Playwright end-to-end flows, Storybook with a mocked API |

## Screenshots

<details>
<summary>More screens (light and dark)</summary>

<table>
  <tr>
    <td align="center"><img src="docs/assets/recipes.png" alt="Recipe library" width="220" /><br/><sub>Recipe library</sub></td>
    <td align="center"><img src="docs/assets/cook-mode.png" alt="Cook mode, one step at a time" width="220" /><br/><sub>Cook mode</sub></td>
    <td align="center"><img src="docs/assets/import.png" alt="Import a recipe from a link" width="220" /><br/><sub>Import from a link or bookmarklet</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/assets/snap.png" alt="Snap camera screen" width="220" /><br/><sub>Snap: share what you cooked</sub></td>
    <td align="center"><img src="docs/assets/recipes-dark.png" alt="Recipe library in dark theme" width="220" /><br/><sub>Dark theme: library</sub></td>
    <td align="center"><img src="docs/assets/recipe-dark.png" alt="Recipe page in dark theme" width="220" /><br/><sub>Dark theme: recipe</sub></td>
  </tr>
</table>

Captured with Playwright's iPhone 15 profile (393×852, 2× scale) from a local build with the demo seed data. Meally
is mobile-first; the same screens adapt to a sidebar layout on desktop.

</details>

## Docs

- [Self-hosting](docs/self-hosting.md): Docker, Compose, reverse proxy, environment variables, backups
- [Deploy to Supabase + Cloudflare Pages](docs/deploy.md)
- [API](docs/api.md): REST endpoints and API tokens
- [Architecture](docs/design/03-architecture.md) and the [design notes](docs/design) behind each feature
- [Roadmap](docs/design/roadmap.md)

## Contributing

Issues and pull requests are welcome. Please read [`CLAUDE.md`](CLAUDE.md) first: it covers the conventions (one small
PR per roadmap row, Conventional Commit titles, feature flags, tenant isolation) and the checks to run before you push:

```sh
npm run lint && npm run typecheck && npm test && npm run build
```

## Licence

[AGPL-3.0](LICENSE). Meally is not affiliated with Mealie or RecipeSage.
