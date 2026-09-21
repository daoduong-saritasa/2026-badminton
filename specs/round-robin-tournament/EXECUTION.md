# Round-robin team tournament — Execution Plan

Spec: [PLAN.md](PLAN.md). Rulebook: `specs/RULEBOOK.md`.
Integration branch: `main`. Branch model: stacked via `gh stack` (extension present, stacks API returns 200).

Local Supabase is off-limits per `AGENTS.md`, so `tests/integration/*.test.ts` fail in every
gate run. Report the skip count alongside passes; never delete or weaken them.

## STATUS

- Current phase: 4 — done-with-debt
- Phase 1 — Schema and SQL command surface: done-with-debt
- Phase 2 — Domain model: done
- Phase 3 — Data layer: done
- Phase 4 — UI and copy: done-with-debt
- Verification debt: `tests/integration/round-robin-phase1.test.ts` could not connect to the prohibited local Supabase stack; 1 suite failed in setup and 4 tests were skipped. Substitute evidence: `npm run typecheck` and `npm run lint` exit 0. Spec gate (2026-09-21): all 5 integration files fail in setup for the same reason (133 passed, 31 skipped); `tests/integration/{tournament,impacts,reset}.test.ts` are ported to the round-robin schema but unrun; they must pass against local Supabase before the spec counts as verified.

## Phase 1 — Schema and SQL command surface

Branch: `round-robin-tournament/phase-1-schema` (stacked: `gh stack init -b main`)

Nothing downstream can be typed or mapped until the tables, stages, and command functions exist.

Produces: `public.team_fixtures.stage` values `'qualifying' | 'qualification-playoff' | 'third-place' | 'final'`; `public.matches.player_1_id`/`player_2_id`; `private.lineups.player_1_id`/`player_2_id` with `match_number` 1..4; `public.tournament.qualification_draw_winner_ids`; `private.qualifying_standings()`; `public.substitute_players()`; `public.record_draw()` for matchup and advancement draws; `public.confirm_finalists()`

Fresh review: required — persistent-data migration with destructive writes, plus `security definer` command functions

Fresh re-review: all P1 findings corrected; user accepted the remaining P2 empty-advancement-draw finding on 2026-09-20 and requested no further fresh review.

- [x] New migration `supabase/migrations/<ts>_round_robin.sql`, forward-only in the style of `202609170002_team_tournament.sql`
- [x] Widen `team_fixtures.stage` check to the four new values; drop the `'group'` value, the `group_code` column, its check constraints, `team_fixtures_group_unique`, `team_fixtures_placement_unique`, and the `unique (tournament_id, stage, group_code)` constraint — playoffs need many fixtures per stage
- [x] Drop `public.teams.group_code` and its check constraint
- [x] Rename `matches.pair_a_seed1_player_id`/`pair_a_seed2_player_id`/`pair_b_seed1_player_id`/`pair_b_seed2_player_id` to `pair_a_player_1_id`/`pair_a_player_2_id`/`pair_b_player_1_id`/`pair_b_player_2_id`; add checks that each pair's two players differ
- [x] Rename `private.lineups.seed1_player_id`/`seed2_player_id` to `player_1_id`/`player_2_id`; widen `match_number` check to 1..4 for the predeclared playoff pair (per PLAN.md → "Implementation decisions")
- [x] Transition migration body: delete existing fixtures, matches, match_games, lineups, and scoring_handovers; keep `tournament`, `teams`, `players`; build six `qualifying` fixtures pairing every team once, plus one `third-place` and one `final` (per PLAN.md → "The deployment migration performs the format transition")
- [x] `private.sync_fixture_matches()`: two matches for a qualifying fixture, one for a `qualification-playoff`, up to three for a placement fixture
- [x] `(amended 2026-09-20)` `private.sync_fixture_matches()`: source qualification-playoff players from each team's confirmed predeclared row-four pair on qualifying fixtures
- [x] `private.is_game_won()`: 21/cap 30 for `qualifying`, `third-place`, `final`; 11/cap 15 for `qualification-playoff`; BO1 everywhere except `final` (per PLAN.md → "Base format — confirmed")
- [x] `private.qualifying_standings()` returning match wins, points scored, points conceded, point difference and rank per team, applying the five ranking criteria over the fixed original tied set, excluding walkover matches from point totals
- [x] `private.populate_placement_fixtures()`: derive finalists and third-place teams from `private.qualifying_standings()` instead of two group winners; leave placement fixtures empty while a qualification tie is unresolved
- [x] `public.confirm_finalists(p_request_id, p_reset_generation, p_expected_version, p_payload)` writing organizer confirmation, and revoking it when a correction changes placement participants
- [x] `public.record_draw(...)` setting `team_a_id`/`team_b_id` on `qualification-playoff` fixtures, and clearing them when the playoff is recalculated
- [x] `public.substitute_players(...)` replacing one match's `pair_a_*`/`pair_b_*` players before it starts, rejecting only a duplicate player within a pair and a player already in a `playing` match (per PLAN.md → "Substitution")
- [x] Partial GIN overlap index plus a serialized constraint trigger preventing one player from being in two `playing` matches, alongside the existing `matches_active_court_unique` (amended 2026-09-20: PostgreSQL unique indexes compare complete B-tree keys and cannot enforce overlap across four denormalized UUID columns)
- [x] `private.team_mark_walkover()`: allow from state `unstarted`, not only mid-match
- [x] `private.team_correction_block_code()`: block qualifying corrections that change playoff participants, format, or available final places once a playoff match starts; block placement-participant changes once a placement fixture starts; allow playoff-result corrections until a placement fixture starts (per PLAN.md → "Confirmed decisions")
- [x] `(amended 2026-09-20)` Pass corrected games into `private.team_correction_block_code()` and use a rolled-back projection so participant-preserving corrections remain allowed
- [x] `private.snapshot_body()` and `public.get_tournament_snapshot()`: emit the new stage values, generic pair columns, the fourth lineup row, and the standings
- [x] `public.reset_tournament()` `progress` mode: stop retaining group assignments, rebuild the new fixture set
- [x] Hand-edit `src/lib/database.types.ts` to match the migration (never claim it was generated, per `AGENTS.md`)
- [x] `(amended 2026-09-20)` Synchronize matches for automatically created two- and three-team qualification playoffs
- [x] `(amended 2026-09-20)` Persist and consume a supervised advancement draw when a three-team playoff remains tied
- [x] `(amended 2026-09-20)` Clear stale placement lineups whenever a correction invalidates placement participants
- [x] `(amended 2026-09-20)` Reveal qualifying lineups only after all 48 rows are confirmed and placement lineups only after both fixture teams confirm
- [x] `(amended 2026-09-20)` Gate placement lineup save and confirmation on organizer finalist confirmation
- [x] `(amended 2026-09-20)` Validate four-team matchup draws atomically against the unresolved tied set and reject in-progress rewrites
- [x] `(amended 2026-09-20)` Compare canonical qualification requirements in correction-boundary projections
- [x] `(amended 2026-09-20)` Enforce one consistent predeclared row-four playoff pair per team
- [x] `(amended 2026-09-20)` Preserve automatic three-team playoff qualifiers and draw only the remaining tied cutoff slots
- [x] `(amended 2026-09-20)` Reject matchup and advancement draw changes after placement play starts
- [x] `(amended 2026-09-20)` Revalidate stored advancement draws after every playoff score correction
- [x] `(amended 2026-09-20)` Preserve finalist confirmation and placement lineups when a qualifying correction leaves participants unchanged

**Phase gate (hard):**
- [x] `npm run typecheck`
- [x] `npm run test:related -- <changed files from the phase diff>` (0 related test files)
- [~] `(amended 2026-09-20)` `npm run test:related -- tests/integration/round-robin-phase1.test.ts supabase/migrations/202609200001_round_robin.sql src/lib/database.types.ts specs/round-robin-tournament/EXECUTION.md` — local Supabase unavailable because the OrbStack socket is absent; 1 suite failed in setup and all 4 focused scenarios were skipped. Substitute evidence: typecheck and lint exit 0.

**Review checklist (user, at PR review):**
- [ ] Migration SQL reads correctly against `202609170002_team_tournament.sql`; no data loss beyond fixtures, matches, lineups and confirmations
- [ ] Six qualifying fixtures pair each of the four teams exactly once

**On completion:** run the phase gate; run `fresh-review`; update STATUS + checkboxes; stop and ask before push/PR. Review checklist goes into the PR description.

## Phase 2 — Domain model

Branch: `round-robin-tournament/phase-2-domain` (stacked: `gh stack add`)

The TypeScript mirror of the SQL rules; every consumer below depends on these types and functions.

Consumes: the Phase 1 stage values, `player_1_id`/`player_2_id` columns, and `src/lib/database.types.ts`
Produces: `LineupPair { player1Id: UUID; player2Id: UUID }`; `FixtureStage = 'qualifying' | 'qualification-playoff' | 'third-place' | 'final'`; `Lineup.pairs: [LineupPair, LineupPair, LineupPair, LineupPair]`; `qualifyingStandings(fixtures, matches, teams): TeamStanding[]`; `requiredPlayoff(standings): PlayoffRequirement | null`; `CommandPayloads['substitute_players' | 'record_draw' | 'confirm_finalists']` (amended 2026-09-21: `substitute_players` is `{ matchId; side } & LineupPair`, flat, because `private.team_substitute_players()` reads `player1Id`/`player2Id` from the payload root)

Fresh review: not required — re-evaluated 2026-09-21 against the actual diff: no hard trigger; growth into consumer files was the user-approved compile-only amendment

- [x] `src/domain/types.ts`: replace `Group`/`TournamentStage` `'groups'`, retype `FixtureStage`, drop `Team.group` and `TeamFixture.group`, rename `LineupPair` fields, widen `Lineup.pairs` to four, add `TeamStanding` and `PlayoffRequirement`
- [x] `src/domain/scoring.ts`: `gameRules(stage)` returns 21/30 for `qualifying`, `third-place`, `final` and 11/15 for `qualification-playoff`; add `gamesToWinMatch(stage)` returning 2 for `final`, 1 otherwise
- [x] `src/domain/roster.ts`: drop `group-split` from `RosterIssueCode` and its check; validate declared lineups as mixed-seed pairs 1–3 using all four players once, and pair 4 (playoff) as any two distinct teammates; keep `decider-repeats-opening-pair`
- [x] `src/domain/roster.ts`: add `validateQualifyingRotation(lineups, roster)` enforcing both disjoint mixed-seed arrangements across a team's three qualifying fixtures (per PLAN.md → "Qualifying pairs must mix seeds")
- [x] New `src/domain/standings.ts`: `qualifyingStandings()` applying the five ranking criteria over the fixed original tied set, excluding walkovers from point totals, and marking teams the criteria did not separate
- [x] New `src/domain/standings.ts`: `requiredPlayoff()` returning the two-, three-, or four-team playoff shape, or null
- [x] `src/domain/team-fixtures.ts`: `fixtureWinnerTeamId()` handles a drawn qualifying fixture (1–1, no winner) and a single-match playoff fixture; `deciderStatus()` applies to placement fixtures only
- [x] `src/domain/progression.ts`: `placementParticipants()` derives from `qualifyingStandings()` plus finalist confirmation instead of two group winners; extend `CorrectionBlockCode` with `'playoff-started'`
- [x] `src/domain/commands.ts`: rename `start_group_play` to `start_qualifying`, add `substitute_players: { matchId: UUID; side: Side; pair: LineupPair }`, `record_draw: { matchups: Array<{ fixtureId: UUID; teamAId: UUID; teamBId: UUID }> } | { advancingTeamIds: UUID[] }`, `confirm_finalists: Record<string, never>`
- [x] `(amended 2026-09-21)` Compile-only fixes in consumers of the Phase 2 types, so the project-wide typecheck passes (user decision 2026-09-21); no new behavior or UI, which stays in Phases 3–4: `src/data/tournament.ts`, `src/data/tournament.test.ts`, `src/data/impacts.test.ts`, `src/features/organizer/ImpactPreview.tsx`, `LineupEditor.tsx`, `OrganizerPage.tsx`, `ResultEditor.tsx`, `SetupForm.tsx`, `src/features/scoring/ScoreTracker.tsx`, `src/features/scoring/scoring-state.test.ts`, `src/features/tournament/FixtureCard.tsx`, `MatchTicket.tsx`, `StandingsTable.tsx`, `TournamentPage.tsx`, `labels.ts`, `src/i18n/vi.ts`
- [x] Update `src/domain/roster.test.ts`, `scoring.test.ts`, `team-fixtures.test.ts`, `progression.test.ts`; add `src/domain/standings.test.ts` covering each ranking criterion, the two/three/four-team playoff shapes, and an unbreakable tie

**Phase gate (hard):**
- [x] `npm run typecheck`
- [x] `npm run test:related -- <changed files from the phase diff>` (9 files, 99 passed, 0 failed, 0 skipped; no integration suite is related)

**Review checklist (user, at PR review):**
- [ ] Ranking criteria in `standings.ts` match PLAN.md's five criteria in order, including the fixed original tied set

**On completion:** run the phase gate; update STATUS + checkboxes; stop and ask before push/PR. Review checklist goes into the PR description.

## Phase 3 — Data layer

Branch: `round-robin-tournament/phase-3-data` (stacked: `gh stack add`)

The zod/DTO boundary between the new SQL snapshot and the new domain types; the UI consumes only mapped values.

Consumes: Phase 2's `LineupPair`, `FixtureStage`, `TeamStanding`, and the new `CommandPayloads` keys
Produces: snapshot mapping emitting four-pair lineups and generic pair fields; `mutateTournament('substitute_players' | 'record_draw' | 'confirm_finalists', …)` (amended 2026-09-21: no per-command wrappers exist in the codebase); `impactConsequences(impact)` in `src/domain/impacts.ts`

Fresh review: not required — re-evaluated 2026-09-21 against the actual diff: no hard trigger

- [x] `src/data/tournament.ts`: update the zod schemas and DTO mapping (schema and mapping landed in Phase 2's compile-only amendment; this phase adds the tests) for the new stage values, `player_1_id`/`player_2_id`, the fourth lineup row, and dropped group fields
- [x] `src/data/tournament.ts`: add mutation wrappers for `substitute_players`, `record_draw`, `confirm_finalists`; rename the `start_group_play` wrapper to `startQualifying` — resolved without wrappers: the codebase has none, and the generic `mutateTournament(operation, input)` typed by `CommandPayloads` already sends these commands (`start_qualifying` renamed in Phase 2); covered by tests
- [x] `src/data/impacts.ts` and `src/domain/impacts.ts`: extend correction-preview impacts for revoked finalist confirmation and cleared placement lineups
- [x] Update `src/data/tournament.test.ts` and `src/data/impacts.test.ts` for the new shapes

**Phase gate (hard):**
- [x] `npm run typecheck`
- [x] `npm run test:related -- <changed files from the phase diff>` (3 files, 30 passed, 0 failed, 0 skipped; no integration suite is related)

**Review checklist (user, at PR review):**
- [ ] A malformed snapshot still fails zod parsing rather than reaching the UI

**On completion:** run the phase gate; update STATUS + checkboxes; stop and ask before push/PR. Review checklist goes into the PR description.

## Phase 4 — UI and copy

Branch: `round-robin-tournament/phase-4-ui` (stacked: `gh stack add`)

Everything a player or organizer sees, built on the mapped snapshot from Phase 3.

Consumes: Phase 3's mapped snapshot and mutation wrappers; Phase 2's `qualifyingStandings()` and `requiredPlayoff()`

Fresh review: required — upgraded 2026-09-21: the ported integration suites could not be run locally, so confidence is lower than usual

- [x] `(amended 2026-09-21)` `src/domain/progression.ts`: export `isQualifyingComplete()` and `resolvedFinalists()` (each finalist's basis: standings, playoff, or draw) for the provisional-standings state and the finalist-confirmation panel; tests in `progression.test.ts`
- [x] `src/features/tournament/StandingsTable.tsx`: round-robin table with match wins, points scored, points conceded, point difference; equal rank plus a marker for teams the criteria did not separate; the criterion that separated tied teams
- [x] `src/features/tournament/StandingsTable.tsx`: distinguish provisional standings, a required playoff, and confirmed finalists
- [x] `src/features/tournament/KnockoutBracket.tsx`: replace the group bracket with qualification playoffs, third place, and the final
- [x] `src/features/tournament/FixtureCard.tsx` and `MatchTicket.tsx`: render a drawn qualifying fixture, a single-match playoff, generic pairs, and per-stage game rules
- [x] `src/features/tournament/labels.ts`: drop `groupTone`; add stage labels for qualifying, qualification playoff, and placement fixtures
- [x] `(amended 2026-09-21)` `src/components/ui/select.tsx`: drop the unused `groupA`/`groupB` trigger tones with the group format
- [x] `src/features/organizer/LineupEditor.tsx`: four pairs per qualifying lineup (three mixed-seed plus the unrestricted playoff pair), with mixed-seed validation on pairs 1–3 only (qualifying rows: matches 1–2 plus the playoff pair, with match 3 derived by recombining the openers; placement rows: matches 1–3, with the unused fourth row derived from match 1; placement lineups open only after finalist confirmation)
- [x] `src/features/organizer/OrganizerPage.tsx`: finalist confirmation showing the proposed finalists and why each qualified; draw recording for playoff matchups (also blocks the qualifying start when `validateQualifyingRotation()` reports a team)
- [x] `src/features/organizer/ResultSchedule.tsx`: substitution control on an unstarted match, listing the team's four players (per PLAN.md → "Substitution") (the form lives in `ResultEditor.tsx`, which hosts the dialog)
- [x] `src/features/organizer/ResultEditor.tsx` and `ImpactPreview.tsx`: surface the new correction block reasons (also: one game row outside the final, and preview consequences from `impactConsequences()`)
- [x] `src/features/scoring/scoring-state.ts` and `ScoreTracker.tsx`: per-stage targets and caps, BO1 outside the final (`scoring-state.ts` needed no change: it already applies each stage's target and cap through `isGameWon()`)
- [x] `src/features/tournament/TournamentPage.tsx`: team filter — a selector (no login) narrowing the schedule to one team's fixtures, showing opponent, stage and court; hide pairs until the lineup reveal (per PLAN.md → "Let any viewer filter the public schedule")
- [x] `src/features/tournament/TournamentPage.tsx`: publish the rules, ranking criteria, playoff formats, walkover treatment, and draw outcomes
- [x] `src/i18n/vi.ts`: Vietnamese copy for the new terms, using CONTEXT.md's canonical words (_Vòng loại_, _Trận tranh vé_, _Cuộc đối đầu xếp hạng_, _Hòa_, _Bốc thăm_, _Thay người_); remove group copy
- [x] `src/i18n/errors.ts`: messages for substitution rejections and the new correction blocks
- [x] Update `src/features/scoring/scoring-state.test.ts` and `src/features/tournament/document-title.test.ts` (`document-title.test.ts` needed no change: the title comes from the tournament name, which this spec leaves alone)

- [x] `(amended 2026-09-21)` Fresh-review P1: `tests/integration/tournament.test.ts` saves both teams' lineups before either confirms, because one confirmation locks the fixture against saves; the reveal test also asserts that lock
- [x] `(amended 2026-09-21)` Fresh-review P1: `tests/integration/tournament.test.ts` "rejects invalid declared pairs" starts qualifying on its existing roster instead of re-creating it
- [x] `(amended 2026-09-21)` Fresh-review P2: `src/features/organizer/LineupEditor.tsx` locks both teams' pairs once either confirms, enables **Confirm** only after both teams have saved, and explains the lock; `src/i18n/errors.ts` and `vi.ts` copy updated
- [x] `(amended 2026-09-21)` Fresh-review P2: `src/features/organizer/OrganizerPage.tsx` keeps the four-team matchup draw open while no playoff match is playing, warning when re-drawing discards played playoff results (PLAN.md: re-record a draw while it still decides something)

**Phase gate (hard):**
- [x] `npm run typecheck`
- [x] `npm run test:related -- <changed files from the phase diff>` (4 files, 46 passed, 0 failed, 0 skipped)

**Review checklist (user, at PR review):**
- [ ] Standings read correctly for a provisional table, a required playoff, and confirmed finalists
- [ ] Substituting a player into an unstarted match shows the new pair on the public page
- [ ] A same-seed pair is accepted by substitution and rejected in a declared lineup
- [ ] Vietnamese copy matches CONTEXT.md's canonical terms
- [ ] Filtering to a team shows its three qualifying fixtures (amended 2026-09-21: six in total, three per team) with the right opponents, and its placement fixture once known
- [ ] The team filter shows no pairs before all four teams have confirmed their lineups
- [ ] Visual check against `references/tournament-prototype.html`

**On completion:** run the phase gate; update STATUS + checkboxes; stop and ask before push/PR. Review checklist goes into the PR description.

## Spec gate (hard — once, before the final phase's PR)

- [~] `npm run test` — report the pass count with the integration-test failures and skip count, per `AGENTS.md` — 2026-09-21: 12 files passed, 5 failed; 133 tests passed, 31 skipped (after the port: 133 passed, 32 skipped). All 5 failures are `requireLocalSupabase` setup errors (local Supabase unavailable, prohibited by `AGENTS.md`): `auth`, `impacts`, `reset`, `round-robin-phase1`, `tournament`. Substitute evidence: typecheck, lint, and every non-database suite pass.
- [x] `npm run build` — exit 0 (existing warning: 817 kB chunk over the 500 kB limit)
- [x] `(amended 2026-09-21)` Port `tests/integration/tournament.test.ts`, `impacts.test.ts`, and `reset.test.ts` to the round-robin schema: they still use `group_code`, `seed1`/`seed2` pair columns, `start_group_play`, three-pair lineups, and the `'group'` stage, so they fail against the Phase 1 migration once local Supabase runs. Ported on user direction 2026-09-21. The suites cover the new format: rosters without groups; four-pair lineups with a consistent playoff pair; the reveal after all 12 qualifying lineups are confirmed; one-game scoring at the new targets; drawn qualifying fixtures; finalist confirmation before placement play; third place before the final; the placement decider; and the `playoff-started`, revoked-confirmation, and `placement-started` correction boundaries. Verified by the project typecheck only; they cannot run without local Supabase.
