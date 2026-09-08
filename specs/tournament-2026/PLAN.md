# Badminton tournament 2026

Status: agreed product plan, consolidated on 2026-09-08. The official Vite React + TypeScript starter is scaffolded; tournament implementation has not started.

## Purpose and scope

Build a small internal website for one company badminton tournament in late September 2026. Replace spreadsheet-based tournament management with clear match tracking, live referee scoring, and organizer controls. This is a one-off project, not a general tournament platform.

Support 6–8 fixed doubles pairs, approximately 16 players, on two courts. Use English throughout. Prioritize phones, particularly landscape referee scoring, while making viewing comfortable on larger screens. Internet is expected to be reliable; operation requires a connection.

The event supports charity, but donation collection and fundraising management are outside the agreed scope.

## Visual reference

Use [the approved tournament prototype](../../references/tournament-prototype.html) as the visual reference.

- Use the Match ticket direction with rounded cards, controls, and score tiles.
- Use Be Vietnam Pro for typography.
- Keep each screen focused; use spacing, typography, score composition, and restrained brand color for visual impact.
- Avoid large promotional introductions, statistics strips, and unnecessary panels.
- Use rounded knockout tickets with seed-position badges, score slots, ticket separators, bracket connectors on wider screens, and a distinct company-blue final card.
- Referee scoring fills the viewport with two side-by-side colored tap areas, team labels above large scores, and Undo and Confirm centered above the scores. Omit “tap to add” instructions.
- Organizer screens use rounded sections for setup, pairs, and stage controls.

### Company palette

| Color | Hex |
| --- | --- |
| Orange | `#f15d27` |
| Blue | `#00448c` |
| Teal | `#23c0c3` |
| Charcoal | `#0f2b29` |
| Cream | `#f4f4e8` |
| Crimson | `#f1025d` |
| Purple | `#682bd7` |
| Pink | `#ff2ae2` |
| Titanium | `#bdbfc7` |
| Gold | `#ffd400` |

Use orange, blue, teal, and charcoal as the primary brand colors. Apply approved tints and secondary colors sparingly, preserving readable contrast.

### Prototype limitations

The HTML is a visual reference, not production architecture or a complete behavior specification. Its sample players, scores, progress, public staff tabs, setup controls, and scoring logic are illustrative. This plan governs where later decisions differ from the prototype. In particular, add team names and player seed badges, hide staff navigation from viewers, and implement persistent, authorized tournament operations.

## Tournament rules

### Players and pairs

- Organizers enter participants manually; registration and drawing happen elsewhere.
- Store the two players separately, each with a name and Seed 1 or Seed 2.
- Each pair may have an optional team name. Without one, display the two player names as its heading.
- Always display both player names and their seed badges on match cards and pair lists. The referee tracker shows a team heading, a smaller player/seed line, and the score.
- Same-seed pairs produce an advisory warning, not a block. The announcement permits organizer adjustments when seed pools are uneven.
- Pairs remain fixed throughout the tournament. There are no gender divisions.

### Groups and progression

- Two groups: 3+3 pairs for six, 4+3 for seven, and 4+4 for eight.
- Organizers enter group assignments from the external draw.
- Each group plays a round robin; its top two pairs advance.
- Semifinals are A1 vs B2 and B1 vs A2. Winners play the final. No third-place match.
- Total matches: 9 for six pairs, 12 for seven, and 15 for eight.
- Once all group matches are resolved, retain the group view and show that organizer confirmation is pending.
- Staff review standings, resolve remaining ties, and explicitly confirm progression before semifinal pairings become playable.

### Scoring and standings

- Every match is one game to 21, win by two, capped at 30.
- Valid completed scores are 21–0 through 21–19, 22–20 through 29–27 with a two-point margin, and 30–28 or 30–29, in either direction.
- Rank group pairs by match wins.
- For a two-pair tie, use head-to-head.
- For three or more tied pairs, use point difference in matches between those pairs.
- If still unresolved, the organizer sets the order with a recorded explanation.
- Standings use confirmed results, not live scores.
- A walkover awards a win without an artificial score and contributes no point difference.
- A pair withdrawing during groups has all its group results voided, so remaining pairs are compared on the same basis.

### Fixtures and courts

- Generate the round-robin fixtures and an initial playing order across two courts.
- Avoid consecutive matches for a pair where possible. Rest is at organizer discretion; there is no mandatory rest timer.
- Use court assignments and playing order only. Booking duration and exact match times are unknown.
- Lock pair membership, seeds, groups, and matchups when the first match starts.
- Keep court assignments and order editable for unstarted matches after play begins.
- Allow one active match per court and prevent a pair from playing on both courts simultaneously.

## Screens and flows

### Public viewing

Anyone with the unlisted link can view player names, seeds, fixtures, live scores, standings, and the bracket without signing in. An unlisted link is not an access restriction.

- Public navigation: Matches, Standings, Knockouts, and Staff Access.
- During groups, prioritize group information while keeping current court matches visible.
- After staff confirm groups, prioritize the knockout bracket.
- Show upcoming matches by court and playing order.
- After the confirmed final, prioritize the champion and completed bracket; standings remain accessible.
- Do not include a separate public completed-match history in the first release.

### Staff access

- One shared staff PIN grants organizer and referee capabilities; no individual staff profiles or separate permission tiers.
- Keep Referee and Organizer controls out of public navigation. After PIN entry, expose a separate staff control menu.
- Staff authorization lasts seven days from successful PIN verification, without sliding renewal, and supports explicit sign-out.
- Changing the PIN invalidates every existing staff session.
- Record action timestamps and anonymous staff session identifiers for debugging and conflict diagnosis.
- Never ship the PIN hash or privileged database credentials to the frontend.

### Referee scoring

1. Staff select Start scoring on an assigned, unstarted match.
2. Atomically claim its scorekeeper lock and mark it Playing. There is no separate Ready state.
3. Open the dedicated viewport-filling scoring screen.
4. Tapping a team's panel adds one point. Undo reverses the most recent point; live scoring has no direct score-entry control.
5. Persist every point and distribute updates to viewers.
6. Reaching a valid winning score stops point entry and opens a review dialog showing both teams and the score.
7. The referee confirms the result, or dismisses the dialog to undo a mistake. Confirmation finishes the match and updates standings or progression.

Only one staff session can score a match at a time. The same device restores the saved score and ownership after reload or reopening when its session remains valid. Another staff device must explicitly take over; the previous owner immediately loses write authority.

If saving fails, pause further scoring, clearly show “Score not saved,” preserve the pending point, and retry idempotently. Resume only after server confirmation. This is recovery for an interrupted request, not offline tournament operation.

### Organizer operations

- Edit the tournament name, pairs, optional team names, player names, seeds, and group assignments before play.
- Generate fixtures and initial order; edit court assignments and upcoming order as allowed above.
- Mark walkovers and withdrawals.
- Enter a final score directly for an unstarted match when live scoring was not used. Apply the same score validation and confirmation flow.
- Provide a compact completed-match list for staff to locate and correct results. This is required even though public results history is deferred.
- Correct confirmed results until a dependent knockout match starts. Recalculate standings and affected unstarted knockout pairings. Block corrections that would alter participants in a dependent match already started.
- Review and confirm group standings before knockouts.
- Confirming the final marks the tournament Completed and locks scoring.
- Allow an explicit organizer recovery action to reopen a completed tournament when correction is required. Preserve downstream correction restrictions.
- Do not provide a tournament reset or rehearsal-reset feature.

## Architecture and hosting

### Selected stack

- React, Vite, and TypeScript with strict types.
- Tailwind CSS and shadcn/ui.
- Cloudflare Pages Free for static hosting, under a company-owned account.
- Supabase Free for PostgreSQL, Realtime, and staff authentication/session state.
- A Supabase Edge Function validates the shared staff PIN and establishes staff authorization.
- Frontend reads and authorized mutations use Supabase's HTTPS Data API and PostgreSQL RPC functions. There is no raw PostgreSQL connection from the browser.
- Next.js and Vercel are excluded from the selected architecture.

### Trust boundaries and concurrency

- Frontend clients use a publishable Supabase key. Privileged keys stay server-side.
- Public reads are restricted to intended tournament information through database grants and Row Level Security.
- Staff mutations use narrowly scoped RPC operations, not unrestricted table updates.
- Every mutation validates a live, authorized staff session. PIN rotation must revoke access immediately, including access from otherwise unexpired tokens; a stale staff claim alone is insufficient.
- Use Supabase anonymous Auth for staff sign-in, then verify the PIN through the Edge Function to grant seven days of staff authorization in a private session registry. Public viewing does not create an Auth user. Anonymous Auth alone grants no staff permissions.
- Bind each staff grant to the verified Auth user and session identifier. Every mutation checks the registry for expiry, revocation, and the current PIN generation. PIN rotation invalidates all existing grants immediately; sign-out revokes the current grant. Supabase manages Auth token refresh separately from the fixed staff-authorization expiry.
- Database transactions enforce score validity, scorekeeper ownership, match/court exclusivity, record versions, and allowed state transitions.
- Idempotency prevents duplicate points when a response is lost or a request is retried.
- Use Realtime Postgres Changes for this small audience. On reconnection, fetch authoritative state rather than assuming every event was delivered.
- PIN attempts require server-side rate limiting. UI visibility is not authorization.

### Free-tier and licensing constraints

Commercial/company use must be compatible with the selected service plans and dependency licenses. Do not infer eligibility from quota sufficiency alone. Verify current applicable terms before provisioning or deploying.

Supabase Free was selected based on capacity sufficient for this event. It can pause projects after approximately a week of low activity. Add a pre-event check to resume if needed and verify reads, writes, and live scoring one day before the tournament. Active database access is distinct from Edge Function cold starts; the proposed scoring path does not invoke an Edge Function per point.

Cloudflare Pages static hosting and its free build quota fit the scope. No Cloudflare Functions are planned. Use permissively licensed application dependencies suitable for commercial use, retain required notices, and verify the font license when self-hosting Be Vietnam Pro.

### shadcn/ui requirements

These are mandatory implementation rules requested by the user:

1. Check the official shadcn/ui component catalog before building a UI control.
2. If an appropriate shadcn component exists, install and use it instead of a native control or custom replacement. This covers buttons, dialogs, forms, fields, selects, tabs, menus, tables, and other applicable components.
3. Install and add components through the official documented CLI, using `npx` or the documented package-manager equivalent.
4. Do not recreate a component by reading documentation and manually writing its implementation.
5. Do not inspect `node_modules` to copy or reconstruct component implementations.
6. Compose and style installed components to match the prototype. Custom match tickets, bracket geometry, and scoring layouts remain appropriate where the catalog has no domain-specific equivalent.
7. Native semantic layout elements remain appropriate; this rule concerns available UI components, not replacing all HTML semantics.

## Deferred and excluded work

| Item | Disposition |
| --- | --- |
| Public results history and filters | Deferred |
| Registration and in-app seed pairing/group draws | Outside first release; performed externally |
| Multiple tournaments, seasons, and archives | Excluded for this one-off project |
| Offline operation and cross-device offline reconciliation | Excluded |
| Exact match times and mandatory rest timers | Excluded |
| Named staff profiles and individual accounts in the UI | Excluded |
| Tournament reset | Explicitly declined |
| Payments, donation collection, and fundraising tracking | Outside agreed scope |

## Implementation verification

Use Vitest for pure logic and focused local Supabase integration tests. Do not add React Testing Library, component snapshot tests, or an automated browser suite. Review UI behavior manually against the prototype.

Verify the behavior that can affect tournament integrity:

- Fixture generation for all three supported pair counts and court/pair exclusivity.
- Winning-score boundaries, cap handling, repeated undo, direct result entry, walkovers, withdrawals, and tiebreak fallback.
- Concurrent scorekeeper claims, takeover, stale-owner writes, and duplicate/retried mutations.
- Anonymous write denial, session expiry, PIN-rotation revocation, and RPC authorization.
- Result correction before and after dependent matches start, group confirmation, final completion, and controlled reopening.
- Reconnect/reload recovery and server-authoritative reconciliation.
- Phone portrait and landscape layouts, safe-area spacing, touch controls, keyboard/focus behavior, dialogs, readable colors, and larger-screen viewing.
- Staff navigation remains private in the UI while server checks independently protect each action.

No code commits, external account provisioning, paid-plan purchases, or deployments are authorized by this planning document alone.

## Remaining implementation details

The product scope, staff authorization flow, UUID identifiers, explicit transactional RPCs, feature folders, and logic-focused testing are agreed. Before deployment, resolve account/project identifiers, the production URL, exact event date, final entrants, and the initial staff PIN through appropriate secret handling. No production provisioning or deployment is part of execution without separate authorization.

## Schema changes

Keep one tournament; do not add a multi-tournament management layer. Use UUID primary keys, UTC timestamps, integer versions, foreign keys, and checked state values. SQL migrations live in `supabase/migrations/`.

- `public.tournament`: singleton UUID, name, stage (`setup`, `groups`, `knockouts`, `completed`), setup-lock timestamp, version. Preserve the setup lock when reopening.
- `public.players`: UUID, name, seed (`1` or `2`). `public.pairs`: UUID, optional team name, two distinct player foreign keys, group (`A` or `B`), withdrawn flag. Enforce that a player belongs to at most one pair across both slots.
- `public.matches`: UUID, round (`group`, `semifinal`, `final`), optional group, pair foreign keys, source labels/dependent match foreign keys for knockout slots, court (`1` or `2`), playing order, state (`unstarted`, `playing`, `completed`, `void`), scores, result kind (`played` or `walkover`), winner, version. Unresolved knockout slots may be null; starting requires both participants.
- `public.tie_resolutions`: group, ordered pair UUIDs, explanation, standings revision. Invalidate resolutions when contributing results change.
- `private.staff_grants`: Auth session UUID, Auth user UUID, granted/expiry/revoked timestamps, PIN generation. `private.staff_config`: singleton PIN hash and generation. `private.pin_attempts`: server-derived rate-limit bucket and attempt timestamps/counts.
- `private.match_ownership`: match UUID and staff-session UUID. `private.mutation_log`: request UUID, staff-session UUID, operation, payload fingerprint, response, timestamp, match UUID when applicable, point side and undone marker when applicable. Keep ownership and audit identifiers out of public match rows.

All mutations serialize on the singleton tournament row, then check the current grant, expected record version, and operation rules. This deliberately simple lock scope fits two courts. A repeated request with the same session and payload returns its recorded result; mismatched reuse fails. Check current authorization and score ownership before replaying a scoring response. Increment tournament version for each tournament mutation and affected match versions for match changes.

## API changes

Create `src/domain/types.ts` for `UUID = string`, `Group = 'A' | 'B'`, `Side = 'a' | 'b'`, `Score = { a: number; b: number }`, and the typed `Tournament`, `Player`, `Pair`, `Match`, `TieResolution`, `TournamentSnapshot`, `Standing`, `Fixture`, `SetupInput`, `CourtAssignment`, and `StaffAccess` records corresponding to the fields above. `TournamentSnapshot` contains tournament, players, pairs, matches, and tie resolutions, never private rows. `StaffAccess` contains sessionId and expiresAt.

Create `src/domain/commands.ts` with `CommandPayloads` mapping the following operation names to payloads. `MutationInput<K extends keyof CommandPayloads>` is `{ requestId: UUID; expectedVersion: number; payload: CommandPayloads[K] }`; expectedVersion refers to the match for match operations and the tournament otherwise. `MutationReceipt` is `{ requestId: UUID; tournamentVersion: number; matchId: UUID | null; matchVersion: number | null }`.

| RPC operation | Payload |
| --- | --- |
| `save_setup` | `{ setup: SetupInput }` |
| `generate_fixtures` | `{}` |
| `assign_courts` | `{ assignments: CourtAssignment[] }` |
| `start_scoring`, `take_over`, `undo_point`, `confirm_result` | `{ matchId: UUID }` |
| `add_point` | `{ matchId: UUID; side: Side }` |
| `enter_result`, `correct_result` | `{ matchId: UUID; score: Score }` |
| `mark_walkover` | `{ matchId: UUID; winnerId: UUID }` |
| `withdraw_pair` | `{ pairId: UUID }` |
| `resolve_tie` | `{ group: Group; orderedPairIds: UUID[]; explanation: string }` |
| `confirm_groups`, `reopen_tournament` | `{}` |

Each named public mutation RPC takes `(p_request_id uuid, p_expected_version integer, p_payload jsonb)` and returns a JSON `MutationReceipt`; validate payload fields server-side. `get_tournament_snapshot() returns jsonb` provides one consistent public snapshot. `get_staff_access() returns jsonb` returns the caller's valid grant or null; `get_score_access(p_match_id uuid) returns boolean` reports caller ownership without exposing another session. `revoke_staff_access() returns void` revokes the caller's grant.

`supabase/functions/staff-pin/index.ts` accepts `{ pin: string }` with a verified anonymous Auth JWT and returns `StaffAccess`. Verify the JWT user and session; never trust body-supplied identity. Use a server-only password hash, constant-time library verification, transactional rate limiting and grant issuance. `supabase/functions/rotate-pin/index.ts` accepts `{ pin: string }` from a currently authorized staff session and atomically updates hash/generation. Both endpoints reject invalid input without logging PINs. Store secrets only server-side; provision the initial hash through the documented operator procedure.

Create `src/domain/scoring.ts` with `isWinningScore(score: Score): boolean`; `src/domain/fixtures.ts` with `generateFixtures(pairs: readonly Pair[]): Fixture[]`; `src/domain/standings.ts` with `calculateStandings(snapshot: TournamentSnapshot, group: Group): Standing[]`. SQL remains authoritative for writes; test SQL outcomes against the same scoring, fixture, and standings examples. A residual tie after applying its specified criterion requires manual resolution, without recursively inventing another tiebreak rule.

## Frontend changes

- `src/lib/supabase.ts` creates the publishable-key client; `src/lib/database.types.ts` contains CLI-generated database types. `.env.example` documents public configuration names without credentials.
- `src/data/tournament.ts` exports `fetchTournament(): Promise<TournamentSnapshot>`, `mutateTournament<K extends keyof CommandPayloads>(operation: K, input: MutationInput<K>): Promise<MutationReceipt>`, and `subscribeTournament(onChange: () => void): () => void`. Treat Realtime events as invalidations; fetch snapshots with stale-response protection.
- `src/data/staff.ts` exports `signInStaff(pin: string): Promise<StaffAccess>`, `getStaffAccess(): Promise<StaffAccess | null>`, `signOutStaff(): Promise<void>`, `rotateStaffPin(pin: string): Promise<void>`, and `canScore(matchId: UUID): Promise<boolean>`.
- `src/features/scoring/scoring-state.ts` exports pure `reduceScoring(state: ScoringState, event: ScoringEvent): ScoringState`. Define the discriminated states/events in this file: idle, saving, failed, and reviewing; preserve one pending request UUID across retries, block further point entry until acknowledgement, and retain ownership/version conflicts for explicit recovery.
- `src/features/tournament/` holds `TournamentPage.tsx`, `MatchTicket.tsx`, `StandingsTable.tsx`, and `KnockoutBracket.tsx`; `src/features/staff/` holds `StaffAccessDialog.tsx` and `StaffMenu.tsx`; `src/features/scoring/` holds `ScoreTracker.tsx`; `src/features/organizer/` holds `OrganizerPage.tsx`, `SetupForm.tsx`, and `ResultEditor.tsx`.
- `src/App.tsx` owns navigation and snapshot loading; `src/index.css` owns the brand tokens and typography. Install reusable controls into `src/components/ui/` using the official shadcn CLI. Keep score panels as styled shadcn buttons. Self-host Be Vietnam Pro and retain its license in `THIRD_PARTY_NOTICES.md`.

## Test and delivery structure

Use `vitest.config.ts`, strict project-wide TypeScript configurations, and package scripts `typecheck`, `test`, and `test:related`. Typecheck covers frontend, tests, tooling, and Edge Function sources with the appropriate runtime types. `test` runs the full Vitest suite; `test:related` runs `vitest related --run` with changed paths supplied at execution.

Pure tests: `src/domain/scoring.test.ts`, `src/domain/fixtures.test.ts`, `src/domain/standings.test.ts`, `src/features/scoring/scoring-state.test.ts`, and `src/data/tournament.test.ts`. Focus data-layer tests on retry identity, reconciliation, and stale responses; do not test component rendering.

Integration tests: `tests/integration/auth.test.ts` and `tests/integration/tournament.test.ts`, using `tests/integration/local-supabase.ts`. Restrict fixtures to a disposable local Supabase instance and refuse remote URLs. Missing local services fail explicitly; do not silently skip database tests. SQL and Edge configuration changes have no reliable TypeScript import graph, so run the integration suite as a fallback when those paths change. Configure Vitest to rerun tests for shared test/configuration changes.

The Supabase CLI must be installed as a development dependency through npm. Docker is installed but its daemon was unavailable during planning on 2026-09-08. Database integration checks require the daemon, local Supabase, and locally served Edge Functions. If still blocked during execution, record the blocked check as verification debt with pure-logic test evidence; do not claim database verification.

`README.md` documents local setup and commands. `docs/deployment.md` documents company-owned Cloudflare Pages/Supabase configuration, license checks, PIN initialization/rotation, migration deployment, and the pre-event smoke check. Producing instructions does not deploy or provision accounts.

## Reference documentation

- [Supabase frontend data security](https://supabase.com/docs/guides/database/secure-data)
- [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys)
- [Supabase Realtime Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes)
- [Supabase project pausing](https://supabase.com/docs/guides/platform/free-project-pausing)
- [Cloudflare Pages limits](https://developers.cloudflare.com/pages/platform/limits/)
- [Cloudflare Pages pricing](https://developers.cloudflare.com/pages/functions/pricing/)
- [Cloudflare self-serve subscription agreement](https://www.cloudflare.com/terms/)
- [shadcn/ui installation](https://ui.shadcn.com/docs/installation)
- [shadcn/ui components](https://ui.shadcn.com/docs/components)
