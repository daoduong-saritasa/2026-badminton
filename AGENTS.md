# Project instructions

## Spec-Driven Execution Workflow
<!-- spec-workflow v1 -->

Specs live in `specs/<feature-slug>/`. Flow: `/grill-me` → `PLAN.md` →
`/spec-plan` → `EXECUTION.md` → `/spec-phase` per phase.

A grill session writes its plan to `specs/<feature-slug>/PLAN.md`, never to the
repository root. Create the directory if needed.

For spec work, read `specs/RULEBOOK.md` first. It defines the state model,
verification gates, branch model, and checkpoints. Do not improvise substitutes.

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
