import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Check } from 'lucide-react'

import { mutateTournament } from '@/data/tournament'
import { pairingRule, qualifyingPairings, validatePairAssignment } from '@/domain/pair-assignment'
import { deciderStatus } from '@/domain/team-fixtures'
import type {
  FixtureMatch,
  Pair,
  Side,
  StaffRole,
  TeamFixture,
  TeamPlayer,
  TournamentSnapshot,
  UUID,
} from '@/domain/types'
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
import {
  fixtureMatches,
  fixtureOf,
  matchLabel,
  matchPair,
  pairPlayers,
  sideTeamId,
  teamName,
} from '@/features/tournament/labels'
import { errorMessage } from '@/i18n/errors'
import { messages } from '@/i18n/vi'

function samePair(left: Pair | null, right: Pair | null): boolean {
  if (left === null || right === null) return left === right
  return (left.player1Id === right.player1Id && left.player2Id === right.player2Id)
    || (left.player1Id === right.player2Id && left.player2Id === right.player1Id)
}

function playerIds(pair: Pair | null): UUID[] {
  return pair ? [pair.player1Id, pair.player2Id] : []
}

/**
 * Completed, played matches in this stage where the player was in the team's
 * pair. Walkovers are excluded: nobody played them.
 */
function stageAppearances(snapshot: TournamentSnapshot, stage: TeamFixture['stage'], teamId: UUID, playerId: UUID): number {
  return snapshot.fixtures
    .filter((fixture) => fixture.stage === stage && (fixture.teamAId === teamId || fixture.teamBId === teamId))
    .flatMap((fixture) => fixtureMatches(snapshot, fixture.id).map((match) => ({ fixture, match })))
    .filter(({ fixture, match }) =>
      match.state === 'completed'
      && match.resultKind === 'played'
      && playerIds(matchPair(match, fixture.teamAId === teamId ? 'a' : 'b')).includes(playerId))
    .length
}

/**
 * The usage line under a player. Qualifying caps at three; a placement fixture
 * allows two, or three while its decider may still be played; playoff rounds
 * have no fixed total. This informs staff and imposes no quota of its own.
 */
function usageText(snapshot: TournamentSnapshot, fixture: TeamFixture, teamId: UUID, playerId: UUID): string {
  const played = stageAppearances(snapshot, fixture.stage, teamId, playerId)
  switch (fixture.stage) {
    case 'qualifying':
      return messages.pairAssignment.usage.qualifying(played)
    case 'qualification-playoff':
      return messages.pairAssignment.usage.playoff(played)
    default: {
      const available = deciderStatus(fixture, fixtureMatches(snapshot, fixture.id)) === 'unnecessary' ? 2 : 3
      return messages.pairAssignment.usage.placement(played, available)
    }
  }
}

function playingPlayerIds(snapshot: TournamentSnapshot): Set<UUID> {
  return new Set(snapshot.matches
    .filter((match) => match.state === 'playing')
    .flatMap((match) => [...playerIds(match.pairA), ...playerIds(match.pairB)]))
}

function OptionButton({ selected, onClick, children }: {
  selected: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={selected ? 'default' : 'outline'}
      aria-pressed={selected}
      className="h-auto min-h-11 justify-start whitespace-normal text-left"
      onClick={onClick}
    >
      {selected ? <Check /> : null}
      <span className="min-w-0 [overflow-wrap:anywhere]">{children}</span>
    </Button>
  )
}

function SideAssignment({
  snapshot,
  match,
  fixture,
  side,
  teamId,
  role,
  resetGeneration,
}: {
  snapshot: TournamentSnapshot
  match: FixtureMatch
  fixture: TeamFixture
  side: Side
  teamId: UUID
  role: StaffRole
  resetGeneration: number
}) {
  const saved = matchPair(match, side)
  const rule = pairingRule(fixture.stage, match.matchNumber)
  const arrangements = rule === 'mixed-seed' ? qualifyingPairings(snapshot.players, teamId) : []
  const savedIsArrangement = arrangements.some((arrangement) => arrangement.some((pair) => samePair(pair, saved)))
  const [selection, setSelection] = useState<Pair | null>(saved)
  const [picked, setPicked] = useState<UUID[]>(playerIds(saved))
  // An organizer starts in the free list when the saved pair is already an exception.
  const [exceptionMode, setExceptionMode] = useState(role === 'organizer' && saved !== null && rule === 'mixed-seed' && !savedIsArrangement)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const name = teamName(snapshot, teamId)
  const teamPlayers: TeamPlayer[] = snapshot.players.filter((player) => player.teamId === teamId)
  const playing = playingPlayerIds(snapshot)
  const freeList = rule === 'free' || exceptionMode

  const issues = selection ? validatePairAssignment(snapshot, match.id, side, selection) : []
  const blocking = issues.filter((issue) => !issue.overridable)
  const overridable = issues.filter((issue) => issue.overridable)
  const dirty = selection !== null && !samePair(selection, saved)
  const needsException = blocking.length === 0 && overridable.length > 0

  const mutation = useMutation({
    mutationFn: (ruleException: boolean) => {
      if (!selection) throw new Error(messages.pairAssignment.notAssigned)
      return mutateTournament('assign_pair', {
        requestId: crypto.randomUUID(),
        resetGeneration,
        expectedVersion: match.version,
        payload: { matchId: match.id, side, ruleException, ...selection },
      })
    },
    onSuccess: () => setConfirmOpen(false),
  })

  const togglePlayer = (playerId: UUID) => {
    const next = picked.includes(playerId)
      ? picked.filter((id) => id !== playerId)
      : [...picked, playerId].slice(-2)
    setPicked(next)
    setSelection(next.length === 2 ? { player1Id: next[0], player2Id: next[1] } : null)
  }

  const choosePair = (pair: Pair) => {
    setSelection(pair)
    setPicked(playerIds(pair))
  }

  return (
    <div className="rounded-field border border-hairline p-4">
      <div className="flex items-center justify-between gap-2">
        <h4 className="min-w-0 text-[0.8125rem] font-semibold [overflow-wrap:anywhere]">{name}</h4>
        <Badge variant={saved ? 'default' : 'outline'}>
          {saved ? messages.pairAssignment.saved : messages.pairAssignment.notAssigned}
        </Badge>
      </div>
      <p className="mt-1 text-[0.6875rem] text-muted-ink">
        {fixture.stage === 'qualifying' ? messages.pairAssignment.qualifyingRule : messages.pairAssignment.rule[rule]}
      </p>
      {saved ? <p className="mt-1 text-[0.75rem] font-medium">{pairPlayers(snapshot, saved)}</p> : null}

      <ul className="mt-3 grid gap-1.5 text-[0.75rem]" aria-label={messages.pairAssignment.playersLabel(name)}>
        {teamPlayers.map((player) => (
          <li className="flex flex-wrap items-baseline justify-between gap-x-2" key={player.id}>
            <span className="min-w-0 [overflow-wrap:anywhere]">
              {player.name} <span className="text-muted-ink">· {messages.common.seed(player.seed)}</span>
            </span>
            <span className="text-[0.6875rem] text-muted-ink">
              {usageText(snapshot, fixture, teamId, player.id)}
              {playing.has(player.id) ? <span className="ml-1.5 font-semibold text-destructive">{messages.pairAssignment.playing}</span> : null}
            </span>
          </li>
        ))}
      </ul>

      {freeList ? (
        <div className="mt-3">
          <p className="text-[0.6875rem] font-semibold text-muted-ink">{messages.pairAssignment.pickTwo}</p>
          <div className="mt-1.5 grid grid-cols-2 gap-2">
            {teamPlayers.map((player) => (
              <OptionButton key={player.id} selected={picked.includes(player.id)} onClick={() => togglePlayer(player.id)}>
                {player.name}
              </OptionButton>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-3 space-y-2.5">
          {arrangements.map((arrangement, index) => (
            <div key={index}>
              <p className="text-[0.6875rem] font-semibold text-muted-ink">{messages.pairAssignment.arrangement(index + 1)}</p>
              <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
                {arrangement.map((pair) => (
                  <OptionButton key={playerIds(pair).join('-')} selected={samePair(pair, selection)} onClick={() => choosePair(pair)}>
                    {pairPlayers(snapshot, pair)}
                  </OptionButton>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {role === 'organizer' && rule === 'mixed-seed' ? (
        <Button type="button" variant="link" size="sm" className="mt-2 h-auto px-0" onClick={() => setExceptionMode((current) => !current)}>
          {exceptionMode ? messages.pairAssignment.hideException : messages.pairAssignment.showException}
        </Button>
      ) : null}

      {issues.length > 0 ? (
        <ul className="mt-3 space-y-1 text-[0.6875rem] text-destructive">
          {issues.map((issue) => <li key={issue.code}>{messages.pairAssignment.issues[issue.code]}</li>)}
          {needsException && role !== 'organizer' ? <li>{messages.pairAssignment.organizerOnly}</li> : null}
        </ul>
      ) : null}

      <div className="mt-3">
        {needsException && role === 'organizer' ? (
          <Button size="sm" variant="outline" disabled={!dirty || mutation.isPending} onClick={() => setConfirmOpen(true)}>
            {messages.pairAssignment.saveException}
          </Button>
        ) : (
          <Button size="sm" disabled={!dirty || issues.length > 0 || mutation.isPending} onClick={() => mutation.mutate(false)}>
            {mutation.isPending ? messages.common.saving : messages.pairAssignment.save}
          </Button>
        )}
      </div>
      {mutation.isError ? <p className="mt-2 text-sm text-destructive" role="alert">{errorMessage(mutation.error)}</p> : null}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{messages.pairAssignment.exceptionTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {messages.pairAssignment.exceptionBody(overridable.map((issue) => messages.pairAssignment.issues[issue.code]).join(' '))}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{messages.common.cancel}</AlertDialogCancel>
            <AlertDialogAction disabled={mutation.isPending} onClick={() => mutation.mutate(true)}>
              {mutation.isPending ? messages.common.saving : messages.pairAssignment.confirmException}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/**
 * Staff record each team's pair for one unstarted match. Each side saves on
 * its own through `assign_pair`; the server repeats every check here.
 */
export function PairAssignmentForm({
  snapshot,
  matchId,
  role,
  resetGeneration,
}: {
  snapshot: TournamentSnapshot
  matchId: UUID
  role: StaffRole
  resetGeneration: number
}) {
  const match = snapshot.matches.find((candidate) => candidate.id === matchId)
  if (!match) return <p className="text-[0.8125rem] text-muted-ink">{messages.organizer.matchGone}</p>
  const fixture = fixtureOf(snapshot, match)
  const teamIds = (['a', 'b'] as const).map((side) => sideTeamId(fixture, side))
  const placement = fixture?.stage === 'third-place' || fixture?.stage === 'final'

  let body: React.ReactNode
  if (!fixture || teamIds.some((teamId) => teamId === null)) {
    body = <p className="text-[0.8125rem] text-muted-ink">{messages.pairAssignment.awaitingTeams}</p>
  } else if (placement && snapshot.tournament.finalistsConfirmedAt === null) {
    body = <p className="text-[0.8125rem] text-muted-ink">{messages.pairAssignment.awaitingFinalists}</p>
  } else if (match.state !== 'unstarted') {
    body = (
      <div className="space-y-1 text-[0.8125rem]">
        <p className="text-muted-ink">{messages.pairAssignment.locked}</p>
        <p className="font-medium">{messages.common.versus(pairPlayers(snapshot, match.pairA), pairPlayers(snapshot, match.pairB))}</p>
      </div>
    )
  } else {
    body = (
      <div className="grid gap-4 md:grid-cols-2">
        {(['a', 'b'] as const).map((side, index) => {
          const teamId = teamIds[index]
          return teamId ? (
            <SideAssignment
              // A new saved pair on this side replaces its draft; the other
              // side's draft survives.
              key={`${side}-${playerIds(matchPair(match, side)).join('-')}`}
              snapshot={snapshot}
              match={match}
              fixture={fixture}
              side={side}
              teamId={teamId}
              role={role}
              resetGeneration={resetGeneration}
            />
          ) : null
        })}
      </div>
    )
  }

  return (
    <section className="space-y-4">
      <h3 className="text-sm font-semibold [overflow-wrap:anywhere]">{messages.pairAssignment.title(matchLabel(snapshot, match))}</h3>
      {body}
    </section>
  )
}
