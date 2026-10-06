# End-to-end tests

Status: approved. Ready for execution planning via the spec-plan skill.

## Purpose and scope

Verify that the tournament runs smoothly on event day. Browser tests drive the real app
against a real database through every stage and every operation staff perform, so that a
broken migration, RPC, Edge Function, or UI flow fails a test before the event.

Nothing exercised the stack end to end before this spec. Migrations shipped verified by
typechecking and review only. That gap let two migration defects through: an ambiguous
`team_id` variable in `save_roster` and an ambiguous `stage` column in
`202609200001_round_robin.sql`. Both failed with SQLSTATE `42702` the first time they ran.

This is a one-time verification effort, not a standing gate. The suite stays in the
repository so it can be run again by hand, but no workflow or policy depends on it.

In scope:

- A Playwright suite under `tests/e2e/` with its own command.
- The scenarios listed under "Scenarios".
- A one-time comparison of `src/lib/database.types.ts` against types generated from the
  migrated database.

Out of scope:

- The `/rules` page.
- The organizer setup screen. The suite uses the roster the user already entered.
- CI. The suite runs on a developer machine only.
- Changes to the local Supabase policy in `AGENTS.md`.
- Visual regression and screenshot comparison.
- Load or Realtime latency testing.
- Running against a hosted Supabase project.

## Confirmed decisions

Confirmed by the user on 2026-10-06.

### Database and policy

- The suite runs against a local Supabase stack that the user starts for end-to-end
  testing only. It keeps tests away from production data.
- The `AGENTS.md` rules on local Supabase stay unchanged. An agent never runs
  `supabase start`, `supabase db reset`, or `supabase gen types --local`. An agent may run
  the suite only while the user has the stack running. When the stack is down, the
  agent records the run as environment-blocked and does not start it.
- The suite runs on the roster the user entered in the local database: the tournament,
  teams, players, and seeds. It never creates, edits, or deletes them.
- Before each test, reset progress the way `npm run maintenance -- reset --mode progress`
  does: enable reset, call `public.reset_tournament` with the service-role key from
  `supabase status`, then disable reset. Reuse the exported logic in
  `scripts/reset-tournament.ts` with the confirmation answered in code. Never call
  `resetLocalDatabase` from `tests/integration/local-supabase.ts`, because it truncates
  the roster.
- Global setup checks that the roster has four teams with four players each, two at each
  seed, and fails with a clear message otherwise. It also records the roster, and global
  teardown fails the run if the roster changed.
- The suite reads the organizer and referee PINs from `E2E_ORGANIZER_PIN` and
  `E2E_REFEREE_PIN`. A progress reset leaves PINs unchanged, so they are the PINs the user
  provisioned.
- The app holds one tournament (`tournament.singleton`), so tests cannot isolate data per
  test. Run the suite with one worker and no parallelism.
- The Edge Functions `staff-pin` and `rotate-pin` must be reachable. `[edge_runtime]` is
  enabled in `supabase/config.toml`, so `supabase start` should serve them. Verify this in
  the first phase. If it fails, the user starts `supabase functions serve`.

### Generated types

- The user runs `supabase gen types typescript --local` once against the migrated
  database. The agent compares the output with the hand-maintained
  `src/lib/database.types.ts` and fixes every difference in the application code that the
  comparison reveals.
- The generated output then replaces the hand-maintained file. Later edits follow the
  existing `AGENTS.md` rule and are made by hand.

### Target safety

- The Playwright `webServer` starts Vite with `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_ANON_KEY` taken from `supabase status -o env`. Process environment
  variables take precedence over `.env.local`, which may point at the hosted project.
- Global setup refuses to run unless the API URL host is `127.0.0.1` or `localhost`. A
  test that resets the database must never reach a hosted project.

### Framework and layout

- Use `@playwright/test` with Chromium only.
- Use two projects: desktop Chromium for organizer flows, and a phone viewport for
  referee scoring. Referees score on phones at the court.
- Put specs in `tests/e2e/*.spec.ts` and add `npm run test:e2e`. Exclude `tests/e2e/`
  from Vitest. Its default `include` also matches `*.spec.ts`.
- Select elements by role and accessible name. Take labels from `src/i18n/vi.ts` instead
  of hard-coding Vietnamese strings, so a copy change cannot break a test silently. Add a
  `data-testid` only where no accessible name exists, and fix the accessibility gap
  instead where possible.

### Seeding

- Seed every scenario's starting state on top of the user's roster through the existing
  RPCs, with the helpers in `local-supabase.ts`: `signInAnonymously`, `elevate`, and
  `mutation`. Seeds assign pairs and enter results; they never touch the roster.
- Seed builders derive pairs from the roster's seeds, never from player names, so the
  suite works on any valid roster.
- Playoff ties come from the results a seed enters, not from the teams, so every tie
  case is reachable on the user's roster.
- Keep seed builders in `tests/e2e/fixtures/` as typed functions that return the IDs a
  test needs. Do not use SQL dumps, because a dump goes stale with every migration.

### Defects found

- A test that exposes a defect stays in the suite and fails until the defect is fixed.
  Never skip or weaken a test to make the suite pass.
- Fix a migration defect in a new migration, unless the migration can never have applied
  on any database. Then fix it in place, as with `202609200001_round_robin.sql`.

## Scenarios

Listed in the order they are built. Each scenario is one spec file and covers every case
listed under it.

1. **Public view with no tournament.** A spectator sees the setup-required screen and no
   staff controls.
2. **Staff access.**
   - A wrong PIN is rejected, and repeated wrong PINs hit the attempt limit.
   - The organizer PIN grants organizer controls.
   - The referee PIN grants scoring and pair assignment, but not organizer controls.
   - Sign-out removes access.
   - The organizer rotates each PIN. The old PIN stops working, and existing grants for
     that role are revoked. The test rotates each PIN back to its original value in
     teardown, including when the test fails.
3. **Pair assignment.**
   - A referee assigns valid pairs and starts a match.
   - The app rejects a same-seed pair in qualifying and a player reused within a fixture.
   - The organizer saves a rule exception after confirmation. A referee cannot.
   - Nobody can put one player twice in a pair or assign a player already in a match in
     progress.
   - A saved pair can change until the match starts and is fixed after.
4. **Live scoring and Realtime.**
   - A referee on the phone viewport scores a match to completion, including the
     win-by-two rule and the score cap.
   - A second browser context, the public view, shows the score and standings update
     without a reload.
   - Scoring hands over between two referees.
   - A walkover completes a match without play.
5. **Qualification and playoffs.**
   - Completed qualifying with clear standings confirms finalists directly.
   - A two-team tie produces one playoff match.
   - A three-team tie produces a mini round robin, and a mini round robin still tied
     produces another round.
   - A four-team tie requires the matchup draw.
6. **Result correction.**
   - The organizer corrects a completed result and sees the impact preview before saving.
   - A correction that crosses a correction boundary is refused.
7. **Placement and completion.**
   - Third place finishes before the final starts.
   - A third-place fixture at 1–1 plays the deciding match with any two teammates.
   - The final completes the tournament, and final positions appear.
8. **Maintenance reset.** `npm run maintenance -- reset --mode progress` keeps the teams,
   players, and fixtures and clears the results. Open clients reload to the reset state.
   The suite never runs `--mode all`, because it deletes the roster.

## Derived from existing code, not open

- Staff sign-in runs anonymous Auth and then the `staff-pin` Edge Function
  (`src/data/staff.ts`). Each browser context therefore needs its own anonymous session.
  Contexts never share a sign-in.
- The app has no router. Only `/rules` has its own URL, and every other view is a tab, so
  tests navigate by clicking tabs, not by `page.goto`.
