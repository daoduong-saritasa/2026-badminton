# End-to-end tests — Execution Plan

Spec: [PLAN.md](PLAN.md). Rulebook: `specs/RULEBOOK.md`.
Integration branch: `main`. Branch model: stacked via `gh stack`, one phase. The model
follows the probe recorded in `specs/round-robin-tournament/EXECUTION.md`; this session did
not run the probe again.

The suite runs against the user's local Supabase stack and roster. Never run
`tests/integration/*.test.ts` while that stack is up: `resetLocalDatabase` truncates the
roster. Every Vitest command below excludes `tests/integration/**` for that reason. Report
the excluded files with each run. If the stack is down, mark an end-to-end item `[~]` and
never start the stack.

## STATUS

- Current phase: 1 — in-progress
- Phase 1 — End-to-end suite: in-progress
- Verification debt: none

## Phase 1 — End-to-end suite

Branch: `e2e-tests/phase-1-suite` (stacked: `gh stack init -b main e2e-tests/phase-1-suite`)

One phase at the user's request; the suite, its harness, and the defects it exposes ship
together.

Consumes: `signInAnonymously`, `elevate`, `mutation`, `rpc`, `localStatus` from
`tests/integration/local-supabase.ts`; `runMaintenance`, `parseMaintenanceAction` from
`scripts/reset-tournament.ts`.
Produces: `npm run test:e2e`; `resetProgress(): Promise<void>`, `readRoster(): Promise<Roster>`,
`staffPins(): { organizer: string; referee: string }` in `tests/e2e/support/`.

Fresh review: required — test-gate infrastructure, and a harness that runs a destructive
reset against a database

- [x] Commit `supabase/migrations/202609200001_round_robin.sql` (qualify `placement.stage`) and `supabase/migrations/202609250001_fix_save_roster_team_variable.sql` as two separate commits
- [x] Add `@playwright/test` to `devDependencies`; install Chromium with `npx playwright install chromium`
- [x] `playwright.config.ts`: `testDir: 'tests/e2e'`, `workers: 1`, `fullyParallel: false`, projects `desktop` (Desktop Chrome) and `phone` (Pixel 7); `webServer` runs `vite` with `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` from `localStatus()` per PLAN.md → "Target safety" (amended 2026-10-06: the phone project runs `*.phone.spec.ts`)
- [x] `package.json`: add `"test:e2e": "playwright test"`; `vitest.config.ts`: exclude `tests/e2e/**`; `tsconfig.node.json`: include `playwright.config.ts` and `tests/e2e/**/*.ts`; `.gitignore`: add `test-results/` and `playwright-report/` (amended 2026-10-06: new `tsconfig.e2e.json` with bundler resolution instead of `tsconfig.node.json`, whose `nodenext` resolution rejects the extensionless imports in `src/i18n/vi.ts`)
- [x] `tests/e2e/global-setup.ts`: refuse unless the API host is `127.0.0.1` or `localhost`; require `E2E_ORGANIZER_PIN` and `E2E_REFEREE_PIN`; check the roster shape (four teams, four players each, two per seed); write the roster snapshot to `test-results/roster.json` (amended 2026-10-06: also signs in with both PINs; PINs read from the environment or the `E2E_` keys of `.env.local` only)
- [x] `tests/e2e/global-teardown.ts`: fail the run if `readRoster()` differs from the snapshot
- [x] `tests/e2e/support/reset.ts`: `resetProgress()` runs `runMaintenance` for `enable`, `reset --mode progress`, then `disable` (in `finally`), with `BADMINTON_MAINTENANCE_URL` and the service-role key from `localStatus()`; `io.confirm` returns the phrase parsed from its prompt (judgment call: avoids exporting `parseTarget`)
- [x] `tests/e2e/support/roster.ts`: `readRoster()` via `get_tournament_snapshot`; `staffPins()` from the environment (amended 2026-10-06: `staffPins()` lives in `support/pins.ts`; `support/api.ts` holds the typed RPC client and `support/test.ts` the reset fixture)
- [x] `tests/e2e/fixtures/`: typed seed builders on the existing RPCs that assign pairs by seed and enter results, per PLAN.md → "Seeding"; one builder per tie shape in scenario 5 (`fixtures/tournament.ts`; tie shapes are `twoTeamTie`, `threeTeamTie`, `fourTeamTie` outcome functions for `decideQualifying`)
- [x] `tests/e2e/support/staff.ts`: page helpers to open staff access, enter a PIN, and sign out, with labels from `src/i18n/vi.ts`
- [x] Verify `staff-pin` and `rotate-pin` respond on the running stack; if not, stop and ask the user to run `supabase functions serve` (both served by `supabase start`; staff-access rotation tests exercise `rotate-pin`)
- [x] `tests/e2e/public-view.spec.ts` — PLAN.md → "Scenarios" 1 (amended 2026-10-06: the user's tournament always exists, so this covers a tournament in setup rather than no tournament)
- [x] `tests/e2e/staff-access.spec.ts` — scenario 2; restore both PINs in `afterEach` through `rotate-pin`
- [x] `tests/e2e/pair-assignment.spec.ts` — scenario 3 (amended 2026-10-06: also covers starting qualifying from the organizer overview)
- [x] `tests/e2e/live-scoring.spec.ts` — scenario 4, on the `phone` project, with a second context for the public view (amended 2026-10-06: file is `live-scoring.phone.spec.ts` so the `phone` project picks it up)
- [ ] `tests/e2e/qualification.spec.ts` — scenario 5
- [ ] `tests/e2e/result-correction.spec.ts` — scenario 6
- [ ] `tests/e2e/placement.spec.ts` — scenario 7
- [ ] `tests/e2e/maintenance-reset.spec.ts` — scenario 8, progress mode only
- [ ] Fix each defect the suite exposes, per PLAN.md → "Defects found"; one commit per defect
- [ ] Ask the user to run `SUPABASE_TELEMETRY_DISABLED=1 npm exec supabase -- gen types typescript --local > src/lib/database.types.ts`; diff against the hand-maintained version and fix every application type error the diff causes, per PLAN.md → "Generated types"

**Phase gate (hard):**
- [ ] `npm run typecheck`
- [ ] `npx vitest related --run --exclude 'tests/integration/**' <changed files>`

**Review checklist (user, at PR review):**
- [ ] With the stack up and both PIN variables set, run `npm run test:e2e` and confirm it passes
- [ ] Confirm your teams, players, seeds, and PINs are unchanged after the run
- [ ] Walk one live-scoring match on a phone against the local stack

**On completion:** run the phase gate; run `fresh-review`; update STATUS + checkboxes; stop
and ask before push/PR. Review checklist goes into the PR description.

## Spec gate (hard — once, before the final phase's PR)

- [ ] `npx vitest run --exclude 'tests/integration/**'`
- [ ] `npm run test:e2e` — needs the user's stack running; `[~]` if it is down
- [ ] `npm run build`
