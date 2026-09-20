# Round-robin team tournament — Execution Plan

Spec: [PLAN.md](PLAN.md). Rulebook: `specs/RULEBOOK.md`.
Integration branch: `main`. Branch model: stacked via `gh stack` (extension present, stacks API returns 200).

Local Supabase is off-limits per `AGENTS.md`, so `tests/integration/*.test.ts` fail in every
gate run. Report the skip count alongside passes; never delete or weaken them.

## STATUS

- Current phase: 1 — in-progress
- Phase 1 — Schema and SQL command surface: in-progress
- Phase 2 — Domain model: pending
- Phase 3 — Data layer: pending
- Phase 4 — UI and copy: pending
- Verification debt: none

## Phase 1 — Schema and SQL command surface

Branch: `round-robin-tournament/phase-1-schema` (stacked: `gh stack init -b main`)

Nothing downstream can be typed or mapped until the tables, stages, and command functions exist.

Produces: `public.team_fixtures.stage` values `'qualifying' | 'qualification-playoff' | 'third-place' | 'final'`; `public.matches.player_1_id`/`player_2_id`; `private.lineups.player_1_id`/`player_2_id` with `match_number` 1..4; `private.qualifying_standings()`; `public.substitute_players()`; `public.record_draw()`; `public.confirm_finalists()`

Fresh review: required — persistent-data migration with destructive writes, plus `security definer` command functions

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
- [ ] Partial unique index preventing one player from being in two `playing` matches, alongside the existing `matches_active_court_unique`
- [x] `private.team_mark_walkover()`: allow from state `unstarted`, not only mid-match
- [ ] `private.team_correction_block_code()`: block qualifying corrections that change playoff participants, format, or available final places once a playoff match starts; block placement-participant changes once a placement fixture starts; allow playoff-result corrections until a placement fixture starts (per PLAN.md → "Confirmed decisions")
- [x] `private.snapshot_body()` and `public.get_tournament_snapshot()`: emit the new stage values, generic pair columns, the fourth lineup row, and the standings
- [x] `public.reset_tournament()` `progress` mode: stop retaining group assignments, rebuild the new fixture set
- [x] Hand-edit `src/lib/database.types.ts` to match the migration (never claim it was generated, per `AGENTS.md`)

**Phase gate (hard):**
- [ ] `npm run typecheck`
- [ ] `npm run test:related -- <changed files from the phase diff>`

**Review checklist (user, at PR review):**
- [ ] Migration SQL reads correctly against `202609170002_team_tournament.sql`; no data loss beyond fixtures, matches, lineups and confirmations
- [ ] Six qualifying fixtures pair each of the four teams exactly once

**On completion:** run the phase gate; run `fresh-review`; update STATUS + checkboxes; stop and ask before push/PR. Review checklist goes into the PR description.

## Phase 2 — Domain model

Branch: `round-robin-tournament/phase-2-domain` (stacked: `gh stack add`)

The TypeScript mirror of the SQL rules; every consumer below depends on these types and functions.

Consumes: the Phase 1 stage values, `player_1_id`/`player_2_id` columns, and `src/lib/database.types.ts`
Produces: `LineupPair { player1Id: UUID; player2Id: UUID }`; `FixtureStage = 'qualifying' | 'qualification-playoff' | 'third-place' | 'final'`; `Lineup.pairs: [LineupPair, LineupPair, LineupPair, LineupPair]`; `qualifyingStandings(fixtures, matches, teams): TeamStanding[]`; `requiredPlayoff(standings): PlayoffRequirement | null`; `CommandPayloads['substitute_players' | 'record_draw' | 'confirm_finalists']`

Fresh review: not required

- [ ] `src/domain/types.ts`: replace `Group`/`TournamentStage` `'groups'`, retype `FixtureStage`, drop `Team.group` and `TeamFixture.group`, rename `LineupPair` fields, widen `Lineup.pairs` to four, add `TeamStanding` and `PlayoffRequirement`
- [ ] `src/domain/scoring.ts`: `gameRules(stage)` returns 21/30 for `qualifying`, `third-place`, `final` and 11/15 for `qualification-playoff`; add `gamesToWinMatch(stage)` returning 2 for `final`, 1 otherwise
- [ ] `src/domain/roster.ts`: drop `group-split` from `RosterIssueCode` and its check; validate declared lineups as mixed-seed pairs 1–3 using all four players once, and pair 4 (playoff) as any two distinct teammates; keep `decider-repeats-opening-pair`
- [ ] `src/domain/roster.ts`: add `validateQualifyingRotation(lineups, roster)` enforcing both disjoint mixed-seed arrangements across a team's three qualifying fixtures (per PLAN.md → "Qualifying pairs must mix seeds")
- [ ] New `src/domain/standings.ts`: `qualifyingStandings()` applying the five ranking criteria over the fixed original tied set, excluding walkovers from point totals, and marking teams the criteria did not separate
- [ ] New `src/domain/standings.ts`: `requiredPlayoff()` returning the two-, three-, or four-team playoff shape, or null
- [ ] `src/domain/team-fixtures.ts`: `fixtureWinnerTeamId()` handles a drawn qualifying fixture (1–1, no winner) and a single-match playoff fixture; `deciderStatus()` applies to placement fixtures only
- [ ] `src/domain/progression.ts`: `placementParticipants()` derives from `qualifyingStandings()` plus finalist confirmation instead of two group winners; extend `CorrectionBlockCode` with `'playoff-started'`
- [ ] `src/domain/commands.ts`: rename `start_group_play` to `start_qualifying`, add `substitute_players: { matchId: UUID; side: Side; pair: LineupPair }`, `record_draw: { fixtureId: UUID; teamAId: UUID; teamBId: UUID }`, `confirm_finalists: Record<string, never>`
- [ ] Update `src/domain/roster.test.ts`, `scoring.test.ts`, `team-fixtures.test.ts`, `progression.test.ts`; add `src/domain/standings.test.ts` covering each ranking criterion, the two/three/four-team playoff shapes, and an unbreakable tie

**Phase gate (hard):**
- [ ] `npm run typecheck`
- [ ] `npm run test:related -- <changed files from the phase diff>`

**Review checklist (user, at PR review):**
- [ ] Ranking criteria in `standings.ts` match PLAN.md's five criteria in order, including the fixed original tied set

**On completion:** run the phase gate; update STATUS + checkboxes; stop and ask before push/PR. Review checklist goes into the PR description.

## Phase 3 — Data layer

Branch: `round-robin-tournament/phase-3-data` (stacked: `gh stack add`)

The zod/DTO boundary between the new SQL snapshot and the new domain types; the UI consumes only mapped values.

Consumes: Phase 2's `LineupPair`, `FixtureStage`, `TeamStanding`, and the new `CommandPayloads` keys
Produces: snapshot mapping emitting four-pair lineups and generic pair fields; `substitutePlayers()`, `recordDraw()`, `confirmFinalists()` mutation wrappers

Fresh review: not required

- [ ] `src/data/tournament.ts`: update the zod schemas and DTO mapping for the new stage values, `player_1_id`/`player_2_id`, the fourth lineup row, and dropped group fields
- [ ] `src/data/tournament.ts`: add mutation wrappers for `substitute_players`, `record_draw`, `confirm_finalists`; rename the `start_group_play` wrapper to `startQualifying`
- [ ] `src/data/impacts.ts` and `src/domain/impacts.ts`: extend correction-preview impacts for revoked finalist confirmation and cleared placement lineups
- [ ] Update `src/data/tournament.test.ts` and `src/data/impacts.test.ts` for the new shapes

**Phase gate (hard):**
- [ ] `npm run typecheck`
- [ ] `npm run test:related -- <changed files from the phase diff>`

**Review checklist (user, at PR review):**
- [ ] A malformed snapshot still fails zod parsing rather than reaching the UI

**On completion:** run the phase gate; update STATUS + checkboxes; stop and ask before push/PR. Review checklist goes into the PR description.

## Phase 4 — UI and copy

Branch: `round-robin-tournament/phase-4-ui` (stacked: `gh stack add`)

Everything a player or organizer sees, built on the mapped snapshot from Phase 3.

Consumes: Phase 3's mapped snapshot and mutation wrappers; Phase 2's `qualifyingStandings()` and `requiredPlayoff()`

Fresh review: not required

- [ ] `src/features/tournament/StandingsTable.tsx`: round-robin table with match wins, points scored, points conceded, point difference; equal rank plus a marker for teams the criteria did not separate; the criterion that separated tied teams
- [ ] `src/features/tournament/StandingsTable.tsx`: distinguish provisional standings, a required playoff, and confirmed finalists
- [ ] `src/features/tournament/KnockoutBracket.tsx`: replace the group bracket with qualification playoffs, third place, and the final
- [ ] `src/features/tournament/FixtureCard.tsx` and `MatchTicket.tsx`: render a drawn qualifying fixture, a single-match playoff, generic pairs, and per-stage game rules
- [ ] `src/features/tournament/labels.ts`: drop `groupTone`; add stage labels for qualifying, qualification playoff, and placement fixtures
- [ ] `src/features/organizer/LineupEditor.tsx`: four pairs per qualifying lineup (three mixed-seed plus the unrestricted playoff pair), with mixed-seed validation on pairs 1–3 only
- [ ] `src/features/organizer/OrganizerPage.tsx`: finalist confirmation showing the proposed finalists and why each qualified; draw recording for playoff matchups
- [ ] `src/features/organizer/ResultSchedule.tsx`: substitution control on an unstarted match, listing the team's four players (per PLAN.md → "Substitution")
- [ ] `src/features/organizer/ResultEditor.tsx` and `ImpactPreview.tsx`: surface the new correction block reasons
- [ ] `src/features/scoring/scoring-state.ts` and `ScoreTracker.tsx`: per-stage targets and caps, BO1 outside the final
- [ ] `src/features/tournament/TournamentPage.tsx`: team filter — a selector (no login) narrowing the schedule to one team's fixtures, showing opponent, stage and court; hide pairs until the lineup reveal (per PLAN.md → "Let any viewer filter the public schedule")
- [ ] `src/features/tournament/TournamentPage.tsx`: publish the rules, ranking criteria, playoff formats, walkover treatment, and draw outcomes
- [ ] `src/i18n/vi.ts`: Vietnamese copy for the new terms, using CONTEXT.md's canonical words (_Vòng loại_, _Trận tranh vé_, _Cuộc đối đầu xếp hạng_, _Hòa_, _Bốc thăm_, _Thay người_); remove group copy
- [ ] `src/i18n/errors.ts`: messages for substitution rejections and the new correction blocks
- [ ] Update `src/features/scoring/scoring-state.test.ts` and `src/features/tournament/document-title.test.ts`

**Phase gate (hard):**
- [ ] `npm run typecheck`
- [ ] `npm run test:related -- <changed files from the phase diff>`

**Review checklist (user, at PR review):**
- [ ] Standings read correctly for a provisional table, a required playoff, and confirmed finalists
- [ ] Substituting a player into an unstarted match shows the new pair on the public page
- [ ] A same-seed pair is accepted by substitution and rejected in a declared lineup
- [ ] Vietnamese copy matches CONTEXT.md's canonical terms
- [ ] Filtering to a team shows its six qualifying fixtures with the right opponents, and its placement fixture once known
- [ ] The team filter shows no pairs before all four teams have confirmed their lineups
- [ ] Visual check against `references/tournament-prototype.html`

**On completion:** run the phase gate; update STATUS + checkboxes; stop and ask before push/PR. Review checklist goes into the PR description.

## Spec gate (hard — once, before the final phase's PR)

- [ ] `npm run test` — report the pass count with the integration-test failures and skip count, per `AGENTS.md`
- [ ] `npm run build`
