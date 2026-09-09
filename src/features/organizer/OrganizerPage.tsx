import { useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, CalendarRange, LockKeyhole, Play, RotateCcw } from 'lucide-react'

import { mutateTournament } from '@/data/tournament'
import { calculateStandings } from '@/domain/standings'
import type { Court, CourtAssignment, Group, MatchRound, TournamentSnapshot, UUID } from '@/domain/types'
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
import { cn } from '@/lib/utils'
import { ResultEditor } from './ResultEditor'
import { SetupForm } from './SetupForm'

type OrganizerAction = 'fixtures' | 'confirm-groups' | 'reopen'

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
    label: inGroups ? 'group matches played' : 'knockout matches played',
  }
}

function StageProgressMeter({ progress }: { progress: StageProgress }) {
  const { done, total, label } = progress
  return (
    <div className="min-w-52">
      <p className="text-[0.6875rem] text-muted-ink">
        <span className="numeric text-sm font-semibold text-navy">{done}</span>
        <span className="numeric"> / {total}</span> {label}
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
  if (!match) return 'Unknown match'
  return `${pairName(snapshot, match.pairAId)} vs ${pairName(snapshot, match.pairBId)}`
}

/** The spoken form, for control labels: the visible row shows the round as a chip. */
function matchName(snapshot: TournamentSnapshot, matchId: UUID): string {
  const match = snapshot.matches.find((candidate) => candidate.id === matchId)
  if (!match) return 'Unknown match'
  return `${matchRoundLabel(match)} · ${matchPairs(snapshot, matchId)}`
}

function UpcomingSchedule({ snapshot, onStartScoring }: { snapshot: TournamentSnapshot; onStartScoring: () => void }) {
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
      expectedVersion: snapshot.tournament.version,
      payload: { assignments },
    }),
    onSuccess: () => setConfirmAssignments(false),
  })
  const startMutation = useMutation({
    mutationFn: (matchId: UUID) => {
      const match = snapshot.matches.find((candidate) => candidate.id === matchId)
      if (!match) throw new Error('Match no longer exists')
      return mutateTournament('start_scoring', {
        requestId: crypto.randomUUID(),
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
          <h3 className="text-sm font-semibold">Upcoming courts</h3>
          <p className="mt-1.5 text-[0.6875rem]/[1.6] text-muted-ink">
            Order is the position in each court&#39;s queue, so the same number can appear once on Court 1 and once on Court 2.
            Edit every slot together and publish in one go.
          </p>
        </div>
        <CalendarRange className="size-5 text-muted-ink" />
      </div>
      {assignments.length > 0 ? (
        <div
          aria-hidden="true"
          className="mt-6 mb-2 hidden gap-2.5 px-[0.9375rem] text-[0.625rem] tracking-[0.08em] text-muted-ink uppercase md:grid md:grid-cols-[minmax(0,1fr)_8rem_6.5rem_6.5rem]"
        >
          <span>Match</span>
          <span>Court</span>
          <span>Order</span>
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
                <span className="truncate text-[0.8125rem] font-medium">{matchPairs(snapshot, assignment.matchId)}</span>
              </span>
              <Select
                value={String(assignment.court)}
                onValueChange={(value) => update(assignment.matchId, { court: Number(value) as Court })}
              >
                <SelectTrigger className="w-full" aria-label={`Court for ${matchName(snapshot, assignment.matchId)}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Court 1</SelectItem>
                  <SelectItem value="2">Court 2</SelectItem>
                </SelectContent>
              </Select>
              <Input
                type="number"
                min="1"
                className="numeric"
                aria-label={`Playing order for ${matchName(snapshot, assignment.matchId)}`}
                value={assignment.playingOrder}
                onChange={(event) => update(assignment.matchId, { playingOrder: Number(event.target.value) })}
              />
              <Button variant="outline" className="w-full" disabled={!ready || startMutation.isPending} onClick={() => setStartMatchId(assignment.matchId)}>
                <Play /> Start
              </Button>
            </div>
          )
        })}
        {assignments.length === 0 ? <p className="text-[0.8125rem] text-muted-ink">No upcoming matches.</p> : null}
      </div>
      {assignments.length > 0 ? (
        <Button className="mt-4" variant="outline" disabled={assignmentMutation.isPending} onClick={() => setConfirmAssignments(true)}>
          Review schedule changes
        </Button>
      ) : null}
      {assignmentMutation.isError ? <p className="mt-3 text-sm text-destructive" role="alert">{assignmentMutation.error.message}</p> : null}
      {startMutation.isError ? <p className="mt-3 text-sm text-destructive" role="alert">{startMutation.error.message}</p> : null}

      <AlertDialog open={confirmAssignments} onOpenChange={setConfirmAssignments}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Publish the updated court order?</AlertDialogTitle>
            <AlertDialogDescription>The public upcoming schedule will change immediately.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep current schedule</AlertDialogCancel>
            <AlertDialogAction onClick={() => assignmentMutation.mutate()}>Publish schedule</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={startMatchId !== null} onOpenChange={(open) => { if (!open) setStartMatchId(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Start scoring this match?</AlertDialogTitle>
            <AlertDialogDescription>Starting play locks the tournament setup and claims this match for your staff session.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={startMutation.isPending || startMatchId === null} onClick={() => { if (startMatchId) startMutation.mutate(startMatchId) }}>
              {startMutation.isPending ? 'Starting…' : 'Start scoring'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

function TieResolutionEditor({ snapshot, group }: { snapshot: TournamentSnapshot; group: Group }) {
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
      <h4 className="text-[0.8125rem] font-semibold">Group {group} manual tie</h4>
      <p className="mt-1.5 text-[0.6875rem] text-muted-ink">Set the exact order for every unresolved pair and record the decision.</p>
      <ol className="mt-3 space-y-2">
        {orderedIds.map((pairId, index) => (
          <li className="flex items-center gap-2 rounded-chip bg-white px-3 py-1.5 text-[0.8125rem]" key={pairId}>
            <span className="numeric w-5 text-[0.625rem] text-dim-ink">{index + 1}</span>
            <span className="min-w-0 flex-1 truncate font-medium">{pairName(snapshot, pairId)}</span>
            <Button size="icon-sm" variant="ghost" aria-label="Move up" disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp /></Button>
            <Button size="icon-sm" variant="ghost" aria-label="Move down" disabled={index === orderedIds.length - 1} onClick={() => move(index, 1)}><ArrowDown /></Button>
          </li>
        ))}
      </ol>
      <div className="mt-3 space-y-2">
        <Label htmlFor={`tie-${group}`}>Decision explanation</Label>
        <textarea
          id={`tie-${group}`}
          className="min-h-20 w-full rounded-field border border-line bg-white px-3.5 py-3 text-[0.8125rem] outline-none transition-colors focus-visible:border-navy focus-visible:ring-[3px] focus-visible:ring-mist"
          value={explanation}
          onChange={(event) => setExplanation(event.target.value)}
        />
      </div>
      <Button className="mt-4" size="sm" disabled={!explanation.trim() || mutation.isPending} onClick={() => setConfirmOpen(true)}>Review tie order</Button>
      {mutation.isError ? <p className="mt-2 text-sm text-destructive" role="alert">{mutation.error.message}</p> : null}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Record this Group {group} order?</AlertDialogTitle>
            <AlertDialogDescription>This order will determine knockout qualification when groups are confirmed.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Review order</AlertDialogCancel>
            <AlertDialogAction onClick={() => mutation.mutate()}>Record tie order</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

export function OrganizerPage({ snapshot, onStartScoring }: { snapshot: TournamentSnapshot; onStartScoring: () => void }) {
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
      const envelope = { requestId: crypto.randomUUID(), expectedVersion: snapshot.tournament.version, payload: {} }
      if (action === 'fixtures') return mutateTournament('generate_fixtures', envelope)
      if (action === 'confirm-groups') return mutateTournament('confirm_groups', envelope)
      return mutateTournament('reopen_tournament', envelope)
    },
    onSuccess: () => setPendingAction(null),
  })

  const actionCopy: Record<OrganizerAction, { title: string; description: string; confirm: string }> = {
    fixtures: {
      title: 'Generate all fixtures?',
      description: 'This fixes the initial group and knockout schedule. Save setup changes first.',
      confirm: 'Generate fixtures',
    },
    'confirm-groups': {
      title: 'Confirm group standings?',
      description: 'The top two pairs in each group will populate the semifinals.',
      confirm: 'Confirm groups',
    },
    reopen: {
      title: 'Reopen the tournament?',
      description: 'The final result will be cleared so staff can record it again.',
      confirm: 'Reopen final',
    },
  }
  const copy = pendingAction ? actionCopy[pendingAction] : null
  const progress = stageProgress(snapshot)
  /*
   * Setup leads before fixtures exist, because nothing else is actionable yet.
   * Once play is scheduled it drops to the bottom: it is the tallest panel on
   * the page and the one an organizer needs least often during a tournament.
   */
  const setupPanel = <SetupForm key={`setup-${snapshot.tournament.version}`} snapshot={snapshot} />

  return (
    <section className="view-enter space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div>
          <h2 className="text-[1.375rem] font-semibold tracking-[-0.036em]">Run the tournament</h2>
          <p className="mt-2 text-xs text-muted-ink">Keep play moving.</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          {progress ? <StageProgressMeter progress={progress} /> : null}
          <Badge variant="outline"><span className="capitalize">{snapshot.tournament.stage}</span>&nbsp;stage</Badge>
        </div>
      </div>

      {!hasFixtures ? setupPanel : null}

      {!hasFixtures ? (
        <section className="rounded-card bg-navy p-6 text-white shadow-final">
          <h3 className="text-sm font-semibold">Fixture generation</h3>
          <p className="mt-1.5 text-[0.6875rem] text-navy-soft">Generate fixtures after the setup contains the final six to eight pairs.</p>
          <Button className="mt-5 bg-white text-navy hover:bg-navy-soft" onClick={() => setPendingAction('fixtures')}>
            <CalendarRange /> Review fixture generation
          </Button>
        </section>
      ) : null}

      {hasFixtures ? <UpcomingSchedule key={`schedule-${snapshot.tournament.version}`} snapshot={snapshot} onStartScoring={onStartScoring} /> : null}
      {hasFixtures ? <ResultEditor key={`results-${snapshot.tournament.version}`} snapshot={snapshot} /> : null}

      {snapshot.tournament.stage === 'groups' && allActiveGroupsComplete ? (
        <section className="rounded-card border border-ink/5 bg-white p-6 shadow-card">
          <div className="flex items-start gap-2.5">
            <span className="grid size-7 shrink-0 place-items-center rounded-step bg-mist text-navy">
              <LockKeyhole className="size-3.5" />
            </span>
            <div>
              <h3 className="text-sm font-semibold">Confirm group standings</h3>
              <p className="mt-1.5 text-[0.6875rem] text-muted-ink">Resolve any manual ties, then lock qualifiers into the semifinals.</p>
            </div>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <TieResolutionEditor key={`tie-A-${snapshot.tournament.version}`} snapshot={snapshot} group="A" />
            <TieResolutionEditor key={`tie-B-${snapshot.tournament.version}`} snapshot={snapshot} group="B" />
          </div>
          <Button className="mt-5" disabled={unresolvedTie} onClick={() => setPendingAction('confirm-groups')}>Review group confirmation</Button>
          {unresolvedTie ? <p className="mt-2 text-xs text-destructive">Record every unresolved tie before confirming groups.</p> : null}
        </section>
      ) : null}

      {snapshot.tournament.stage === 'completed' ? (
        <section className="rounded-card border border-peach-line bg-[#fff7f3] p-6">
          <h3 className="text-sm font-semibold">Tournament completed</h3>
          <p className="mt-1.5 text-[0.6875rem] text-muted-ink">Reopening clears only the final result; setup remains locked.</p>
          <Button className="mt-5" variant="outline" onClick={() => setPendingAction('reopen')}><RotateCcw /> Review reopening</Button>
        </section>
      ) : null}

      {hasFixtures ? setupPanel : null}

      {actionMutation.isError ? <p className="text-sm text-destructive" role="alert">{actionMutation.error.message}</p> : null}
      <AlertDialog open={copy !== null} onOpenChange={(open) => { if (!open) setPendingAction(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{copy?.title}</AlertDialogTitle>
            <AlertDialogDescription>{copy?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={!pendingAction || actionMutation.isPending} onClick={() => { if (pendingAction) actionMutation.mutate(pendingAction) }}>
              {actionMutation.isPending ? 'Saving…' : copy?.confirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
