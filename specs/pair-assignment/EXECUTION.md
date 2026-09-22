# Pair assignment — Execution Plan

Spec: [PLAN.md](PLAN.md). Rulebook: `specs/RULEBOOK.md`.
Integration branch: `main`. Branch model: stacked via `gh stack` (default).

## STATUS

- Current phase: 2 — in-progress
- Phase 1 — Pairing and playoff-round domain rules: done (PR #26 open)
- Phase 2 — Database and application cutover: in-progress
- Verification debt: none

The rules-page work is already merged in `9a0db33`; retain it and review it in Phase 2. Neither remaining phase authorizes production deployment. Phase 2 removes a database contract and its client together; deploy them together before play starts. Reverting code cannot recover deleted lineup data.

Local Supabase is prohibited by `AGENTS.md`. Related tests that include integration suites and the full suite will fail in setup; at execution, record `[~]` only for this environment block, mirror debt in STATUS, and retain typecheck, non-database test results, and SQL review as substitute evidence. Report passed and skipped counts plus setup failures; never describe these gates as passing or weaken the tests.

## Phase 1 — Pairing and playoff-round domain rules

Branch: `pair-assignment/phase-1-domain` (`gh stack init`)

Pure pairing validation and single-round resolution establish the contracts consumed by the database/application cutover without changing live behavior.

Produces: `Pair = { player1Id: UUID; player2Id: UUID }`; `PairingRule = 'mixed-seed' | 'free'`; `PairAssignmentIssue = { code: 'unknown-player' | 'wrong-team' | 'duplicate-player' | 'player-playing' | 'same-seed' | 'qualifying-player-reused'; overridable: boolean }` in `src/domain/types.ts`.
Produces: `pairingRule(stage: FixtureStage, matchNumber: 1 | 2 | 3): PairingRule`; `validatePairAssignment(snapshot: TournamentSnapshot, matchId: UUID, side: Side, pair: Pair): PairAssignmentIssue[]`; `qualifyingPairings(players: readonly TeamPlayer[], teamId: UUID): [Pair, Pair][]` in `src/domain/pair-assignment.ts`.
Produces: `PlayoffRound = { id: UUID; roundNumber: number; teamIds: UUID[]; fixedFinalistIds: UUID[]; availablePlaces: 1 | 2; fixtureIds: UUID[] }`; `PlayoffRoundOutcome = { finalistIds: UUID[]; nextRound: { teamIds: UUID[]; fixedFinalistIds: UUID[]; availablePlaces: 1 | 2 } | null }`; `resolvePlayoffRound(round: PlayoffRound, fixtures: readonly TeamFixture[], matches: readonly FixtureMatch[]): PlayoffRoundOutcome | null` in `src/domain/playoff-rounds.ts`.

Fresh review: not required

- [x] Add `Pair`, `PairingRule`, and `PairAssignmentIssue` to `src/domain/types.ts`; keep existing consumers compiling until Phase 2 removes `Lineup` and `LineupPair`.
- [x] Create `src/domain/pair-assignment.ts` with the three exported helpers above: require two teammates; distinguish overridable seed/qualifying-reuse violations from duplicate-player, unknown-player, wrong-team, and playing-player violations; compare qualifying assignments with the other match in that fixture; require mixed seeds only in qualifying and third-place matches 1–2.
- [x] Implement `qualifyingPairings` as the two disjoint mixed-seed arrangements for a valid four-player roster; choosing a pair saves only the selected match side, not its complementary pair or the other match.
- [x] Create `src/domain/pair-assignment.test.ts` covering both arrangements, repeated arrangements across qualifying fixtures, saved sibling-pair reuse, same-seed exceptions, unrestricted deciders/finals/playoffs, wrong-team players, duplicate players, and players in progress on any court.
- [x] Create `src/domain/playoff-rounds.ts` with `PlayoffRound`, `PlayoffRoundOutcome`, and `resolvePlayoffRound`: return null before all round matches resolve; rank three-team rounds by wins, point difference, then points scored; return another round only for teams tied across the advancement cutoff, carrying fixed finalists and remaining places; resolve two-team and four-team rounds from match winners.
- [x] Create `src/domain/playoff-rounds.test.ts` covering a fully tied replay, a two-team continuation for one remaining place, a fixed finalist carried across multiple rounds, exclusion of previous-round scores, incomplete rounds, four-team matchup winners, and walkovers counting wins without artificial points.

**Phase gate (hard):**
- [x] Run `npm run typecheck` project-wide.
- [x] Run `npm run test:related -- <changed files>` with changed-file arguments derived from the phase diff; record any Supabase setup failures as environment debt using the substitute evidence described above. Passed 2 files and 22 tests; no integration suite entered the reverse-dependency closure.

**Review checklist (user, at PR review):**
- [ ] Review the pairing cases: qualifying permits either arrangement repeatedly; third-place opening matches require mixed seeds; placement deciders, finals, and playoffs allow any two teammates.
- [ ] Review a three-team tie that first qualifies one team, then needs repeated play for the remaining place: earlier qualifiers remain qualified and earlier scores never enter the new round's ranking.

**On completion:** run the phase gate; run `fresh-review` when the recorded or actual-diff decision requires it; update STATUS + checkboxes; stop and ask before push/PR. Review checklist goes into the PR description.

## Phase 2 — Database and application cutover

Branch: `pair-assignment/phase-2-cutover` (`gh stack add`)

The destructive removal of lineup storage, snapshot fields, and RPCs must land with every typed client and UI consumer that currently requires them.

Consumes: `Pair`, `PairingRule`, `PairAssignmentIssue`; `pairingRule(stage: FixtureStage, matchNumber: 1 | 2 | 3): PairingRule`; `validatePairAssignment(snapshot: TournamentSnapshot, matchId: UUID, side: Side, pair: Pair): PairAssignmentIssue[]`; `qualifyingPairings(players: readonly TeamPlayer[], teamId: UUID): [Pair, Pair][]`; `PlayoffRound`, `PlayoffRoundOutcome`, and `resolvePlayoffRound(round: PlayoffRound, fixtures: readonly TeamFixture[], matches: readonly FixtureMatch[]): PlayoffRoundOutcome | null`.

Fresh review: required — authorization, persistent-data migration, destructive reset, and correction paths protecting durable data

- [x] Add `supabase/migrations/202609220001_pair_assignment.sql`: retain tournament identity/name, rosters/seeds, court count, qualifying/placement fixture and match identities, and scheduling; clear declared pairs, confirmations, and match players per PLAN.md → "Migration"; replace dependent functions before dropping `private.lineups`, obsolete lineup RPCs/helpers, `substitute_players`, and the advancement-draw field `qualification_draw_winner_ids` without `CASCADE`.
- [x] In that migration create `public.qualification_playoff_rounds` with `id uuid`, `tournament_id uuid`, positive `round_number integer`, `team_ids uuid[]`, `fixed_finalist_ids uuid[]`, and `available_places integer` restricted to 1 or 2; enforce unique tournament/round numbers; add nullable `team_fixtures.playoff_round_id` and `tournament.current_playoff_round_id` foreign keys; apply the existing public-read/staff-RPC-only write policy to round data.
- [x] Implement `public.assign_pair(p_request_id uuid, p_reset_generation integer, p_expected_version integer, p_payload jsonb) returns jsonb` and `private.team_assign_pair` with payload `{ matchId, side, player1Id, player2Id, ruleException: boolean }`, expected match version, and existing mutation receipt; route through `private.invoke_team_mutation`, preserve locking/idempotency/reset-generation checks, and verify staff role server-side before permitting `ruleException: true`.
- [x] Enforce pair membership, distinct players, stage seed rules, qualifying sibling-match reuse, unstarted state, and confirmed placement participants in `private.team_assign_pair`; permit organizer exceptions only for seed/reuse rules, store no reason/original-pair/public marker, and retain the non-overridable playing-player guard at assignment and start under the mutation lock.
- [x] Replace lineup-based readiness in `private.sync_fixture_matches`, `private.team_start_qualifying`, and `private.team_start_match`: retain roster/setup locking, remove lineup/rotation prerequisites, require both saved pairs to start, freeze pairs after start, preserve court occupancy and third-place-before-final gates, and allow pre-start walkovers under existing permissions without inventing pairs.
- [x] Update `private.is_game_won`, `private.team_confirm_game`, `private.finish_fixture_if_decided`, and correction score validation for third-place BO3 to 15 capped at 21; keep final BO3 to 21/30, qualifying BO1 to 21/30, playoff BO1 to 11/15, and placement decider eligibility at 1–1.
- [x] Replace advancement draws in `private.populate_placement_fixtures` with numbered rounds mirroring `resolvePlayoffRound`; create continuation fixtures/matches once under the existing mutation lock, retain prior results, advance the current-round pointer, and carry fixed finalists/remaining places; restrict `private.team_record_draw` to the existing four-team matchup draw.
- [x] Update `private.team_correction_block_code`, `private.apply_team_correction`, and `public.preview_result_correction` for round dependencies: preserve existing correction boundaries, reject corrections that would invalidate a started successor round, rebuild only affected unstarted continuation state, revoke finalist confirmation when participants change, and clear both saved pairs only on affected unstarted placement matches.
- [x] Update `public.reset_tournament` and `private.team_save_roster` dependencies after lineup removal: progress reset retains all fixtures and schedules while clearing scores/pairs/confirmation and active playoff progress; recompute round eligibility from fresh qualifying results and reuse retained applicable fixture slots without treating historical rounds as current; retain reset-all semantics.
- [x] Update `private.snapshot_body` to publish each saved match side immediately, include `playoff_rounds` rows and `current_playoff_round_id`, and omit lineups/advancement draws; manually maintain `src/lib/database.types.ts` against the migration, including the new RPC and removed RPCs.
- [x] Update `src/domain/types.ts` and `src/domain/commands.ts`: replace `LineupPair` with `Pair`, remove `Lineup`/`TournamentSnapshot.lineups`/`qualificationDrawWinnerIds`, add `Tournament.currentPlayoffRoundId: UUID | null` and `TournamentSnapshot.playoffRounds: PlayoffRound[]`, add the `assign_pair` payload above, remove lineup/substitution commands, and narrow `record_draw` to matchups.
- [x] Update `src/data/tournament.ts` schemas/mappers and `parseSnapshot` to the new snapshot, mapping round fixture IDs from `playoff_round_id`; accept one assigned side independently while rejecting half-populated pairs; retain receipt validation, refresh, reset-generation, and stale-response protection in `mutateTournament<K extends keyof CommandPayloads>(operation: K, input: MutationInput<K>): Promise<MutationReceipt>`.
- [x] Update `src/domain/scoring.ts`, `src/domain/progression.ts`, and `src/domain/standings.ts` to the revised scoring and current-round resolver; remove advancement-draw resolution and `FinalistBasis = 'draw'`; retire `validateLineup`/`validateQualifyingRotation` from `src/domain/roster.ts` while retaining roster validation.
- [x] Update `src/domain/impacts.ts` and `src/features/organizer/ImpactPreview.tsx` to expose cleared placement pairs by match/side from the before/after snapshots rather than cleared lineups; retain authoritative preview/revision checks in `src/data/impacts.ts` and `src/features/organizer/ResultEditor.tsx`.
- [x] Replace `src/features/organizer/LineupEditor.tsx` with `src/features/scoring/PairAssignmentForm.tsx`, used by `ScoreTracker.tsx` and `OrganizerPage.tsx`; show per-team seed rule, four players with current-stage usage and playing markers, qualifying arrangement options, and pick-two selection elsewhere; validate each side, confirm organizer exceptions explicitly, and save through `assign_pair` using the current match version.
- [x] In `PairAssignmentForm.tsx`, derive usage from completed played matches in the stage, excluding walkovers; show qualifying usage out of three, and conditional available appearances for placement/free-playoff stages without imposing a new quota (playoff replays have no fixed total); exact Vietnamese wording is an execution-time copy choice, not an enforcement rule.
- [x] Update `src/App.tsx`, `src/features/scoring/ScoreTracker.tsx`, `src/features/organizer/OrganizerPage.tsx`, and `ResultSchedule.tsx` to offer assignment to both staff roles, remove lineup confirmation/reopening/rotation/substitution flows, retain setup and finalist confirmation, and show current-round play-on status instead of advancement drawing.
- [x] Update `src/features/tournament/labels.ts`, `FixtureCard.tsx`, `MatchTicket.tsx`, and `KnockoutBracket.tsx` to read saved pairs only, show assignment pending per missing side, display continuation fixtures and retained prior results, and retain only four-team matchup draw outcomes; publish no usage counts or exception markers.
- [x] Update `src/i18n/vi.ts`, `src/i18n/errors.ts`, and `src/i18n/errors.test.ts` for assignment, rule exceptions, server validation, and continuation status; retain the already merged `/rules` route in `src/main.tsx`, `RulesPage.tsx`, revised footer, and removal of collapsible rules from `TournamentPage.tsx`.
- [x] Update `src/domain/{roster,scoring,progression,standings,team-fixtures}.test.ts`, `src/data/{tournament,impacts}.test.ts`, and `src/features/scoring/scoring-state.test.ts` for removed contracts, asymmetric saved pairs, 21–20 third-place wins, two games per placement match, fixed finalists across rounds, correction consequences, and unchanged scoring retry behavior; update snapshot fixtures in `scripts/reset-tournament.test.ts` where required.
- [x] Add `tests/integration/pair-assignment.test.ts` covering referee/organizer/public authorization, forged exception flags, invalid pairs, concurrent assignment/start attempts, idempotency/version conflicts, placement gates, unchanged pre-start walkovers, round creation exactly once, historical-score exclusion, and correction invalidation of unstarted continuations; port `tests/integration/{round-robin-phase1,tournament,impacts,reset,auth}.test.ts` to the new contract without weakening retained scenarios, including preserved fixture identities/schedules after migration/reset.

**Phase gate (hard):**
- [ ] Run `npm run typecheck` project-wide.
- [ ] Run `npm run test:related -- <changed files>` with changed-file arguments derived from the phase diff; record Supabase setup failures as environment debt with non-database results, typecheck, and SQL review as substitute evidence.

**Review checklist (user, at PR review):**
- [ ] As referee, assign one side and see it immediately on a public page; save the other side, start, and verify assignments become fixed; same-seed qualifying pairs and qualifying player reuse are rejected.
- [ ] As organizer, explicitly confirm a seed/reuse exception; verify no public marker appears and duplicated or currently playing players remain blocked for both roles; doubled-up players can play only sequentially.
- [ ] Repeat the same qualifying arrangement across all three fixtures; verify no rotation or lineup-confirmation gate remains and each normal fixture uses all four players once.
- [ ] Finish third-place matches with two games to 15/21, including 21–20; verify the decider appears only at 1–1 and the final remains blocked until third place finishes; final pairs and placement decider pairs are unrestricted.
- [ ] Complete a tied mini round robin, then another tied replay, then a two-team continuation; verify new fixtures appear, prior results remain visible, only current-round scores rank the unresolved teams, and no advancement draw is offered.
- [ ] Confirm finalists before placement assignment; correct an eligible result changing participants and verify affected unstarted placement pairs clear; unchanged participants retain their pairs and started downstream dependencies block invalidating corrections.
- [ ] Reset progress and compare fixture identities, playing order, courts, roster, seeds, and tournament name; all remain while pair assignments and play progress clear.
- [ ] Open `/rules` directly on mobile: verify the three stage cards and subsequent rules match PLAN.md, no tournament data/navigation/staff access appears, the footer agrees, and the match list has no collapsible rules.

**On completion:** run the phase gate; run `fresh-review` when the recorded or actual-diff decision requires it; update STATUS + checkboxes; stop and ask before push/PR. Review checklist goes into the PR description.

## Spec gate (hard — once, before the final phase's PR)

- [ ] Run `npm run test` over the accumulated spec; expect prohibited local-Supabase setup failures, record passed/skipped counts and failed suites, and defer the blocked portion with typecheck, non-database tests, and SQL review as substitute evidence.
- [ ] Run `npm run build` to verify the integrated application and retained standalone rules entry point.
