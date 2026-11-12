# Scope queries by user, or by accepted friendship on snap read paths

Status: accepted · Date: 2026-11-12 · Deciders: owner · Stage: [01-research.md](../01-research.md)

## Context and problem
CLAUDE.md requires every query on household data to filter by `householdId` from the session, with a test that
another household gets a 404. [ADR 0001](0001-replace-households-with-user-ownership-and-friendships.md) removes
households, so the rule needs a new form.

## Decision drivers
- Brief constraint: isolation stays strict and testable.
- Brief G2 and G4: friends read snaps and linked recipes.

## Options
1. Every query filters by the session user's id. Only the snap, feed and linked-recipe read paths also allow an
   accepted friendship.
2. Friendship grants read access to all of a user's data.

## Decision
Chosen: "option 1", because it keeps the friend read surface small and lists it explicitly.
- Good: writes and every other read stay owner-only, so a bug in the friend check can only leak snaps and linked
  recipes.
- Bad: each friend-readable path needs its own check, plus two tests: a non-friend gets a 404, and a pending
  (not accepted) friendship gets a 404.
- Follow-up: rewrite the tenant isolation rule in CLAUDE.md and `docs/design/03-architecture.md` in the first build
  PR.

## Pros and cons of the options
### User id, plus friendship on listed read paths
- Good, because the surface is small and auditable.
- Bad, because it adds one extra check per listed path.
### Friendship grants read access to everything
- Good, because it is simpler to implement.
- Bad, because it exposes plans, lists and private recipes to every friend.
