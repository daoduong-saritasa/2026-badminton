import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  Activity,
  CalendarRange,
  CheckCircle2,
  ChevronRight,
  Flag,
  LayoutDashboard,
  ListChecks,
  Play,
  Repeat,
  Shuffle,
  Trophy,
  Users,
} from 'lucide-react'

import { mutateTournament } from '@/data/tournament'
import type { CommandPayloads } from '@/domain/commands'
import type { PlayoffRound } from '@/domain/playoff-rounds'
import { resolvedFinalists, type FinalistBasis } from '@/domain/progression'
import { qualifyingStandings } from '@/domain/standings'
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
import { PairAssignmentForm } from '@/features/scoring/PairAssignmentForm'
import {
  courtLabel,
  fixtureLabel,
  fixtureMatches,
  fixtureOf,
  groupByFixture,
  isDeciderEligible,
  startBlocker,
  matchLabel,
  sideTeamId,
  teamName,
  teamNames,
  upcomingMatches,
} from '@/features/tournament/labels'
import { errorMessage } from '@/i18n/errors'
import { formatNumber } from '@/i18n/format'
import { messages } from '@/i18n/vi'
import { PairLines } from '@/features/tournament/PairLines'
import { CourtNamesDialog } from './CourtNamesDialog'
import { ResultEditor } from './ResultEditor'
import { ResultSchedule } from './ResultSchedule'
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
  const [editing, setEditing] = useState<{ matchId: UUID; session: number } | null>(null)
  const [open, setOpen] = useState(false)

  const select = (matchId: UUID) => {
    setEditing((previous) => ({ matchId, session: (previous?.session ?? 0) + 1 }))
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
      <p className="text-xs text-muted-ink">
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

/**
 * Matches waiting to be played. Choosing a court saves it at once; pairs are
 * assigned per fixture in a dialog; starting a match asks first because it
 * cannot be undone.
 */
function CourtSchedule({ snapshot, resetGeneration, onStartScoring }: { snapshot: TournamentSnapshot; resetGeneration: number; onStartScoring: () => void }) {
  const waiting = upcomingMatches(snapshot)
  // The fixture outlives `assignOpen` so the dialog keeps its content while closing.
  const [assignFixtureId, setAssignFixtureId] = useState<UUID | null>(null)
  const [assignOpen, setAssignOpen] = useState(false)
  const [startMatchId, setStartMatchId] = useState<UUID | null>(null)

  const courtMutation = useMutation({
    mutationFn: ({ matchId, court }: { matchId: UUID; court: Court }) => mutateTournament('assign_courts', {
      requestId: crypto.randomUUID(),
      resetGeneration,
      expectedVersion: snapshot.tournament.version,
      payload: { assignments: [{ matchId, court }] },
    }),
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
    <section className="rounded-card border border-ink/5 bg-white p-5 shadow-card sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[0.9375rem] font-semibold">{messages.organizer.schedule.heading}</h3>
        <CourtNamesDialog snapshot={snapshot} resetGeneration={resetGeneration} />
      </div>
      <ul className="mt-6 divide-y divide-line">
        {groupByFixture(waiting).map(({ fixtureId, matches }) => {
          const fixture = snapshot.fixtures.find((candidate) => candidate.id === fixtureId)
          const fixtureTeams = teams(snapshot, matches[0])
          const paired = matches.every((match) => match.pairA !== null && match.pairB !== null)
          return (
            <li className="py-6 first:pt-0 last:pb-0" aria-label={`${fixtureLabel(fixture)} · ${fixtureTeams}`} key={fixtureId}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-base font-semibold [overflow-wrap:anywhere]">{fixtureTeams}</p>
                  <p className="mt-0.5 text-[0.8125rem] text-muted-ink">{fixtureLabel(fixture)}</p>
                </div>
                <Button className={paired ? 'w-[7.5rem] border-navy text-navy hover:bg-navy-soft' : 'w-[7.5rem] bg-navy text-white hover:bg-ink'} variant={paired ? 'outline' : 'secondary'} onClick={() => { setAssignFixtureId(fixtureId); setAssignOpen(true) }}>
                  <Users /> {messages.pairAssignment.open}
                </Button>
              </div>
              <ul className="mt-4 divide-y divide-hairline">
                {matches.map((match) => (
                  <li className="grid grid-cols-[minmax(0,1fr)_7.5rem] items-center gap-x-4 gap-y-4 py-5 first:pt-0 last:pb-0 md:grid-cols-[minmax(0,1fr)_14rem_7.5rem]" aria-label={messages.common.matchNumber(match.matchNumber)} key={match.id}>
                    <p className="col-start-1 row-start-1 w-fit rounded-field bg-well px-2.5 py-1 text-sm font-semibold">{messages.common.matchNumber(match.matchNumber)}</p>
                    <p className="col-start-2 row-start-1 text-right text-xs text-muted-ink md:col-start-3">
                      {startBlocker(snapshot, match) ? messages.scoring.startBlocked[startBlocker(snapshot, match) ?? 'pairs'] : null}
                    </p>
                    <PairLines snapshot={snapshot} match={match} className="col-span-2 row-start-2 md:col-span-1 md:col-start-1" />
                    <div className="col-start-1 row-start-3 md:col-start-2 md:row-start-2">
                    <Select
                      value={match.court === null ? '' : String(match.court)}
                      disabled={courtMutation.isPending}
                      onValueChange={(value) => courtMutation.mutate({ matchId: match.id, court: Number(value) as Court })}
                    >
                      <SelectTrigger className="w-full" aria-label={messages.organizer.schedule.courtFor(`${matchLabel(snapshot, match)} · ${fixtureTeams}`)}>
                        <SelectValue placeholder={messages.organizer.schedule.noCourt} />
                      </SelectTrigger>
                      <SelectContent>
                        {courts.map((option) => <SelectItem value={String(option)} key={option}>{courtLabel(snapshot, option)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    </div>
                    <Button
                      className="col-start-2 row-start-3 w-full md:col-start-3 md:row-start-2"
                      disabled={startBlocker(snapshot, match) !== null || startMutation.isPending}
                      onClick={() => setStartMatchId(match.id)}
                    >
                      <Play /> {messages.organizer.schedule.startShort}
                    </Button>
                  </li>
                ))}
              </ul>
            </li>
          )
        })}
      </ul>
      {waiting.length === 0 ? <p className="text-[0.8125rem] text-muted-ink">{messages.organizer.schedule.empty}</p> : null}
      {courtMutation.isError ? <p className="mt-3 text-[0.8125rem] text-destructive" role="alert">{errorMessage(courtMutation.error)}</p> : null}
      {startMutation.isError ? <p className="mt-3 text-[0.8125rem] text-destructive" role="alert">{errorMessage(startMutation.error)}</p> : null}

      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent className="flex max-h-[calc(100dvh-1.5rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
          {assignFixtureId ? (
            <PairAssignmentForm
              key={assignFixtureId}
              snapshot={snapshot}
              fixtureId={assignFixtureId}
              role="organizer"
              resetGeneration={resetGeneration}
              onSaved={() => setAssignOpen(false)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
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
  const ready = snapshot.fixtures.filter((fixture) => fixture.stage === 'qualifying').length === 6
    && snapshot.teams.length === 4
    && snapshot.players.length === 16
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
    <section className="rounded-card border border-ink/5 bg-white p-5 shadow-card sm:p-6">
      <h3 className="text-[0.9375rem] font-semibold">{messages.organizer.qualifying.heading}</h3>
      <Button className="mt-4" disabled={!ready || mutation.isPending} onClick={() => setConfirmOpen(true)}>
        <Flag /> {messages.organizer.qualifying.review}
      </Button>
      {mutation.isError ? <p className="mt-3 text-sm text-destructive" role="alert">{errorMessage(mutation.error)}</p> : null}
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
    <section className="rounded-card border border-ink/5 bg-white p-5 shadow-card sm:p-6">
      <h3 className="text-[0.9375rem] font-semibold">{messages.organizer.finalists.heading}</h3>
      <ul className="mt-4 space-y-2">
        {finalists.map(({ teamId, basis }) => (
          <li className="flex flex-wrap items-baseline justify-between gap-2 rounded-chip bg-well px-3 py-2.5" key={teamId}>
            <span className="text-sm font-semibold [overflow-wrap:anywhere]">{teamName(snapshot, teamId)}</span>
            <span className="text-[0.8125rem] text-muted-ink">{basisText(basis, rankOf(teamId))}</span>
          </li>
        ))}
      </ul>
      <Button className="mt-4" disabled={mutation.isPending} onClick={() => setConfirmOpen(true)}>
        <CheckCircle2 /> {messages.organizer.finalists.review}
      </Button>
      {mutation.isError ? <p className="mt-3 text-sm text-destructive" role="alert">{errorMessage(mutation.error)}</p> : null}
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

type DrawPayload = CommandPayloads['record_draw']

/** The current playoff round, or null when qualification needs none. */
function currentRound(snapshot: TournamentSnapshot): PlayoffRound | null {
  return snapshot.playoffRounds.find((round) => round.id === snapshot.tournament.currentPlayoffRoundId) ?? null
}

/**
 * The two matchups of a four-team playoff round, while none of its matches is
 * being played and placement play has not started. Re-drawing discards played
 * results. Null when no draw decides anything; advancement is never drawn.
 */
function drawNeeded(snapshot: TournamentSnapshot) {
  const placementStarted = snapshot.fixtures
    .filter((fixture) => fixture.stage === 'third-place' || fixture.stage === 'final')
    .some((fixture) => fixtureMatches(snapshot, fixture.id).some((match) => match.state !== 'unstarted'))
  const round = currentRound(snapshot)
  if (placementStarted || !round || round.teamIds.length !== 4 || round.fixtureIds.length !== 2) return null
  const roundMatches = round.fixtureIds.flatMap((fixtureId) => fixtureMatches(snapshot, fixtureId))
  if (roundMatches.some((match) => match.state === 'playing')) return null
  return {
    tiedTeamIds: round.teamIds,
    fixtureIds: round.fixtureIds,
    discardsResults: roundMatches.some((match) => match.state === 'completed'),
  }
}

function DrawRecording({ snapshot, resetGeneration }: { snapshot: TournamentSnapshot; resetGeneration: number }) {
  const needed = drawNeeded(snapshot)
  const [opponentId, setOpponentId] = useState<UUID | ''>('')
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
  const form = (
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
        <p className="text-xs text-muted-ink">
          {messages.organizer.draw.otherMatchup(messages.common.versus(teamName(snapshot, rest[0]), teamName(snapshot, rest[1])))}
        </p>
      ) : null}
    </div>
  )

  return (
    <section className="rounded-card border border-ink/5 bg-white p-6 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{messages.organizer.draw.matchupHeading}</h3>
          <p className="mt-1.5 text-xs/[1.6] text-muted-ink">{messages.organizer.draw.matchupDescription}</p>
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
              {needed.discardsResults ? ` ${messages.organizer.draw.discardsResults}` : ''}
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

/**
 * Where qualification playoffs stand. A continuation round says why the tied
 * teams play on; there is nothing to draw.
 */
function PlayoffRoundStatus({ snapshot }: { snapshot: TournamentSnapshot }) {
  const round = currentRound(snapshot)
  if (!round || resolvedFinalists(snapshot)) return null
  return (
    <section className="rounded-card border border-ink/5 bg-white p-6 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{messages.organizer.playoffRound.heading(round.roundNumber)}</h3>
          <p className="mt-1.5 text-xs/[1.6] text-muted-ink">
            {round.roundNumber > 1
              ? messages.organizer.playoffRound.playOn(teamNames(snapshot, round.teamIds), round.availablePlaces)
              : messages.organizer.playoffRound.inProgress(teamNames(snapshot, round.teamIds), round.availablePlaces)}
          </p>
          {round.fixedFinalistIds.length > 0 ? (
            <p className="mt-1 text-xs/[1.6] text-muted-ink">
              {messages.organizer.playoffRound.qualified(teamNames(snapshot, round.fixedFinalistIds))}
            </p>
          ) : null}
        </div>
        <Repeat className="size-5 text-muted-ink" />
      </div>
    </section>
  )
}

export type OrganizerSection = 'overview' | 'teams' | 'matches' | 'results'

function OrganizerOverview({
  snapshot,
  resetGeneration,
  onNavigate,
}: {
  snapshot: TournamentSnapshot
  resetGeneration: number
  onNavigate: (section: OrganizerSection) => void
}) {
  const inSetup = snapshot.tournament.stage === 'setup'
  const eligibleMatches = snapshot.matches.filter((match) => isDeciderEligible(snapshot, match))
  const scheduledMatches = eligibleMatches.filter((match) => match.court !== null).length
  const completedMatches = eligibleMatches.filter((match) => match.state === 'completed').length
  const teamsReady = snapshot.teams.length === 4 && snapshot.players.length === 16
  const next = teamsReady
    ? { section: null, text: messages.organizer.overview.readyToStart }
    : { section: 'teams' as const, text: messages.organizer.overview.setupTeams }
  const metrics = [
    { label: messages.organizer.overview.teams, value: `${snapshot.teams.length}/4`, section: 'teams' as const, icon: Users },
    ...(!inSetup ? [
      { label: messages.organizer.overview.scheduled, value: String(scheduledMatches), section: 'matches' as const, icon: ListChecks },
      { label: messages.organizer.overview.completed, value: String(completedMatches), section: 'results' as const, icon: Trophy },
    ] : []),
  ]

  return (
    <div className="space-y-6">
      {inSetup ? <section className="overflow-hidden rounded-card bg-orange text-white shadow-final">
        <div className="grid gap-6 p-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end sm:p-7">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-white">{messages.organizer.overview.heading}</p>
            <p className="mt-3 max-w-2xl text-lg/[1.45] font-semibold">{next.text}</p>
          </div>
          {next.section ? (
            <Button className="bg-white text-navy hover:bg-navy-soft" onClick={() => onNavigate(next.section)}>
              {messages.organizer.overview.open}<ChevronRight />
            </Button>
          ) : null}
        </div>
      </section> : null}

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
      {!inSetup ? <PlayoffRoundStatus snapshot={snapshot} /> : null}
      {!inSetup ? <DrawRecording key={`draw-${resetGeneration}-${snapshot.tournament.resultRevision}`} snapshot={snapshot} resetGeneration={resetGeneration} /> : null}
      {!inSetup ? <FinalistConfirmation snapshot={snapshot} resetGeneration={resetGeneration} /> : null}
    </div>
  )
}

/**
 * The organizer workspace. The caller holds the selected section, so it
 * survives a trip to the scoring screen, which `onOpenScoring` opens.
 */
export function OrganizerPage({ snapshot, resetGeneration, selectedSection, onSectionChange, onOpenScoring }: {
  snapshot: TournamentSnapshot
  resetGeneration: number
  selectedSection: OrganizerSection
  onSectionChange: (section: OrganizerSection) => void
  onOpenScoring: () => void
}) {
  const inSetup = snapshot.tournament.stage === 'setup'
  const section = inSetup && (selectedSection === 'matches' || selectedSection === 'results') ? 'overview' : selectedSection
  const navigation: Array<{ value: OrganizerSection | 'scoring'; label: string; icon: typeof Users }> = [
    { value: 'overview', label: messages.organizer.navigation.overview, icon: LayoutDashboard },
    { value: 'teams', label: messages.organizer.navigation.teams, icon: Users },
    ...(!inSetup ? [
      { value: 'matches' as const, label: messages.organizer.navigation.matches, icon: CalendarRange },
      { value: 'scoring' as const, label: messages.organizer.navigation.scoring, icon: Activity },
      { value: 'results' as const, label: messages.organizer.navigation.results, icon: Trophy },
    ] : []),
  ]

  let content: React.ReactNode
  switch (section) {
    case 'overview':
      content = <OrganizerOverview snapshot={snapshot} resetGeneration={resetGeneration} onNavigate={onSectionChange} />
      break
    case 'teams':
      content = <SetupForm key={`setup-${resetGeneration}-${snapshot.tournament.version}`} snapshot={snapshot} resetGeneration={resetGeneration} />
      break
    case 'matches':
      content = <CourtSchedule snapshot={snapshot} resetGeneration={resetGeneration} onStartScoring={onOpenScoring} />
      break
    case 'results':
      content = <ResultsSection key={`results-${resetGeneration}`} snapshot={snapshot} resetGeneration={resetGeneration} />
      break
  }

  return (
    <main className="view-enter space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div>
          <h2 className="text-[1.625rem] font-semibold tracking-[-0.036em]">{messages.organizer.heading}</h2>
        </div>
        <StageProgressMeter snapshot={snapshot} />
      </div>

      <nav className="min-w-0" aria-label={messages.organizer.navigationLabel}>
        <div className="grid grid-cols-3 gap-2 border-b border-line pb-3 sm:flex sm:flex-wrap">
          {navigation.map(({ value, label, icon: Icon }) => (
            <button
              type="button"
              className={`flex min-h-12 min-w-0 items-center justify-center gap-2 rounded-pill px-2 text-sm sm:px-4 font-semibold transition-colors ${
                section === value ? 'bg-orange text-white' : 'text-muted-ink hover:bg-white hover:text-ink'
              }`}
              aria-current={section === value ? 'page' : undefined}
              key={value}
              onClick={() => { if (value === 'scoring') onOpenScoring(); else onSectionChange(value) }}
            >
              <Icon className="size-4 shrink-0" aria-hidden="true" /><span>{label}</span>
            </button>
          ))}
        </div>
      </nav>

      {content}
    </main>
  )
}
