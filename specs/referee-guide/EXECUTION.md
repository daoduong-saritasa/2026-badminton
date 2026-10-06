# Referee walkthrough — Execution Plan

Spec: [PLAN.md](PLAN.md). Rulebook: `specs/RULEBOOK.md`.
Integration branch: `main`. Branch model: stacked via `gh stack` (default).

## STATUS

- Current phase: 1 — done-with-debt
- Phase 1 — Isolated referee walkthrough: done-with-debt
- Verification debt: Database integration setup failed in `auth`, `impacts`, `pair-assignment`, `reset`, `round-robin-phase1`, and `tournament`. Local Supabase remains prohibited. Substitute evidence: 168 non-database tests passed, 7 related tests passed, typecheck/build succeeded, and phone/desktop browser checks passed.

## Phase 1 — Isolated referee walkthrough

Branch: `codex/referee-guide/phase-1-walkthrough` (stacked: `gh stack init` rooted at `main`).

One phase delivers the shared presentation and its isolated guide consumer, as requested.

Fresh review: required — shared live scoring and recovery controls protect durable match results.

- [x] Add Driver.js to `package.json` and `package-lock.json`; verify the installed version's configuration and dynamic-target APIs against official documentation.
- [x] Extract presentation into `src/features/staff/StaffAccessView.tsx`, `src/features/scoring/PairAssignmentView.tsx`, and `src/features/scoring/ScoreTrackerView.tsx`; keep authentication, mutations, queries, ownership checks, and side-order persistence in the existing live containers.
- [x] Update `StaffAccessDialog.tsx`, `PairAssignmentForm.tsx`, and `ScoreTracker.tsx` to use those views; preserve live validation, save indicators, undo, confirmations, retry, and takeover behavior.
- [x] Create `src/features/guide/guide-data.ts` with fictional players, teams, fixtures, matches, and games; validate pair and score examples with `src/domain/pair-assignment.ts` and `src/domain/scoring.ts`.
- [x] Create `src/features/guide/guide-state.ts` with explicit immutable states and stable target IDs for every section in PLAN.md → "Walkthrough sequence"; restore the exact preceding state on Back.
- [x] Create `src/features/guide/GuidePage.tsx` and `guide-tour.ts`; apply each state before highlighting, render shared views, intercept example actions, and provide Vietnamese Start, Back, Next, Close, and Restart controls.
- [x] Implement dialog target readiness and focus coordination in `guide-tour.ts` and the shared views; retain live dialog focus traps, clean up Driver.js on close/unmount, and respect reduced motion.
- [x] Add fictional-data notices, the example PIN, explicit stage/failure transitions, and the final live-tournament link in `src/i18n/vi.ts`; follow `CONTEXT.md` terminology.
- [x] Update `src/main.tsx` to render `/guide` and `/guide/` without mounting `App`, its providers, or live containers; load guide code separately from the live scoring path.
- [x] Add the public **Hướng dẫn** link in `src/App.tsx`; confirm the SPA fallback described in `docs/deployment.md` supports direct guide links and reloads.
- [x] Add `src/features/guide/guide-state.test.ts` for every forward/backward transition, Close/Restart, stage changes, failure/retry, and coherent pair/game examples.
- [x] Add `scripts/verify-referee-guide.ts` using the installed Playwright library against `http://127.0.0.1:5181`; verify both routes, all targets, dialog transitions, keyboard navigation, and 390px/1280px layouts without the database-dependent E2E setup.
- [x] In `scripts/verify-referee-guide.ts`, fail on Supabase HTTP/WebSocket activity, compare seeded staff-session and scoring-preference storage before/after, and verify reload resets progress; never navigate to the live tournament during isolation checks.
- [x] Run `npm run dev -- --host 127.0.0.1 --port 5181 --strictPort` if no preview exists, then `node --experimental-strip-types scripts/verify-referee-guide.ts`; resolve missing targets, stale overlays, unreachable controls, and horizontal overflow.

- [x] (amended 2026-10-07) Wait for stable popover geometry in `scripts/verify-referee-guide.ts` before viewport assertions.

- [x] (amended 2026-10-07) Share `MatchPickerView.tsx` between `ScoreTracker.tsx` and `GuidePage.tsx`; show both upcoming and active fictional matches.
- [x] (amended 2026-10-07) Own arrow-key navigation in `guide-tour.ts` so rapid Back restores the correct state.

- [x] (amended 2026-10-07) Target the actual save button in `PairAssignmentView.tsx`; preserve the optimistic score across retry in `guide-state.ts` and its test.
- [x] (amended 2026-10-07) Distinguish Vite development sockets from Supabase sockets in `scripts/verify-referee-guide.ts`.

- [x] (amended 2026-10-07) Load shared `App.css` in `src/main.tsx` so guide/rules retain layout without loading the live app.
- [x] (amended 2026-10-07) Restore successful-save draft and confirmation cleanup through the `PairAssignmentView.tsx` / `PairAssignmentForm.tsx` completion callback.

- [x] (amended 2026-10-07) Add a browser regression in `scripts/verify-referee-guide.ts` that saves through the shared pair view and verifies fresh saved pairs replace its drafts.

- [x] (amended 2026-10-07) Focus Driver.js navigation after popover insertion in `guide-tour.ts`; assert Tab/Shift+Tab access at dialog steps in `scripts/verify-referee-guide.ts`.

- [x] (amended 2026-10-07) Give the text Close control the shared ink color in `guide.css` for readable contrast.

- [x] (amended 2026-10-07) Refine guide page, popover, and mock-dialog spacing in `GuidePage.tsx` and `guide.css`; verify phone/desktop targets and keyboard navigation.

**Phase gate (hard):**
- [x] Run `npm run typecheck` project-wide.
- [x] Run `npm run test:related -- <changed source files from the phase diff>`; record pass, failure, and skip counts (2026-10-07: 7 passed, 0 failed, 0 skipped). If integration setup lacks the prohibited Supabase socket, defer only that blocked verification with substitute evidence and STATUS debt.

**Review checklist (user, at PR review):**
- [ ] Open `/guide` and `/guide/` directly and reload; confirm the fictional-data notice and optional Start control.
- [ ] Follow the public **Hướng dẫn** link; complete PIN explanation, match selection, valid pair assignment, blocked/start confirmation, scoring, undo, side swap, and result confirmation.
- [ ] Confirm the placement example distinguishes games, matches, and team fixtures; verify failed-save retry and takeover explain the required coordination.
- [ ] Use Back across dialogs, stage changes, and failures; use Close and Restart from intermediate steps and the final step.
- [ ] Complete the guide with a keyboard and on a phone; confirm every highlighted dialog and navigation control remains accessible.
- [ ] Return explicitly to the live tournament; confirm the existing staff session, side preferences, and referee scoring behavior remain intact.

**On completion:** run the phase gate; run `fresh-review` when the recorded or actual-diff decision requires it; update STATUS + checkboxes; stop and ask before push/PR. Review checklist goes into the PR description.

## Spec gate (hard — once, before the final phase's PR)

- [~] Run `npm run test`; 168 tests passed and 42 skipped. Six integration suites failed setup because local Supabase is unavailable. The prohibited local Supabase socket blocks database verification; record it as `[~]` with successful non-database results and STATUS debt, without weakening tests.
- [x] Run `npm run build` to verify the new entry route, dependency, and guide bundle.

## Verification record

- Browser verifier passed both guide routes at 390px and 1280px, including all 28 steps and every Close/Restart position.
- Browser checks confirmed Back, arrows, Escape, Tab/Shift+Tab, reload reset, and successful pair-save draft cleanup.
- No Supabase HTTP/WebSocket request or live-key storage access occurred; seeded staff and scoring preferences remained unchanged.
- Fresh review found missing shared route styles. The correction passed the single re-review through `1a44c94` with no actionable findings.
- Cloudflare preview routing and live database mutations remain for user verification; no deployment was performed.
- The final Close text color passed a browser contrast check; dialog Tab navigation, typecheck, related tests, and build passed afterward.
- Guide spacing refinement passed the full 390px/1280px browser matrix, typecheck, build, and 7 related tests (0 failed, 0 skipped). Lint reported five existing Fast Refresh warnings.
