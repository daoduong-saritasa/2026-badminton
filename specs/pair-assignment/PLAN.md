# Pair assignment and revised placement format

Status: approved. Ready for execution planning via the spec-plan skill.

## Purpose and scope

Apply the organizer's final tournament format. Two coupled changes ship
together:

1. Revise the pairing and placement rules: drop the qualifying rotation
   requirement, restructure the third-place fixture, and free final pairing.
2. Replace declared lineups with pair assignment: a team names its pair when a
   match is called, and a referee or the organizer records it before the match
   starts.

The second change is what makes the first coherent: free final pairing and a
free third-place decider only make sense without predeclared pairs.

## Relationship to the round-robin plan

`specs/round-robin-tournament/PLAN.md` remains the record of the round-robin
format. This plan supersedes these parts of it and leaves the rest in force,
including qualifying ranking criteria, qualification playoff formats and
triggers, the four-team matchup draw, walkovers, finalist confirmation, result
correction boundaries, stage gates, and manual scheduling:

- Every rule about declared lineups: lineup confirmation, lock, reveal, and
  exceptional reopening, for qualifying and placement fixtures.
- The mandatory qualifying rotation across both pairing arrangements.
- Predeclared unrestricted-seed playoff pairs.
- The predeclared recombined deciding pair, in both placement fixtures.
- The third-place format (BO1 matches to 21).
- The whole "Substitution" section.
- The blocking requirement that all four teams confirm lineups before
  qualification.
- The "Deferred discussion" item on the final deciding pair's seeds, which
  this plan resolves.
- The playing-time estimate for third place.
- The supervised draw that resolves a three-team mini round robin still tied
  after its ranking criteria.

## Confirmed decisions

### Format

- Qualifying is unchanged in shape: four teams, six fixtures, each fixture two
  simultaneous matches on two courts. Each match is one game to 21, win by two,
  capped at 30. A match win counts one, a loss zero. Ranking criteria are
  unchanged; tie resolution changes only as described below.
- Every qualifying pair combines one seed 1 and one seed 2 player, and each of
  a team's four players plays exactly once per fixture. Each player therefore
  plays exactly three qualifying matches; the app enforces the per-fixture
  rule and never needs a separate remaining-matches count.
- Drop the mandatory rotation. A team may use the same pairing in all three
  qualifying fixtures, or any mix of its two mixed-seed pairings.
- Qualification playoffs keep their format (BO1 to 11, win by two, capped at
  15). Pairs are assigned per match and may combine any two teammates. In a
  three-team mini round robin a team may change its pair between its matches.
- The third-place fixture goes to the first team to win two matches. Each
  match is best of three games to 15, win by two, capped at 21, where 21–20
  wins. Matches 1 and 2 are played simultaneously on the two courts with
  mixed-seed pairs. Match 3 is played only at 1–1 and its pair may combine any
  two teammates, including a pair that already played.
- The final goes to the first team to win two matches. Each match is best of
  three games to 21, win by two, capped at 30. Every final match allows any two
  teammates. Matches 1 and 2 are simultaneous, so they still use four distinct
  players through the existing rule against one player in two concurrent
  matches.
- Third place finishes before the final starts. This gate is unchanged.

- Advancement is never decided by lot. If a three-team mini round robin
  leaves teams tied after match wins, point difference, and points scored,
  the teams still tied play on: two teams play one playoff match, three teams
  replay the mini round robin, until a result separates them. Each extra match
  uses the playoff format and costs about six minutes; a replay is expected to
  be rare. The four-team tie keeps its supervised matchup draw, because both
  winners advance and the draw decides only opponents.

### Pair assignment

- No pair is declared in advance, in any stage. A team names its pair when the
  match is called; a referee or the organizer records it.
- Pairs are public as soon as they are saved. The app does not hide one team's
  pair until the opponent's is saved; the organizer handles that fairness
  manually if they want it.
- A match cannot start until both teams have a saved pair. A saved pair may be
  changed freely until the match starts; once it starts, its players are fixed,
  and a player who cannot continue produces a walkover as today.
- Pairs are saved per match. Validation of the per-fixture rule checks against
  the other match of the same fixture or round when that match already has a
  saved pair.
- Placement matches can receive pairs only once their participants are known,
  that is, after finalist confirmation.

### Enforcement

- A referee's pair assignment must satisfy the stage's pairing rule. The app
  rejects a same-seed pair where mixed seeds are required and a player reused
  within a qualifying fixture.
- The organizer may save a rule exception after an explicit confirmation. This
  covers an absent player, including a doubled-up player whose matches then
  run sequentially. Opponent agreement stays a human rule. Store no reason and
  no original pair, and show no public marker.
- Two safeguards bind everyone, with no override: the same player twice in one
  pair, and a player already in a match in progress.
- Substitution no longer exists as a separate concept: pair assignment covers
  it. Walkover rules are unchanged, including pre-start walkovers and the
  absence of double walkovers.

### Stage gates and corrections

- Remove the requirement that all four teams confirm lineups before
  qualifying. Qualifying play starts per match once both pairs are saved.
- Finalist confirmation still gates placement play. It no longer opens lineup
  entry.
- Wherever the round-robin plan clears placement lineups after a result
  correction, instead clear the saved pairs of every unstarted placement match
  whose participating teams changed. The correction boundaries themselves are
  unchanged.

### Assignment form

- The form is staff-only (referee and organizer). For each team it shows:
  - The stage's pairing rule in one line: mixed seeds for qualifying and
    third-place matches 1–2, free pairing for the third-place decider, the
    final, and playoffs.
  - Each of the four players with seed, matches played in the current stage
    out of those allowed, and a marker when the player is in a match in
    progress.
  - The eligible choices as one-tap options: in qualifying, the two valid
    pairings for the fixture; in free stages, a pick-two list.
- Public pages show only saved pairs. Before assignment, a match shows that its
  pairs are not yet assigned. Publish no remaining-matches information.
- Rename UI copy from _Đội hình_ to the glossary terms _Xếp cặp_ and
  _Ngoại lệ_ where it refers to pair assignment and rule exceptions.

### Published rules page

- Publish the rules as a standalone page at `/rules`, shared with players as a
  plain link. It shows only the rules: no tournament data, tab bar, staff
  access, or link back to the tournament. It ships ahead of the rest of this
  plan so the format can be announced before play.
- Lay the format out as one card per stage (qualifying, third place, final),
  each answering the same four questions in the same order: who plays, how the
  fixture is decided, how each match is scored, and the pairing rule. Follow
  with pair assignment, qualifying ranking, qualification playoffs, and
  walkovers.
- Word the ranking criteria so the head-to-head ones read as head-to-head:
  total qualifying match wins, match wins in head-to-head matches, point
  difference in head-to-head matches, point difference across qualifying.
- Remove the collapsible rules from the public match list; the rules page
  replaces it. Draw outcomes stay on the placement view.
- Until the rest of this plan ships, the page and the footer scoring line
  describe the new format while the app still enforces the old one. Nothing
  has been played, so this is acceptable only before play starts.

### Migration

- Nothing has been played in production; declared lineups exist.
- The deployment migration keeps the tournament name, teams, players, seeds,
  court count, fixtures, and their schedule (playing order and courts). It
  deletes all lineups, confirmations, predeclared playoff pairs, and match
  players. Do not rebuild fixtures: the qualifying and placement fixture shapes
  are unchanged.
- Reset progress follows the same rule: it keeps teams, players, seeds, court
  count, and fixtures with their schedule, and clears pair assignments.

### Playing time

- Estimate: about 10 minutes per game to 21 and 7 per game to 15. Worst case:
  qualifying 60, qualification playoff 0–20, third place 42, final 60, about
  182 minutes against a 180-minute booking, before warm-up and changeovers. The
  typical case is about 130 minutes.
- Accepted risk. Company games usually finish under 10 minutes. Add no cutoff,
  deadline, or shortened fallback.

## Derived from existing code, not open

- `gameRules` and `gamesToWinMatch` in `src/domain/scoring.ts` change for the
  third-place stage only: 15 capped at 21, two games to win a match.
- Tournament completion still derives from final positions; no new rule.
- Referee permissions widen to writing match players for unstarted matches,
  subject to the enforcement rules above. Organizer permissions add rule
  exceptions.

## Open for execution planning

- How rule exceptions are authorized at the database boundary, given that
  validation for referees must be authoritative server-side.
- Whether the lineup tables are dropped or left unused, subject to the
  migration decision that their data is deleted.
- How play-on rounds are modeled. The round-robin plan fixed the playoff
  fixture count by tie size (one, three, or two fixtures); a still-tied mini
  round robin now needs further playoff fixtures created on demand, possibly
  more than once, and the ranking must read only the latest round.
