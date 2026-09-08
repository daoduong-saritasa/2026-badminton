# Project instructions

## Spec-Driven Execution Workflow
<!-- spec-workflow v1 -->

Specs live in `specs/<feature-slug>/`. Flow: `/grill-me` → `PLAN.md` →
`/spec-plan` → `EXECUTION.md` → `/spec-phase` per phase.

A grill session writes its plan to `specs/<feature-slug>/PLAN.md`, never to the
repository root. Create the directory if needed.

For spec work, read `specs/RULEBOOK.md` first. It defines the state model,
verification gates, branch model, and checkpoints. Do not improvise substitutes.
