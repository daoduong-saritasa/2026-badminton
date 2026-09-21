import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  CalendarRange,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Flag,
  LayoutDashboard,
  ListChecks,
  Play,
  Shuffle,
  Trophy,
  Users,
} from 'lucide-react'

import { mutateTournament } from '@/data/tournament'
import { resolvedFinalists, type FinalistBasis } from '@/domain/progression'
import { validateQualifyingRotation } from '@/domain/roster'
import { qualificationCutoff, qualifyingStandings, requiredPlayoff, threeTeamPlayoffOutcome } from '@/domain/standings'
import type { Court, FixtureMatch, TournamentSnapshot, UUID } from '@/domain/types'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  fixtureMatches,
  fixtureLabel,
  fixtureOf,
  isDeciderEligible,
  matchLabel,
  sideTeamId,
  teamName,
  teamNames,
} from '@/features/tournament/labels'
import { errorMessage } from '@/i18n/errors'
import { formatNumber } from '@/i18n/format'
import { messages } from '@/i18n/vi'
import { LineupEditor } from './LineupEditor'
import { ResultEditor } from './ResultEditor'
import { ResultSchedule, type ResultAction } from './ResultSchedule'
import { SetupForm } from './SetupForm'

const courts: readonly Court[] = [1, 2]

/**
 * Result entry is driven from the schedule: pick a match, then edit that one
 * match in a dialog, so the schedule never shifts underneath it.
 */
function ResultsSection({
  snapshot,
  resetGeneration,
}: {
  snapshot: TournamentSnapshot
  resetGeneration: number
}) {
  // The match outlives `open` so the dialog keeps its content while it animates
  // closed; `session` remounts the editor so reopening never shows a stale draft.
  const [editing, setEditing] = useState<{ matchId: UUID; action: ResultAction; session: number } | null>(null)
  const [open, setOpen] = useState(false)

  const select = (matchId: UUID, action: ResultAction) => {
    setEditing((previous) => ({ matchId, action, session: (previous?.session ?? 0) + 1 }))
    setOpen(true)
  }

  return (
    <>
      <ResultSchedule snapshot={snapshot} onSelect={select} />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
          {editing ? (
            <ResultEditor
              key={editing.session}
              snapshot={snapshot}
              resetGeneration={resetGeneration}
              matchId={editing.matchId}
              action={editing.action}
              onClose={() => setOpen(false)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}

function StageProgressMeter({ snapshot }: { snapshot: TournamentSnapshot }) {
  const total = snapshot.matches.length
  if (total === 0) return null
  const done = snapshot.matches.filter((match) => match.state === 'completed' || match.state === 'unnecessary').length
  const label = messages.organizer.progress
  return (
    <div className="min-w-52">
      <p className="text-[0.6875rem] text-muted-ink">
        <span className="numeric text-sm font-semibold text-navy">{formatNumber(done)}</span>
        <span className="numeric"> / {formatNumber(total)}</span> {label}
      </p>
      <div
        className="mt-2.5 h-[5px] overflow-hidden rounded-[5px] bg-mist"
        role="progressbar"
        aria-label={label}
        aria-valuenow={done}
        aria-valuemin={0}
        aria-valuemax={total}
      >
        <div className="h-full rounded-[5px] bg-cyan transition-[width] duration-300" style={{ width: `${(done / total) * 100}%` }} />
      </div>
    </div>
  )
}

function teams(snapshot: TournamentSnapshot, match: FixtureMatch): string {
  const fixture = fixtureOf(snapshot, match)
  return messages.common.versus(teamName(snapshot, sideTeamId(fixture, 'a')), teamName(snapshot, sideTeamId(fixture, 'b')))
}

function CourtSchedule({ snapshot, resetGeneration, onStartScoring }: { snapshot: TournamentSnapshot; resetGeneration: number; onStartScoring: () => void }) {
  const waiting = snapshot.matches.filter((match) =>
    match.state === 'unstarted' && match.pairA !== null && isDeciderEligible(snapshot, match))
  const [drafts, setDrafts] = useState<Record<UUID, Court>>({})
  const [confirmAssignments, setConfirmAssignments] = useState(false)
  const [startMatchId, setStartMatchId] = useState<UUID | null>(null)
  const assignments = waiting.flatMap((match) => {
    const court = drafts[match.id]
    return court !== undefined && court !== match.court ? [{ matchId: match.id, court }] : []
  })

  const assignmentMutation = useMutation({
    mutationFn: () => mutateTournament('assign_courts', {
      requestId: crypto.randomUUID(),
      resetGeneration,
      expectedVersion: snapshot.tournament.version,
      payload: { assignments },
    }),
    onSuccess: () => {
      setConfirmAssignments(false)
      setDrafts({})
    },
  })
  const startMutation = useMutation({
    mutationFn: (matchId: UUID) => {
      const match = snapshot.matches.find((candidate) => candidate.id === matchId)
      if (!match) throw new Error(messages.organizer.matchGone)
      return mutateTournament('start_match', {
        requestId: crypto.randomUUID(),
        resetGeneration,
        expectedVersion: match.version,
        payload: { matchId },
      })
    },
    onSuccess: onStartScoring,
  })

  return (
    <section className="rounded-card border border-ink/5 bg-white p-6 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{messages.organizer.schedule.heading}</h3>
          <p className="mt-1.5 text-[0.6875rem]/[1.6] text-muted-ink">{messages.organizer.schedule.description}</p>
        </div>
        <CalendarRange className="size-5 text-muted-ink" />
      </div>
      {waiting.length > 0 ? (
        <div
          aria-hidden="true"
          className="mt-6 mb-2 hidden gap-2.5 px-[0.9375rem] text-[0.625rem] text-muted-ink md:grid md:grid-cols-[minmax(0,1fr)_9rem_6.5rem]"
        >
          <span>{messages.organizer.schedule.match}</span>
          <span>{messages.organizer.schedule.court}</span>
          <span />
        </div>
      ) : null}
      <div className="space-y-3">
        {waiting.map((match) => {
          const court = drafts[match.id] ?? match.court
          return (
            <div className="grid gap-2.5 rounded-field border border-hairline p-3.5 md:grid-cols-[minmax(0,1fr)_9rem_6.5rem] md:items-center" key={match.id}>
              <span className="flex min-w-0 flex-wrap items-center gap-2.5">
                <span className="shrink-0 rounded-pill bg-well px-2 py-0.5 text-[0.625rem] font-semibold text-muted-ink">
                  {matchLabel(snapshot, match)}
                </span>
                <span className="min-w-0 [overflow-wrap:anywhere] text-[0.8125rem] font-medium">{teams(snapshot, match)}</span>
              </span>
              <Select
                value={court === null ? '' : String(court)}
                onValueChange={(value) => setDrafts((current) => ({ ...current, [match.id]: Number(value) as Court }))}
              >
                <SelectTrigger className="w-full" aria-label={messages.organizer.schedule.courtFor(`${matchLabel(snapshot, match)} · ${teams(snapshot, match)}`)}>
                  <SelectValue placeholder={messages.organizer.schedule.noCourt} />
                </SelectTrigger>
                <SelectContent>
                  {courts.map((option) => <SelectItem value={String(option)} key={option}>{messages.common.court(option)}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button variant="outline" className="w-full" disabled={match.court === null || startMutation.isPending} onClick={() => setStartMatchId(match.id)}>
                <Play /> {messages.organizer.schedule.startShort}
              </Button>
            </div>
          )
        })}
        {waiting.length === 0 ? <p className="text-[0.8125rem] text-muted-ink">{messages.organizer.schedule.empty}</p> : null}
      </div>
      {waiting.length > 0 ? (
        <Button className="mt-4" variant="outline" disabled={assignments.length === 0 || assignmentMutation.isPending} onClick={() => setConfirmAssignments(true)}>
          {messages.organizer.schedule.review}
        </Button>
      ) : null}
      {assignmentMutation.isError ? <p className="mt-3 text-sm text-destructive" role="alert">{errorMessage(assignmentMutation.error)}</p> : null}
      {startMutation.isError ? <p className="mt-3 text-sm text-destructive" role="alert">{errorMessage(startMutation.error)}</p> : null}

      <AlertDialog open={confirmAssignments} onOpenChange={setConfirmAssignments}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{messages.organizer.schedule.confirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>{messages.organizer.schedule.confirmBody}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{messages.organizer.schedule.keep}</AlertDialogCancel>
            <AlertDialogAction disabled={assignmentMutation.isPending} onClick={() => assignmentMutation.mutate()}>
              {assignmentMutation.isPending ? messages.common.saving : messages.organizer.schedule.publish}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={startMatchId !== null} onOpenChange={(open) => { if (!open) setStartMatchId(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{messages.organizer.schedule.startTitle}</AlertDialogTitle>
            <AlertDialogDescription>{messages.organizer.schedule.startBody}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{messages.common.cancel}</AlertDialogCancel>
            <AlertDialogAction disabled={startMutation.isPending || startMatchId === null} onClick={() => { if (startMatchId) startMutation.mutate(startMatchId) }}>
              {startMutation.isPending ? messages.organizer.schedule.starting : messages.organizer.schedule.start}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

function StartQualifying({ snapshot, resetGeneration }: { snapshot: TournamentSnapshot; resetGeneration: number }) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const qualifyingFixtureIds = new Set(snapshot.fixtures.filter((fixture) => fixture.stage === 'qualifying').map((fixture) => fixture.id))
  const qualifyingLineups = snapshot.lineups.filter((lineup) => qualifyingFixtureIds.has(lineup.fixtureId))
  // The rotation is checked once, against the declared lineups, when they lock.
  const rotationTeamIds = qualifyingLineups.length === 12
    ? validateQualifyingRotation(qualifyingLineups, snapshot.players).map((issue) => issue.teamId)
    : []
  const ready = qualifyingFixtureIds.size === 6
    && qualifyingLineups.filter((lineup) => lineup.confirmedAt !== null).length === 12
    && rotationTeamIds.length === 0
  const mutation = useMutation({
    mutationFn: () => mutateTournament('start_qualifying', {
      requestId: crypto.randomUUID(),
      resetGeneration,
      expectedVersion: snapshot.tournament.version,
      payload: {},
    }),
    onSuccess: () => setConfirmOpen(false),
  })

  return (
    <section className="rounded-card bg-navy p-6 text-white shadow-final">
      <h3 className="text-sm font-semibold">{messages.organizer.qualifying.heading}</h3>
      <p className="mt-1.5 text-[0.6875rem] text-navy-soft">{messages.organizer.qualifying.description}</p>
      {rotationTeamIds.length > 0 ? (
        <p className="mt-2 text-[0.6875rem] font-semibold text-white" role="alert">
          {messages.organizer.qualifying.rotationMissing(teamNames(snapshot, rotationTeamIds))}
        </p>
      ) : null}
      <Button className="mt-4 bg-white text-navy hover:bg-navy-soft" disabled={!ready || mutation.isPending} onClick={() => setConfirmOpen(true)}>
        <Flag /> {messages.organizer.qualifying.review}
      </Button>
      {mutation.isError ? <p className="mt-3 text-sm text-white" role="alert">{errorMessage(mutation.error)}</p> : null}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{messages.organizer.qualifying.title}</AlertDialogTitle>
            <AlertDialogDescription>{messages.organizer.qualifying.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{messages.common.cancel}</AlertDialogCancel>
            <AlertDialogAction disabled={mutation.isPending} onClick={() => mutation.mutate()}>
              {mutation.isPending ? messages.common.saving : messages.organizer.qualifying.confirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

function basisText(basis: FinalistBasis, rank: number): string {
  return basis === 'standings' ? messages.organizer.finalists.basis.standings(rank) : messages.organizer.finalists.basis[basis]
}

/**
 * Qualification stays provisional until the organizer confirms the finalists,
 * with the reason each one qualified in view.
 */
function FinalistConfirmation({ snapshot, resetGeneration }: { snapshot: TournamentSnapshot; resetGeneration: number }) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const mutation = useMutation({
    mutationFn: () => mutateTournament('confirm_finalists', {
      requestId: crypto.randomUUID(),
      resetGeneration,
      expectedVersion: snapshot.tournament.version,
      payload: {},
    }),
    onSuccess: () => setConfirmOpen(false),
  })
  const finalists = resolvedFinalists(snapshot)
  if (!finalists || snapshot.tournament.finalistsConfirmedAt !== null) return null
  const standings = qualifyingStandings(snapshot.fixtures, snapshot.matches, snapshot.teams)
  const rankOf = (teamId: UUID) => standings.find((standing) => standing.teamId === teamId)?.rank ?? 0

  return (
    <section className="rounded-card bg-navy p-6 text-white shadow-final">
      <h3 className="text-sm font-semibold">{messages.organizer.finalists.heading}</h3>
      <p className="mt-1.5 text-[0.6875rem] text-navy-soft">{messages.organizer.finalists.description}</p>
      <ul className="mt-4 space-y-2">
        {finalists.map(({ teamId, basis }) => (
          <li className="flex flex-wrap items-baseline justify-between gap-2 rounded-chip bg-white/10 px-3 py-2" key={teamId}>
            <span className="text-[0.8125rem] font-semibold [overflow-wrap:anywhere]">{teamName(snapshot, teamId)}</span>
            <span className="text-[0.6875rem] text-navy-soft">{basisText(basis, rankOf(teamId))}</span>
          </li>
        ))}
      </ul>
      <Button className="mt-4 bg-white text-navy hover:bg-navy-soft" disabled={mutation.isPending} onClick={() => setConfirmOpen(true)}>
        <CheckCircle2 /> {messages.organizer.finalists.review}
      </Button>
      {mutation.isError ? <p className="mt-3 text-sm text-white" role="alert">{errorMessage(mutation.error)}</p> : null}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{messages.organizer.finalists.title}</AlertDialogTitle>
            <AlertDialogDescription>{messages.organizer.finalists.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{messages.common.cancel}</AlertDialogCancel>
            <AlertDialogAction disabled={mutation.isPending} onClick={() => mutation.mutate()}>
              {mutation.isPending ? messages.common.saving : messages.organizer.finalists.confirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

type DrawPayload =
  | { matchups: Array<{ fixtureId: UUID; teamAId: UUID; teamBId: UUID }> }
  | { advancingTeamIds: UUID[] }

/**
 * What the organizer can draw now: the two matchups of a four-team tie while
 * no playoff match is being played (re-drawing discards played results), or
 * the teams a finished three-team playoff left tied. Null when no draw decides
 * anything.
 */
function drawNeeded(snapshot: TournamentSnapshot) {
  const placementStarted = snapshot.fixtures
    .filter((fixture) => fixture.stage === 'third-place' || fixture.stage === 'final')
    .some((fixture) => fixtureMatches(snapshot, fixture.id).some((match) => match.state !== 'unstarted'))
  const playoffs = snapshot.fixtures.filter((fixture) => fixture.stage === 'qualification-playoff')
  const playoffMatches = playoffs.flatMap((fixture) => fixtureMatches(snapshot, fixture.id))
  const standings = qualifyingStandings(snapshot.fixtures, snapshot.matches, snapshot.teams)
  const playoff = requiredPlayoff(standings)
  if (placementStarted || !playoff) return null

  if (playoff.format === 'four-team' && playoffs.length === 2 && playoffMatches.every((match) => match.state !== 'playing')) {
    return {
      kind: 'matchups' as const,
      tiedTeamIds: playoff.tiedTeamIds,
      fixtureIds: playoffs.map((fixture) => fixture.id),
      discardsResults: playoffMatches.some((match) => match.state === 'completed'),
    }
  }
  const cutoff = qualificationCutoff(standings)
  if (playoff.format === 'three-team' && cutoff && playoffMatches.length === 3 && playoffMatches.every((match) => match.state === 'completed')) {
    const outcome = threeTeamPlayoffOutcome(playoffs, snapshot.matches, cutoff.tiedTeamIds, cutoff.availablePlaces)
    if (outcome && outcome.drawSlots > 0) {
      return { kind: 'advancement' as const, candidateIds: outcome.drawCandidateIds, slots: outcome.drawSlots }
    }
  }
  return null
}

function DrawRecording({ snapshot, resetGeneration }: { snapshot: TournamentSnapshot; resetGeneration: number }) {
  const needed = drawNeeded(snapshot)
  const [opponentId, setOpponentId] = useState<UUID | ''>('')
  const [chosen, setChosen] = useState<UUID[]>([])
  const [confirmOpen, setConfirmOpen] = useState(false)
  const mutation = useMutation({
    mutationFn: (payload: DrawPayload) => mutateTournament('record_draw', {
      requestId: crypto.randomUUID(),
      resetGeneration,
      expectedVersion: snapshot.tournament.version,
      payload,
    }),
    onSuccess: () => setConfirmOpen(false),
  })
  if (!needed) return null

  let payload: DrawPayload | null = null
  let summary = ''
  let form: React.ReactNode
  if (needed.kind === 'matchups') {
    const [anchorId, ...others] = needed.tiedTeamIds
    const rest = others.filter((teamId) => teamId !== opponentId)
    if (anchorId && opponentId && rest.length === 2 && needed.fixtureIds.length === 2) {
      payload = {
        matchups: [
          { fixtureId: needed.fixtureIds[0], teamAId: anchorId, teamBId: opponentId },
          { fixtureId: needed.fixtureIds[1], teamAId: rest[0], teamBId: rest[1] },
        ],
      }
      summary = [[anchorId, opponentId], rest]
        .map(([a, b]) => messages.common.versus(teamName(snapshot, a), teamName(snapshot, b)))
        .join(' · ')
    }
    form = (
      <div className="mt-4 space-y-2">
        <Select value={opponentId} onValueChange={(value) => setOpponentId(value)}>
          <SelectTrigger className="w-full" aria-label={messages.organizer.draw.opponentOf(teamName(snapshot, anchorId ?? null))}>
            <SelectValue placeholder={messages.organizer.draw.opponentOf(teamName(snapshot, anchorId ?? null))} />
          </SelectTrigger>
          <SelectContent>
            {others.map((teamId) => <SelectItem value={teamId} key={teamId}>{teamName(snapshot, teamId)}</SelectItem>)}
          </SelectContent>
        </Select>
        {rest.length === 2 && opponentId ? (
          <p className="text-[0.6875rem] text-muted-ink">
            {messages.organizer.draw.otherMatchup(messages.common.versus(teamName(snapshot, rest[0]), teamName(snapshot, rest[1])))}
          </p>
        ) : null}
      </div>
    )
  } else {
    if (chosen.length === needed.slots) {
      payload = { advancingTeamIds: chosen }
      summary = teamNames(snapshot, chosen)
    }
    const toggle = (teamId: UUID) => setChosen((current) => current.includes(teamId)
      ? current.filter((id) => id !== teamId)
      : [...current, teamId].slice(-needed.slots))
    form = (
      <div className="mt-4 flex flex-wrap gap-2">
        {needed.candidateIds.map((teamId) => (
          <Button
            key={teamId}
            size="sm"
            variant={chosen.includes(teamId) ? 'default' : 'outline'}
            aria-pressed={chosen.includes(teamId)}
            onClick={() => toggle(teamId)}
          >
            {teamName(snapshot, teamId)}
          </Button>
        ))}
      </div>
    )
  }

  return (
    <section className="rounded-card border border-ink/5 bg-white p-6 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">
            {needed.kind === 'matchups' ? messages.organizer.draw.matchupHeading : messages.organizer.draw.advancementHeading}
          </h3>
          <p className="mt-1.5 text-[0.6875rem]/[1.6] text-muted-ink">
            {needed.kind === 'matchups' ? messages.organizer.draw.matchupDescription : messages.organizer.draw.advancementDescription(needed.slots)}
          </p>
        </div>
        <Shuffle className="size-5 text-muted-ink" />
      </div>
      {form}
      <Button className="mt-4" variant="outline" disabled={payload === null || mutation.isPending} onClick={() => setConfirmOpen(true)}>
        {messages.organizer.draw.review}
      </Button>
      {mutation.isError ? <p className="mt-3 text-sm text-destructive" role="alert">{errorMessage(mutation.error)}</p> : null}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{messages.organizer.draw.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {messages.organizer.draw.recorded(summary)} {messages.organizer.draw.body}
              {needed.kind === 'matchups' && needed.discardsResults ? ` ${messages.organizer.draw.discardsResults}` : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{messages.common.cancel}</AlertDialogCancel>
            <AlertDialogAction disabled={mutation.isPending || payload === null} onClick={() => { if (payload) mutation.mutate(payload) }}>
              {mutation.isPending ? messages.common.saving : messages.organizer.draw.confirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

type OrganizerSection = 'overview' | 'teams' | 'lineups' | 'matches' | 'results'

function LineupsWorkspace({
  snapshot,
  fixtures,
  resetGeneration,
}: {
  snapshot: TournamentSnapshot
  fixtures: TournamentSnapshot['fixtures']
  resetGeneration: number
}) {
  const [selectedFixtureId, setSelectedFixtureId] = useState<UUID | null>(null)
  const selectedFixture = fixtures.find((fixture) => fixture.id === selectedFixtureId)
  if (selectedFixture) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" className="-ml-3 text-muted-ink" onClick={() => setSelectedFixtureId(null)}>
          {messages.organizer.lineupsWorkspace.back}
        </Button>
        <LineupEditor
          key={`lineup-${resetGeneration}-${selectedFixture.id}`}
          snapshot={snapshot}
          fixture={selectedFixture}
          resetGeneration={resetGeneration}
        />
      </div>
    )
  }

  return (
    <section className="rounded-card border border-ink/5 bg-white p-5 shadow-card sm:p-6">
      <h3 className="text-base font-semibold">{messages.organizer.lineupsWorkspace.heading}</h3>
      <p className="mt-1.5 max-w-2xl text-sm/[1.6] text-muted-ink">{messages.organizer.lineupsWorkspace.description}</p>
      <ul className="mt-5 divide-y divide-hairline">
        {fixtures.map((fixture) => {
          const fixtureLineups = snapshot.lineups.filter((lineup) => lineup.fixtureId === fixture.id)
          const confirmed = fixtureLineups.filter((lineup) => lineup.confirmedAt !== null).length
          const started = fixtureMatches(snapshot, fixture.id).some((match) => match.state !== 'unstarted')
          const teamsKnown = fixture.teamAId !== null && fixture.teamBId !== null
          const status = !teamsKnown
            ? messages.organizer.lineupsWorkspace.awaitingTeams
            : started
              ? messages.organizer.lineupsWorkspace.locked
              : confirmed > 0
                ? messages.organizer.lineupsWorkspace.confirmed(confirmed)
                : fixtureLineups.length > 0
                  ? messages.organizer.lineupsWorkspace.saved(fixtureLineups.length)
                  : messages.organizer.lineupsWorkspace.notStarted
          return (
            <li key={fixture.id}>
              <button
                type="button"
                className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 py-4 text-left"
                onClick={() => setSelectedFixtureId(fixture.id)}
              >
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{fixtureLabel(fixture)}</span>
                  <span className="mt-1 block truncate text-xs text-muted-ink">
                    {messages.common.versus(teamName(snapshot, fixture.teamAId), teamName(snapshot, fixture.teamBId))}
                  </span>
                </span>
                <span className="flex items-center gap-2 text-xs font-medium text-muted-ink">
                  {status}<ChevronRight className="size-4" aria-hidden="true" />
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function OrganizerOverview({
  snapshot,
  resetGeneration,
  lineupFixtures,
  onNavigate,
}: {
  snapshot: TournamentSnapshot
  resetGeneration: number
  lineupFixtures: TournamentSnapshot['fixtures']
  onNavigate: (section: OrganizerSection) => void
}) {
  const inSetup = snapshot.tournament.stage === 'setup'
  const expectedLineups = lineupFixtures.reduce((total, fixture) =>
    total + Number(fixture.teamAId !== null) + Number(fixture.teamBId !== null), 0)
  const confirmedLineups = snapshot.lineups.filter((lineup) =>
    lineup.confirmedAt !== null && lineupFixtures.some((fixture) => fixture.id === lineup.fixtureId)).length
  const eligibleMatches = snapshot.matches.filter((match) => isDeciderEligible(snapshot, match))
  const scheduledMatches = eligibleMatches.filter((match) => match.court !== null).length
  const completedMatches = eligibleMatches.filter((match) => match.state === 'completed').length
  const teamsReady = snapshot.teams.length === 4 && snapshot.players.length === 16
  const next = !teamsReady
    ? { section: 'teams' as const, text: messages.organizer.overview.setupTeams }
    : confirmedLineups < expectedLineups
      ? { section: 'lineups' as const, text: messages.organizer.overview.setupLineups }
      : inSetup
        ? { section: null, text: messages.organizer.overview.readyToStart }
        : { section: 'matches' as const, text: messages.organizer.overview.manageMatches }
  const metrics = [
    { label: messages.organizer.overview.teams, value: `${snapshot.teams.length}/4`, section: 'teams' as const, icon: Users },
    { label: messages.organizer.overview.lineups, value: `${confirmedLineups}/${expectedLineups}`, section: 'lineups' as const, icon: ClipboardList },
    ...(!inSetup ? [
      { label: messages.organizer.overview.scheduled, value: String(scheduledMatches), section: 'matches' as const, icon: ListChecks },
      { label: messages.organizer.overview.completed, value: String(completedMatches), section: 'results' as const, icon: Trophy },
    ] : []),
  ]

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-card bg-navy text-white shadow-final">
        <div className="grid gap-6 p-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end sm:p-7">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-navy-soft">{messages.organizer.overview.heading}</p>
            <p className="mt-3 max-w-2xl text-lg/[1.45] font-semibold">{next.text}</p>
          </div>
          {next.section ? (
            <Button className="bg-white text-navy hover:bg-navy-soft" onClick={() => onNavigate(next.section)}>
              {messages.organizer.overview.open}<ChevronRight />
            </Button>
          ) : null}
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(({ label, value, section, icon: Icon }) => (
          <button
            type="button"
            className="rounded-card border border-ink/5 bg-white p-5 text-left shadow-card transition-transform hover:-translate-y-0.5"
            key={section}
            onClick={() => onNavigate(section)}
          >
            <span className="flex items-center justify-between gap-3 text-xs font-medium text-muted-ink">
              {label}<Icon className="size-4" aria-hidden="true" />
            </span>
            <strong className="numeric mt-3 block text-2xl tracking-tight text-ink">{value}</strong>
          </button>
        ))}
      </div>

      {inSetup && snapshot.fixtures.length > 0 ? <StartQualifying snapshot={snapshot} resetGeneration={resetGeneration} /> : null}
      {!inSetup ? <DrawRecording key={`draw-${resetGeneration}-${snapshot.tournament.resultRevision}`} snapshot={snapshot} resetGeneration={resetGeneration} /> : null}
      {!inSetup ? <FinalistConfirmation snapshot={snapshot} resetGeneration={resetGeneration} /> : null}
    </div>
  )
}

export function OrganizerPage({ snapshot, resetGeneration, onStartScoring }: { snapshot: TournamentSnapshot; resetGeneration: number; onStartScoring: () => void }) {
  const [selectedSection, setSelectedSection] = useState<OrganizerSection>('overview')
  const inSetup = snapshot.tournament.stage === 'setup'
  const section = inSetup && (selectedSection === 'matches' || selectedSection === 'results') ? 'overview' : selectedSection
  const lineupFixtures = snapshot.fixtures.filter((fixture) =>
    fixture.stage !== 'qualification-playoff'
    && (fixture.stage === 'qualifying' || fixture.teamAId !== null))
  const navigation = [
    { value: 'overview' as const, label: messages.organizer.navigation.overview, icon: LayoutDashboard },
    { value: 'teams' as const, label: messages.organizer.navigation.teams, icon: Users },
    { value: 'lineups' as const, label: messages.organizer.navigation.lineups, icon: ClipboardList },
    ...(!inSetup ? [
      { value: 'matches' as const, label: messages.organizer.navigation.matches, icon: CalendarRange },
      { value: 'results' as const, label: messages.organizer.navigation.results, icon: Trophy },
    ] : []),
  ]

  let content: React.ReactNode
  switch (section) {
    case 'overview':
      content = <OrganizerOverview snapshot={snapshot} resetGeneration={resetGeneration} lineupFixtures={lineupFixtures} onNavigate={setSelectedSection} />
      break
    case 'teams':
      content = <SetupForm key={`setup-${resetGeneration}-${snapshot.tournament.version}`} snapshot={snapshot} resetGeneration={resetGeneration} />
      break
    case 'lineups':
      content = <LineupsWorkspace snapshot={snapshot} fixtures={lineupFixtures} resetGeneration={resetGeneration} />
      break
    case 'matches':
      content = <CourtSchedule snapshot={snapshot} resetGeneration={resetGeneration} onStartScoring={onStartScoring} />
      break
    case 'results':
      content = <ResultsSection key={`results-${resetGeneration}`} snapshot={snapshot} resetGeneration={resetGeneration} />
      break
  }

  return (
    <main className="view-enter space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-orange">{messages.organizer.stageBadge(messages.app.stage[snapshot.tournament.stage])}</p>
          <h2 className="mt-1 text-[1.625rem] font-semibold tracking-[-0.036em]">{messages.organizer.heading}</h2>
        </div>
        <StageProgressMeter snapshot={snapshot} />
      </div>

      <nav className="-mx-5 overflow-x-auto px-5 sm:mx-0 sm:px-0" aria-label={messages.organizer.navigationLabel}>
        <div className="flex min-w-max gap-2 border-b border-line pb-3">
          {navigation.map(({ value, label, icon: Icon }) => (
            <button
              type="button"
              className={`flex min-h-11 items-center gap-2 rounded-pill px-4 text-sm font-semibold transition-colors ${
                section === value ? 'bg-navy text-white' : 'text-muted-ink hover:bg-white hover:text-ink'
              }`}
              aria-current={section === value ? 'page' : undefined}
              key={value}
              onClick={() => setSelectedSection(value)}
            >
              <Icon className="size-4" aria-hidden="true" />{label}
            </button>
          ))}
        </div>
      </nav>

      {content}
    </main>
  )
}
