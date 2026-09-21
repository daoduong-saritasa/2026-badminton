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

const emptyPair: LineupPair = { player1Id: '', player2Id: '' }

/**
 * Which of the four stored pairs the organizer picks. The server stores four
 * for every fixture, but a qualifying fixture never plays match 3 and a
 * placement fixture never uses the playoff pair, so those rows are derived.
 */
function editableRows(fixture: TeamFixture): readonly (0 | 1 | 2 | 3)[] {
  return fixture.stage === 'qualifying' ? [0, 1, 3] : [0, 1, 2]
}

/**
 * Fills the rows the organizer does not pick. A qualifying fixture's match 3
 * recombines the openers, which keeps it mixed-seed and distinct from both; a
 * placement fixture's unused playoff row repeats match 1.
 */
function completePairs(fixture: TeamFixture, pairs: LineupPairs): LineupPairs {
  const [first, second, third, playoff] = pairs
  return fixture.stage === 'qualifying'
    ? [first, second, { player1Id: first.player1Id, player2Id: second.player2Id }, playoff]
    : [first, second, third, first]
}

function samePairs(left: LineupPairs, right: LineupPairs | undefined): boolean {
  return right !== undefined && left.every((pair, index) =>
    pair.player1Id === right[index]?.player1Id && pair.player2Id === right[index]?.player2Id)
}

/** A team declares one playoff pair; a new qualifying lineup starts from it. */
function declaredPlayoffPair(snapshot: TournamentSnapshot, teamId: UUID): LineupPair {
  const qualifyingIds = new Set(snapshot.fixtures.filter((fixture) => fixture.stage === 'qualifying').map((fixture) => fixture.id))
  return snapshot.lineups.find((lineup) => lineup.teamId === teamId && qualifyingIds.has(lineup.fixtureId))?.pairs[3] ?? emptyPair
}

function TeamLineup({
  snapshot,
  fixture,
  teamId,
  resetGeneration,
  started,
  fixtureConfirmed,
  opponentSaved,
}: {
  snapshot: TournamentSnapshot
  fixture: TeamFixture
  teamId: UUID
  resetGeneration: number
  started: boolean
  /** Any lineup in the fixture is confirmed, which the server treats as a lock on both. */
  fixtureConfirmed: boolean
  opponentSaved: boolean
}) {
  const saved = snapshot.lineups.find((lineup) => lineup.fixtureId === fixture.id && lineup.teamId === teamId)
  const [pairs, setPairs] = useState<LineupPairs>(() => saved?.pairs ?? [
    emptyPair,
    emptyPair,
    emptyPair,
    fixture.stage === 'qualifying' ? declaredPlayoffPair(snapshot, teamId) : emptyPair,
  ])
  const [confirmOpen, setConfirmOpen] = useState(false)
  const name = teamName(snapshot, teamId)
  const confirmed = saved?.confirmedAt != null
  // A confirmed lineup locks both teams' pairs; only confirming remains open.
  const locked = started || fixtureConfirmed
  const complete = completePairs(fixture, pairs)
  const dirty = !samePairs(complete, saved?.pairs)
  const issueCodes = [...new Set(validateLineup({ fixtureId: fixture.id, teamId, pairs: complete, confirmedAt: null }, snapshot.players)
    .map((issue) => issue.code))]
  const teamPlayers = snapshot.players.filter((player) => player.teamId === teamId)
  const playersBySeed = (seed: Seed) => teamPlayers.filter((player) => player.seed === seed)

  const envelope = () => ({ requestId: crypto.randomUUID(), resetGeneration, expectedVersion: fixture.version })
  const saveMutation = useMutation({
    mutationFn: () => mutateTournament('save_lineup', { ...envelope(), payload: { fixtureId: fixture.id, teamId, pairs: complete } }),
  })
  const confirmMutation = useMutation({
    mutationFn: () => mutateTournament('confirm_lineup', { ...envelope(), payload: { fixtureId: fixture.id, teamId } }),
    onSuccess: () => setConfirmOpen(false),
  })

  const update = (index: number, field: keyof LineupPair, playerId: UUID) => {
    setPairs((current) => current.map((pair, pairIndex) =>
      pairIndex === index ? { ...pair, [field]: playerId } : pair) as LineupPairs)
  }

  const playerSelect = (index: number, field: keyof LineupPair, label: string, options: typeof teamPlayers) => (
    <Select key={field} value={pairs[index]?.[field] ?? ''} disabled={locked} onValueChange={(value) => update(index, field, value)}>
      <SelectTrigger className="w-full" aria-label={label}>
        <SelectValue placeholder={messages.lineups.selectPlayer} />
      </SelectTrigger>
      <SelectContent>
        {options.map((player) => (
          <SelectItem value={player.id} key={player.id}>{player.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )

  return (
    <div className="rounded-field border border-hairline p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h4 className="min-w-0 text-[0.8125rem] font-semibold [overflow-wrap:anywhere]">{name}</h4>
        <Badge variant={confirmed ? 'default' : 'outline'}>
          {confirmed ? messages.lineups.confirmed : saved ? messages.lineups.draft : messages.lineups.notEntered}
        </Badge>
      </div>
      <div className="space-y-2.5">
        {editableRows(fixture).map((index) => (
          <div className="grid grid-cols-[3.25rem_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2" key={index}>
            <span className="text-[0.6875rem] text-muted-ink">
              {index === 3 ? messages.lineups.playoffPair : messages.common.matchNumber(index + 1)}
            </span>
            {index === 3
              ? (['player1Id', 'player2Id'] as const).map((field, slot) =>
                playerSelect(index, field, messages.lineups.playoffPlayerFor(name, slot + 1), teamPlayers))
              : ([1, 2] as const).map((seed) =>
                playerSelect(index, seed === 1 ? 'player1Id' : 'player2Id', messages.lineups.seedFor(name, index + 1, seed), playersBySeed(seed)))}
          </div>
        ))}
      </div>
      {!locked && issueCodes.length > 0 ? (
        <ul className="mt-3 space-y-1 text-[0.6875rem] text-destructive">
          {issueCodes.map((code) => <li key={code}>{messages.lineups.issues[code]}</li>)}
        </ul>
      ) : null}
      {!locked && dirty && saved ? <p className="mt-2 text-[0.6875rem] text-muted-ink">{messages.lineups.unsaved}</p> : null}
      {!started && !confirmed ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {!locked ? (
            <Button size="sm" variant="outline" disabled={!dirty || issueCodes.length > 0 || saveMutation.isPending} onClick={() => saveMutation.mutate()}>
              {saveMutation.isPending ? messages.common.saving : messages.lineups.save}
            </Button>
          ) : null}
          <Button size="sm" disabled={!saved || dirty || !opponentSaved || confirmMutation.isPending} onClick={() => setConfirmOpen(true)}>
            <CheckCircle2 /> {messages.lineups.confirm}
          </Button>
        </div>
      ) : null}
      {!started && !confirmed && saved && !opponentSaved ? (
        <p className="mt-2 text-[0.6875rem] text-muted-ink">{messages.lineups.awaitingOpponent}</p>
      ) : null}
      {!started && !confirmed && fixtureConfirmed ? (
        <p className="mt-2 text-[0.6875rem] text-muted-ink">{messages.lineups.lockedByConfirmation}</p>
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
  const awaitingFinalists = fixture.stage !== 'qualifying' && snapshot.tournament.finalistsConfirmedAt === null
  const title = teamIds.length === 2
    ? `${fixtureLabel(fixture)} · ${messages.common.versus(teamName(snapshot, teamIds[0]), teamName(snapshot, teamIds[1]))}`
    : fixtureLabel(fixture)
  const description = started
    ? messages.lineups.locked
    : fixture.stage === 'qualifying' ? messages.lineups.qualifyingDescription : messages.lineups.placementDescription

  return (
    <section className="rounded-card border border-ink/5 bg-white p-6 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold [overflow-wrap:anywhere]">{messages.lineups.heading(title)}</h3>
          <p className="mt-1.5 text-[0.6875rem] text-muted-ink">{description}</p>
        </div>
        {!started && anyConfirmed ? (
          <Button size="sm" variant="outline" disabled={reopenMutation.isPending} onClick={() => setReopenOpen(true)}>
            <RotateCcw /> {messages.lineups.reopen}
          </Button>
        ) : null}
      </div>
      {awaitingFinalists ? (
        <p className="mt-4 text-[0.8125rem] text-muted-ink">{messages.lineups.awaitingFinalists}</p>
      ) : teamIds.length === 2 ? (
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
                fixtureConfirmed={anyConfirmed}
                opponentSaved={snapshot.lineups.some((lineup) =>
                  lineup.fixtureId === fixture.id && lineup.teamId !== teamId && teamIds.includes(lineup.teamId))}
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
