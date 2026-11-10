# Meally

A modern, self-hostable recipe manager, meal planner and shopping list.

> **Meally is inspired by [Mealie](https://github.com/mealie-recipes/mealie).** It also borrows ideas from
> [RecipeSage](https://github.com/julianpoy/RecipeSage). It is a clean rewrite in TypeScript: no code is copied from
> either project. Thank you to both communities for showing what a great self-hosted recipe app can be.

## Why another recipe app?

Meally fixes two problems with the apps it learns from:

1. **The UI feels dated.** Mealie and RecipeSage do a lot, but their interfaces are dense and look old. Meally starts
   from a design system with light and dark themes, a mobile-first layout, large recipe photos, a cook mode and a
   command-palette search. Each UI decision has a short research note in [`docs/design`](docs/design).
2. **RecipeSage can't be hosted publicly for free.** RecipeSage is AGPL-3.0 for *personal use* only, and every other
   use needs a separate licence. Meally is plain **AGPL-3.0** with no extra conditions. You can self-host it for
   yourself, your family, or your community on a public server.

## Features

Every feature after the core can be switched on or off ([feature flags](docs/design/03-architecture.md#feature-flags)).
[`docs/design/02-features.md`](docs/design/02-features.md) maps each Mealie and RecipeSage feature to its place in
Meally.

## Self-hosting

```sh
docker run -d -p 8080:8080 -v meally-data:/data ghcr.io/bachtly/meally:latest
```

Configuration is done through environment variables, listed in [`docs/self-hosting.md`](docs/self-hosting.md).

## Development

```sh
npm install
npm run dev      # server on :8080, web on :5173
npm test
```

The project layout and conventions are in [`CLAUDE.md`](CLAUDE.md) and
[`docs/design/03-architecture.md`](docs/design/03-architecture.md).

## Licence

[AGPL-3.0](LICENSE). Meally is not affiliated with Mealie or RecipeSage.
