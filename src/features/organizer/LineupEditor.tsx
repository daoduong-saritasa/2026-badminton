import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { CheckCircle2, RotateCcw } from 'lucide-react'

import { mutateTournament } from '@/data/tournament'
import { validateLineup } from '@/domain/roster'
import type { Lineup, LineupPair, Seed, TeamFixture, TournamentSnapshot, UUID } from '@/domain/types'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { fixtureLabel, fixtureMatches, teamName } from '@/features/tournament/labels'
import { errorMessage } from '@/i18n/errors'
import { messages } from '@/i18n/vi'

type LineupPairs = Lineup['pairs']

const matchNumbers = [1, 2, 3] as const
const emptyPair: LineupPair = { seed1PlayerId: '', seed2PlayerId: '' }

function samePairs(left: LineupPairs, right: LineupPairs | undefined): boolean {
  return right !== undefined && left.every((pair, index) =>
    pair.seed1PlayerId === right[index]?.seed1PlayerId && pair.seed2PlayerId === right[index]?.seed2PlayerId)
}

function TeamLineup({
  snapshot,
  fixture,
  teamId,
  resetGeneration,
  started,
}: {
  snapshot: TournamentSnapshot
  fixture: TeamFixture
  teamId: UUID
  resetGeneration: number
  started: boolean
}) {
  const saved = snapshot.lineups.find((lineup) => lineup.fixtureId === fixture.id && lineup.teamId === teamId)
  const [pairs, setPairs] = useState<LineupPairs>(saved?.pairs ?? [emptyPair, emptyPair, emptyPair])
  const [confirmOpen, setConfirmOpen] = useState(false)
  const name = teamName(snapshot, teamId)
  const confirmed = saved?.confirmedAt != null
  const locked = started || confirmed
  const dirty = !samePairs(pairs, saved?.pairs)
  const issueCodes = [...new Set(validateLineup({ fixtureId: fixture.id, teamId, pairs, confirmedAt: null }, snapshot.players)
    .map((issue) => issue.code))]
  const playersBySeed = (seed: Seed) => snapshot.players.filter((player) => player.teamId === teamId && player.seed === seed)

  const envelope = () => ({ requestId: crypto.randomUUID(), resetGeneration, expectedVersion: fixture.version })
  const saveMutation = useMutation({
    mutationFn: () => mutateTournament('save_lineup', { ...envelope(), payload: { fixtureId: fixture.id, teamId, pairs } }),
  })
  const confirmMutation = useMutation({
    mutationFn: () => mutateTournament('confirm_lineup', { ...envelope(), payload: { fixtureId: fixture.id, teamId } }),
    onSuccess: () => setConfirmOpen(false),
  })

  const update = (index: number, field: keyof LineupPair, playerId: UUID) => {
    setPairs((current) => current.map((pair, pairIndex) =>
      pairIndex === index ? { ...pair, [field]: playerId } : pair) as LineupPairs)
  }

  return (
    <div className="rounded-field border border-hairline p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h4 className="min-w-0 text-[0.8125rem] font-semibold [overflow-wrap:anywhere]">{name}</h4>
        <Badge variant={confirmed ? 'default' : 'outline'}>
          {confirmed ? messages.lineups.confirmed : saved ? messages.lineups.draft : messages.lineups.notEntered}
        </Badge>
      </div>
      <div className="space-y-2.5">
        {matchNumbers.map((matchNumber, index) => (
          <div className="grid grid-cols-[3.25rem_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2" key={matchNumber}>
            <span className="text-[0.6875rem] text-muted-ink">{messages.common.matchNumber(matchNumber)}</span>
            {([1, 2] as const).map((seed) => {
              const field: keyof LineupPair = seed === 1 ? 'seed1PlayerId' : 'seed2PlayerId'
              return (
                <Select key={seed} value={pairs[index]?.[field] ?? ''} disabled={locked} onValueChange={(value) => update(index, field, value)}>
                  <SelectTrigger className="w-full" aria-label={messages.lineups.seedFor(name, matchNumber, seed)}>
                    <SelectValue placeholder={messages.lineups.selectPlayer} />
                  </SelectTrigger>
                  <SelectContent>
                    {playersBySeed(seed).map((player) => (
                      <SelectItem value={player.id} key={player.id}>{player.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )
            })}
          </div>
        ))}
      </div>
      {!locked && issueCodes.length > 0 ? (
        <ul className="mt-3 space-y-1 text-[0.6875rem] text-destructive">
          {issueCodes.map((code) => <li key={code}>{messages.lineups.issues[code]}</li>)}
        </ul>
      ) : null}
      {!locked && dirty && saved ? <p className="mt-2 text-[0.6875rem] text-muted-ink">{messages.lineups.unsaved}</p> : null}
      {!locked ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={!dirty || issueCodes.length > 0 || saveMutation.isPending} onClick={() => saveMutation.mutate()}>
            {saveMutation.isPending ? messages.common.saving : messages.lineups.save}
          </Button>
          <Button size="sm" disabled={!saved || dirty || confirmMutation.isPending} onClick={() => setConfirmOpen(true)}>
            <CheckCircle2 /> {messages.lineups.confirm}
          </Button>
        </div>
      ) : null}
      {saveMutation.isError ? <p className="mt-2 text-sm text-destructive" role="alert">{errorMessage(saveMutation.error)}</p> : null}
      {confirmMutation.isError ? <p className="mt-2 text-sm text-destructive" role="alert">{errorMessage(confirmMutation.error)}</p> : null}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{messages.lineups.confirmTitle(name)}</AlertDialogTitle>
            <AlertDialogDescription>{messages.lineups.confirmBody}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{messages.common.cancel}</AlertDialogCancel>
            <AlertDialogAction disabled={confirmMutation.isPending} onClick={() => confirmMutation.mutate()}>
              {confirmMutation.isPending ? messages.common.saving : messages.lineups.confirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** The organizer enters and confirms both teams' lineups for one fixture. */
export function LineupEditor({
  snapshot,
  fixture,
  resetGeneration,
}: {
  snapshot: TournamentSnapshot
  fixture: TeamFixture
  resetGeneration: number
}) {
  const [reopenOpen, setReopenOpen] = useState(false)
  const started = fixtureMatches(snapshot, fixture.id).some((match) => match.state !== 'unstarted')
  const anyConfirmed = snapshot.lineups.some((lineup) => lineup.fixtureId === fixture.id && lineup.confirmedAt !== null)
  const reopenMutation = useMutation({
    mutationFn: () => mutateTournament('reopen_lineups', {
      requestId: crypto.randomUUID(),
      resetGeneration,
      expectedVersion: fixture.version,
      payload: { fixtureId: fixture.id },
    }),
    onSuccess: () => setReopenOpen(false),
  })
  const teamIds = [fixture.teamAId, fixture.teamBId].filter((teamId): teamId is UUID => teamId !== null)

  return (
    <section className="rounded-card border border-ink/5 bg-white p-6 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{messages.lineups.heading(fixtureLabel(fixture))}</h3>
          <p className="mt-1.5 text-[0.6875rem] text-muted-ink">{started ? messages.lineups.locked : messages.lineups.description}</p>
        </div>
        {!started && anyConfirmed ? (
          <Button size="sm" variant="outline" disabled={reopenMutation.isPending} onClick={() => setReopenOpen(true)}>
            <RotateCcw /> {messages.lineups.reopen}
          </Button>
        ) : null}
      </div>
      {teamIds.length === 2 ? (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {teamIds.map((teamId) => {
            const saved = snapshot.lineups.find((lineup) => lineup.fixtureId === fixture.id && lineup.teamId === teamId)
            return (
              <TeamLineup
                // A saved or reopened lineup replaces the draft on screen.
                key={`${teamId}-${saved?.confirmedAt ?? ''}-${JSON.stringify(saved?.pairs ?? null)}`}
                snapshot={snapshot}
                fixture={fixture}
                teamId={teamId}
                resetGeneration={resetGeneration}
                started={started}
              />
            )
          })}
        </div>
      ) : (
        <p className="mt-4 text-[0.8125rem] text-muted-ink">{messages.lineups.awaitingTeams}</p>
      )}
      {reopenMutation.isError ? <p className="mt-3 text-sm text-destructive" role="alert">{errorMessage(reopenMutation.error)}</p> : null}

      <AlertDialog open={reopenOpen} onOpenChange={setReopenOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{messages.lineups.reopenTitle}</AlertDialogTitle>
            <AlertDialogDescription>{messages.lineups.reopenBody}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{messages.common.cancel}</AlertDialogCancel>
            <AlertDialogAction disabled={reopenMutation.isPending} onClick={() => reopenMutation.mutate()}>
              {reopenMutation.isPending ? messages.common.saving : messages.lineups.reopen}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
