# Replace households with user ownership and friendships

Status: accepted · Date: 2026-11-12 · Deciders: owner · Stage: [01-research.md](../01-research.md)

## Context and problem
Today a household owns recipes, plans, lists, images and timeline events (16 `household_id` columns in 12 schema
files). The snap loop needs a link between users across households. The owner wants households gone, not hidden.

## Decision drivers
- Brief G6: households replaced by user-to-user friendships, and no recipe lost.
- Brief G2 and G4: friends read snaps and linked recipes across what are households today.
- Cost and risk of the migration, and whether it can be undone.

## Options
1. O1: replace households with ownership by each user, plus friendships.
2. O2: keep households and add snaps and friendships on top.
3. O3: a household of one. Each user keeps a personal household behind the scenes.
4. O0: reuse timeline events and share links.

## Decision
Chosen: "O1", the owner's choice, because it removes the household concept entirely instead of keeping it as an
implementation detail.
- Good: one ownership model (the user) and one social model (friendships), with no hidden second concept.
- Bad: the highest cost, since every service signature, image path and slug uniqueness rule is re-keyed. The migration
  can't be undone, so it needs a backup step and a dry run.
- Bad: shared editing of plans and lists is lost unless friendships gain an edit level ([#76](https://github.com/bachtly/Meally/issues/76)).
- Migration: every member of a multi-member household gets a full copy of its data, and former housemates become
  friends automatically. Duplicates are accepted.

## Pros and cons of the options
### O1: replace households
- Good, because it matches G6 exactly.
- Bad, because the cost is high and it can't be undone.
### O2: keep households
- Good, because it is additive, keeps co-editing, and matches the Chefless and Monarch evidence.
- Bad, because it fails G6, and two scoping rules sit side by side.
### O3: household of one
- Good, because users see no households, the existing scoping keeps working, the cost is low, and it can be undone.
- Bad, because the household concept stays in code and data. The critic raised it; the owner rejected it.
### O0: reuse timeline and share links
- Good, because it adds no new tables.
- Bad, because it fails G2–G4 and G6.
