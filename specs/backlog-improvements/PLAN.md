# Tournament backlog improvements

Status: agreed product plan, confirmed on 2026-09-15, including contextual
Vietnamese translation and responsive layouts. Implementation has not started.

## Purpose and scope

Resolve all five items in [the backlog](../../docs/backlog.md), with one
independently shippable phase per item.

## Decisions

- Keep all five backlog items in one plan, with one phase per item.
- Resolve tournament structure before reset semantics and organizer workflows.
- Translate the resulting interface before finalizing the application identity.

### Phase 1 — Flexible pair count and courts

- Keep exactly two groups, A and B, when expanding the supported pair count.
  Configurable group counts are outside this spec.
- Support 4–10 pairs inclusive.
- Keep group sizes balanced: equal for even totals and differing by one for odd
  totals. Required splits for 4–10 pairs are 2+2, 3+2, 3+3, 4+3, 4+4, 5+4,
  and 5+5 respectively. Either A or B may be the larger group for odd totals.
- Keep the top two from each group advancing to semifinals A1 vs B2 and B1 vs
  A2, followed by a final, for every supported pair count. With four pairs, all
  four advance and the group matches determine semifinal seeding.
- Let the organizer configure one or two courts; the event's court availability
  is not yet known.
- Require an explicit choice of one or two courts before fixture generation,
  with no default. Reset progress preserves that choice; Reset all clears it.
- Allow court reassignment for unstarted matches, including after other matches
  have begun. Lock a match's court assignment once that match starts.
- Block reduction from two courts to one while Court 2 has an active match.
  Otherwise, append Court 2's unstarted matches to Court 1's queue in their
  existing relative order. Completed matches retain their original court.
- When increasing from one court to two, preserve existing assignments and
  playing order; the organizer manually moves unstarted matches to Court 2.
  Initial fixture generation distributes matches across the selected court count.
- Schedule by court assignment and playing order only. Scheduled start times
  and sessions are outside this spec.
- Before play, adding or removing a pair preserves all remaining pairs' group
  assignments. Do not automatically redistribute the draw. Block fixture
  generation until the organizer satisfies the required group sizes.
- Save setup requires 4–10 pairs, valid player details, and the required balanced
  group sizes. Temporary imbalance is allowed in the editing form only;
  incomplete draft persistence is outside this spec.
- On one court, initially schedule semifinal 1, semifinal 2, then the final.
  On two courts, initially assign one semifinal to each court and the final to
  Court 1. Unstarted matches remain reassignable, and the final cannot start
  until both semifinals resolve.

### Phase 2 — Tournament reset

- Provide tournament reset as a maintenance command, with no reset control
  available through the shared staff PIN interface.
- Provide two explicit reset modes:
  - **Reset progress:** preserve tournament name, players, pairs, groups, and
    court count; clear scores, results, withdrawals, and progression; return to
    editable setup.
  - **Reset all:** clear tournament setup and play data and return to empty setup.
  Both modes preserve the staff PIN, staff access, and mutation history, and
  append a log entry recording the reset.
- Reset progress preserves fixtures, court assignments, and playing order;
  returns every match to unstarted; clears knockout participants, scores,
  results, withdrawals, and tie decisions; and unlocks setup. Changing pairs or
  groups still requires rebuilding fixtures.
- Allow maintenance resets against production only when an explicit
  database-side enable flag is on; default the flag to off. Require confirmation
  identifying the target tournament and reset mode.
- A successful reset turns the reset-enable flag off as part of the same
  operation. Each subsequent reset requires explicitly enabling it again.
- Allow both reset modes while matches are active. Clear scoring ownership and
  reject pending scoring requests from before the reset so open referee screens
  cannot restore old progress. Staff remain signed in.

### Phase 3 — Results and withdrawals

- Treat direct result entry as a recovery workflow for matches played without
  live scoring: select a match from the schedule, enter the score, and confirm.
  A bulk or consecutive-result entry workflow is outside this spec.
- Move withdrawals into a separate section under the organizer's pair list.
  Select a pair, review affected results and fixtures, then explicitly confirm
  withdrawal. Keep result entry and score correction attached to matches.
- Before confirming a result correction, show the old and proposed scores,
  affected standings and knockout slots, and whether group confirmation must
  be repeated. Explain and block corrections prevented by downstream play.
  The server rechecks correction safety when saving to handle concurrent play.
- Preserve the database rule blocking all group-result corrections once
  knockout play starts, including same-winner score corrections. Correct the
  current UI claim that same-winner corrections are always allowed. Preserve
  existing semifinal and final correction restrictions.
- Keep withdrawals available only before knockout play starts. Withdrawal
  voids the pair's group matches and recalculates standings. After knockout
  play starts, use a walkover for an affected unstarted match when a pair cannot
  play, preserving earlier results.
- Block withdrawal when it would leave fewer than two active pairs in a group.
  Explain this limit in the withdrawal preview; use match walkovers for absences
  instead. Semifinal byes are outside this spec.

### Phase 4 — Vietnamese translation

- Replace English with Vietnamese throughout public, organizer, and referee
  interfaces. Do not add a language switch. Preserve player, pair, and tournament
  names as entered.
- Use a shared, typed Vietnamese message catalogue without adding an
  internationalization library. Cover labels, confirmations, validation, and
  translated server errors. Set document language to `vi` and number formatting
  to `vi-VN`.
- Write natural Vietnamese for the badminton and organizer context, rather than
  translating English word for word. Use consistent terminology for tournament
  stages, player seeds, standings, walkovers, withdrawals, and result corrections.
  Review messages as complete screens and actions, not isolated catalogue entries.

### Phase 5 — Application icon and title

- Use the configured tournament name as the browser title, falling back to
  “Giải cầu lông” before setup. Do not append the tournament stage or introduce
  a separate application brand.
- Use a simple shuttlecock icon in the existing company blue and orange, with
  a bold silhouette and no text or fine detail at browser-tab size.
- Ship an SVG favicon, PNG icons, an Apple touch icon, and a web app manifest
  for browser and phone home-screen identity. Offline operation remains outside
  scope.

## Phase boundaries and acceptance scenarios

Each phase implements one backlog item. Court flexibility belongs to phase 1.
Phase 2 consumes its setup and scheduling model; phase 3 consumes the expanded
match schedule; phase 4 translates the resulting interface; phase 5 completes
its identity. The execution plan will define exact changes and verification
commands under [the spec rulebook](../RULEBOOK.md).

### Responsive requirements across phases

Responsive behavior applies to every changed interface, including setup, court
controls, schedules, result entry, correction previews, withdrawals, dialogs,
and referee scoring. Home-screen icons alone do not satisfy phone support.

- Verify narrow phone layouts from 320 CSS pixels wide, representative larger
  phones, tablets, and desktop layouts, in portrait and landscape where relevant.
- Prevent page-level horizontal overflow, clipped Vietnamese text, overlapping
  controls, and inaccessible actions. Long player and tournament names must
  wrap or truncate with a way to access their full content.
- Keep controls usable by touch without hover. Adapt dense standings and bracket
  views with deliberate local scrolling or reflow, keeping labels understandable.
- Keep forms and confirmation dialogs usable with the phone keyboard open;
  allow content scrolling so review details and confirmation actions remain
  reachable. Account for device safe areas and changing viewport height.
- Preserve the viewport-filling referee scoring layout, especially on landscape
  phones, without hiding names, scores, Undo, or Confirm. Check portrait use too.
- Recheck layouts after Vietnamese copy is applied and in the home-screen launch
  context supported by the manifest. Include these scenarios in each affected
  phase's review checklist and the final accumulated review.

### Phase 1 — Flexible pair count and courts

Update setup validation, authoritative database validation, fixture generation,
domain contracts, and court controls together. Preserve existing scoring,
standings, setup-locking, and staff-authorization rules except where explicitly
changed above. Preserve the existing best-effort avoidance of consecutive play.

| Pair count | Group sizes, either orientation | Total matches |
| --- | --- | --- |
| 4 | 2+2 | 5 |
| 5 | 3+2 | 7 |
| 6 | 3+3 | 9 |
| 7 | 4+3 | 12 |
| 8 | 4+4 | 15 |
| 9 | 5+4 | 19 |
| 10 | 5+5 | 23 |

Totals include every group pairing once, two semifinals, and one final.

- Accept every listed split, including either larger group for odd totals;
  reject out-of-range totals and unbalanced splits in both UI and database.
- Adding or removing a pair leaves every remaining group assignment unchanged.
  Invalid drafts cannot be saved or used to generate fixtures.
- No court choice means fixture generation is blocked. One court produces
  one queue; two courts distribute initial fixtures across both courts.
- Increasing court count leaves existing queues intact. Reducing it while
  Court 2 is playing fails without changing assignments; otherwise its unstarted
  queue follows Court 1's existing queue in relative order.
- Started matches retain their court. Enforce one active match per court and
  prevent simultaneous play by the same pair, including after reassignment.
- Four pairs still play group matches and the full semifinal/final bracket.
  The final cannot start with unresolved semifinal participants.
- Apply schema changes without resetting existing tournaments or rewriting
  completed-match history. Carry the existing two-court configuration forward
  for existing tournaments; require an explicit choice for new or empty setup.

### Phase 2 — Tournament reset

Provide a privileged maintenance command and documented invocation, target
selection, enabling, and confirmation steps. Shared staff authorization alone
must not authorize reset. Keep privileged credentials out of frontend code and
command output.

- With reset disabled, either mode fails without changing tournament data.
- Before applying a reset, confirmation identifies the target environment,
  tournament, mode, and data to be cleared. Cancellation makes no changes.
- Reset progress preserves setup, fixtures, court assignments, and order while
  clearing play state, point history, ownership, withdrawals, tie decisions,
  and knockout participants. Return to editable setup with unstarted fixtures.
- Reset all clears tournament setup and fixtures as well as play state. Show
  empty setup, the fallback title, and no selected court count.
- Both modes preserve PIN configuration, staff access, and mutation history.
  Record the reset mode and target in a new mutation-history entry.
- Reset works during active play. Requests issued before reset cannot restore
  cleared state, including delayed requests and retries from open staff screens.
  Preserve audit history without allowing an old mutation receipt to authorize
  a new write against the reset tournament.
- Apply the reset, log entry, and disable flag atomically. A failed reset leaves
  the prior tournament intact; a successful reset requires re-enabling before
  another reset.

### Phase 3 — Results and withdrawals

Replace the flat match selector with schedule-based match selection for staff,
including access to completed matches for corrections. Keep walkovers attached
to matches and withdrawals attached to pairs.

- From an unstarted match with known participants, staff can enter a valid final
  score, review it, and confirm. Reject invalid scores and preserve the existing
  live-scoring ownership boundary for playing matches.
- From a completed match, staff can review old and proposed scores, projected
  standings and knockout effects, and any need to confirm groups again.
- Once knockout play starts, group-result corrections show the blocking reason
  even when the proposed winner is unchanged. Server and UI rules agree.
- If the tournament changes after a preview, saving rechecks authoritative
  safety and versions; reject stale changes and require a refreshed review.
- Withdrawal previews identify affected fixtures and results. Block withdrawal
  after knockout play begins or when fewer than two active pairs would remain
  in the group. Valid withdrawals void group results and recalculate standings.
- A pair's absence from an unstarted knockout match can be recorded as a
  walkover without rewriting its earlier results.

### Phase 4 — Vietnamese translation

Centralize interface messages in a typed catalogue and apply Vietnamese to public
and staff flows, including the new phases. Include accessible names, empty
states, loading states, confirmations, validation, and recoverable errors.

- Public, organizer, and referee screens use Vietnamese while user-entered
  names remain unchanged. No language selector appears.
- Review Vietnamese copy in its actual badminton context. Distinguish a player's
  seed classification from group ranking, a match walkover from tournament
  withdrawal, and a score correction from a tournament reset. Avoid literal
  translations that obscure these differences.
- Review complete public and staff flows for natural wording, consistent terms,
  clear action labels, and accurate consequences in confirmations and errors.
  Resolve ambiguous Vietnamese terminology with the user before finalizing copy;
  glossary entries must describe domain concepts rather than implementation.
- Known server failures produce useful Vietnamese messages; unexpected failures
  have a Vietnamese fallback instead of exposing raw server text in the UI.
- The document declares `vi`; scores and counts use `vi-VN` number formatting.
- Verify Be Vietnam Pro renders the Vietnamese diacritics used by the catalogue
  and representative player names, and inspect narrow-screen layouts for
  wrapping, clipping, and readable scoring controls. Apply the cross-phase
  responsive requirements to the translated interface, including long messages
  and validation errors.

### Phase 5 — Application icon and title

Replace scaffold identity with the agreed shuttlecock and tournament title.

- Before setup, the browser title is “Giải cầu lông”. With a configured
  tournament, it matches the tournament name and updates when that name changes.
  Stage changes do not alter the title; Reset all restores the fallback.
- Deliver a recognizable blue-and-orange shuttlecock SVG favicon, PNG icons,
  Apple touch icon, and a manifest with valid asset references. Use the generic
  “Giải cầu lông” identity for static home-screen metadata.
- Verify icon readability at tab size and the supplied phone icon sizes. This
  phase adds shortcut identity without adding offline operation.

## Verification and review planning

Follow the rulebook's phase gates: project-wide typechecking and tests related
to changed files. Run the full local suite and applicable production build once
at the final spec gate. Manual visual and event-flow scenarios belong in the
user's review checklist. No CI gating was requested.

- Phase 1 requires fresh review for persistent-data migrations and durable
  scheduling writes.
- Phase 2 requires fresh review for destructive reset operations and privileged
  access boundaries.
- Phase 3 requires fresh review for correction and withdrawal paths protecting
  durable tournament data.
- Phases 4 and 5 do not require fresh review unless their actual changes meet a
  rulebook trigger.

Exact migration, command, and preview API contracts belong in the execution
plan. Preserve the existing mutation versioning, concurrency, and idempotency
guarantees when extending them for reset and court-count changes.

## Implementation contracts

The user approved these mechanisms on 2026-09-15:

- **Court configuration:** add nullable `public.tournament.court_count`, checked
  to allow 1 or 2; backfill existing tournaments to 2 without a default for new
  setup. Expose `CourtCount = 1 | 2`, `Tournament.courtCount`, and
  `SetupInput.courtCount`; add `set_court_count` through the existing versioned
  staff mutation boundary. Fixture generation requires a non-null count.
- **Reset access:** use a local Node maintenance command calling a database RPC
  granted only to `service_role`, with its credential supplied through the
  environment. Keep the enable flag in a private maintenance-state table.
  Enabling is a separate explicit command; reset never enables itself. This
  reuses the installed Supabase client without introducing an admin UI or a new
  database login. Credentials never appear in arguments or output.
- **Reset isolation:** persist a monotonic reset generation independently of the
  tournament row, include it in all mutation requests and audit entries, and
  reject an old generation before idempotency replay. Advance it atomically on
  either reset. Reset all removes the tournament row to reuse empty-setup
  behavior; snapshot/cache handling must recognize the new generation and must
  not compare a new tournament's version to an old tournament's version.
  This extends the shared mutation envelope and requires coordinated client and
  server deployment; old clients must refresh before writing.
- **Impact previews:** use authenticated read-only database preview RPCs for
  corrections and withdrawals, returning typed impact data and the tournament
  version used for the preview. Reuse authoritative standings and safety logic;
  confirmation checks that version in addition to existing mutation checks.
  This avoids a second implementation of progression rules in the browser.

## Schema, API, and frontend changes

These concrete contracts implement the approved mechanisms. New SQL goes in
forward migrations; existing migrations remain unchanged.

### Phase 1 contracts

- `202609150001_flexible_setup.sql`: add `tournament.court_count smallint null`
  with a 1-or-2 check, backfill existing rows to 2, and update `save_setup`,
  `generate_fixtures`, `assign_courts`, `start_scoring`, and snapshot output.
  Add `set_court_count(p_request_id uuid, p_expected_version integer,
  p_payload jsonb) returns jsonb`, payload `{ courtCount: 1 | 2 }`.
- `src/domain/types.ts`: `CourtCount = 1 | 2`; add
  `courtCount: CourtCount | null` to `Tournament` and `SetupInput`.
  `generateFixtures(pairs: readonly Pair[], courtCount: CourtCount): Fixture[]`
  replaces its current one-argument signature.
- `src/domain/setup.ts`: export `isValidGroupSplit(pairs: readonly
  Pick<Pair, 'group'>[]): boolean` and
  `availableCourts(courtCount: CourtCount | null): readonly Court[]`.
- Extend `CommandPayloads`, snapshot validation/mapping, `SetupForm`,
  `OrganizerPage`, `TournamentPage`, and `ScoreTracker` for selected courts.

### Phase 2 contracts

- `202609150002_maintenance_reset.sql`: create private singleton
  `maintenance_state(reset_enabled boolean, reset_generation integer)` with
  defaults false and zero. The generation survives Reset all.
- Extend `private.mutation_log` with `reset_generation` and an explicit actor
  kind (`staff` or `maintenance`). Use a generated `id` primary key, preserve
  staff request/session uniqueness, and permit a null staff session only for
  maintenance entries. Retain existing rows and match-reference cleanup.
  Maintenance entries record request ID, mode, original target ID/name, database
  role, and resulting generation; never fabricate a staff session.
- Replace `get_tournament_snapshot()` output with
  `{ resetGeneration: number, snapshot: TournamentSnapshot | null }`, so empty
  setup still carries a generation. Add `TournamentState` with that exact shape.
  `fetchTournament(): Promise<TournamentState>` and subscription/cache consumers
  adopt the envelope. Generation is public; the reset-enable flag remains private.
- Add `public.tournament_generation(singleton boolean primary key,
  reset_generation integer not null)` as a read-only public Realtime projection
  of the private generation; update it in the reset transaction and include it
  in the existing publication. Browser roles cannot write it. It signals Reset
  all even when the tournament row no longer exists.
- Add required `resetGeneration: number` to `MutationInput<K>` and
  `MutationReceipt`; all tournament mutation RPCs add required
  `p_reset_generation integer`. Remove obsolete overloads so old clients cannot
  bypass the generation check. Include generation in replay fingerprints and
  point-history selection; retain old point entries as audit evidence only.
- Add service-role-only `set_reset_enabled(p_enabled boolean) returns void` and
  `reset_tournament(p_request_id uuid, p_expected_generation integer,
  p_expected_tournament_id uuid, p_expected_version integer, p_mode text,
  p_confirmation_name text) returns jsonb`. Mode is `progress` or `all`.
  Reset requires an existing matching tournament; cancellation or a stale target
  makes no changes. A retry of the same committed maintenance request returns
  its receipt without performing another reset or enabling the flag.
- `scripts/reset-tournament.ts`: Node command with `enable`, `disable`, and
  `reset --mode progress|all` actions, using environment-only
  `BADMINTON_MAINTENANCE_URL` and `BADMINTON_MAINTENANCE_SERVICE_ROLE_KEY`.
  Display a sanitized host, target name/ID, mode, and impact; require typed
  confirmation before reset. Enable is always a separate invocation.
- `src/features/scoring/scoring-state.ts`: pending points retain their original
  generation. A new generation clears pending scoring state and ownership;
  late responses from older generations cannot update current caches or forms.

### Phase 3 contracts

- `src/domain/impacts.ts`: define `ImpactBlockCode` as
  `'knockouts-started' | 'final-started' | 'too-few-active-pairs' |
  'invalid-match-state' | 'tournament-completed'`; define `MutationImpact` with
  `resetGeneration: number`, `tournamentVersion: number`,
  `blockedReason: ImpactBlockCode | null`, `before: TournamentSnapshot`, and
  `after: TournamentSnapshot | null` (null when blocked).
- `202609150003_result_previews.sql`: add authenticated, read-only
  `preview_result_correction(p_match_id uuid, p_score jsonb,
  p_reset_generation integer) returns jsonb` and
  `preview_withdrawal(p_pair_id uuid, p_reset_generation integer) returns jsonb`,
  both returning `MutationImpact`. Shared private projection helpers calculate
  proposed standings, invalidated ties, stage, and knockout slots without writes;
  mutation paths reuse the same progression rules under the mutation lock.
- Correction and withdrawal payloads add `previewTournamentVersion: number`;
  saving checks it with generation and existing entity versions before applying
  the change. Other direct-result and walkover payloads keep their behavior.
- `src/data/impacts.ts`: export
  `previewResultCorrection(matchId: UUID, score: Score, resetGeneration: number):
  Promise<MutationImpact>` and
  `previewWithdrawal(pairId: UUID, resetGeneration: number): Promise<MutationImpact>`.
- `ResultEditor({ snapshot, resetGeneration, matchId, onClose })` receives the
  selected match; `ResultSchedule`, `WithdrawalPanel`, and `ImpactPreview` live
  beside it under `src/features/organizer/`. Component prop types are explicit;
  `ImpactPreview` consumes `MutationImpact` and displays before/after differences.

### Phase 4 and 5 contracts

- `src/i18n/vi.ts` exports typed `messages`; parameterized messages are functions,
  not fragments concatenated in components. `src/i18n/format.ts` exports
  `formatNumber(value: number): string`; `src/i18n/errors.ts` exports
  `errorMessage(error: unknown): string` with a Vietnamese fallback.
- `src/features/tournament/document-title.ts` exports
  `tournamentTitle(name: string | null): string`; `App.tsx` applies it from current
  tournament state. The empty document title and static manifest use
  “Giải cầu lông”.
- Assets: `public/favicon.svg`, `public/favicon-32.png`,
  `public/apple-touch-icon.png` (180 square), `public/icon-192.png`,
  `public/icon-512.png`, and `public/site.webmanifest`. Manifest uses
  `display: standalone`, `start_url: /`, `scope: /`, and `lang: vi`, with ordinary
  icons (do not declare maskable unless separately prepared and checked).

## Existing verification debt

The previous spec records unavailable Docker-backed integration verification and
database types awaiting CLI generation in
[its execution status](../tournament-2026/EXECUTION.md#status). This interview
has not reverified or resolved that debt.

## Final review

The user confirmed the five-phase scope, product decisions, and consolidated
acceptance scenarios on 2026-09-15. The execution checklist is maintained in [EXECUTION.md](EXECUTION.md).
No application code, database data, or deployment was changed during this
interview.
