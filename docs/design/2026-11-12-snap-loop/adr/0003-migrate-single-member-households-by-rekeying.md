# Migrate single-member households by rekeying, and abort otherwise

Status: accepted · Date: 2026-11-12 · Deciders: owner · Stage: [03-data-model.md](../03-data-model.md) ·
Supersedes the migration bullet of [ADR 0001](0001-replace-households-with-user-ownership-and-friendships.md)

## Context and problem
ADR 0001 planned to copy a household's data to every member and to make housemates Friends. The owner confirmed that no
deployment has a household with more than one member yet.

## Decision drivers
- G6: no recipe is lost.
- Migration cost and risk. `migrate()` applies every pending SQL file in a single call (`apps/server/src/db/index.ts:33,41`).

## Options
1. Rekey `household_id` to the household's single user, and abort if any household has more than one member.
2. Copy the data to every member, as ADR 0001 planned.

## Decision
Chosen: "option 1", because it can be done in plain SQL inside one migration file, with no copies and no file
duplication.
- Good: the migration is small, has no application-code step between SQL files, and loses no data.
- Bad: an instance that does have a multi-member household can't upgrade until the household is split by hand. The
  abort message says so.

## Pros and cons of the options
### Rekey and abort
- Good, because it is simple, fast and atomic.
- Bad, because it blocks upgrades for instances with multi-member households.
### Copy to every member
- Good, because it handles every instance.
- Bad, because it needs application code between migrations, duplicates image files, and remaps foreign keys across 21
  tables.
