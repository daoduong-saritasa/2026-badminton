# Qualifying schedule across two courts

Status: schedule agreed; implementation not started.

## Goal

Organize qualifying into three rounds, with one team fixture on each court.
Both matches of a fixture use the same court and run sequentially.
The next round opens only after both fixtures of the current round finish.

This distributes participation across all four teams in each round.
It does not guarantee equal rest in minutes or reduce the theoretical minimum duration.

This plan supersedes the qualifying timing and court allocation in `specs/pair-assignment/PLAN.md`.
Pairing rules, scoring, standings, qualification playoffs, and placement fixtures retain their existing behavior.

## Agreed schedule

A–D represent teams in setup order, not players, pairs, seeds, or standings ranks.

| Round | Court 1 | Court 2 |
|---|---|---|
| 1 | A–B: match 1, then match 2 | C–D: match 1, then match 2 |
| 2 | A–C: match 1, then match 2 | B–D: match 1, then match 2 |
| 3 | A–D: match 1, then match 2 | B–C: match 1, then match 2 |

The fixture order becomes **AB, CD, AC, BD, AD, BC**.
The schedule still contains six fixtures and twelve doubles matches.
At eight minutes per match, its theoretical duration is 48 minutes, excluding breaks and transitions.

## Decisions

- Use fixed round boundaries; do not allow a free court to start a later round early.
- Allow either court to start its fixture's second match immediately after its first match finishes.
- Store each qualifying fixture's assigned court and existing order position.
- Derive the round from the fixture position: positions 1–2, 3–4, and 5–6 form rounds 1, 2, and 3.
- Use one round-based qualifying format; the tournament has not started.
- Store `team_fixtures.qualifying_court` as court 1 or 2 for qualifying fixtures.
- Keep pair assignments independent between fixtures; do not store permanent pairs or assume player numbering determines pairs.
- Apply this format only to qualifying; retain qualification playoff and placement rules.
- Add no automatic rest timer or timed break requirement.

## Current behavior to replace

Qualifying currently generates the serial order **AB, AC, BD, AD, BC, CD**.
The snapshot publishes fixtures and matches using the stored fixture order.

Match creation currently assigns match 1 to court 1 and match 2 to court 2.
Staff can move individual unstarted matches between courts.
Starting a match checks court occupancy and player overlap, but does not enforce qualifying rounds or match sequence.

## Functional requirements

### Schedule generation and court assignment

- Generate the agreed order when the organizer saves a roster.
- Assign both matches of each qualifying fixture to its scheduled court when qualifying starts.
- Preserve fixture order and court assignments when staff reload the page or another device connects.
- Retain referee permission to change courts for eligible unstarted fixtures.
- Move both matches together when staff change a qualifying fixture's court.
- Keep the round's two fixtures on different courts.
- Support an atomic court swap before either fixture in that round starts.
- Lock a qualifying fixture's court after either of its matches starts or receives a result.

### Match and round progression

- Require match 1 to finish before match 2 of the same fixture starts.
- Require all four matches of every earlier round to finish before a later round starts.
- Count completed walkovers as finished matches without creating artificial scores.
- Preserve court occupancy, saved-pair validation, and player-overlap checks.
- Enforce eligibility in database commands, not only through disabled UI buttons.
- Serialize competing mutations so simultaneous requests cannot bypass a round boundary.
- Keep the next match's start manual; finishing a match must not start another automatically.

### Pair assignments

- Allow teams to select different pairs in different fixtures.
- Keep one seed 1 player and one seed 2 player per qualifying pair, subject to existing organizer exceptions.
- Keep the existing restriction on repeated player appearances within a qualifying fixture, subject to existing organizer exceptions.
- Allow staff to prepare later fixtures before their round opens, subject to existing player-availability rules.
- Keep saved pairs separate from permission to start a match.

### Public and staff screens

- Group qualifying fixtures by round and court.
- Show the current match and next match for each court.
- Preserve global fixture numbering when users filter by team.
- Use compact labels such as **Lượt 2 · Cặp đấu 3/6**, with match numbers underneath.
- Show a short start blocker only where staff need it, such as **Chờ lượt 1 kết thúc**.
- Keep score controls accessible on phones and preserve long-name wrapping.
- Update Vietnamese and English copy using the canonical terms in `CONTEXT.md`.
- Avoid duplicate stage headings, repeated team captions, and permanent instructional paragraphs.

### Reset and result correction

- Preserve fixture order and courts during **Reset progress**.
- Clear scores, results, and pair assignments through the existing reset behavior.
- Use the new format when a roster is saved and fixtures are regenerated.
- Retain the existing **Reset all** behavior.
- Review corrections that reopen an earlier round while later rounds have progress.
- Prevent new starts while a prerequisite is unfinished; preserve existing later results unless the correction workflow explicitly authorizes their removal.

## Migration and compatibility

Use a new migration rather than rewriting previously applied scheduling migrations.
Maintain `src/lib/database.types.ts` by hand to match the schema changes.
Expose scheduling metadata through validated DTOs and domain models.

Convert existing complete qualifying schedules only when no qualifying match has started or received a result.
Also exclude schedules with qualifying score records, even if a match appears unstarted.
Preserve team IDs, fixture IDs, match IDs, and pair assignments during conversion.
Update qualifying court assignments to the new fixture-level defaults.

Do not add a legacy scheduling format or a tournament format flag.
Reject migration if any qualifying match has started, has a result, or has score records.
**Reset progress** retains fixture order and courts; saving the roster regenerates the agreed schedule.

Protect conversion with the existing mutation lock.
Bump applicable fixture, match, and tournament versions so clients refresh and stale commands fail correctly.
Review effects on result-preview revisions when schedule data changes.
Make the conversion a no-op when the schedule already uses the new format.

## Implementation sequence

1. Define scheduling metadata, pure eligibility rules, and representative domain tests.
2. Add the migration for generation, default courts, progression enforcement, and compatibility.
3. Update DTO validation, database types, and domain mapping.
4. Update staff court controls, pair preparation, and start blockers.
5. Update public round grouping, court queues, and translated labels.
6. Verify migration, reset, correction, concurrency, and mobile behavior before deployment.

Persistent-data migrations require an independent fresh review under `specs/RULEBOOK.md`.
This plan does not authorize implementation, database deployment, commits, or pushes.
Create `EXECUTION.md` through the spec-plan workflow before phased implementation.

## Acceptance criteria

- Each team faces every other team exactly once and appears in each of the three rounds.
- Each round contains two fixtures, on separate courts, with two sequential matches per fixture.
- Match 2 cannot start before its fixture's match 1 finishes.
- Neither court can start round 2 before all four round 1 matches finish.
- The same barrier applies between rounds 2 and 3.
- Walkovers allow progression through the same barriers.
- Pair changes between rounds remain supported.
- Court swaps preserve fixture integrity and cannot split its matches across courts.
- Concurrent start requests cannot bypass match sequence or round boundaries.
- Conversion preserves match identity and pairing data, and rejects started tournaments.
- **Reset progress** preserves fixture order and courts.
- Public and staff views show the same current round, fixture order, and court queues on phones.

## Verification constraints

Run project-wide typechecking and dependency-aware tests during each implementation phase.
Run the full suite and production build at the final spec gate, following `specs/RULEBOOK.md`.

Do not start or reset local Supabase, generate local database types, or request Docker or OrbStack startup.
Do not run integration or end-to-end fixtures that clear a populated local tournament without explicit authorization.
When database checks cannot run, report the limitation and verification debt rather than claiming they passed.
Report test pass and skip counts together.

Review the public schedule, team filtering, court swaps, start blockers, pair changes, and scoring on mobile and desktop.
Include those scenarios in the implementation review checklist.
