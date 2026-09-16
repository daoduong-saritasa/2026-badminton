import { useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, CalendarRange, LockKeyhole, Play, RotateCcw } from 'lucide-react'

import { mutateTournament } from '@/data/tournament'
import { availableCourts } from '@/domain/setup'
import { calculateStandings } from '@/domain/standings'
import type { Court, CourtAssignment, CourtCount, Group, MatchRound, TournamentSnapshot, UUID } from '@/domain/types'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { groupTone, matchRoundLabel, pairName } from '@/features/tournament/MatchTicket'
import { errorMessage } from '@/i18n/errors'
import { formatNumber } from '@/i18n/format'
import { messages } from '@/i18n/vi'
import { cn } from '@/lib/utils'
import { ResultEditor } from './ResultEditor'
import { ResultSchedule } from './ResultSchedule'
import { WithdrawalPanel } from './WithdrawalPanel'
import { SetupForm } from './SetupForm'

type OrganizerAction = 'fixtures' | 'confirm-groups' | 'reopen'

/**
 * Result entry is driven from the schedule: pick a match, then edit that one
 * match. Withdrawals are a separate section because they act on a pair, not a
 * match.
 */
function ResultsSection({
  snapshot,
  resetGeneration,
}: {
  snapshot: TournamentSnapshot
  resetGeneration: number
}) {
  const [selectedMatchId, setSelectedMatchId] = useState<UUID | null>(null)

  return (
    <div className="space-y-4">
      <ResultSchedule snapshot={snapshot} selectedMatchId={selectedMatchId} onSelect={setSelectedMatchId} />
      {selectedMatchId ? (
        <div className="rounded-card border border-ink/5 bg-white p-6 shadow-card">
          <ResultEditor
            key={selectedMatchId}
            snapshot={snapshot}
            resetGeneration={resetGeneration}
            matchId={selectedMatchId}
            onClose={() => setSelectedMatchId(null)}
          />
        </div>
      ) : null}
    </div>
  )
}


interface StageProgress {
  done: number
  total: number
  label: string
}

/** Progress through the rounds the current stage is actually playing. */
function stageProgress(snapshot: TournamentSnapshot): StageProgress | null {
  const inGroups = snapshot.tournament.stage === 'groups'
  const rounds: MatchRound[] = inGroups ? ['group'] : ['semifinal', 'final']
  const scoped = snapshot.matches.filter((match) => rounds.includes(match.round))
  if (scoped.length === 0) return null
  return {
    done: scoped.filter((match) => match.state === 'completed' || match.state === 'void').length,
    total: scoped.length,
    label: messages.organizer.progress(inGroups),
  }
}

function StageProgressMeter({ progress }: { progress: StageProgress }) {
  const { done, total, label } = progress
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

function matchPairs(snapshot: TournamentSnapshot, matchId: UUID): string {
  const match = snapshot.matches.find((candidate) => candidate.id === matchId)
  if (!match) return messages.organizer.unknownMatch
  return messages.common.versus(pairName(snapshot, match.pairAId), pairName(snapshot, match.pairBId))
}

/** The spoken form, for control labels: the visible row shows the round as a chip. */
function matchName(snapshot: TournamentSnapshot, matchId: UUID): string {
  const match = snapshot.matches.find((candidate) => candidate.id === matchId)
  if (!match) return messages.organizer.unknownMatch
  return `${matchRoundLabel(match)} · ${matchPairs(snapshot, matchId)}`
}

function UpcomingSchedule({ snapshot, resetGeneration, onStartScoring }: { snapshot: TournamentSnapshot; resetGeneration: number; onStartScoring: () => void }) {
  const courts = availableCourts(snapshot.tournament.courtCount)
  const unstarted = useMemo(
    () => snapshot.matches.filter((match) => match.state === 'unstarted'),
    [snapshot.matches],
  )
  const [assignments, setAssignments] = useState<CourtAssignment[]>(() => unstarted.map((match) => ({
    matchId: match.id,
    court: match.court ?? 1,
    playingOrder: match.playingOrder,
  })))
  const [confirmAssignments, setConfirmAssignments] = useState(false)
  const [startMatchId, setStartMatchId] = useState<UUID | null>(null)

  const assignmentMutation = useMutation({
    mutationFn: () => mutateTournament('assign_courts', {
      requestId: crypto.randomUUID(),
      resetGeneration,
      expectedVersion: snapshot.tournament.version,
      payload: { assignments },
    }),
    onSuccess: () => setConfirmAssignments(false),
  })
  const startMutation = useMutation({
    mutationFn: (matchId: UUID) => {
      const match = snapshot.matches.find((candidate) => candidate.id === matchId)
      if (!match) throw new Error(messages.organizer.matchGone)
      return mutateTournament('start_scoring', {
        requestId: crypto.randomUUID(),
        resetGeneration,
        expectedVersion: match.version,
        payload: { matchId },
      })
    },
    onSuccess: onStartScoring,
  })

  const update = (matchId: UUID, changes: Partial<CourtAssignment>) => {
    setAssignments((current) => current.map((assignment) =>
      assignment.matchId === matchId ? { ...assignment, ...changes } : assignment,
    ))
  }

  return (
    <section className="rounded-card border border-ink/5 bg-white p-6 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{messages.organizer.schedule.heading}</h3>
          <p className="mt-1.5 text-[0.6875rem]/[1.6] text-muted-ink">
            {messages.organizer.schedule.description}
          </p>
        </div>
        <CalendarRange className="size-5 text-muted-ink" />
      </div>
      {assignments.length > 0 ? (
        <div
          aria-hidden="true"
          className="mt-6 mb-2 hidden gap-2.5 px-[0.9375rem] text-[0.625rem] text-muted-ink md:grid md:grid-cols-[minmax(0,1fr)_8rem_6.5rem_6.5rem]"
        >
          <span>{messages.organizer.schedule.match}</span>
          <span>{messages.organizer.schedule.court}</span>
          <span>{messages.organizer.schedule.order}</span>
          <span />
        </div>
      ) : null}
      <div className="space-y-3">
        {assignments.map((assignment) => {
          const match = unstarted.find((candidate) => candidate.id === assignment.matchId)
          const ready = match?.pairAId !== null && match?.pairBId !== null
          return (
            <div className="grid gap-2.5 rounded-field border border-hairline p-3.5 md:grid-cols-[minmax(0,1fr)_8rem_6.5rem_6.5rem] md:items-center" key={assignment.matchId}>
              <span className="flex min-w-0 items-center gap-2.5">
                {match?.group ? (
                  <span className={cn('shrink-0 rounded-pill px-2 py-0.5 text-[0.625rem] font-semibold', groupTone(match.group))}>
                    {match.group}
                  </span>
                ) : (
                  <span className="shrink-0 rounded-pill bg-well px-2 py-0.5 text-[0.625rem] font-semibold text-muted-ink">
                    {match ? matchRoundLabel(match) : '–'}
                  </span>
                )}
                <span className="min-w-0 [overflow-wrap:anywhere] text-[0.8125rem] font-medium">{matchPairs(snapshot, assignment.matchId)}</span>
              </span>
              <Select
                value={String(assignment.court)}
                onValueChange={(value) => update(assignment.matchId, { court: Number(value) as Court })}
              >
                <SelectTrigger className="w-full" aria-label={messages.organizer.schedule.courtFor(matchName(snapshot, assignment.matchId))}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {courts.map((court) => <SelectItem value={String(court)} key={court}>Court {court}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input
                type="number"
                min="1"
                className="numeric"
                aria-label={messages.organizer.schedule.orderFor(matchName(snapshot, assignment.matchId))}
                value={assignment.playingOrder}
                onChange={(event) => update(assignment.matchId, { playingOrder: Number(event.target.value) })}
              />
              <Button variant="outline" className="w-full" disabled={!ready || startMutation.isPending} onClick={() => setStartMatchId(assignment.matchId)}>
                <Play /> Start
              </Button>
            </div>
          )
        })}
        {assignments.length === 0 ? <p className="text-[0.8125rem] text-muted-ink">{messages.organizer.schedule.empty}</p> : null}
      </div>
      {assignments.length > 0 ? (
        <Button className="mt-4" variant="outline" disabled={assignmentMutation.isPending} onClick={() => setConfirmAssignments(true)}>
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
            <AlertDialogAction onClick={() => assignmentMutation.mutate()}>{messages.organizer.schedule.publish}</AlertDialogAction>
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

function CourtConfiguration({ snapshot, resetGeneration }: { snapshot: TournamentSnapshot; resetGeneration: number }) {
  const [nextCount, setNextCount] = useState<CourtCount>(snapshot.tournament.courtCount ?? 1)
  const [confirmationOpen, setConfirmationOpen] = useState(false)
  const mutation = useMutation({
    mutationFn: () => mutateTournament('set_court_count', {
      requestId: crypto.randomUUID(),
      resetGeneration,
      expectedVersion: snapshot.tournament.version,
      payload: { courtCount: nextCount },
    }),
    onSuccess: () => setConfirmationOpen(false),
  })
  const changed = nextCount !== snapshot.tournament.courtCount

  return (
    <section className="rounded-card border border-ink/5 bg-white p-6 shadow-card">
      <h3 className="text-sm font-semibold">{messages.organizer.courts.heading}</h3>
      <p className="mt-1.5 text-[0.6875rem] text-muted-ink">
        {messages.organizer.courts.description}
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="min-w-44 space-y-2">
          <Label htmlFor="active-court-count">{messages.organizer.courts.label}</Label>
          <Select value={String(nextCount)} onValueChange={(value) => setNextCount(Number(value) as CourtCount)}>
            <SelectTrigger id="active-court-count" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1">{messages.setup.courtOption(1)}</SelectItem>
              <SelectItem value="2">{messages.setup.courtOption(2)}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" disabled={!changed || mutation.isPending} onClick={() => setConfirmationOpen(true)}>
          {messages.organizer.courts.review}
        </Button>
      </div>
      {mutation.isError ? <p className="mt-3 text-sm text-destructive" role="alert">{errorMessage(mutation.error)}</p> : null}

      <AlertDialog open={confirmationOpen} onOpenChange={setConfirmationOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{messages.organizer.courts.confirmTitle(nextCount)}</AlertDialogTitle>
            <AlertDialogDescription>
              {nextCount === 1
                ? messages.organizer.courts.reduceBody
                : messages.organizer.courts.increaseBody}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{messages.organizer.courts.keep}</AlertDialogCancel>
            <AlertDialogAction disabled={mutation.isPending} onClick={() => mutation.mutate()}>
              {mutation.isPending ? messages.common.saving : messages.organizer.courts.change}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

function TieResolutionEditor({ snapshot, resetGeneration, group }: { snapshot: TournamentSnapshot; resetGeneration: number; group: Group }) {
  const manual = useMemo(
    () => calculateStandings(snapshot, group).filter((standing) => standing.tieStatus === 'manual'),
    [snapshot, group],
  )
  const existing = snapshot.tieResolutions.find((resolution) => resolution.group === group)
  const initialIds = existing?.orderedPairIds.length ? existing.orderedPairIds : manual.map((standing) => standing.pairId)
  const [orderedIds, setOrderedIds] = useState<UUID[]>(initialIds)
  const [explanation, setExplanation] = useState(existing?.explanation ?? '')
  const [confirmOpen, setConfirmOpen] = useState(false)

  const mutation = useMutation({
    mutationFn: () => mutateTournament('resolve_tie', {
      requestId: crypto.randomUUID(),
      resetGeneration,
      expectedVersion: snapshot.tournament.version,
      payload: { group, orderedPairIds: orderedIds, explanation: explanation.trim() },
    }),
    onSuccess: () => setConfirmOpen(false),
  })
  const move = (index: number, offset: -1 | 1) => {
    setOrderedIds((current) => {
      const next = [...current]
      const destination = index + offset
      if (destination < 0 || destination >= next.length) return current
      ;[next[index], next[destination]] = [next[destination] as UUID, next[index] as UUID]
      return next
    })
  }

  if (manual.length < 2) return null
  return (
    <section className="rounded-field border border-navy-soft bg-mist/50 p-4">
      <h4 className="text-[0.8125rem] font-semibold">{messages.organizer.tie.heading(group)}</h4>
      <p className="mt-1.5 text-[0.6875rem] text-muted-ink">{messages.organizer.tie.description}</p>
      <ol className="mt-3 space-y-2">
        {orderedIds.map((pairId, index) => (
          <li className="flex items-center gap-2 rounded-chip bg-white px-3 py-1.5 text-[0.8125rem]" key={pairId}>
            <span className="numeric w-5 text-[0.625rem] text-dim-ink">{formatNumber(index + 1)}</span>
            <span className="min-w-0 flex-1 truncate font-medium">{pairName(snapshot, pairId)}</span>
            <Button size="icon-sm" variant="ghost" aria-label={messages.organizer.tie.moveUp} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp /></Button>
            <Button size="icon-sm" variant="ghost" aria-label={messages.organizer.tie.moveDown} disabled={index === orderedIds.length - 1} onClick={() => move(index, 1)}><ArrowDown /></Button>
          </li>
        ))}
      </ol>
      <div className="mt-3 space-y-2">
        <Label htmlFor={`tie-${group}`}>{messages.organizer.tie.explanation}</Label>
        <textarea
          id={`tie-${group}`}
          className="min-h-20 w-full rounded-field border border-line bg-white px-3.5 py-3 text-[0.8125rem] outline-none transition-colors focus-visible:border-navy focus-visible:ring-[3px] focus-visible:ring-mist"
          value={explanation}
          onChange={(event) => setExplanation(event.target.value)}
        />
      </div>
      <Button className="mt-4" size="sm" disabled={!explanation.trim() || mutation.isPending} onClick={() => setConfirmOpen(true)}>{messages.organizer.tie.review}</Button>
      {mutation.isError ? <p className="mt-2 text-sm text-destructive" role="alert">{errorMessage(mutation.error)}</p> : null}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Record this Group {group} order?</AlertDialogTitle>
            <AlertDialogDescription>{messages.organizer.tie.confirmBody}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{messages.organizer.tie.back}</AlertDialogCancel>
            <AlertDialogAction onClick={() => mutation.mutate()}>{messages.organizer.tie.record}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

export function OrganizerPage({ snapshot, resetGeneration, onStartScoring }: { snapshot: TournamentSnapshot; resetGeneration: number; onStartScoring: () => void }) {
  const [pendingAction, setPendingAction] = useState<OrganizerAction | null>(null)
  const hasFixtures = snapshot.matches.length > 0
  const allActiveGroupsComplete = snapshot.matches
    .filter((match) => match.round === 'group')
    .every((match) => match.state === 'completed' || match.state === 'void')
  const unresolvedTie = (['A', 'B'] as const).some((group) =>
    calculateStandings(snapshot, group).some((standing) => standing.tieStatus === 'manual' && standing.rank === null),
  )

  const actionMutation = useMutation({
    mutationFn: (action: OrganizerAction) => {
      const envelope = { requestId: crypto.randomUUID(), resetGeneration, expectedVersion: snapshot.tournament.version, payload: {} }
      if (action === 'fixtures') {
        // Deliberately the server's own wording: errorMessage translates it, so
        // this client guard and the server produce the same Vietnamese.
        if (snapshot.tournament.courtCount === null) throw new Error('Select one or two courts before generating fixtures')
        return mutateTournament('generate_fixtures', envelope)
      }
      if (action === 'confirm-groups') return mutateTournament('confirm_groups', envelope)
      return mutateTournament('reopen_tournament', envelope)
    },
    onSuccess: () => setPendingAction(null),
  })

  const actionCopy: Record<OrganizerAction, { title: string; description: string; confirm: string }> = {
    fixtures: {
      title: messages.organizer.actions.fixtures.title,
      description: messages.organizer.actions.fixtures.description,
      confirm: messages.organizer.actions.fixtures.confirm,
    },
    'confirm-groups': {
      title: messages.organizer.actions.confirmGroups.title,
      description: messages.organizer.actions.confirmGroups.description,
      confirm: messages.organizer.actions.confirmGroups.confirm,
    },
    reopen: {
      title: messages.organizer.actions.reopen.title,
      description: messages.organizer.actions.reopen.description,
      confirm: messages.organizer.actions.reopen.confirm,
    },
  }
  const copy = pendingAction ? actionCopy[pendingAction] : null
  const progress = stageProgress(snapshot)
  /*
   * Setup leads before fixtures exist, because nothing else is actionable yet.
   * Once play is scheduled it drops to the bottom: it is the tallest panel on
   * the page and the one an organizer needs least often during a tournament.
   */
  const setupPanel = <SetupForm key={`setup-${resetGeneration}-${snapshot.tournament.version}`} snapshot={snapshot} resetGeneration={resetGeneration} />

  return (
    <section className="view-enter space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div>
          <h2 className="text-[1.375rem] font-semibold tracking-[-0.036em]">{messages.organizer.heading}</h2>
          <p className="mt-2 text-xs text-muted-ink">{messages.organizer.subheading}</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          {progress ? <StageProgressMeter progress={progress} /> : null}
          <Badge variant="outline">{messages.organizer.stageBadge(messages.app.stage[snapshot.tournament.stage])}</Badge>
        </div>
      </div>

      {!hasFixtures ? setupPanel : null}

      {!hasFixtures ? (
        <section className="rounded-card bg-navy p-6 text-white shadow-final">
          <h3 className="text-sm font-semibold">{messages.organizer.fixtures.heading}</h3>
          <p className="mt-1.5 text-[0.6875rem] text-navy-soft">{messages.organizer.fixtures.description}</p>
          <Button className="mt-5 bg-white text-navy hover:bg-navy-soft" disabled={snapshot.tournament.courtCount === null} onClick={() => setPendingAction('fixtures')}>
            <CalendarRange /> {messages.organizer.fixtures.review}
          </Button>
        </section>
      ) : null}

      {hasFixtures ? <CourtConfiguration key={`courts-${resetGeneration}-${snapshot.tournament.version}`} snapshot={snapshot} resetGeneration={resetGeneration} /> : null}
      {hasFixtures ? <UpcomingSchedule key={`schedule-${resetGeneration}-${snapshot.tournament.version}`} snapshot={snapshot} resetGeneration={resetGeneration} onStartScoring={onStartScoring} /> : null}
      {hasFixtures ? <ResultsSection key={`results-${resetGeneration}`} snapshot={snapshot} resetGeneration={resetGeneration} /> : null}
      {hasFixtures ? <WithdrawalPanel key={`withdrawals-${resetGeneration}`} snapshot={snapshot} resetGeneration={resetGeneration} /> : null}

      {snapshot.tournament.stage === 'groups' && allActiveGroupsComplete ? (
        <section className="rounded-card border border-ink/5 bg-white p-6 shadow-card">
          <div className="flex items-start gap-2.5">
            <span className="grid size-7 shrink-0 place-items-center rounded-step bg-mist text-navy">
              <LockKeyhole className="size-3.5" />
            </span>
            <div>
              <h3 className="text-sm font-semibold">{messages.organizer.confirmGroups.heading}</h3>
              <p className="mt-1.5 text-[0.6875rem] text-muted-ink">{messages.organizer.confirmGroups.description}</p>
            </div>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <TieResolutionEditor key={`tie-A-${resetGeneration}-${snapshot.tournament.version}`} snapshot={snapshot} resetGeneration={resetGeneration} group="A" />
            <TieResolutionEditor key={`tie-B-${resetGeneration}-${snapshot.tournament.version}`} snapshot={snapshot} resetGeneration={resetGeneration} group="B" />
          </div>
          <Button className="mt-5" disabled={unresolvedTie} onClick={() => setPendingAction('confirm-groups')}>{messages.organizer.confirmGroups.review}</Button>
          {unresolvedTie ? <p className="mt-2 text-xs text-destructive">{messages.organizer.confirmGroups.unresolved}</p> : null}
        </section>
      ) : null}

      {snapshot.tournament.stage === 'completed' ? (
        <section className="rounded-card border border-peach-line bg-[#fff7f3] p-6">
          <h3 className="text-sm font-semibold">{messages.organizer.completed.heading}</h3>
          <p className="mt-1.5 text-[0.6875rem] text-muted-ink">{messages.organizer.completed.description}</p>
          <Button className="mt-5" variant="outline" onClick={() => setPendingAction('reopen')}><RotateCcw /> {messages.organizer.completed.review}</Button>
        </section>
      ) : null}

      {hasFixtures ? setupPanel : null}

      {actionMutation.isError ? <p className="text-sm text-destructive" role="alert">{errorMessage(actionMutation.error)}</p> : null}
      <AlertDialog open={copy !== null} onOpenChange={(open) => { if (!open) setPendingAction(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{copy?.title}</AlertDialogTitle>
            <AlertDialogDescription>{copy?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{messages.common.cancel}</AlertDialogCancel>
            <AlertDialogAction disabled={!pendingAction || actionMutation.isPending} onClick={() => { if (pendingAction) actionMutation.mutate(pendingAction) }}>
              {actionMutation.isPending ? messages.common.saving : copy?.confirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
