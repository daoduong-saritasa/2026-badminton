# Project instructions

## Spec-Driven Execution Workflow
<!-- spec-workflow v1 -->

Specs live in `specs/<feature-slug>/`. Flow: `/grill-me` → `PLAN.md` →
`/spec-plan` → `EXECUTION.md` → `/spec-phase` per phase.

A grill session writes its plan to `specs/<feature-slug>/PLAN.md`, never to the
repository root. Create the directory if needed.

For spec work, read `specs/RULEBOOK.md` first. It defines the state model,
verification gates, branch model, and checkpoints. Do not improvise substitutes.

Starting or resuming a phase through `/spec-phase` authorizes the local commits
required by that workflow. Commit each completed logical sub-step without asking
for separate approval. Pushes, pull requests, merges, and destructive Git actions
still require the checkpoints defined in `specs/RULEBOOK.md`.

## Domain Model & Decisions
<!-- domain-rulebook v1 -->

`CONTEXT.md` (repo root) is the project's glossary. Use its canonical terms — and avoid the
synonyms it marks `_Avoid_` — in code, docs, specs, and UI copy. It is a glossary only:
never add schema, file references, or implementation detail to it.

Recording a new term, or a decision worth keeping? Read `docs/DOMAIN-RULEBOOK.md` first — it
routes between `CONTEXT.md`, `docs/adr/`, and a spec's `PLAN.md`, and defines what does and
doesn't qualify as an ADR.

## Commit messages

This project does not use Jira task IDs. Follow the repository's prefix-free
commit history without appending an issue identifier.

## Local Supabase and integration tests

Do not run `npm exec supabase -- start`, `supabase db reset`, or
`supabase gen types --local`, and do not ask the user to start OrbStack or
Docker. The local Supabase stack pulls container images this project does not
want installed.

Consequences you must accept rather than work around:

* `tests/integration/*.test.ts` do **not** skip cleanly without the socket.
  `requireLocalSupabase` throws in each suite's setup hook, so `npm run test`
  and `npm run test:related` report those files as failed and exit 1, with the
  scenarios inside them counted as skipped. Expect a red gate. Do not report it
  as a pass, and do not delete, skip, or weaken those tests to make it green.
* `src/lib/database.types.ts` is maintained by hand from the migrations. Edit it
  to match new SQL; never claim it was generated.
* SQL in `supabase/migrations/` ships verified by project-wide typechecking, the
  non-database tests, and review only. When you report a test run, state the
  skip count alongside the pass count so an unrun gate is never mistaken for a
  passing one.
