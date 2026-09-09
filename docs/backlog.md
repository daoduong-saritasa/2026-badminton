# Backlog

Work identified but not scheduled. Each entry records why it matters, what it touches, and
what has to be decided before anyone starts. Nothing here is committed to a release.

Order below is recording order, not priority.

## Vietnamese translation

Players, staff and spectators are Vietnamese, and every string in the interface is English.
The tournament data is already Vietnamese — player names, pair names — so the app currently
mixes the two languages on the same screen.

**What it touches.** There is no internationalization library in `package.json`, and no
message catalogue. User-facing strings are written inline in roughly a dozen components under
`src/features/`, mixed with layout markup. `index.html` declares `lang="en"`.

**Open decisions:**

- Whether Vietnamese replaces English or the two ship side by side with a language switch. A
  switch costs a persisted preference and doubles the review surface; replacing English is
  cheaper but locks out non-Vietnamese staff.
- Whether staff-only screens need translating at all, or only the public views a spectator
  sees.
- Library or hand-rolled. The string count is small enough that a typed record of messages
  and a `useMessages` hook may beat adding a dependency.

**Also in scope:** `lang` on the document, `Intl.NumberFormat` for scores and counts, and a
check that Be Vietnam Pro covers every diacritic used — it was chosen for this, but nothing
verifies it.

## Reset tournament status for end-to-end testing

There is no way to return a tournament to the start, so the full flow can only be exercised
once per database. Rehearsing an event, or reproducing a bug that appears in the knockout
stage, currently means resetting the database by hand.

`reopen_tournament` is the closest existing command and is deliberately narrow: it requires
stage `completed`, clears only the final match result, and returns the tournament to
`knockouts`. Nothing rewinds to `groups` or `setup`.

Reset is also blocked from the other direction: `save_setup` refuses once
`tournament.setup_locked_at` is set or any match has left `unstarted`.

**Open decisions:**

- Whether this is a staff-facing command or a maintenance script. A destructive reset behind
  the staff PIN is a real hazard at a live event — the PIN is shared among referees.
- Whether reset means "wipe results, keep pairs" or "wipe everything back to an empty setup".
  These are different commands and both are useful.
- Whether it should exist in production at all, or be restricted to local and staging
  databases. Gating on a database setting rather than a UI affordance is the safer shape.

Any version needs a confirmation step that names what will be destroyed, and a mutation log
entry, like every other command.

## Flexible pair count

The tournament is fixed at six to eight pairs in two groups, and the group split must be
exactly 3+3, 4+3 or 4+4. A different entry count cannot be run without code changes.

**Where the constraint lives.** Three places enforce it independently, and they must stay in
agreement:

- `SetupForm.tsx` — client validation and the "Add pair" limit
- `save_setup` in `supabase/migrations/202609080003_tournament.sql` — rejects anything
  outside 6 to 8 with the fixed splits
- `generateFixtures` in `src/domain/fixtures.ts` — asserts the expected group sizes

**This is not only a validation change.** The knockout shape is hard-coded to the same
assumption: two groups feeding two semifinals feeding one final, with the top two from each
group qualifying. Ten pairs, or three groups, or a quarter-final round, all change the bracket
that `generateFixtures` builds and that `KnockoutBracket.tsx` draws.

**Open decisions:**

- The real range. Twelve pairs in two groups of six is a different problem from twelve pairs
  in four groups of three.
- Whether the number of groups becomes configurable, or stays at two with variable size.
- What the knockout stage looks like when group count changes — this is the decision the rest
  depends on, and it should be settled before any validation is touched.
- Court count is currently two, and playing order is unique per court. More pairs means more
  matches on the same two courts, so the schedule may need a session or time concept rather
  than a single queue.

## Easier results and withdrawals

Recording a result that was not scored live is slower than it should be, and the panel is the
one an organizer reaches for under time pressure.

**Current shape.** `ResultEditor.tsx` presents a single select listing every editable match as
`Group A · Minh / Linh vs Duc / Mai · completed`, then two score inputs. Finding a match
means reading the whole list. Withdrawals share the same panel but are a different task with
different consequences.

**Candidate improvements**, none decided:

- Pick the match from the schedule rather than a flat select — the organizer knows which
  court and roughly when, not the match's position in a list.
- Separate withdrawals from result entry. Withdrawal voids fixtures and is irreversible in
  practice; it does not belong behind the same control as fixing a typo in a score.
- A quick-entry path for the common case: an unstarted match that was played off-app, where
  the organizer just needs two numbers.
- Show what a correction will invalidate before it is applied. `assert_correction_safe`
  already refuses a winner change once downstream play has started, but the operator only
  finds out after trying.

**Worth confirming first:** how often results are actually entered this way. If nearly every
match is scored live by a referee, this panel is a recovery tool and simplicity matters more
than speed. Watching one real event would settle it.

## Application icon and document title

The browser tab still carries the Vite scaffold identity. `index.html` sets
`<title>badminton</title>` — lowercase, the npm package name — and `public/favicon.svg` is
the default purple Vite mark. Anyone who bookmarks the app, pins the tab, or adds it to a
phone home screen gets a generic entry that says nothing about the tournament.

**What it touches.** `index.html` (the `<title>` and the `<link rel="icon">`) and
`public/favicon.svg`. Nothing in `src/` reads either, so this is self-contained unless a
per-screen title is wanted. `public/icons.svg` is the interface sprite and is unrelated —
it should not become the source of the favicon by accident.

**Open decisions:**

- What the app is called. The title is the name the audience sees first, and no name has
  been settled — the repository, the package and the interface heading do not agree.
- Whether the title stays fixed or reflects the current tournament and stage. A dynamic
  title helps an organizer running two tabs at a live event; it also means the name lives
  in `src/` rather than in `index.html`.
- What the mark is. A shuttlecock is the obvious choice and also the choice everyone makes;
  the tournament tokens already define a palette the icon should draw from.
- Which formats to ship. An SVG favicon alone leaves older browsers and iOS home screens
  with nothing, so a PNG set and a web app manifest may be in scope — that decision turns
  on whether anyone is expected to install the app to a home screen.
