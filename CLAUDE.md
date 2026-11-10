# Meally: conventions for contributors and agents

Read `docs/design/03-architecture.md` before writing code.

## Ground rules

- **Don't copy Mealie or RecipeSage.** No code, CSS, strings or assets from either project. Reimplement the behaviour
  in our own design. You can read their public docs to understand a feature. Don't paste from their source.
- **One small PR per roadmap row** (`docs/design/roadmap.md`). Use Conventional Commit titles (`feat(web): …`,
  `feat(server): …`, `docs: …`).
- **PRs are stacked.** Branch off the previous PR's branch (not `main`) and open the PR with that branch as its base.
  Start the body with "Stacked on #N; review/merge in order." Merge in order, bottom first; GitHub retargets the next
  PR when its base merges.
- **Migration collisions.** Two branches can generate the same migration number. After a rebase, delete your generated
  migration and its snapshot and journal entry, then run `npm run db:generate -w apps/server` again.
- **Never commit data dirs** (`data/`, `.vdata/`, anything under `DATA_DIR`) or test output (`playwright-report/`,
  `test-results/`). Check `git status` before committing.
- **Every feature PR adds `docs/design/features/<key>.md`**, written from `_template.md`. Do a quick web search for
  each decision (1–3 sources) and cite them.
- **Every non-core feature is behind its flag**: server routes use `requireFeature('<key>')`, and the web app uses
  `useFeature` / `<Feature>`. Register new flags only in `packages/shared/src/features.ts`.
- **Tenant isolation:** every query on household data filters by `householdId` from the session. Add a test that
  another household gets a 404.

## Commands (from the repo root)

- `npm install`
- `npm run e2e` runs the Playwright flows (needs `npx playwright install chromium` once). CI runs it as its own job.
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`. All four must pass before you push. CI runs the
  same four.
- `npm run db:generate -w apps/server` after changing anything in `apps/server/src/db/schema/`. Commit the generated
  migration.

## UI rules

- Mobile-first: test widths from 360 px to 1440 px. Touch targets are at least 44 px.
- Use design tokens (CSS variables from `apps/web/src/ui/theme.css`). Don't hard-code colours.
- Every async view has loading (skeleton), empty, and error states.
- Accessibility: semantic HTML, labelled controls, visible focus, Radix primitives for overlays, and colour contrast
  of at least AA.
- Copy: short and plain, with sentence case.

## PR body

Write the PR body in sections: Summary, What changes, Design note link, How to verify (the commands you ran and
their results), and anything you deferred.
