# Tournament backlog improvements — Execution Plan

Spec: [PLAN.md](PLAN.md). Rulebook: `specs/RULEBOOK.md`.
Integration branch: `main`. Branch model: stacked via `gh stack` (default); extension 0.1.1 and repository stacks API confirmed available on 2026-09-15.

## STATUS

- Current phase: 2 — in-progress
- Phase 1 — Flexible pair count and courts: done-with-debt
- Phase 2 — Tournament reset: in-progress
- Phase 3 — Results and withdrawals: pending
- Phase 4 — Vietnamese translation: pending
- Phase 5 — Application icon and title: pending
- Verification debt: Phase 1 and Phase 2 local database type generation and Phase 1's 19 selected integration scenarios are blocked because `/Users/thomasduong/.orbstack/run/docker.sock` is absent; `src/lib/database.types.ts` carries a schema-derived fallback, while project-wide typechecking and non-database related tests provide substitute evidence. Never target production for integration tests.

## Phase 1 — Flexible pair count and courts

Branch: `backlog-improvements/phase-1-flexible-setup` (stacked: `gh stack init -b main backlog-improvements/phase-1-flexible-setup`; announce that initialization enables `git rerere`).

Keep schema, domain validation, fixture generation, and UI together so the expanded format ships as one usable backlog item.

Consumes: existing `Pair`, `Fixture`, `SetupInput`, `TournamentSnapshot`, `MutationInput<K>`, and `MutationReceipt`.
Produces: `CourtCount = 1 | 2`; `Tournament.courtCount: CourtCount | null`; `SetupInput.courtCount: CourtCount | null`; `generateFixtures(pairs: readonly Pair[], courtCount: CourtCount): Fixture[]`; `isValidGroupSplit(pairs: readonly Pick<Pair, 'group'>[]): boolean`; `availableCourts(courtCount: CourtCount | null): readonly Court[]`; `CommandPayloads.set_court_count: { courtCount: CourtCount }`.

Fresh review: required — persistent-data migration, durable scheduling writes, and integration-test dependency wiring; re-review passed with no P0–P2 findings on 2026-09-15 after one P1 correction

- [x] In `src/domain/types.ts`, `src/domain/commands.ts`, and new `src/domain/setup.ts`, implement the phase 1 contracts in PLAN.md → “Schema, API, and frontend changes”; add `src/domain/setup.test.ts` for 4–10 pairs, either larger group, invalid splits, and explicit court choices.
- [x] Update `src/domain/fixtures.ts` and `src/domain/fixtures.test.ts` for every accepted split and both court counts; assert unique group pairings, totals 5/7/9/12/15/19/23, per-court order uniqueness, existing rest heuristic, and semifinal/final ordering.
- [x] Add `supabase/migrations/202609150001_flexible_setup.sql`: nullable checked `tournament.court_count`, existing-row backfill to 2, extended snapshot/setup validation, selected-court fixture generation, and versioned `set_court_count`; reject inactive-court assignment/start, active-Court-2 reduction, and reassignment of started matches.
- [x] In that migration, reduce courts atomically by appending Court 2's unstarted queue beyond Court 1's maximum occupied order, preserving relative order and historical assignments; increasing count preserves queues; retain locking, idempotency, pair exclusivity, and fixture dependency checks.
- [~] Update `src/data/tournament.ts`, `src/data/tournament.test.ts`, and `src/lib/database.types.ts` for `court_count` and `set_court_count`; regenerate types using `npm exec supabase -- gen types typescript --local` when local services are available, recording blocked generation rather than claiming generated types. Blocked on 2026-09-15: local Supabase cannot connect because `/Users/thomasduong/.orbstack/run/docker.sock` is absent; schema-derived fallback updated and data tests pass.
- [x] Update `src/features/organizer/SetupForm.tsx` to preserve existing group assignments on add/remove, allow 4–10 pairs, enforce valid Save setup, and require explicit courts before fixture generation; update fixture/sample setup objects in `src/data/tournament.test.ts`, `src/domain/standings.test.ts`, and `tests/integration/tournament.test.ts` for the new contracts.
- [x] Update `src/features/organizer/OrganizerPage.tsx`, `src/features/tournament/TournamentPage.tsx`, and `src/features/scoring/ScoreTracker.tsx` to use selected courts, expose court-count changes, and reset stale schedule drafts after authoritative changes; retain visibility of historical Court 2 matches after reduction.
- [~] In `tests/integration/tournament.test.ts`, verify accepted/rejected setup, both court counts, queue reduction/increase, historical-court preservation, version conflicts, duplicate requests, concurrent start/reassignment, and final dependencies against local Supabase. Blocked on 2026-09-15: all 19 selected scenarios were discovered but skipped because `/Users/thomasduong/.orbstack/run/docker.sock` is absent; project-wide typechecking and non-database related tests are substitute evidence only.
- [x] Add `tests/integration/sql.d.ts` declaring `*.sql?raw`; import and use the new migration in `tests/integration/tournament.test.ts` as fixture evidence, so Vitest's reverse dependency selection includes integration tests for SQL changes; do not treat text assertions as a substitute for live database scenarios.
- [x] Adjust affected setup/schedule markup and `src/App.css` or `src/index.css` for PLAN.md → “Responsive requirements across phases”; retain usable controls and full-name access on narrow screens.
- [x] Correct `start_scoring` in `supabase/migrations/202609150001_flexible_setup.sql` to read the tournament's court configuration without comparing the independent match version to the tournament version (amended 2026-09-15).

**Phase gate (hard):**

- [x] Run `npm run typecheck` project-wide.
- [~] Run `npm run test:related -- <changed files>` using paths from the real phase diff; local Supabase is required for selected integration tests, with environment-blocked results handled under the STATUS debt rules. On 2026-09-15, 54 non-database tests passed and 19 selected integration tests were skipped because `/Users/thomasduong/.orbstack/run/docker.sock` is absent.
- [x] Re-run the complete phase gate after the fresh-review correction: project-wide typecheck passed; 54 non-database related tests passed and the same 19 integration tests remained environment-blocked (amended 2026-09-15).

**Review checklist (user, at PR review):**

- [ ] Configure four and ten pairs, test both orientations of nine pairs, and verify the draw stays intact while editing; generate on one and two courts.
- [ ] Add Court 2 without reordering, attempt reduction during Court 2 play, then reduce after completion and inspect queue/history; check semifinal-to-final flow.
- [ ] Inspect 320px phones, larger phones, tablet, and desktop, including landscape, long names, touch controls, safe areas, and keyboard-open setup dialogs.

**On completion:** run the phase gate; run `fresh-review` when the recorded or actual-diff decision requires it; update STATUS + checkboxes; stop and ask before push/PR. Review checklist goes into the PR description.

## Phase 2 — Tournament reset

Branch: `backlog-improvements/phase-2-reset` (stacked: `gh stack add`).

Ship the maintenance operation with request isolation and client recovery so resetting cannot revive pre-reset play.

Consumes: `Tournament.courtCount`, `SetupInput.courtCount`, `CommandPayloads.set_court_count`, and phase 1 fixture generation.
Produces: `TournamentState = { resetGeneration: number; snapshot: TournamentSnapshot | null }`; `fetchTournament(): Promise<TournamentState>`; required `MutationInput<K>.resetGeneration` and `MutationReceipt.resetGeneration`; `set_reset_enabled(p_enabled boolean)` and `reset_tournament(...)` per PLAN.md → “Phase 2 contracts”.

Fresh review: required — destructive operations, privileged authorization, persistent audit migration, and stale-request recovery

- [x] Add `supabase/migrations/202609150002_maintenance_reset.sql` with private `maintenance_state`, generation-aware `mutation_log` migration and explicit maintenance actors per PLAN.md; preserve staff logs, staff request/session uniqueness, PIN configuration, grants, and auth sessions.
- [x] In that migration, implement service-role-only `set_reset_enabled` and `reset_tournament` with the exact PLAN.md signatures; validate mode, target ID/name/version/generation, disable flag by default, use the shared transaction lock, retain reset receipts for safe retries, and atomically reset/log/disable without weakening staff authorization.
- [x] Implement progress reset preserving fixtures and schedule but clearing play/ownership/ties/withdrawals/knockout participants and setup lock; scope undo history to the current generation while preserving old audit rows. Implement all reset removing fixtures, pairs, players, and tournament in FK-safe order while retaining maintenance state and staff access.
- [x] Extend every tournament mutation RPC, `private.replay_mutation`, `private.store_mutation`, and undo selection in the new migration with required generation checks before replay; remove unsafe old overloads; test missing-generation requests fail and old requests cannot recreate setup after Reset all.
- [x] Extend `get_tournament_snapshot()` to return generation even with no tournament; add `public.tournament_generation` per PLAN.md, update it transactionally, grant read-only browser access, and add it to the existing Realtime publication without exposing the private enable flag.
- [~] Update `src/domain/types.ts`, `src/domain/commands.ts`, `src/data/tournament.ts`, `src/data/tournament.test.ts`, and `src/lib/database.types.ts` for `TournamentState`, generation-bound requests/receipts, identity-scoped version tracking, empty snapshots, reset notification, reconnect recovery, and discarded late responses; regenerate local database types when available. Client contracts, migration-derived fallback types, and data tests are complete; CLI generation remains blocked by the absent `/Users/thomasduong/.orbstack/run/docker.sock` recorded in STATUS.
- [x] Update `src/App.tsx`, `src/features/organizer/SetupForm.tsx`, `src/features/organizer/OrganizerPage.tsx`, `src/features/organizer/ResultEditor.tsx`, and `src/features/scoring/ScoreTracker.tsx` to carry the observed generation into actions and remount stale forms when it changes; empty setup must keep staff signed in and display public empty state.
- [x] Update `src/features/scoring/scoring-state.ts` and `src/features/scoring/scoring-state.test.ts` to retain generation on pending points and discard pending state/ownership on reset; ensure retries retain the original generation rather than adopting the newest one.
- [x] Add `scripts/reset-tournament.ts` and `scripts/reset-tournament.test.ts`, include `scripts/**/*.ts` in `tsconfig.node.json`, and add `maintenance` in `package.json` invoking `node --experimental-strip-types scripts/reset-tournament.ts`; implement separate enable/disable/reset actions, environment-only credentials, sanitized target display, typed confirmation, and no automatic retry with a new request ID.
- [ ] Add `tests/integration/reset.test.ts` importing the new SQL migration; update `tests/integration/local-supabase.ts`, `tests/integration/tournament.test.ts`, and `tests/integration/auth.test.ts` for the envelope, generation, and maintenance fixtures; verify anonymous/staff denial, service-role access, flag behavior, both modes in active/completed stages, audit retention, rollback, stale requests, and replay after reset.
- [ ] Document command usage and coordinated server/client rollout in `docs/deployment.md`, including old-client refresh, explicit enabling, credential redaction, and disposable test targets; update `src/data/tournament.test.ts` for rapid reset/recreate and out-of-order responses from both generations.

**Phase gate (hard):**

- [ ] Run `npm run typecheck` project-wide.
- [ ] Run `npm run test:related -- <changed files>` using the real phase diff; package changes use the configured rerun behavior, and unavailable local Supabase checks require explicit debt with substitute evidence.

**Review checklist (user, at PR review):**

- [ ] On a disposable tournament, exercise both modes with a referee screen open; verify kept/cleared data, staff access, audit record, disabled flag, and rejection of pending old points.
- [ ] Cancel confirmation and attempt stale-target reset; verify no data changes. Confirm a repeated committed request does not reset a second time.
- [ ] Verify empty setup and reconfigured play recover on phone and desktop without reload loops or stale forms; inspect mobile keyboard and landscape scoring behavior.

**On completion:** run the phase gate; run `fresh-review` when the recorded or actual-diff decision requires it; update STATUS + checkboxes; stop and ask before push/PR. Review checklist goes into the PR description.

## Phase 3 — Results and withdrawals

Branch: `backlog-improvements/phase-3-results` (stacked: `gh stack add`).

Ship schedule-based recovery and pair withdrawals with authoritative previews and stale-confirmation protection.

Consumes: `TournamentState`, generation-bound `MutationInput<K>`, `TournamentSnapshot`, and phase 1 court configuration.
Produces: `MutationImpact`, `ImpactBlockCode`, `previewResultCorrection(matchId: UUID, score: Score, resetGeneration: number): Promise<MutationImpact>`, and `previewWithdrawal(pairId: UUID, resetGeneration: number): Promise<MutationImpact>` per PLAN.md.

Fresh review: required — correction/withdrawal paths protecting durable data and authenticated preview APIs

- [ ] Add `src/domain/impacts.ts` with the exact PLAN.md impact contracts and `supabase/migrations/202609150003_result_previews.sql` with `preview_result_correction` and `preview_withdrawal`; enforce staff access and generation, use shared read-only projection helpers, and return coherent before/after snapshots without mutation-log or database writes.
- [ ] In that migration, share projection/safety rules with correction and withdrawal writes; require `previewTournamentVersion` in their payloads and check under the mutation lock before applying; preserve all-group-correction blocking after knockout start, semifinal/final restrictions, withdrawal cutoff, and minimum two active pairs.
- [ ] Update `src/domain/commands.ts`, add `src/data/impacts.ts` and `src/data/impacts.test.ts` with strict runtime validation, and update `src/lib/database.types.ts` for both preview RPCs; unknown or malformed impacts must not be confirmable.
- [ ] Add `src/features/organizer/ResultSchedule.tsx`, `WithdrawalPanel.tsx`, and `ImpactPreview.tsx`; refactor `ResultEditor.tsx` to accept the selected match and `OrganizerPage.tsx` to show upcoming/completed schedule actions and a separate pair withdrawal section; keep direct results/walkovers restricted to eligible unstarted matches.
- [ ] In `ImpactPreview.tsx` and `ResultEditor.tsx`, display old/new scores, standings changes, knockout participants, invalidated tie/group confirmations, and explicit block reasons; capture the exact proposal/version and require a new preview after any snapshot change or reset.
- [ ] Add `tests/integration/impacts.test.ts` importing the preview migration, and update correction/withdrawal calls in `tests/integration/tournament.test.ts` for preview versions; prove preview/write parity, read-only behavior, same-winner group correction blocking, tie effects, withdrawal limits, authorization, and concurrent downstream start/reset rejection.
- [ ] In the new organizer components and `src/components/ui/alert-dialog.tsx`, implement the agreed phone layouts, scrollable impact dialogs, long-name access, touch actions, and keyboard-safe confirmation; use `src/App.css` or `src/index.css` only for shared responsive rules.

**Phase gate (hard):**

- [ ] Run `npm run typecheck` project-wide.
- [ ] Run `npm run test:related -- <changed files>` using paths from the real phase diff; selected local database tests follow the recorded environment-debt policy.

**Review checklist (user, at PR review):**

- [ ] Enter an off-app result from the schedule, correct a completed result, and verify each preview's standings/knockout effects and confirmation invalidation.
- [ ] Start dependent play on a second device between preview and save; verify refresh is required. Verify group corrections are blocked even with the same winner once knockouts start.
- [ ] Preview a valid withdrawal and a blocked two-pair-group withdrawal; record a knockout walkover and verify earlier results remain intact.
- [ ] Check phone portrait/landscape, 320px width, keyboard-open dialogs, long names, and desktop schedule readability without page overflow.

**On completion:** run the phase gate; run `fresh-review` when the recorded or actual-diff decision requires it; update STATUS + checkboxes; stop and ask before push/PR. Review checklist goes into the PR description.

## Phase 4 — Vietnamese translation

Branch: `backlog-improvements/phase-4-vietnamese` (stacked: `gh stack add`).

Translate the completed workflows together so terminology, consequences, and layouts remain consistent.

Consumes: `MutationImpact`, `ImpactBlockCode`, `TournamentState`, and all public/staff flows from phases 1–3.
Produces: typed `messages` in `src/i18n/vi.ts`, `formatNumber(value: number): string`, and `errorMessage(error: unknown): string`.

Fresh review: not required

- [ ] Add `src/i18n/vi.ts`, `src/i18n/format.ts`, and `src/i18n/errors.ts` per PLAN.md; compose complete natural Vietnamese messages with typed parameters, distinguish badminton seed/rank and walkover/withdrawal/reset concepts, and resolve ambiguous terminology with the user in `CONTEXT.md` before final copy.
- [ ] Translate `src/App.tsx`, `src/features/tournament/TournamentPage.tsx`, `MatchTicket.tsx`, `StandingsTable.tsx`, and `KnockoutBracket.tsx`, preserving user-entered names and using `formatNumber` for scores/counts.
- [ ] Translate `src/features/organizer/SetupForm.tsx`, `OrganizerPage.tsx`, `ResultSchedule.tsx`, `ResultEditor.tsx`, `WithdrawalPanel.tsx`, and `ImpactPreview.tsx`, plus `src/features/scoring/ScoreTracker.tsx`, `src/features/staff/StaffAccessDialog.tsx`, and `StaffMenu.tsx`; cover accessible names, errors, pending/empty states, confirmations, and full impact explanations.
- [ ] Audit user-visible defaults in `src/components/ui/dialog.tsx`, `alert-dialog.tsx`, and `select.tsx`; localize close/control labels without translating identifiers or user data, and route known backend/staff errors through typed Vietnamese messages with a safe unknown-error fallback.
- [ ] Set `index.html` language to `vi`; adjust `src/index.css`, `src/App.css`, `ScoreTracker.tsx`, and affected component layouts to support Vietnamese diacritics, long copy, dynamic viewport height, safe areas, and touch controls without hiding Undo/Confirm in landscape.
- [ ] Add `src/i18n/errors.test.ts` and `src/i18n/format.test.ts` for known/unknown failures, parameter handling, and `vi-VN` formatting; keep linguistic and font/layout assessment in the manual review rather than tests that merely repeat catalogue strings.

**Phase gate (hard):**

- [ ] Run `npm run typecheck` project-wide.
- [ ] Run `npm run test:related -- <changed files>` using paths from the real phase diff.

**Review checklist (user, at PR review):**

- [ ] Read complete public, organizer, and referee flows in Vietnamese for natural badminton terminology and accurate consequences; check seed versus rank, walkover versus withdrawal, correction versus reset, and unknown-error messages.
- [ ] Verify Be Vietnam Pro diacritics and representative long Vietnamese names; check 320px and larger phones, tablet/desktop, portrait/landscape, keyboard-open forms, local table/bracket scrolling, and no page-level overflow.
- [ ] Score a match in landscape and portrait using touch, Undo, and Confirm; verify readable names/scores and reachable controls throughout error and confirmation states.

**On completion:** run the phase gate; run `fresh-review` when the recorded or actual-diff decision requires it; update STATUS + checkboxes; stop and ask before push/PR. Review checklist goes into the PR description.

## Phase 5 — Application icon and title

Branch: `backlog-improvements/phase-5-identity` (stacked: `gh stack add`).

Finalize identity after translated workflows exist, then verify the accumulated spec.

Consumes: `TournamentState` and `messages`.
Produces: `tournamentTitle(name: string | null): string` and browser/home-screen assets named in PLAN.md.

Fresh review: not required

- [ ] Add `src/features/tournament/document-title.ts` and update `src/App.tsx` to set the configured tournament name or “Giải cầu lông”; apply the fallback for empty setup/Reset all and never append stage names.
- [ ] Replace `public/favicon.svg` with the blue/orange shuttlecock silhouette; render `public/favicon-32.png`, `apple-touch-icon.png` (180), `icon-192.png`, and `icon-512.png` from the same artwork, leaving the unrelated interface sprite untouched.
- [ ] Add `public/site.webmanifest` with PLAN.md's static identity/start/scope/display/language and valid PNG references; update `index.html` title, icon, Apple touch icon, and manifest links; do not add a service worker or offline behavior.
- [ ] Inspect home-screen standalone viewport behavior in `src/App.css`, `src/index.css`, and `src/features/scoring/ScoreTracker.tsx`; correct any safe-area or reachable-control issues against the shared responsive requirements.

**Phase gate (hard):**

- [ ] Run `npm run typecheck` project-wide.
- [ ] Run `npm run test:related -- <changed files>` using paths from the real phase diff.

**Review checklist (user, at PR review):**

- [ ] Check fallback title, configured title, renaming, stage transitions, and Reset all; stage changes must not append text to the title.
- [ ] Inspect small favicon and phone icons, manifest links, and home-screen launch where supported; verify the shuttlecock stays recognizable and text-free.
- [ ] Walk through the accumulated setup, one/two-court schedule, results, withdrawals, and Vietnamese scoring flows on phone portrait/landscape and desktop, including keyboard, safe areas, and long text.

**On completion:** run the phase gate; run `fresh-review` when the recorded or actual-diff decision requires it; update STATUS + checkboxes; stop and ask before push/PR. Review checklist goes into the PR description.

## Spec gate (hard — once, before the final phase's PR)

- [ ] Run `npm test` over the accumulated spec, including the disposable local Supabase integration suites; if the documented environment block persists, record actual blocked checks and substitute evidence under the rulebook without claiming the full suite passed.
- [ ] Run `npm run build` over the accumulated spec.
