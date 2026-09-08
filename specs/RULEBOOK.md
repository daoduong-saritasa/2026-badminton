# Spec-Driven Execution Workflow
<!-- rulebook v9 -->

Large/architectural changes flow: `/grill-me` → `specs/<feature>/PLAN.md` →
`specs/<feature>/EXECUTION.md` (via the `spec-plan` skill) → phased implementation
(via the `spec-phase` skill).

This is the full rulebook. The spec skills read it when they run; it is deliberately kept
out of the project's context file (`CLAUDE.md` / `AGENTS.md`) so sessions doing ordinary
work don't carry it. That file holds only the workflow's pointer section (marker
`<!-- spec-workflow vN -->`): the specs-root mapping that tells a grill session where
`PLAN.md` goes, plus a pointer back here. If that section is missing, plans land in the repo
root — fix the section, don't move rules into it. An agent that lands on a
`<feature-slug>/phase-<n>-<desc>` branch without invoking a spec skill is caught by
`spec-phase`'s skill description, which names that branch shape and points here.

## State model
- **Git is the authoritative state store**: branch name encodes spec+phase
  (`<feature-slug>/phase-<n>-<desc>`), commits encode progress. Each `EXECUTION.md` opens
  with a **STATUS block** (current phase, per-phase state, verification debt) — the only
  prose trusted as state. **On any conflict, git wins silently** for mechanical facts
  (branch, commits, merged-or-not); STATUS is trusted only for what git can't express
  (debt, park reasons). `HANDOFF.md` is a session baton from `/handoff` — advisory context,
  never authority; do not resume from it.
- Phase states: `pending` / `in-progress` / `done` / `done-with-debt`. Gate items are
  `[ ]`/`[x]`; an item may be `[~]` (deferred) only when environment-blocked (missing
  tool/credentials, not effort), with substitute evidence inline and a mirrored STATUS debt
  entry. A phase is in-progress iff it has unchecked **non-deferred** items.

## Branch model — stacked via `gh stack`
- **Default: stacked, driven by `gh stack`** (GitHub's stacked-PR CLI). One stack per spec,
  rooted at the integration branch (currently `main`; resolve at plan time,
  never hardcode). Each phase is one branch on that stack, still named
  `<feature-slug>/phase-<n>-<desc>` — the CLI tracks the base chain, so no phase computes
  its own base or PR target.
  - Spec start: `gh stack init -b main` (adopts existing branches, and
    **turns on `git rerere` in the repo** — say so before running it on a repo that hasn't
    opted into that).
  - Phase start: `gh stack add <feature-slug>/phase-<n>-<desc>`, from the stack top. Pass
    the name explicitly — the auto-generated date-slug form breaks the state model, which
    reads spec and phase out of the branch name. Never `-m`/`-A`/`-u`; commits are ordinary
    git commits at logical sub-steps.
  - Push + PR: two commands, because `gh stack submit` accepts a PR description only in
    its full-screen editor, which an agent's non-interactive terminal never reaches.
    1. `gh stack submit --auto` submits every active branch in the stack, not just the
       current phase's — already-submitted phases are no-ops — so the phase's single
       remote-action ask stays "push + update the stack on GitHub?". New PRs land as
       drafts carrying auto-generated titles.
    2. Map branch → PR number with `gh stack view --json`, then give **this phase's PR**
       its real title and description: `gh pr edit <n> --title '<title>' --body-file
       <path>`, then `gh pr ready <n>`. Pass `--body-file`, never `--body` — shell
       quoting mangles a multi-line body. Leave every other PR in the stack alone —
       earlier phases' descriptions may carry the user's own edits. A later phase's
       `submit --auto` that regenerates an earlier PR's title has undone this step:
       restore that title with `gh pr edit`.
    Never pass `--open` to `submit`: it marks every PR in the stack ready, publishing
    auto-generated titles and any draft the user left draft deliberately.
  - After a merge: `gh stack sync` (fetch, fast-forward trunk, cascade-rebase the
    remaining phases, push, sync PR state) — it replaces the manual pull-and-rebase. Add
    `--prune` only once the user has said yes to deleting merged phase branches.
  - Reading stack shape: `gh stack view --json`. Git remains the authoritative state store.
- **Non-interactive always.** Bare `gh stack submit`, `switch`, `checkout`, and `view` open
  full-screen editors or a pager and will hang an agent. Use the flags above; on a diverged
  stack, non-interactive `sync` aborts without pushing — surface that to the user rather
  than retrying interactively.
- **Never run `gh stack merge`** (all-or-nothing across the stack; merging is the user's
  decision, per phase) **or `gh stack modify`** (restructures phases — that is `spec-plan`'s
  job, and it desyncs EXECUTION.md). `gh stack unstack`/`delete` needs an explicit ask.
- **Fallback: sequential.** When `gh stack` is unavailable — the CLI lacks the command, or
  the repo returns "stacked pull requests not enabled" (exit 9), or the remote isn't
  GitHub — the spec runs sequential: each phase branches off the integration branch → push
  → PR → user reviews & merges → pull → next phase off the updated integration branch. The
  user may also choose sequential outright. Record the choice in EXECUTION.md's header.
- After a phase's PR merges, ask before deleting the merged phase branch (local + remote).

## Checkpoints
- Starting a phase authorizes its commits — nothing else.
- Gate pass → one ask: "push + update the stack on GitHub?" (sequential: "push + open
  PR?"). Remote actions are never bundled with anything else.
- **Evidence before claims.** If you have not run the command in this message, you cannot
  say it passes. This binds every status claim: tests pass ⇒ runner output with 0 failures;
  build succeeds ⇒ exit 0; bug fixed ⇒ the original symptom retested; phase complete ⇒ the
  gate actually run. A prior run, a partial run, or "should pass" is not evidence, and
  checking a box is not running a command.
- Verification runs in **two tiers**, so the expensive checks are paid once per spec rather
  than once per phase:
  - **Phase gate (every phase, cheap)**: project-wide typecheck + dependency-aware tests on
    the phase's changed files. A phase is complete when its phase gate passed. Nothing else
    belongs here — no full suite, no build, no CI watch.
  - **Spec gate (once, before the final phase's PR)**: the full local test suite, plus the
    build if the spec's changes can plausibly break it, over the whole accumulated spec
    diff. This is where a phase-gate escape surfaces. Failures found here are fixed on the
    final phase's branch as `(amended)` items; if the cause sits in an already-merged
    phase, fix it forward — never reopen a merged phase.
  - **CI is opt-in.** Add a `CI green on the final phase PR` item to the spec gate only
    when the user asks for CI gating. Without that ask, the phase and spec gates are the
    verdict and no agent watches checks.
  Manual verification scenarios are the **review checklist**, listed in the PR description
  for the user to walk through before merging — they are the user's, not agent debt.
- **Fresh review is conditional, not a universal gate.** Each phase records
  `Fresh review: required — <hard trigger>` or `Fresh review: not required` when planned.
  Require it for changes involving authentication/authorization, cryptography, secrets or
  injection boundaries; payments or financial calculations; persistent-data migrations,
  destructive operations, or other hard-to-reverse writes; CI/test-gate infrastructure;
  or error/rollback paths protecting money or durable data. At phase end, upgrade
  `not required` to `required` if the actual diff crosses one of those triggers, the same
  behavior needed two correction attempts, or the implementer answers yes to: "Am I less
  confident in this change than usual, or did it grow beyond what was asked?" Never
  downgrade a planned requirement. A required review runs through `fresh-review` after the
  phase gate and before push/PR. Fix actionable findings, rerun the phase gate,
  and allow one fresh re-review only; if actionable findings remain, stop and put them to
  the user. When review is not required, do not invoke the skill or build a review packet.
- **One spec in flight at a time.** Do not start or resume a different spec's phase while
  another has an unfinished phase. Finish the current phase, or explicitly **park** it with
  the user's go-ahead: a `WIP: parked <date>` commit on the phase branch plus a STATUS note
  (never `git stash` — stashes are invisible to a cold agent and easy to orphan).

Procedure lives in the skills — planning in the `spec-plan` skill, execution and resume in
the `spec-phase` skill, baseline application in the `spec-archive` skill — invoke the
relevant one rather than re-deriving it.
