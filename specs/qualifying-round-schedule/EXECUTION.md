# Qualifying round schedule — Execution plan

Spec: [PLAN.md](PLAN.md). Rulebook: `specs/RULEBOOK.md`.
Integration branch: `main`. Branch model: stacked via `gh stack` (default).

## STATUS

- Current phase: 1 — in-progress
- Phase 1 — Round schedule: in-progress
- Verification debt: none

## Phase 1 — Round schedule

Branch: `qualifying-round-schedule/phase-1-rounds` (stacked: `gh stack init -b main`)

One phase delivers the database contract and every consumer of the qualifying schedule together.

Produces: `TeamFixture.qualifyingOrder: number | null`, `TeamFixture.qualifyingCourt: Court | null`; `qualifyingRound(fixture: TeamFixture): number | null`; `qualifyingStartBlocker(snapshot: TournamentSnapshot, match: FixtureMatch): 'sequence' | 'round' | null`; `qualifyingCourtAssignments(snapshot: TournamentSnapshot, match: FixtureMatch, court: Court): CourtAssignment[]`.

Fresh review: required — persistent-data migration and durable mutation rules.

- [x] Add metadata in `src/domain/types.ts`; implement round eligibility, court locking, swaps, and queues in `src/domain/qualifying-schedule.ts`; cover barriers, walkovers, missing matches, corrections, court swaps, and pair changes in `src/domain/qualifying-schedule.test.ts`; update typed fixture factories.
- [x] Add `supabase/migrations/202610080004_qualifying_round_schedule.sql`: guarded conversion preserving identities/pairs, fixture court constraints, roster generation, `private.sync_fixture_matches`, `private.team_start_match`, and atomic fixture court swaps in `private.team_assign_courts`; retain reset and correction contracts.
- [x] Maintain `src/lib/database.types.ts` by hand; validate/map metadata in `src/data/tournament.ts`; cover valid and malformed scheduling DTOs in `src/data/tournament.test.ts`; update `src/data/impacts.test.ts` DTO fixtures.
- [ ] Update `src/features/tournament/labels.ts`, `src/features/scoring/CourtSelect.tsx`, `src/features/scoring/MatchPickerView.tsx`, and `src/features/organizer/OrganizerPage.tsx` for round labels, start blockers, fixture swaps, and locked courts; preserve future pair preparation.
- [ ] Group public fixtures and court queues in `src/features/tournament/TournamentPage.tsx` and `src/features/tournament/FixtureCard.tsx`; translate round labels, blockers, and qualifying rules in `src/i18n/vi.ts`, `src/i18n/en.ts`, and `src/i18n/errors.ts`; remove obsolete simultaneous-qualifying claims in `src/domain/pair-assignment.ts`.
- [ ] Add transactional SQL regression scenarios in `tests/sql/qualifying-round-schedule.sql` for generation, conversion, progression, walkovers, swaps, reset, and stale versions; document concurrency review evidence.

**Phase gate (hard):**
- [ ] `npm run typecheck`.
- [ ] `git diff --name-only --diff-filter=ACMR main...HEAD -z | xargs -0 npm run test:related --` (database suites may be environment-blocked; record pass/skip counts and substitute non-database evidence).

**On completion:** run the phase gate; run `fresh-review`; update STATUS + checkboxes; stop and ask before push/PR.

- [x] (amended 2026-10-08) Update `src/features/guide/guide-data.ts` and `src/features/guide/guide-state.ts` illustrative scheduling metadata and qualifying courts.

## Spec gate (hard — once, before the final phase's PR)

- [ ] `npm run test` (database fixtures clear tournament data; do not elevate or run against a populated stack without authorization; record environment debt).
- [ ] `npm run build`.
