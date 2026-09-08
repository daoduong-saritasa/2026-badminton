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
- Staff sessions last several days and support explicit sign-out. Final duration is an implementation parameter.
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
- The exact supported mechanism for establishing the staff Auth session must be verified before implementation. Do not assume an Edge Function can mint an ordinary refreshable Supabase Auth session merely by setting a claim.
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

The product scope is agreed. Before deployment, resolve account/project identifiers, the production URL, exact event date, final entrants, and the initial staff PIN through appropriate secret handling. Before building staff authentication, verify the supported Supabase session flow and select the concrete revocation implementation. These details do not change the accepted screen or tournament scope.

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
