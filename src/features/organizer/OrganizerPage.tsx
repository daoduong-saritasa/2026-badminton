import { useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, CalendarRange, LockKeyhole, Play, RotateCcw } from 'lucide-react'

import { mutateTournament } from '@/data/tournament'
import { calculateStandings } from '@/domain/standings'
import type { Court, CourtAssignment, Group, TournamentSnapshot, UUID } from '@/domain/types'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { pairName } from '@/features/tournament/MatchTicket'
import { ResultEditor } from './ResultEditor'
import { SetupForm } from './SetupForm'

type OrganizerAction = 'fixtures' | 'confirm-groups' | 'reopen'

function matchName(snapshot: TournamentSnapshot, matchId: UUID): string {
  const match = snapshot.matches.find((candidate) => candidate.id === matchId)
  if (!match) return 'Unknown match'
  return `${match.round} · ${pairName(snapshot, match.pairAId)} vs ${pairName(snapshot, match.pairBId)}`
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
    <section className="rounded-[1.375rem] border bg-white p-5 shadow-[0_6px_0_rgb(15_43_41/0.03)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">Upcoming courts</h3>
          <p className="mt-1 text-xs text-muted-foreground">Edit every unstarted slot together to keep court/order combinations unique.</p>
        </div>
        <CalendarRange className="size-5 text-muted-foreground" />
      </div>
      <div className="mt-5 space-y-3">
        {assignments.map((assignment) => {
          const match = unstarted.find((candidate) => candidate.id === assignment.matchId)
          const ready = match?.pairAId !== null && match?.pairBId !== null
          return (
            <div className="grid gap-3 rounded-xl border p-3 md:grid-cols-[minmax(0,1fr)_6rem_7rem_auto] md:items-center" key={assignment.matchId}>
              <span className="truncate text-sm font-medium">{matchName(snapshot, assignment.matchId)}</span>
              <select
                className="h-9 rounded-md border bg-transparent px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Court for ${matchName(snapshot, assignment.matchId)}`}
                value={assignment.court}
                onChange={(event) => update(assignment.matchId, { court: Number(event.target.value) as Court })}
              >
                <option value="1">Court 1</option>
                <option value="2">Court 2</option>
              </select>
              <Input
                type="number"
                min="1"
                aria-label={`Playing order for ${matchName(snapshot, assignment.matchId)}`}
                value={assignment.playingOrder}
                onChange={(event) => update(assignment.matchId, { playingOrder: Number(event.target.value) })}
              />
              <Button size="sm" variant="outline" disabled={!ready || startMutation.isPending} onClick={() => setStartMatchId(assignment.matchId)}>
                <Play /> Start
              </Button>
            </div>
          )
        })}
        {assignments.length === 0 ? <p className="text-sm text-muted-foreground">No upcoming matches.</p> : null}
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
    <section className="rounded-xl border border-[#bed0e2] bg-[#f4f8fb] p-4">
      <h4 className="text-sm font-semibold">Group {group} manual tie</h4>
      <p className="mt-1 text-xs text-muted-foreground">Set the exact order for every unresolved pair and record the decision.</p>
      <ol className="mt-3 space-y-2">
        {orderedIds.map((pairId, index) => (
          <li className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm" key={pairId}>
            <span className="numeric w-5 text-muted-foreground">{index + 1}</span>
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
          className="min-h-20 w-full rounded-md border bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={explanation}
          onChange={(event) => setExplanation(event.target.value)}
        />
      </div>
      <Button className="mt-3" size="sm" disabled={!explanation.trim() || mutation.isPending} onClick={() => setConfirmOpen(true)}>Review tie order</Button>
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

  return (
    <section className="view-enter space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Staff controls</p>
          <h2 className="mt-2 text-2xl font-bold tracking-tight">Tournament control</h2>
        </div>
        <span className="rounded-full border bg-white px-3 py-1 text-xs font-semibold capitalize">{snapshot.tournament.stage}</span>
      </div>

      <SetupForm key={`setup-${snapshot.tournament.version}`} snapshot={snapshot} />

      {!hasFixtures ? (
        <section className="rounded-[1.375rem] border bg-[#0f2b29] p-5 text-white">
          <h3 className="font-semibold">Fixture generation</h3>
          <p className="mt-1 text-xs text-white/70">Generate fixtures after the setup contains the final six to eight pairs.</p>
          <Button className="mt-4 bg-white text-primary hover:bg-white/90" onClick={() => setPendingAction('fixtures')}>
            <CalendarRange /> Review fixture generation
          </Button>
        </section>
      ) : null}

      {hasFixtures ? <UpcomingSchedule key={`schedule-${snapshot.tournament.version}`} snapshot={snapshot} onStartScoring={onStartScoring} /> : null}
      {hasFixtures ? <ResultEditor key={`results-${snapshot.tournament.version}`} snapshot={snapshot} /> : null}

      {snapshot.tournament.stage === 'groups' && allActiveGroupsComplete ? (
        <section className="rounded-[1.375rem] border bg-white p-5 shadow-[0_6px_0_rgb(15_43_41/0.03)]">
          <div className="flex items-start gap-3">
            <LockKeyhole className="mt-0.5 size-5" />
            <div>
              <h3 className="font-semibold">Confirm group standings</h3>
              <p className="mt-1 text-xs text-muted-foreground">Resolve any manual ties, then lock qualifiers into the semifinals.</p>
            </div>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <TieResolutionEditor key={`tie-A-${snapshot.tournament.version}`} snapshot={snapshot} group="A" />
            <TieResolutionEditor key={`tie-B-${snapshot.tournament.version}`} snapshot={snapshot} group="B" />
          </div>
          <Button className="mt-4" disabled={unresolvedTie} onClick={() => setPendingAction('confirm-groups')}>Review group confirmation</Button>
          {unresolvedTie ? <p className="mt-2 text-xs text-destructive">Record every unresolved tie before confirming groups.</p> : null}
        </section>
      ) : null}

      {snapshot.tournament.stage === 'completed' ? (
        <section className="rounded-[1.375rem] border border-[#e9a589] bg-[#fff7f3] p-5">
          <h3 className="font-semibold">Tournament completed</h3>
          <p className="mt-1 text-xs text-muted-foreground">Reopening clears only the final result; setup remains locked.</p>
          <Button className="mt-4" variant="outline" onClick={() => setPendingAction('reopen')}><RotateCcw /> Review reopening</Button>
        </section>
      ) : null}

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
