# Four-player team tournament

Status: approved by the user on 2026-09-17. Ready for spec-plan; implementation has not started.

## Purpose and scope

Replace the existing fixed-pair tournament format with the four-player team
format for this event. Do not retain the old format as an additional mode.

## Confirmed decisions

- Require exactly sixteen distinct players in four teams. Each team has two
  seed 1 and two seed 2 players; a player cannot belong to multiple teams.
- Once group play starts, lock team membership, player seeds and group
  assignments for the entire tournament. Placement submissions may change
  pairings and match order, not the roster, seeds or group.
- Block group play until all rosters are valid, both groups contain exactly two
  teams, and all four group lineups are valid and confirmed.
- The organizer enters players and teams manually.
- Two groups contain two teams each. Group winners play the final; group losers
  play the third-place fixture.
- Once a decider starts, block corrections to opening results that would turn
  1–1 into 2–0 and invalidate the decider. Score corrections preserving opening
  match winners remain allowed, subject to tournament completion restrictions.
- Allow a group-result correction that changes advancement only before either
  placement fixture starts. Recalculate final and third-place participants and
  clear their lineup confirmations; require confirmation for the revised
  opponents before play. Once either placement fixture starts, block group
  corrections that would change advancement.
- Mark the tournament completed only after both the final and third-place
  fixture have confirmed outcomes, settling all four positions.
- After both group fixtures finish, automatically populate the final with
  group winners and third place with group losers. Block scoring for each
  placement fixture until both opposing lineups are confirmed; starts remain
  manual.
- Play third place before the final so spectators can watch both. Each placement
  fixture uses both courts for its first two matches, then one court for its
  deciding match if needed. The final starts after third place finishes.
- Each team fixture is first to two doubles-match wins. Each doubles match is
  best of three games.
- Every lineup submission includes pairs for matches 1, 2 and 3. Confirm and
  lock the deciding pair with the opening pairs before any fixture match starts;
  do not select it after seeing the first two results. It remains recorded even
  when match 3 is unnecessary.
- Enable match 3 only after both opening results are confirmed and the fixture
  is tied 1–1. At 2–0, mark match 3 unnecessary. Walkovers count as match wins.
  An organizer or referee starts an eligible decider manually.
- The referee confirms each game before the next game begins. Preserve each
  game’s score and display the match game-win tally. Confirming a pair’s second
  game win completes the doubles match.
- Group and third-place games are to 15 points, win by two, capped at 21.
  Final games are to 21 points, win by two, capped at 30. At either cap, a
  one-point margin wins.
- Each pair contains one seed 1 and one seed 2. The first two matches use disjoint
  pairs; the deciding match, if needed, uses a recombined pair.
- Each team submits and confirms its group lineup before group play.
- Finalists submit and confirm a fresh final lineup after qualifying, before
  the final begins. Final lineups are not locked before the tournament.
- Third-place teams also submit and confirm fresh lineups before their
  fixture. Every team therefore has two lineup submissions: group and placement
  (final or third place).
- If both pairs cannot play a match, leave it unresolved for an in-person
  organizer decision. Do not invent a winner or award opposing walkovers.
- Handle absences per match through manually recorded walkovers, without
  permanently withdrawing a team. Preserve results and allow the team to play
  its next fixture if available. Do not add a permanent team-withdrawal state.
- Remove the old withdrawal behavior that voided earlier group results.
  Preserve completed results; use match walkovers when a team cannot continue.
- If a player cannot continue after a fixture starts, do not substitute or
  edit the lineup. Award the opponent a walkover in each affected unresolved
  match without an artificial score. Preserve completed results and play
  unaffected matches normally; omit the decider if the fixture is already won.
- Once both opposing teams confirm and their lineups are revealed, lock both
  lineups. Before any match in the fixture starts, an exceptional correction
  requires reopening confirmation for both teams and reconfirming both lineups.
  Once the fixture starts, no lineup edits are allowed.
- The organizer can see draft lineups. Players and spectators see both
  opposing lineups only after both teams confirm; reveal them together.
- The organizer enters and confirms lineups in the app after obtaining each
  captain’s confirmation outside the app. Do not add captain accounts or a
  captain-facing submission flow. Organizer access must now be separated from
  referee scoring access.
- Block starting a match if its assigned court is occupied by another active
  match or any participating player is already in another active match.
- The organizer manages match timing, rest and playing order in person. The
  app provides manual match starts, court assignments, participating pairs and
  score tracking; do not add enforced rest timers, scheduled starts or a clock
  enforcing the event order.
- Two courts are available for three hours on one day. Assume no extension
  beyond the booking.
- Prioritize normal BO3 completion over match-slot deadlines. Shorten planned
  breaks to recover time when possible. Treat three hours as a planning target,
  not an app-enforced guarantee.
- Assume the event finishes within the booking. If it overruns, the organizer
  handles it in person. The app does not enforce time cutoffs or determine
  winners from elapsed time; normal scoring remains available.
- Replacement scope was explicitly confirmed during the interview.
- Start with fresh tournament data. The user will run Reset all before
  implementation proceeds. Do not migrate existing event results into the new
  format. Schema changes still require forward migrations; this decision does
  not authorize a database reset or removal of migration history.
- Canonical names: Team (Đội) is a four-player roster; Pair (Cặp) is a
  two-player pairing selected for a doubles match.
- Team fixture (Cuộc đối đầu) contains up to three doubles matches; Match
  (Trận) is a BO3 doubles contest; Game (Ván) is one game within that match.

## Access roles

- Public viewers can view published tournament information and live scores;
  they cannot start or score matches.
- Use separate organizer and referee PINs. Share the organizer PIN only with
  the small organizing group and the referee PIN with attendees at the venue.
- Organizers manage setup, lineups, courts, fixtures and result corrections,
  and can also score matches. Existing maintenance-only reset access remains
  separate; an organizer PIN does not grant maintenance credentials.
- Referees can start eligible matches, score, undo points and confirm games.
  They cannot change courts, fixtures, pairings or organizer settings, and
  have no access to organizer controls or hidden draft lineups.
- Enforce permissions server-side, not only through navigation visibility.
- Check referee eligibility (not playing the match) in person. Shared PINs
  do not verify player identity; do not add player accounts.
- Keep one active scorekeeper per match. Any authorized referee or organizer
  can explicitly confirm Take over scoring when the current scorer cannot
  continue. Atomically transfer ownership, preserve the authoritative score
  and game history, immediately revoke the previous session’s scoring access,
  and record the handover. Reject late writes from the former owner.
- Referees can resume matches they already own. Takeover does not grant
  organizer permissions.

## Existing behavior to retain

Preserve existing live-update, scoring recovery and maintenance-reset features,
adapting them to the new format. Replace pair standings with team-fixture
results and final positions; add roster and lineup controls without unrelated
redesign. The referee role replaces the existing single shared staff authorization
model with separate organizer and referee access.

## Match-start prerequisites

Require an authorized organizer or referee, confirmed and locked opposing
lineups, known participants, an assigned free court and no participating player
in another active match. A decider also requires two confirmed opening results
at 1–1. Retain the existing ownership and mutation safeguards. Timing, recovery
and the preferred third-place-before-final order remain in-person decisions,
not additional app-enforced gates.

## Acceptance review

1. Invalid team sizes, seed splits, duplicate roster membership or group splits
   prevent group play. All four group lineups must be confirmed.
2. Each submission includes three legal pairs. The first two cover all four
   players; the third recombines them and cannot repeat an opening pair.
3. Public viewers and referees cannot read draft lineups through either the UI
   or the data API. Both opposing lineups become public together after confirmation.
4. Placement lineups are submitted afresh. Reopening an unstarted fixture’s
   lineup requires both teams to reconfirm; started fixtures prohibit edits.
5. Games at 15–14 or 21–20 do not end below the relevant cap. Group and third-place
   games can end 21–20; final games can end 30–29. Two confirmed game wins finish
   a match, preserving all game scores.
6. A confirmed 1–1 enables the submitted decider; 2–0 leaves it recorded but
   unnecessary. Walkovers count as wins without invented point scores.
7. Group outcomes populate both placement fixtures. Completing only one
   placement fixture does not complete the tournament.
8. Conflicting court or player use blocks a start. Manual starts impose no
   scheduled time or rest countdown.
9. Correction cannot invalidate an already-started decider or change advancement
   once a placement fixture has started. Earlier advancement corrections clear
   placement lineup confirmations.
10. Absences preserve completed results and do not permanently withdraw a team.
    If both pairs are unavailable, the match remains unresolved.
11. Referee credentials cannot mutate organizer data or grant organizer access.
    Public access cannot score. A confirmed takeover preserves results and
    rejects subsequent writes from the previous scorekeeper.
12. Existing reload recovery, live updates, conflict handling and maintenance
    reset protections continue to work with teams, lineups and per-game scores.

## Execution planning boundaries

Plan the tournament model and referee authorization as distinct workstreams
within this replacement spec. Both must be ready for the event. Follow the
project rulebook for phase gates and required independent review of persistent
migrations and authorization changes. Do not implement or reset data during
this interview.

Retain existing access expiry, revocation and rate-limiting protections while
adapting them to the two roles. Concrete role-grant, PIN rotation, migration and
API contracts belong in execution planning; they must not allow old broad staff
grants to bypass the new role boundaries.

No capability-baseline section is enabled in the project rulebook, so this plan
does not introduce a capability baseline or Spec Delta.

## Delivery and verification priorities

Implement quickly with the smallest coherent change. Avoid unrelated refactors,
extra abstraction, cosmetic redesign and optional workflow overhead.

- Do not add UI component, layout, screenshot or browser-driven tests for this
  feature. The user performs manual UI verification. Do not call browser tools
  or launch browser-based UI checks.
- Focus automated tests on critical behavior: roster and lineup validation,
  scoring targets and caps, BO3 completion, decider eligibility, progression,
  correction restrictions, walkovers, role authorization, hidden lineup access,
  ownership transfer and court/player concurrency.
- Preserve existing tests; do not delete or weaken them to achieve a green gate.
  UI tests already in the configured suites may still run.
- Retain project-wide typechecking and relevant logic tests. Run the rulebook’s
  final suite and applicable build once, without redundant reruns absent changes
  or failures. Required review of authorization and durable-data changes remains
  necessary; omit optional review and CI monitoring.
- Follow the local Supabase restriction: do not start containers, reset the local
  database or generate local database types. Maintain database types by hand.
  Report database integration failures and skipped scenario counts honestly;
  do not describe that gate as passing.
- Carry the user’s UI acceptance checklist into the final review materials rather
  than treating manual visual checks as agent verification debt.

## Final review

The user confirmed the consolidated scope and lean verification approach on
2026-09-17. The grill is complete and this plan is ready for the spec-plan
workflow. No application changes, reset, commits or deployment were performed
during this interview.

## Scheduling constraint

The revised placement order requires up to seven sequential court waves:
three group waves, two third-place waves and two final waves. The first two
matches of each placement fixture run simultaneously on separate courts; its
decider follows after recovery. At the previous 25-minute allocation, seven
waves consume 175 minutes before briefing, breaks or awards.

Three hours remains a planning target, not an app-enforced deadline. Overruns
are handled in person. The user prioritizes finishing BO3 matches normally
and permits shortening breaks, while assuming no court extension. Time budgets and player recovery are handled
in person, not enforced by the app. The playing sequence is an event plan rather than a timed app workflow.
