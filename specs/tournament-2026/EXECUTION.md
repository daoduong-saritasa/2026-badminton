# Badminton tournament 2026 — Execution Plan

Spec: [PLAN.md](PLAN.md). Rulebook: `specs/RULEBOOK.md`.
Integration branch: `main`. Branch model: stacked via `gh stack` (default; probe returned exit 2 on 2026-09-08).

## STATUS

- Current phase: 2 — in-progress
- Phase 1 — Domain contracts and logic: done
- Phase 2 — Database and staff authorization: in-progress
- Phase 3 — Frontend data and scoring recovery: pending
- Phase 4 — Tournament and staff screens: pending
- Verification debt: none

## Phase 1 — Domain contracts and logic

Branch: `tournament-2026/phase-1-domain` (stacked: `gh stack add`)

Establish the contracts and executable tournament examples consumed by the database and frontend.

Produces: `isWinningScore(score: Score): boolean`, `generateFixtures(pairs: readonly Pair[]): Fixture[]`, `calculateStandings(snapshot: TournamentSnapshot, group: Group): Standing[]`, and the exported records, `CommandPayloads`, `MutationInput<K>`, and `MutationReceipt` in PLAN.md → API changes.

Fresh review: required — test-gate infrastructure

- [x] In `package.json`, `package-lock.json`, `vitest.config.ts`, `tsconfig.app.json`, `tsconfig.node.json`, and `tsconfig.json`, install Vitest through npm, enable strict types, and add `typecheck` (project-wide `tsc -b`), `test` (`vitest run`), and `test:related` (`vitest related --run`); cover tests/tooling and rerun for shared configuration changes without adding UI test tooling.
- [x] Create `src/domain/types.ts` and `src/domain/commands.ts` with the exact exported records, command payloads, mutation envelope, and receipt in PLAN.md → API changes; use discriminated states and no loose `any`.
- [x] Create `src/domain/scoring.ts` and `src/domain/scoring.test.ts` for valid scores, symmetry, deuce, cap, impossible scores, and the transition that stops point entry.
- [x] Create `src/domain/fixtures.ts` and `src/domain/fixtures.test.ts` for 6/7/8 pairs, group membership, every group pairing exactly once, two courts, initial ordering, and best-effort avoidance of consecutive play; leave three knockout slots with the defined dependency labels.
- [x] Create `src/domain/standings.ts` and `src/domain/standings.test.ts` for confirmed wins, head-to-head, tied-pair point difference, manual residual ties, walkovers without fabricated points, and withdrawn-pair exclusion.
- [x] In `src/domain/scoring.ts` and `src/domain/scoring.test.ts`, reject two-point margins below 21 symmetrically and prove point entry continues from those scores. (amended 2026-09-09)
- [x] In `tsconfig.node.json` and `vitest.config.ts`, include Vitest configuration in strict project-wide typechecking and make `package-lock.json` force a complete related-test rerun. (amended 2026-09-09)

**Phase gate (hard):**
- [x] Run `npm run typecheck` project-wide.
- [x] Run `npm run test:related -- <changed files>` with paths derived from the real phase diff; configuration changes trigger the runner's configured rerun behavior.
- [x] Rerun `npm run typecheck` and `npm run test:related -- <changed files>` after the fresh-review corrections, deriving paths from the real phase diff; separately verify `npm run test:related -- package-lock.json` runs the complete suite. (amended 2026-09-09)

**Review checklist (user, at PR review):**
- [ ] Check the 6/7/8-pair fixture examples and tie examples against the organizer's rules.

**On completion:** run the phase gate; run `fresh-review` when the recorded or actual-diff decision requires it; update STATUS + checkboxes; stop and ask before push/PR. Review checklist goes into the PR description.

## Phase 2 — Database and staff authorization

Branch: `tournament-2026/phase-2-database` (stacked: `gh stack add`)

Implement the authoritative transaction and authorization boundary before connecting browser mutations.

Consumes: `Score`, `Pair`, `TournamentSnapshot`, `CommandPayloads`, `MutationReceipt`, and the scoring/fixture/standings examples from `src/domain/*.test.ts`.
Produces: the named RPC signatures in PLAN.md → API changes; `staff-pin` and `rotate-pin` Edge endpoints; CLI-generated `Database` in `src/lib/database.types.ts`.

Fresh review: required — authentication, secrets, persistent migrations, and durable writes

- [x] Install the Supabase CLI through npm in `package.json`/`package-lock.json`; create `supabase/config.toml` for disposable local development with anonymous Auth and Edge Functions, and extend TypeScript configuration/runtime declarations to typecheck Edge Function sources project-wide.
- [x] Create `supabase/migrations/202609080001_schema.sql` for `public.tournament`, `players`, `pairs`, `matches`, `tie_resolutions`, and `private.staff_grants`, `staff_config`, `pin_attempts`, `match_ownership`, `mutation_log` per PLAN.md → Schema changes; enforce pair-slot uniqueness and keep private state outside public reads.
- [x] Create `supabase/migrations/202609080002_authorization.sql` with grants/RLS, `get_staff_access`, `get_score_access`, `revoke_staff_access`, and private grant/rate-limit/PIN helpers; check verified session/user, fixed seven-day expiry, revocation and PIN generation on every staff operation; restrict privileged helper execution and fix SECURITY DEFINER search paths.
- [x] Create `supabase/functions/staff-pin/index.ts` and `supabase/functions/rotate-pin/index.ts` using verified Auth identity, maintained password-hashing primitives, bounded PIN input, server-derived rate-limit buckets, atomic generation checks/grant issuance, and secret-free logs; document concrete rate-limit thresholds and trusted request metadata in `docs/deployment.md`.
- [x] Create `supabase/migrations/202609080003_tournament.sql` with `get_tournament_snapshot`, `save_setup`, `generate_fixtures`, and `assign_courts`; implement singleton locking, expected versions, scoped idempotency, 6–8-pair/group validation, immutable setup after play, and court/order editing only for unstarted matches.
- [x] In `supabase/migrations/202609080003_tournament.sql`, implement `start_scoring`, `take_over`, `add_point`, `undo_point`, and `confirm_result`; enforce one live match per court/pair, ownership on every write, reversible point history, stop at winning score, atomic result progression, and duplicate-request protection.
- [x] In `supabase/migrations/202609080003_tournament.sql`, implement `enter_result`, `correct_result`, `mark_walkover`, `withdraw_pair`, `resolve_tie`, `confirm_groups`, and `reopen_tournament`; recalculate affected standings/slots, invalidate stale tie resolutions, block changed participants after dependent play starts, and preserve setup locks after reopening.
- [x] In `supabase/migrations/202609080003_tournament.sql`, increment dependent knockout match versions when participant slots change and return group confirmation to review when corrected results or withdrawals invalidate seeded slots. (amended 2026-09-09)
- [x] In `supabase/migrations/202609080003_tournament.sql`, lock setup when direct results or walkovers record tournament play so reopening cannot expose an unlocked setup. (amended 2026-09-09)
- [ ] Add `tests/integration/local-supabase.ts`, `tests/integration/auth.test.ts`, and `tests/integration/tournament.test.ts` covering anonymous denial, expired/revoked grants, PIN rotation, rate limits, concurrent claims/court conflicts, takeover, retry duplication, score/undo boundaries, correction dependencies, withdrawals, group confirmation, and final reopening; use local-only fixtures and fail clearly when services are unavailable.
- [ ] Generate `src/lib/database.types.ts` through the Supabase CLI from the local schema; configure publication of public tournament tables for Realtime and verify that audit/ownership/PIN records cannot be read publicly.
- [ ] Update `README.md` and `docs/deployment.md` with local Supabase/Edge commands, initial PIN hash handling and rotation; note that production credentials/provisioning remain separate deployment inputs.

**Phase gate (hard):**
- [ ] Run `npm run typecheck` project-wide, including Edge Function sources.
- [ ] Run `npm run test:related -- <changed files>` from the actual diff and `npm exec vitest -- run tests/integration` as the SQL/Edge/configuration fallback suite. Local Docker/Supabase/Edge services are required; if unavailable, mark this check `[~]`, record the blocker and passing domain-test substitute in STATUS, and do not claim database verification.

**Review checklist (user, at PR review):**
- [ ] Review the authorization lifetime, PIN-rotation behavior, public data exposure, and correction restrictions against the agreed plan.

**On completion:** run the phase gate; run `fresh-review` when the recorded or actual-diff decision requires it; update STATUS + checkboxes; stop and ask before push/PR. Review checklist goes into the PR description.

## Phase 3 — Frontend data and scoring recovery

Branch: `tournament-2026/phase-3-data` (stacked: `gh stack add`)

Provide typed server access and recovery behavior for the screens without mixing transport logic into UI components.

Consumes: `Database`, `TournamentSnapshot`, `StaffAccess`, `CommandPayloads`, `MutationInput<K>`, `MutationReceipt`, and all Phase 2 RPCs/Edge endpoints named in PLAN.md → API changes.
Produces: `fetchTournament(): Promise<TournamentSnapshot>`, `mutateTournament<K extends keyof CommandPayloads>(operation: K, input: MutationInput<K>): Promise<MutationReceipt>`, `subscribeTournament(onChange: () => void): () => void`, `signInStaff(pin: string): Promise<StaffAccess>`, `getStaffAccess(): Promise<StaffAccess | null>`, `signOutStaff(): Promise<void>`, `rotateStaffPin(pin: string): Promise<void>`, `canScore(matchId: UUID): Promise<boolean>`, and `reduceScoring(state: ScoringState, event: ScoringEvent): ScoringState`.

Fresh review: required — staff authorization and recovery paths protecting durable score data

- [ ] Install `@supabase/supabase-js` through npm; create `src/lib/supabase.ts` and `.env.example` using only the public URL/key in browser configuration, with explicit missing-configuration errors.
- [ ] Create `src/data/tournament.ts` to map generated database responses into domain records, invoke named RPCs, and subscribe to public changes as invalidations; refetch on reconnect and mutation acknowledgement, reject stale responses, and clean up subscriptions.
- [ ] Create `src/data/staff.ts` for anonymous Auth plus PIN elevation, registry-backed access checks, current-session revocation before sign-out, PIN rotation, and private ownership checks; preserve explicit errors if server-side sign-out revocation fails.
- [ ] Create `src/features/scoring/scoring-state.ts` with exported `ScoringState`, `ScoringEvent`, and `reduceScoring`; permit one in-flight point, retain its request/version through failures, retry the same request, pause until acknowledgement, and require explicit takeover after ownership conflicts.
- [ ] Create `src/features/scoring/scoring-state.test.ts` and `src/data/tournament.test.ts` for failed-save retry identity, duplicate acknowledgements, stale snapshots, winning-score review/dismiss/undo, reconnection, and revoked ownership; test logic without rendering components.

**Phase gate (hard):**
- [ ] Run `npm run typecheck` project-wide.
- [ ] Run `npm run test:related -- <changed files>` from the real phase diff; if SQL/Edge/configuration changes occur, also run the fallback `npm exec vitest -- run tests/integration` with the same explicit local-service debt rule as Phase 2.

**Review checklist (user, at PR review):**
- [ ] Confirm that retries preserve one pending point and that a restored session can recover ownership without an automatic takeover.

**On completion:** run the phase gate; run `fresh-review` when the recorded or actual-diff decision requires it; update STATUS + checkboxes; stop and ask before push/PR. Review checklist goes into the PR description.

## Phase 4 — Tournament and staff screens

Branch: `tournament-2026/phase-4-screens` (stacked: `gh stack add`)

Compose the approved visual reference around the verified data and scoring interfaces.

Consumes: all exported data/staff functions and `reduceScoring(state: ScoringState, event: ScoringEvent): ScoringState` from Phase 3; `calculateStandings(snapshot: TournamentSnapshot, group: Group): Standing[]` from Phase 1.

Fresh review: required — staff access integration and score/result recovery controls

- [ ] Configure Tailwind and shadcn through their official installation commands in `package.json`, `package-lock.json`, `vite.config.ts`, TypeScript alias configuration, and `components.json`; consult the official catalog and install applicable button, dialog, alert-dialog, input, label, select, tabs, dropdown-menu, table, badge, and alert controls into `src/components/ui/` through the CLI; never reconstruct components from docs or `node_modules`.
- [ ] Replace starter styling in `src/index.css`/`src/App.css`, self-host Be Vietnam Pro under `public/fonts/`, and retain required notices in `THIRD_PARTY_NOTICES.md`; implement company tokens, rounded ticket details, contrast, focus styles, responsive spacing and reduced-motion behavior.
- [ ] Replace `src/App.tsx` with snapshot loading, error/retry states, public/staff navigation, and stage-driven default views; keep viewer access free of Auth creation and close protected controls when the staff grant expires or is revoked.
- [ ] Create `src/features/tournament/TournamentPage.tsx`, `MatchTicket.tsx`, `StandingsTable.tsx`, and `KnockoutBracket.tsx` with current courts, upcoming order, explicit group-confirmation waiting state, named pairs plus both players/seeds, rounded knockout tickets, and champion priority; omit the deferred public results history.
- [ ] Create `src/features/staff/StaffAccessDialog.tsx` and `StaffMenu.tsx` for PIN entry, actionable rate-limit feedback, staff-only navigation, sign-out, and confirmed PIN rotation; never embed secrets or treat hidden navigation as authorization.
- [ ] Create `src/features/scoring/ScoreTracker.tsx` using `reduceScoring` and data functions: full-viewport side-by-side panels, player/seed labels, large scores, Undo/Confirm above scores, safe-area handling, winning-score confirmation, failed-save retry, reload recovery, and explicit takeover; omit tap instructions and direct live-score editing.
- [ ] Create `src/features/organizer/OrganizerPage.tsx`, `SetupForm.tsx`, and `ResultEditor.tsx` for player/seed/team/group setup, advisory same-seed warnings, fixture generation, editable upcoming courts/order, completed-result lookup/correction, direct results, walkovers, withdrawals, tie explanations, group confirmation, and explicit reopening; mirror server restrictions and confirm consequential actions.
- [ ] Finish `README.md` and `docs/deployment.md` with company-account deployment configuration, public environment variables, Supabase migrations/Edge publication, current commercial-license checks, and the day-before-event resume/read/write/realtime smoke procedure; do not provision or deploy.

**Phase gate (hard):**
- [ ] Run `npm run typecheck` project-wide.
- [ ] Run `npm run test:related -- <changed files>` from the real phase diff; pure presentation changes may have no related tests, which must be reported explicitly without adding UI tests. For SQL/Edge/configuration changes, also run `npm exec vitest -- run tests/integration`, recording local-service blockers as debt rather than silently skipping them.

**Review checklist (user, at PR review):**
- [ ] Compare desktop and phone layouts to `references/tournament-prototype.html`: rounded tickets, company colors, Be Vietnam Pro, restrained content, and readable player/seed labels.
- [ ] Score a match on a landscape phone: panels fill the viewport, Undo/Confirm sit above scores, confirmation can be dismissed to undo, and touch/focus/safe-area behavior is usable.
- [ ] Use two staff browsers to test takeover and lost-save recovery; verify the old owner cannot continue and retry never adds the point twice.
- [ ] Walk through 6/7/8-pair setup, same-seed advisory, fixture ordering, walkover/withdrawal, manual tie resolution, group confirmation, result correction restrictions, final completion, and reopening.
- [ ] Check public navigation before login, staff controls after PIN entry, sign-out/PIN rotation, reconnect updates, and stage-driven group/bracket/champion priority.

**On completion:** run the phase gate; run `fresh-review` when the recorded or actual-diff decision requires it; update STATUS + checkboxes; stop and ask before push/PR. Review checklist goes into the PR description.

## Spec gate (hard — once, before the final phase's PR)

- [ ] Run `npm test` over the accumulated spec, including local Supabase integration tests; if Docker/Supabase/Edge services remain unavailable, record `[~]` with explicit verification debt and passing logic-test substitute evidence.
- [ ] Run `npm run build`.
