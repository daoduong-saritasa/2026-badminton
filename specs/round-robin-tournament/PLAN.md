# Round-robin team tournament

Status: approved. Ready for execution planning via the spec-plan skill.

## Purpose and scope

Replace the current two-group team tournament with a four-team round robin
and a final. Do not retain the current format as a selectable mode.

## Confirmed decisions

- Replace the existing format entirely rather than supporting multiple modes.
- Rank qualifying teams by these criteria in order:
  1. Total match wins.
  2. Match wins among tied teams.
  3. Point difference among those teams.
  4. Overall point difference.
  5. A playoff if qualification remains unresolved.
- Point difference may decide qualification without a playoff when an earlier
  ranking criterion resolves the tie.

- If exactly two teams remain tied for the last final spot after all ranking
  criteria, play one BO1 playoff game to 11, win by two, capped at 15.
  At the cap, a one-point margin wins.
- Each team declares its playoff pair before qualification begins. This pair
  may contain any two distinct teammates, including two seed 1 players or two
  seed 2 players; mixed seeds are not required for qualification playoffs.

- If three teams remain tied across the qualification cutoff, play a mini
  round robin using their predeclared unrestricted-seed playoff pairs. Each pair faces
  the other two: three sequential BO1 matches to 11, win by two, capped at 15.
- Rank that playoff by match wins, then point difference, then points scored.
  If a qualification tie remains, resolve it by a supervised draw.
  Advance one or two teams according to the available final places.

- If all four teams remain tied after all qualifying ranking criteria, draw
  two playoff matchups and play them simultaneously on two courts. Use the
  predeclared unrestricted-seed playoff pairs: BO1 to 11, win by two, capped at 15.
  Both winners advance to the final.

- Keep the original set of teams tied on total qualifying match wins fixed
  when calculating head-to-head criteria. Apply the criteria once in order;
  do not restart on a smaller subset after some teams separate.
- When the ranking criteria leave teams tied and nothing depends on the tie,
  show them at the same rank with a marker saying the criteria did not
  separate them, and sort those rows by team name for a stable table. Do not
  play a playoff or hold a draw purely to order the standings: final ranks
  come from the final and the third-place fixture.
- Publish scoring, ranking criteria, playoff rules, and draw results for players.
  Show live standings with match wins, points scored, points conceded, and
  point difference. Explain the criterion separating tied teams and distinguish
  provisional standings, required playoffs, and confirmed finalists.
- Let any viewer filter the public schedule to one team, chosen from a
  selector with no account or login, to see that team's fixtures, opponents,
  stage, and court. The filter respects the lineup reveal: before all four
  teams confirm, it shows the opponent but not the pairs.
- Rules are public before play. Keep qualifying lineups hidden from players
  until all four teams have confirmed and locked their qualifying lineups;
  reveal all qualifying lineups together. The organizer can prepare lineups
  before this reveal, consistent with the existing staff workflow.

- Every rule below about mixed seeds, using each player once, mandatory
  rotation, and locked lineups describes the *declared* lineup. A substitution
  changes the players of one match without changing any declared lineup, and
  is bound only by the two safeguards listed under substitution.
- Qualifying pairs must mix seeds and use all four players once per fixture.
  Across three qualifying fixtures, each team must use both disjoint mixed-seed
  pairing arrangements. The team chooses which arrangement to repeat and its
  match order against each opponent before lineup lock.

- Keep the final deciding pair mixed-seed and different from both opening
  pairs. Unrestricted-seed pairs apply only to qualification playoffs in this
  change.

- Represent qualification playoffs in the app and score them through the
  existing scoring workflow. Determine the required playoff format from the
  unresolved qualification tie. Let the organizer record drawn matchups when
  needed. Publish playoff scores and supervised-draw outcomes so players can
  trace advancement.

- A qualifying walkover counts as a match win but contributes no points
  scored or conceded to ranking calculations. Do not invent a score. Calculate
  point differences from completed, played matches only. Explain publicly that
  walkovers can leave teams with different numbers of scored games.

- Require organizer confirmation of finalists after qualifying standings and
  any required playoffs or supervised draws are resolved. Show the proposed
  finalists and why each qualified before confirmation; public qualification
  remains provisional until confirmed.
- Only after finalist confirmation may the finalists submit fresh final
  lineups. Block final play until confirmation and valid final lineups.

- Before either placement fixture starts, a result correction that changes
  placement participants revokes qualification confirmation and clears both
  placement lineups. Recalculate
  qualification, resolve any newly required playoff, and require organizer
  confirmation again before the teams submit fresh placement lineups.
- Once either placement fixture starts, block result corrections that would
  change participants in either placement fixture. Corrections preserving
  placement participants remain allowed subject
  to existing tournament-completion restrictions.

- Once any qualification playoff match starts, block qualifying-result
  corrections that would change the playoff participants, format, or number
  of available final places, including making the playoff unnecessary.
- Before any playoff match starts, recalculate the playoff after such
  corrections and clear obsolete matchup draws. Corrections that leave the
  playoff valid remain allowed, subject to later-stage restrictions.

- Correct playoff results under the same boundary as qualifying results.
  Allow a correction until a placement fixture starts; after that, block it
  when it would change who plays in the final or the third-place fixture, and
  allow it otherwise. A correction that changes a playoff outcome revokes
  finalist confirmation and clears both placement lineups, exactly as a
  qualifying correction does.
- Allow the organizer to re-record a supervised draw while it still decides
  something. If matchups from that draw have already been played, correcting
  the draw invalidates those playoff results and the organizer replays them;
  never relabel a played score onto a team that did not play it.
- Correcting one game of a three-team mini round robin after later games are
  played changes the ranking, not the matchups. Keep those results and
  recalculate; do not replay.

- The two non-finalists play a third-place fixture: first to two match wins,
  each match BO1 to 21 points. Matches 1 and 2 use disjoint mixed-seed pairs
  on two courts. At 2–0, the fixture ends and match 3 is unnecessary. At 1–1,
  play match 3 using a predeclared recombined mixed-seed pair.
- The third-place winner finishes third and the loser fourth. This supersedes
  the proposal to assign third and fourth from qualifying standings.

- Finish the third-place fixture before the final starts. This gives finalists
  a rest and lets participants watch the final. Block final starts until the
  third-place fixture has a confirmed outcome.
- Estimated playing time on two courts, at ten minutes per 21-point game and
  six per 11-point game: qualifying 60 minutes, qualification playoff 0–20,
  third place 10–20, final 30–60. Total 100–160 minutes against a 180-minute
  booking, excluding warm-up, changeovers, rest, and lineup confirmation.
- Accept that the worst case runs close to the booking. Add no enforced cutoff
  or match deadline: the schedule is manual, so the organizer manages the clock.
  Keep the final at BO3 per match rather than shortening it for insurance.

- After qualification confirmation, both finalists and both third-place teams
  submit fresh three-pair lineups, including their conditional deciding pair.
  Reveal and lock each placement fixture's lineups only when both opponents
  confirm; do not wait for confirmation from all four teams.

- Before any qualifying match starts, the organizer may exceptionally reopen
  locked qualifying lineups. Require all four teams to reconfirm before play.
  Once any qualifying match starts, all qualifying lineups and predeclared
  playoff pairs remain locked.
- Before a placement fixture starts, exceptional lineup reopening requires
  both opponents to reconfirm. Once it starts, its declared lineup is fixed
  and cannot be edited.
- Substitution nonetheless follows the match boundary, not the fixture
  boundary: the organizer may substitute into a placement fixture's match 3
  before that match starts, including a final standing at 1–1. Without this,
  a player leaving during match 1 would decide the tournament by walkover
  rather than by play. Once a match starts, its players are fixed.

- Show a recommended six-fixture qualifying schedule, but allow the organizer
  to change playing order and court assignments. Keep match starts and rest
  timing manual; do not enforce rest timers or scheduled start times.
- Prevent occupied-court starts and simultaneous matches involving the same
  player. Enforce stage gates: qualification and required playoffs must be
  resolved and confirmed before placement play, and third place must finish
  before the final starts.

- The deployment migration performs the format transition, once. It deletes
  old fixtures, matches, lineups, confirmations, and group assignments, and
  builds the six qualifying fixtures, the third-place fixture, and the final.
  It preserves the tournament name, teams, players, seeds, and court count.
  Never reinterpret existing group results as round-robin results.
  This supersedes the earlier decision that the organizer resets to transition:
  between deploying the new code and an organizer reset, the database would
  hold group-shaped rows the new code cannot render, for no benefit.
- Reset stays a maintenance operation with no UI entry point, so this change
  does not redefine it. Its `progress` mode must stop retaining group
  assignments and rebuild fixtures for the new format, but that is migration
  work, not a new organizer-facing capability.

- Block qualification until all four teams confirm three qualifying lineups
  and one unrestricted-seed playoff pair each. Lock and reveal qualifying
  lineups and playoff pairs together after every team confirms.

## Substitution

- An unavailable player does not force an automatic walkover. Before a match
  starts, the organizer may change that match's players. This supersedes the
  blanket no-substitution rule; routine lineup editing stays locked.
- A substitution applies in every stage: qualifying, qualification playoffs,
  third place, and the final, including a placement fixture's match 3 while
  the fixture is already under way. Once a match starts, its players are fixed
  and a player who cannot continue produces a walkover.
- Substitutes come from the team's existing four-player roster only. Never add
  an outside player or change roster membership.
- A substitution may assign any two distinct players from that roster. Only
  two safeguards block it: the same player twice in one pair, and a player
  already in a match that is in progress. Same-seed pairs, a player appearing
  in both matches of one fixture, and a decider pair repeating an opening pair
  are all permitted. Play a doubled-up player's matches sequentially.
- A same-seed pair requires the opposing team's agreement on court. That stays
  a human rule; the app does not record or enforce it. Qualification playoff
  pairs already permit any seed combination, so they need no agreement.
- A substitution changes one match's players and nothing else. Declared
  lineups for later matches stand. The opponent's confirmed lineup stands and
  needs no new confirmation. Check the qualifying rotation requirement once
  against the declared lineups at lock time; never recompute it from
  substituted matches.
- Build no audit record: no reason field, no stored original pair, no recorded
  agreement. The organizer edits the match's players, and the site shows the
  players currently assigned to that match.
- When a team cannot field two players for a match that has not started, add
  no new status. The organizer either plays that match later, since order is
  manual, or records a walkover: a match win to the opponent with no points.
  Walkovers therefore apply before a match starts as well as mid-match, in
  every stage, including a BO1 qualification playoff that then decides a final
  place without play.
- If neither team can field a pair, leave the match unstarted and record
  nothing. There is no double walkover and no separate unresolved state.

## Deferred discussion

- Reconsider whether the final deciding pair may use any seed combination
  after the round-robin format change is complete. This is not an implementation
  option or a blocker for this spec; retain the mixed-seed rule for now.

## Base format — confirmed

- Four teams, each containing two seed 1 and two seed 2 players.
- Each team faces every other team once: six qualifying team fixtures.
- Each qualifying fixture contains two BO1 doubles matches. Both pairs mix
  seeds, and each team's four players appear exactly once.
- Qualifying fixtures may finish 1–1. Rank teams by total match wins.
- The top two teams play a final: first to two match wins, each match BO3.
  Preserve mixed-seed pairs and a predeclared recombined deciding pair.
- Game rules per stage:
  - Qualifying: 21 points, win by two, cap 30.
  - Qualification playoff: 11 points, win by two, cap 15.
  - Third place: 21 points, win by two, cap 30.
  - Final: 21 points, win by two, cap 30.
  This raises qualifying and third place from the current 15/21 to 21/30, and
  replaces the `group` stage with `qualifying` and `qualification-playoff`.
- Two courts and a three-hour booking. Ten minutes per 21-point game is a
  planning assumption, not a maximum or an enforced match deadline.

## Derived from existing code, not open

- Completion needs no new rule: `isTournamentComplete` derives from
  `finalPositions`, which requires both a final and a third-place winner.
  Third place finishes first, so the tournament completes when the final ends.
- Placement scheduling is settled by the confirmed stage gates.

## Implementation decisions (resolved at execution planning)

- Qualification standings are authoritative in SQL, mirrored in TypeScript for
  display, matching the existing split between `private.populate_placement_fixtures()`
  and `src/domain/progression.ts`. The five ranking criteria exist twice and
  must agree.
- Model each qualification playoff pairing as its own fixture at stage
  `qualification-playoff` with one match: one fixture for a two-team tie,
  three for a three-team mini round robin, two for a four-team tie. Drop the
  fixture uniqueness constraints that assume one fixture per stage.
- Store pairs as generic `player_1_id` / `player_2_id` in `public.matches` and
  `private.lineups`, with a check that they differ. Seed rules move entirely
  into validation: mixed-seed for declared lineups, unrestricted for playoff
  pairs and substitutions.
- Add no new tables. A supervised draw is the organizer setting `team_a_id` /
  `team_b_id` on playoff fixtures; a predeclared playoff pair is a fourth
  lineup row, widening `match_number` to 1..4.
