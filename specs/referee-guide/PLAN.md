# Referee walkthrough

Status: approved on 2026-10-07. Ready for execution planning via the spec-plan skill.

## Purpose

Help any available player understand the referee workflow before volunteering for a match.
The tournament is on Saturday, October 10, 2026.
The guide is optional and available whenever players need it.
The organizer will train the other organizer personally.

## Confirmed decisions

- Publish a separate Vietnamese guide page at `/guide`, accessible without a referee PIN.
- Add an **Hướng dẫn** link to the main public tournament page.
- Use Driver.js for a walkthrough of the referee workflow.
- Render the app's relevant visual components with fictional tournament data.
- **Next** advances the walkthrough and updates the mock screens automatically.
- Users do not need to enter a PIN, select players, or score points themselves.
- Provide **Back**, **Close**, and **Restart** controls with Vietnamese labels.
- Include failed-save recovery, scoring takeover, and matches that require two game wins.
- Prioritize phone layouts while retaining keyboard and desktop usability.
- Keep every guide state and action isolated from the live tournament.

## Scope and exclusions

The guide demonstrates referee access, match selection, pair assignment, starting a match,
scoring, undo, swapping displayed sides, and confirming results.
It also explains resuming a match and the recovery situations listed below.

There is no organizer lesson, free-practice mode, exercise requirement, or completion gate.
There is no completion tracking or tournament-day notification feature.
The guide does not render every application component; it renders the components needed for referee training.
It does not change tournament rules or referee permissions.

## Walkthrough sequence

The following sections define coverage, rather than an exact popover count.
Keep each popover focused on one action or distinction.

1. Introduce the fictional tournament and explain that guide actions cannot affect real matches.
2. Show the staff-access button and PIN dialog with a clearly labeled example PIN.
   Explain that the organizer supplies the actual referee PIN separately.
3. Show the referee match picker, court labels, and match identity.
   Explain how to distinguish upcoming matches from matches already in progress.
4. Open pair assignment and demonstrate saving the pairs named by the teams.
   Explain seed labels, the current stage's pairing rule, and the need to contact an organizer for a rule exception.
5. Show why a match without saved pairs cannot start.
   Demonstrate the start confirmation after valid pairs are saved.
6. Show the scoring surface and demonstrate adding a point to the correct pair.
   Explain the save indicator before another point can be recorded.
7. Demonstrate undoing an incorrect point.
8. Demonstrate swapping the displayed sides.
   Explain that this changes their screen position without changing the teams or score.
9. Move the example near game point and show the game-result confirmation dialog.
   Explain reviewing the score, returning to undo when needed, and confirming a correct result.
10. Show that a completed single-game match returns to the match picker.
11. Demonstrate a placement match where confirming a game starts another game.
    Explain that the first pair to win two games wins the match.
    Distinguish a game from a match and a match from a team fixture.
12. Show a simulated failed point save and demonstrate retry.
    Explain that a failed save needs recovery before further scoring.
13. Show resuming an active match and the scoring-takeover confirmation.
    Explain coordinating with the current referee before takeover.
    Explain that takeover removes the previous device's scoring control.
14. Finish with a reminder to contact an organizer for exceptions or corrections to confirmed results.
    Offer **Restart** and an explicit link to the live tournament.

Use coherent examples, with explicit transitions when the walkthrough changes stages or demonstrates a failure.
Do not imply that an error or takeover always follows result confirmation.

## Navigation and presentation

- Render a visible **Hướng dẫn** heading and notice identifying the fictional data.
- Start the tour through a clearly labeled button on the guide page.
- Keep progression controlled by the walkthrough, rather than the example screen's action buttons.
- Disable or intercept example controls so they cannot bypass the demonstrated sequence or trigger live actions.
- **Back** restores the exact example state and target for the preceding step.
- **Close** dismisses the tour and leaves the user on the guide page with a restart option.
- **Restart** restores the initial example and starts the walkthrough from its first step.
- Reloading starts a fresh guide session without saved progress.
- Keep navigation controls available on small screens and when highlighting dialogs.
- Avoid unnecessary motion and respect reduced-motion preferences.
- Use existing Vietnamese UI terms from `CONTEXT.md` and `src/i18n/vi.ts`.

## Isolation requirements

The guide must not mount the live `App` or its tournament and staff queries.
It must not fetch tournament data, subscribe to realtime updates, or call Supabase authentication or RPCs.
It must not inspect, modify, or revoke a real staff session.
It must not read or write live scoring preferences, including side-order storage keys.

Fictional fixtures, matches, pairs, and players belong to a guide-only dataset.
Snapshots and simulated failures stay in memory for the current guide visit.
The example PIN is explanatory content, not an authentication credential.
Opening the live tournament requires an explicit navigation action.
Closing or finishing the walkthrough must not navigate there automatically.

## Implementation direction

`src/main.tsx` already renders `/rules` separately from the live application.
Use the same route boundary for `/guide` and support a trailing slash.
Verify direct navigation and reload through the project's deployment configuration.

`ScoreTracker`, `PairAssignmentForm`, and `StaffAccessDialog` currently combine presentation with live calls.
Extract reusable presentation components where necessary.
Keep live hooks and operations in their existing live containers.
The guide supplies presentation state and controlled callbacks without importing those containers.

Prefer narrow component contracts over a global mock mode or replacement of the shared data layer.
Share visual structure so the guide follows future changes to the live interface.
Reuse pure domain rules where they improve accuracy.
No database migration, new backend endpoint, or authentication change is needed.

Model each walkthrough step with a stable target and an explicit example state.
Apply that state before Driver.js highlights the target, including targets inside dialogs.
Use stable guide selectors rather than text or styling selectors.
Keep the guide and Driver.js loading separate from the live scoring path where practical.
Check the installed Driver.js version against its documented API before implementation.

## Verification criteria

- `/guide` and `/guide/` render directly without a real PIN or tournament data.
- The public page exposes the **Hướng dẫn** link.
- Opening and completing the guide produces no Supabase requests or realtime connections.
- An existing real staff session and scoring preferences remain unchanged after guide use.
- All promised sections render the correct example and highlight target.
- **Back** works across screens, dialogs, stage changes, and simulated failures.
- **Close** and **Restart** work from any step without stale overlays or example state.
- A full walkthrough demonstrates valid pair assignment and score confirmation under the existing domain rules.
- Dialog focus handling and Driver.js navigation work together with a keyboard.
- At phone widths, users can read each popover and reach its navigation controls.
- Existing live referee actions retain their behavior after presentation extraction.

Use focused tests for step transitions and route isolation.
Use browser checks to prove the absence of backend requests and exercise dialog transitions.
Run project-wide typechecking and dependency-aware tests during each implementation phase.
Run the full suite and production build at the final spec gate.

Do not start local Supabase or weaken integration tests.
Database integration suites fail their setup without the local socket, as documented in `AGENTS.md`.
Report the actual failed suites, pass count, and skip count; record the unavailable database gate as verification debt.

## Risks and tradeoffs

Presentation extraction touches the live referee workflow and therefore needs regression verification.
Duplicating complete screens would reduce immediate refactoring but allow the guide and live app to diverge.
The plan chooses shared presentation with separate live and guide state.

Driver.js overlays and dialog focus traps can conflict.
Resolve that interaction within shared presentation contracts without weakening live dialogs.

The deadline favors one short sequential walkthrough over separate lessons or a practice simulator.
Neither a new glossary term nor an app-wide architectural decision is required by this feature.

## Sources

- [Driver.js repository](https://github.com/nilbuild/driver.js)
- [Driver.js configuration](https://driverjs.com/docs/configuration)
- [Driver.js dynamic tour targets](https://driverjs.com/docs/async-tour)
