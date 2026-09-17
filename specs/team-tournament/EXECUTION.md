# Four-player team tournament — Execution Plan

Spec: [PLAN.md](PLAN.md). Rulebook: `specs/RULEBOOK.md`.
Integration branch: `main`. Branch model: stacked via `gh stack` (default).

Planning decisions (user, 2026-09-17): replace pair tables in place with a forward migration;
role column on grants with two PINs, organizer-only rotation; draft lineups in a private table
filtered by the snapshot RPC; per-game scores in a `match_games` table; courts fixed at 2, with the
court-count setting removed.

## STATUS

- Current phase: 1 — in-progress
- Phase 1 — Domain rules: in-progress
- Phase 2 — Staff roles: pending
- Phase 3 — Team tournament schema: pending
- Phase 4 — Client replacement: pending
- Verification debt: none

## Phase 1 — Domain rules

Branch: `team-tournament/phase-1-domain` (`gh stack init -b main`)

Pure TypeScript rules with no I/O; additive so the old pair model still compiles until Phase 4 removes it.

Produces: `Team`, `TeamPlayer`, `LineupPair { seed1PlayerId; seed2PlayerId }`, `Lineup { fixtureId; teamId; pairs: [LineupPair, LineupPair, LineupPair]; confirmedAt: string | null }`, `FixtureStage = 'group' | 'third-place' | 'final'`, `TeamFixture`, `FixtureMatch` (`matchNumber: 1 | 2 | 3`, `resultKind`, `winnerSide`, `games: Game[]`), `Game { gameNumber; score: Score; confirmedAt: string | null }` in `src/domain/types.ts`; `validateRoster(teams, players): RosterIssue[]`, `validateLineup(lineup, roster): LineupIssue[]` in `src/domain/roster.ts`; `gameRules(stage): { target; cap }`, `isGameWon(score, stage)`, `matchGameTally(games)`, `matchWinnerSide(games, stage)` in `src/domain/scoring.ts`; `fixtureTally(matches)`, `deciderStatus(matches): 'pending' | 'eligible' | 'unnecessary'`, `fixtureWinnerTeamId(fixture, matches)` in `src/domain/team-fixtures.ts`; `placementParticipants(groupFixtures, matches)`, `finalPositions(fixtures, matches)`, `isTournamentComplete(fixtures, matches)`, `correctionBlockCode(...)` in `src/domain/progression.ts`.

Fresh review: not required

- [x] Add the Produces types to `src/domain/types.ts` beside the old `Pair`/`Match` types (new names avoid collisions; Phase 4 deletes the old ones)
- [x] `src/domain/roster.ts` + `roster.test.ts`: 4 teams × 16 distinct players, 2 seed 1 + 2 seed 2 per team, 2 teams per group; lineup pairs are seed 1 + seed 2 of that team, matches 1–2 disjoint and covering all four, match 3 recombined and not repeating an opening pair (PLAN.md → Acceptance review 1–2)
- [x] `src/domain/scoring.ts` + `scoring.test.ts`: `gameRules` 15/21 for group and third place, 21/30 for final; win by two, one-point margin at cap; two game wins end the match (Acceptance review 5). Keep `isWinningScore`/`addPointToScore` until Phase 4
- [ ] `src/domain/team-fixtures.ts` + `team-fixtures.test.ts`: first to two match wins, walkovers count as wins, decider `eligible` only with both openers confirmed at 1–1, `unnecessary` at 2–0, no winner when a match is unresolved (Acceptance review 6, 10)
- [ ] `src/domain/progression.ts` + `progression.test.ts`: group winners → final, losers → third place; completion needs both placement outcomes; `correctionBlockCode` returns `'decider-started'` when a correction flips 1–1 with a started decider, `'placement-started'` when it changes advancement after either placement fixture starts (Acceptance review 7, 9)
- [ ] Extend `impactBlockCodes` in `src/domain/impacts.ts` with `'decider-started'` and `'placement-started'` (old codes stay until Phase 4)

**Phase gate (hard):**
- [ ] `npm run typecheck`
- [ ] `npm run test:related -- <changed files>`

**On completion:** run the phase gate; run `fresh-review` when the recorded or actual-diff
decision requires it; update STATUS + checkboxes; stop and ask before push/PR. Review
checklist goes into the PR description.

## Phase 2 — Staff roles

Branch: `team-tournament/phase-2-roles` (`gh stack add`)

Authorization boundary on its own migration so its review is not mixed with tournament schema; works against the existing pair RPCs.

Produces: `StaffRole = 'organizer' | 'referee'` and `StaffAccess.role: StaffRole` in `src/domain/types.ts`; SQL `private.require_organizer()`, `private.require_scorer()` (organizer or referee), `private.staff_role()`; `get_staff_access()` returns `{ sessionId, expiresAt, role }`; `rotateStaffPin(role: StaffRole, pin: string)` in `src/data/staff.ts`.

Fresh review: required — authentication/authorization and a persistent-data migration

- [ ] `supabase/migrations/202609170001_staff_roles.sql`: re-key `private.staff_config` by `role text check (role in ('organizer','referee'))` (drop `singleton`), add `role` to `private.staff_grants`, revoke every existing grant (`revoked_at = clock_timestamp()`) so no pre-role grant survives
- [ ] Same migration: `exchange_staff_pin` matches the PIN against both hashes and issues a grant carrying the matched role, keeping `consume_pin_attempt` rate limiting and expiry; `rotate_staff_pin_for_session(p_session_id, p_user_id, p_role, p_pin)` requires an organizer grant, rejects a PIN equal to the other role's PIN (judgment call: identical PINs would make the role ambiguous), bumps that role's generation and revokes that role's grants
- [ ] Same migration: add `private.require_organizer()` / `private.require_scorer()`; `has_staff_access` validates `pin_generation` against the grant's role row; replace `private.require_staff_access()` call sites in `private.invoke_legacy_mutation` so `start_scoring`, `take_over`, `add_point`, `undo_point`, `confirm_result` require scorer and every other command, `preview_result_correction` and `preview_withdrawal` require organizer
- [ ] `supabase/functions/staff-pin/index.ts` passes through the role in the access body; `supabase/functions/rotate-pin/index.ts` parses and forwards `role`, returning 400 on an unknown role
- [ ] `src/data/staff.ts`: `staffAccessSchema` gains `role: z.enum(['organizer','referee'])`; `rotateStaffPin(role, pin)`
- [ ] `src/features/staff/StaffMenu.tsx`, `src/App.tsx`: show organizer navigation and PIN rotation only when `role === 'organizer'` (server enforces regardless)
- [ ] `src/lib/database.types.ts`: hand-edit `rotate_staff_pin_for_session` args and `get_staff_access` return to match the SQL
- [ ] `tests/integration/auth.test.ts`: referee PIN yields a referee grant; referee cannot call an organizer command or preview; organizer can score; rotation by a referee is rejected; rotating one role revokes only that role's grants; pre-migration grants are revoked (Acceptance review 11)
- [ ] `docs/deployment.md`, `README.md`: provision both role PINs in the `psql` procedure

**Phase gate (hard):**
- [ ] `npm run typecheck`
- [ ] `npm run test:related -- <changed files>` (integration suites fail at setup without local Supabase; report the skip count, never as a pass)

**Review checklist (user, at PR review):**
- [ ] Sign in with the referee PIN: organizer controls absent, scoring available
- [ ] Sign in with the organizer PIN: organizer controls and PIN rotation available for both roles

**On completion:** run the phase gate; run `fresh-review` when the recorded or actual-diff
decision requires it; update STATUS + checkboxes; stop and ask before push/PR. Review
checklist goes into the PR description.

## Phase 3 — Team tournament schema

Branch: `team-tournament/phase-3-schema` (`gh stack add`)

Server model and command RPCs replace the pair format; the client keeps compiling because `database.types.ts` changes land with the client in Phase 4.

Consumes: `private.require_organizer()`, `private.require_scorer()`, `private.staff_role()` from Phase 2; rule definitions from Phase 1 (SQL mirrors `validateRoster`, `validateLineup`, `gameRules`, `deciderStatus`, `placementParticipants`, `correctionBlockCode`).
Produces: tables `public.teams`, `public.players.team_id`, `public.team_fixtures (stage, group_code, team_a_id, team_b_id, version)`, `public.matches (fixture_id, match_number, pair_a_*, pair_b_*, court, state, result_kind, winner_side)`, `public.match_games (match_id, game_number, score_a, score_b, confirmed_at)`, `private.lineups (fixture_id, team_id, match_number, seed1_player_id, seed2_player_id, confirmed_at)`, `private.scoring_handovers`; snapshot JSON `{ tournament, teams, players, fixtures, matches, games, lineups }`; mutation RPCs `save_roster`, `save_lineup`, `confirm_lineup`, `reopen_lineups`, `start_group_play`, `assign_courts`, `start_match`, `take_over`, `add_point`, `undo_point`, `confirm_game`, `mark_walkover`, `correct_result`, `preview_result_correction`, each `(p_request_id, p_reset_generation, p_expected_version, p_payload)`.

Fresh review: required — persistent-data migration and authorization on every command

- [ ] `supabase/migrations/202609170002_team_tournament.sql`: raise if any `public.pairs` or `public.matches` rows exist (Reset all must precede), then drop `public.pairs`, `public.tie_resolutions`, pair columns and `void` state, and every legacy wrapper/`private.legacy_*` function, including `withdraw_pair`, `resolve_tie`, `confirm_groups`, `preview_withdrawal`, `generate_fixtures`, `enter_result`, `set_court_count`; drop `public.tournament.court_count` (courts are always 1 and 2, enforced by `matches.court in (1, 2)`)
- [ ] Same migration: create the Produces tables with constraints (seed per player, `match_number in (1,2,3)`, unique `(match_id, game_number)`), `public` read policies for teams/players/fixtures/matches/match_games, no grants on `private.lineups`; add the new public tables to the `supabase_realtime` publication set up in `202609080004_realtime.sql`
- [ ] `private.snapshot_body()` / `get_tournament_snapshot()`: include a fixture's lineups only when both teams confirmed, or when `private.staff_role() = 'organizer'` (Acceptance review 3)
- [ ] Roster and lineup commands (organizer): `save_roster` blocked once group play started; `save_lineup` validates three legal pairs; `confirm_lineup` locks when both confirmed; `reopen_lineups` clears both confirmations only before any fixture match starts; `start_group_play` requires valid rosters, 2 teams per group, all four group lineups confirmed, then creates both group fixtures and their three matches (Acceptance review 1, 2, 4)
- [ ] Scoring commands (scorer): `start_match` requires confirmed lineups, assigned free court, no participating player in another `playing` match, and for match 3 both openers confirmed at 1–1; `add_point`/`undo_point` on the open game only; `confirm_game` applies stage target/cap, completes the match at two game wins, marks match 3 unnecessary at 2–0, completes the fixture (Acceptance review 5, 6, 8)
- [ ] Progression: completing both group fixtures populates third place and final teams; completing both placement fixtures sets tournament `completed` (Acceptance review 7)
- [ ] `mark_walkover` (organizer) per match without score; no double walkover; `correct_result` + `preview_result_correction` (organizer) block `decider-started` / `placement-started` / `tournament-completed`, recompute placement participants and clear placement lineup confirmations when advancement changes before placement starts (Acceptance review 9, 10)
- [ ] `take_over` (scorer): atomically reassign `private.match_ownership`, insert `private.scoring_handovers (match_id, from_session_id, to_session_id, created_at)`; ownership checks reject the former owner's writes (Acceptance review 11)
- [ ] `public.reset_tournament` clears the new tables and handovers and no longer reads `court_count`; `scripts/reset-tournament.ts` unchanged unless its table list diverges
- [ ] Rewrite `tests/integration/tournament.test.ts`, `impacts.test.ts`, `reset.test.ts` for the team format, covering Acceptance review 1–12 server-side; removed pair/withdrawal/tie scenarios are replaced, not skipped — list removed scenario names in the PR description

**Phase gate (hard):**
- [ ] `npm run typecheck`
- [ ] `npm run test:related -- <changed files>` (integration suites fail at setup without local Supabase; report the skip count, never as a pass)

**Review checklist (user, at PR review):**
- [ ] Confirm Reset all ran on the target database before applying the migration

**On completion:** run the phase gate; run `fresh-review` when the recorded or actual-diff
decision requires it; update STATUS + checkboxes; stop and ask before push/PR. Review
checklist goes into the PR description.

## Phase 4 — Client replacement

Branch: `team-tournament/phase-4-client` (`gh stack add`)

`database.types.ts`, `CommandPayloads`, and `TournamentSnapshot` are imported by every feature, so the data layer and UI must switch in one typecheck-green step.

Consumes: all Phase 1 exports; `StaffRole` and `StaffAccess.role` from Phase 2; Phase 3 snapshot JSON and mutation RPC names/payloads.
Produces: none.

Fresh review: not required

- [ ] `src/lib/database.types.ts`: hand-edit tables and `Functions` to the Phase 3 SQL; remove legacy entries
- [ ] `src/domain/commands.ts`: `CommandPayloads` keys and payloads = Phase 3 RPCs; `src/domain/types.ts`: `TournamentSnapshot { tournament, teams, players, fixtures, matches, lineups }`, delete `Pair`, old `Match` union, `TieResolution`, `Standing`, `Fixture`/`GroupFixture`/`KnockoutFixture`, `SetupPairInput`
- [ ] Delete `src/domain/standings.ts`, `src/domain/fixtures.ts`, `src/domain/setup.ts` (including `availableCourts`) and their tests (replaced by Phase 1 modules and tests); drop old codes from `impactBlockCodes`
- [ ] Remove the court-count setting: `CourtCount`, `Tournament.courtCount`, `SetupInput.courtCount`, the `set_court_count` command, and its controls and reads in `SetupForm.tsx`, `OrganizerPage.tsx`, `TournamentPage.tsx`, `ScoreTracker.tsx`; `Court = 1 | 2` stays
- [ ] `src/data/tournament.ts` (`parseSnapshot` zod schemas, `mutateTournament`), `src/data/tournament.test.ts`; `src/data/impacts.ts` (remove `previewWithdrawal`), `src/data/impacts.test.ts`
- [ ] `src/features/scoring/scoring-state.ts` + `scoring-state.test.ts`: per-game score, `confirm_game` event, stage target/cap; `ScoreTracker.tsx`: game tally, confirm game, take over with explicit confirmation
- [ ] Organizer UI: `SetupForm.tsx` → team roster entry; new `src/features/organizer/LineupEditor.tsx` (enter, confirm, reopen); `ResultSchedule.tsx`, `ResultEditor.tsx`, `ImpactPreview.tsx` on fixtures/matches/games; delete `WithdrawalPanel.tsx`; `OrganizerPage.tsx` wiring
- [ ] Public UI: `StandingsTable.tsx` → group fixture results and final positions; `KnockoutBracket.tsx` → third place + final; `MatchTicket.tsx` pairs and game scores; `TournamentPage.tsx` wiring; lineups shown only when present in the snapshot
- [ ] `src/i18n/vi.ts`, `src/i18n/errors.ts` (+ `errors.test.ts`): Đội, Cặp, Cuộc đối đầu, Trận, Ván, Trọng tài copy and new block/error codes per `CONTEXT.md`

**Phase gate (hard):**
- [ ] `npm run typecheck`
- [ ] `npm run test:related -- <changed files>`

**Review checklist (user, at PR review):**
- [ ] Organizer enters 4 teams; invalid seed split or duplicate player blocks group play
- [ ] Draft lineup invisible to a referee session and a public tab; both appear together after both confirm
- [ ] Referee scores a group game to 15–14 (continues), 21–20 (ends); final game ends at 30–29; game tally updates after confirm
- [ ] 1–1 enables the decider; 2–0 shows it recorded but unnecessary
- [ ] Both group fixtures done → third place and final populated; completing only third place leaves tournament incomplete
- [ ] Both courts always offered; no court-count control remains; starting a match on an occupied court or with a player already playing is blocked
- [ ] Take over scoring from a second device; the first device's next point is rejected
- [ ] Reload mid-game restores score; live updates reach a public tab; Reset all still works

**On completion:** run the phase gate; run `fresh-review` when the recorded or actual-diff
decision requires it; update STATUS + checkboxes; stop and ask before push/PR. Review
checklist goes into the PR description.

## Spec gate (hard — once, before the final phase's PR)

- [ ] `npm run test` (integration suites fail at setup without local Supabase; report pass and skip counts, never as a pass)
- [ ] `npm run build`
