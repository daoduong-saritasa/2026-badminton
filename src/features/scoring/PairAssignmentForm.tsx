import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'

import { mutateTournament } from '@/data/tournament'
import { applyPairDrafts, pairingRule, validatePairDrafts } from '@/domain/pair-assignment'
import type {
  FixtureMatch,
  FixtureStage,
  Pair,
  PairDraft,
  Side,
  StaffRole,
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
import { Button } from '@/components/ui/button'
import { DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  fixtureLabel,
  fixtureMatches,
  isDeciderEligible,
  isDeciderOpen,
  matchPair,
  pairPlayers,
  sideTeamId,
  teamName,
} from '@/features/tournament/labels'
import { errorMessage } from '@/i18n/errors'
import { messages } from '@/i18n/vi'
import { cn } from '@/lib/utils'

const pa = messages.pairAssignment
const sides = ['a', 'b'] as const

function samePair(left: Pair | null, right: Pair | null): boolean {
  if (left === null || right === null) return left === right
  return (left.player1Id === right.player1Id && left.player2Id === right.player2Id)
    || (left.player1Id === right.player2Id && left.player2Id === right.player1Id)
}

function key(matchId: UUID, side: Side): string {
  return `${matchId}:${side}`
}

function toPair(playerIds: readonly UUID[]): Pair | null {
  const [player1Id, player2Id] = playerIds
  return player1Id && player2Id ? { player1Id, player2Id } : null
}

function playingPlayerIds(snapshot: TournamentSnapshot): Set<UUID> {
  return new Set(snapshot.matches
    .filter((match) => match.state === 'playing')
    .flatMap((match) => [match.pairA, match.pairB])
    .flatMap((pair) => (pair ? [pair.player1Id, pair.player2Id] : [])))
}

/**
 * Matches in `stage` where the player is in a pair: saved for later, on court,
 * or finished. A walkover without pairs and an unnecessary decider count for
 * nobody.
 */
function stageAppearances(snapshot: TournamentSnapshot, stage: FixtureStage, playerId: UUID): number {
  const stageFixtureIds = new Set(snapshot.fixtures.filter((fixture) => fixture.stage === stage).map((fixture) => fixture.id))
  return snapshot.matches.filter((match) =>
    stageFixtureIds.has(match.fixtureId)
    && match.state !== 'unnecessary'
    && [match.pairA, match.pairB].some((pair) => pair?.player1Id === playerId || pair?.player2Id === playerId))
    .length
}

/** A player button; selected players fill navy. The second line shows matches played and whether the player is on court. */
function PlayerChoice({ player, selected, playedText, overLimit, playing, onClick }: {
  player: TeamPlayer
  selected: boolean
  playedText: string
  overLimit: boolean
  playing: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        'flex h-full min-h-14 min-w-0 flex-col justify-center rounded-field border px-3 py-2 text-left text-[0.8125rem] font-medium transition-colors',
        selected ? 'border-navy bg-navy text-white' : 'border-line bg-white text-ink hover:bg-well',
      )}
      onClick={onClick}
    >
      <span className="[overflow-wrap:anywhere]">{player.name}</span>
      <span className={cn('mt-0.5 text-xs font-normal', selected ? 'text-white/80' : 'text-muted-ink')}>
        <span className={cn(overLimit && 'font-semibold', overLimit && !selected && 'text-destructive')}>{playedText}</span>
        {playing ? <span className={selected ? undefined : 'text-destructive'}> · {pa.playing}</span> : null}
      </span>
    </button>
  )
}

interface TeamPickerProps {
  teamLabel: string
  players: TeamPlayer[]
  picked: UUID[]
  mixed: boolean
  playing: Set<UUID>
  playedText: (playerId: UUID) => string
  overLimit: (playerId: UUID) => boolean
  onPick: (playerIds: UUID[]) => void
}

/**
 * One team's pair for one match. A mixed-seed match asks for one player per
 * seed; any other match asks for two players.
 */
function TeamPicker({ teamLabel, players, picked, mixed, playing, playedText, overLimit, onPick }: TeamPickerProps) {
  const choose = (player: TeamPlayer) => {
    if (mixed) {
      const others = picked.filter((id) => players.find((candidate) => candidate.id === id)?.seed !== player.seed)
      onPick(player.seed === 1 ? [player.id, ...others] : [...others, player.id])
    } else {
      onPick(picked.includes(player.id) ? picked.filter((id) => id !== player.id) : [...picked, player.id].slice(-2))
    }
  }

  return (
    <div role="group" aria-label={teamLabel} className="min-w-0 space-y-2">
      <p className="text-[0.8125rem] font-semibold [overflow-wrap:anywhere]">{teamLabel}</p>
      {mixed ? (
        ([1, 2] as const).map((seed) => (
          <div className="grid grid-cols-[2.75rem_minmax(0,1fr)_minmax(0,1fr)] items-stretch gap-2" key={seed}>
            <span className="self-center text-xs font-semibold text-muted-ink">{pa.seedShort(seed)}</span>
            {players.filter((player) => player.seed === seed).map((player) => (
              <PlayerChoice key={player.id} player={player} selected={picked.includes(player.id)} playedText={playedText(player.id)} overLimit={overLimit(player.id)} playing={playing.has(player.id)} onClick={() => choose(player)} />
            ))}
          </div>
        ))
      ) : (
        <div className="grid grid-cols-2 items-stretch gap-2">
          {players.map((player) => (
            <PlayerChoice key={player.id} player={player} selected={picked.includes(player.id)} playedText={playedText(player.id)} overLimit={overLimit(player.id)} playing={playing.has(player.id)} onClick={() => choose(player)} />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Staff pick each team's pair for every open match of one fixture, then save
 * them together through `assign_fixture_pairs`; the server repeats every
 * check here and saves all of them or none. While both opening matches need
 * mixed seeds, one of them takes the two players the other leaves.
 */
export function PairAssignmentForm({
  snapshot,
  fixtureId,
  role,
  resetGeneration,
  onSaved,
}: {
  snapshot: TournamentSnapshot
  fixtureId: UUID
  role: StaffRole
  resetGeneration: number
  onSaved: () => void
}) {
  const [picks, setPicks] = useState<Record<string, UUID[]>>({})
  const [exceptionMode, setExceptionMode] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const fixture = snapshot.fixtures.find((candidate) => candidate.id === fixtureId)
  const matches = fixture ? fixtureMatches(snapshot, fixture.id) : []
  const openMatches = matches.filter((match) => match.state === 'unstarted' && isDeciderOpen(snapshot, match))
  const playing = playingPlayerIds(snapshot)
  const isMixed = (match: FixtureMatch) => fixture !== undefined && pairingRule(fixture.stage, match.matchNumber) === 'mixed-seed'
  const openers = matches.filter((match) => match.matchNumber < 3)
  const linked = !exceptionMode && openers.length === 2 && openers.every(isMixed)

  const teamPlayers = (side: Side) => {
    const teamId = sideTeamId(fixture, side)
    return snapshot.players.filter((player) => player.teamId === teamId)
  }
  /**
   * The opening match whose pair fixes this one's, or null when this match is
   * picked freely. With both openers open, match 1 is picked and match 2
   * follows; once one opener has started or finished, its saved pair decides
   * the other, whichever order they went on court.
   */
  const sourceOf = (match: FixtureMatch, side: Side): FixtureMatch | null => {
    if (!linked || match.matchNumber === 3 || !openMatches.includes(match)) return null
    const sibling = openers.find((opener) => opener.id !== match.id)
    if (!sibling) return null
    if (openMatches.includes(sibling)) return match.matchNumber === 2 ? sibling : null
    return matchPair(sibling, side) ? sibling : null
  }
  const picked = (match: FixtureMatch, side: Side): UUID[] => {
    const source = sourceOf(match, side)
    if (source) {
      const sourcePair = openMatches.includes(source) ? null : matchPair(source, side)
      const taken = sourcePair ? [sourcePair.player1Id, sourcePair.player2Id] : picked(source, side)
      return taken.length === 2 ? teamPlayers(side).map((player) => player.id).filter((id) => !taken.includes(id)) : []
    }
    const own = picks[key(match.id, side)]
    if (own) return own
    const saved = matchPair(match, side)
    return saved ? [saved.player1Id, saved.player2Id] : []
  }

  const changed: PairDraft[] = openMatches.flatMap((match) => sides.flatMap((side) => {
    const pair = toPair(picked(match, side))
    return pair && !samePair(pair, matchPair(match, side)) ? [{ matchId: match.id, side, pair }] : []
  }))
  const issues = validatePairDrafts(snapshot, changed).flatMap((result) => result.issues)
  // Counts include the picks in this dialog, so a player's total moves as staff choose.
  const projected = applyPairDrafts(snapshot, changed)
  const playedText = (playerId: UUID) => {
    if (!fixture) return ''
    const count = stageAppearances(projected, fixture.stage, playerId)
    return fixture.stage === 'qualifying' ? pa.played.qualifying(count) : pa.played.other(count)
  }
  // Each player plays one match per qualifying fixture, so three in all; only an exception goes past it.
  const overLimit = (playerId: UUID) => fixture?.stage === 'qualifying' && stageAppearances(projected, 'qualifying', playerId) > 3
  const blocking = issues.filter((issue) => !issue.overridable)
  const overridable = issues.filter((issue) => issue.overridable)
  const needsException = blocking.length === 0 && overridable.length > 0
  const issueTexts = [...new Set(issues.map((issue) => pa.issues[issue.code]))]

  const mutation = useMutation({
    mutationFn: (ruleException: boolean) => {
      if (!fixture) throw new Error(messages.organizer.matchGone)
      return mutateTournament('assign_fixture_pairs', {
        requestId: crypto.randomUUID(),
        resetGeneration,
        expectedVersion: fixture.version,
        payload: {
          fixtureId: fixture.id,
          ruleException,
          assignments: changed.map(({ matchId, side, pair }) => ({
            matchId,
            side,
            matchVersion: matches.find((match) => match.id === matchId)?.version ?? 0,
            ...pair,
          })),
        },
      })
    },
    onSuccess: () => {
      setConfirmOpen(false)
      setPicks({})
      onSaved()
    },
  })

  const teams = messages.common.versus(teamName(snapshot, sideTeamId(fixture, 'a')), teamName(snapshot, sideTeamId(fixture, 'b')))
  const ruleText = !fixture || openMatches.length === 0
    ? null
    : fixture.stage === 'qualifying'
      ? pa.rule.qualifying
      : openMatches.some(isMixed) ? pa.rule['mixed-seed'] : pa.rule.free
  const header = (
    <DialogHeader className="pr-6">
      <DialogTitle>{fixture ? pa.title(fixtureLabel(fixture), teams) : pa.open}</DialogTitle>
      {ruleText ? <DialogDescription className="text-[0.8125rem]">{ruleText}</DialogDescription> : null}
    </DialogHeader>
  )

  const unavailable = !fixture || sides.some((side) => sideTeamId(fixture, side) === null)
    ? pa.awaitingTeams
    : (fixture.stage === 'third-place' || fixture.stage === 'final') && snapshot.tournament.finalistsConfirmedAt === null
      ? pa.awaitingFinalists
      : openMatches.length === 0 ? pa.locked : null
  if (unavailable) return <>{header}<p className="text-[0.8125rem] text-muted-ink">{unavailable}</p></>

  return (
    <>
      {header}
      <div className="space-y-4">
        {openMatches.map((match) => (
          <section className="rounded-card border border-line bg-white p-4 sm:p-5" aria-label={messages.common.matchNumber(match.matchNumber)} key={match.id}>
            <h3 className="mb-3 text-sm font-semibold">
              {messages.common.matchNumber(match.matchNumber)}
              {match.court ? <span className="font-normal text-muted-ink"> · {messages.common.court(match.court)}</span> : null}
              {!isDeciderEligible(snapshot, match) ? <span className="font-normal text-muted-ink"> · {messages.scoring.startBlocked.decider}</span> : null}
            </h3>
            <div className="grid gap-5 sm:grid-cols-2">
              {sides.map((side) => {
                const source = sourceOf(match, side)
                if (source) {
                  const pair = toPair(picked(match, side))
                  return (
                    <div className="min-w-0 space-y-2" key={side}>
                      <p className="text-[0.8125rem] font-semibold [overflow-wrap:anywhere]">{teamName(snapshot, sideTeamId(fixture, side))}</p>
                      <p className="rounded-field bg-well px-3 py-3 text-[0.8125rem]">
                        <span className="block font-medium">{pair ? pairPlayers(snapshot, pair) : pa.notAssigned}</span>
                        <span className="mt-0.5 block text-xs text-muted-ink">{pa.remainingOf(source.matchNumber)}</span>
                      </p>
                    </div>
                  )
                }
                return (
                  <TeamPicker
                    key={side}
                    teamLabel={teamName(snapshot, sideTeamId(fixture, side))}
                    players={teamPlayers(side)}
                    picked={picked(match, side)}
                    mixed={isMixed(match) && !exceptionMode}
                    playing={playing}
                    playedText={playedText}
                    overLimit={overLimit}
                    onPick={(playerIds) => setPicks((existing) => ({ ...existing, [key(match.id, side)]: playerIds }))}
                  />
                )
              })}
            </div>
          </section>
        ))}
      </div>

      {issueTexts.length > 0 ? (
        <ul className="space-y-1 text-[0.8125rem] text-destructive" role="status">
          {issueTexts.map((text) => <li key={text}>{text}</li>)}
          {needsException && role !== 'organizer' ? <li>{pa.organizerOnly}</li> : null}
        </ul>
      ) : null}
      {mutation.isError ? <p className="text-[0.8125rem] text-destructive" role="alert">{errorMessage(mutation.error)}</p> : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        {role === 'organizer' && openMatches.some(isMixed) ? (
          <Button type="button" variant="link" className="h-auto px-0" onClick={() => { setExceptionMode((value) => !value); setPicks({}) }}>
            {exceptionMode ? pa.hideException : pa.showException}
          </Button>
        ) : <span />}
        {needsException && role === 'organizer' ? (
          <Button variant="outline" disabled={mutation.isPending} onClick={() => setConfirmOpen(true)}>
            {pa.saveException}
          </Button>
        ) : (
          <Button disabled={changed.length === 0 || issues.length > 0 || mutation.isPending} onClick={() => mutation.mutate(false)}>
            {mutation.isPending ? messages.common.saving : pa.save}
          </Button>
        )}
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pa.exceptionTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {pa.exceptionBody([...new Set(overridable.map((issue) => pa.issues[issue.code]))].join(' '))}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{messages.common.cancel}</AlertDialogCancel>
            <AlertDialogAction disabled={mutation.isPending} onClick={() => mutation.mutate(true)}>
              {mutation.isPending ? messages.common.saving : pa.confirmException}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
