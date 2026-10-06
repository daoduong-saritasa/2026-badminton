import { useState } from 'react'

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
  courtLabel,
  fixtureLabel,
  fixtureMatches,
  isDeciderEligible,
  isDeciderOpen,
  matchPair,
  pairPlayers,
  sideTeamId,
  teamName,
} from '@/features/tournament/labels'
import { formatNumber } from '@/i18n/format'
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

function PlayerChoice({ player, selected, played, overLimit, playing, onClick }: {
  player: TeamPlayer
  selected: boolean
  played: { short: string; full: string }
  overLimit: boolean
  playing: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        'flex min-h-11 min-w-0 items-center gap-2 rounded-field border px-3 py-2 text-left text-sm transition-colors',
        selected ? 'border-navy bg-mist font-semibold text-navy ring-1 ring-navy' : 'border-line bg-white text-ink hover:bg-well',
      )}
      onClick={onClick}
    >
      {playing ? <span className="size-2 shrink-0 rounded-full bg-destructive" aria-hidden="true" /> : null}
      <span className="seed-name min-w-0 flex-1 [overflow-wrap:anywhere]" data-seed={player.seed}>{player.name}</span>
      <span
        aria-hidden="true"
        className={cn(
          'numeric shrink-0 rounded-pill px-1.5 py-0.5 text-xs font-medium',
          overLimit ? 'bg-[#fdeceb] text-destructive' : selected ? 'bg-navy text-white' : 'bg-well text-muted-ink',
        )}
      >
        {played.short}
      </span>
      <span className="sr-only">{played.full}{playing ? `, ${pa.playing}` : ''}</span>
    </button>
  )
}

interface TeamPickerProps {
  teamLabel: string
  players: TeamPlayer[]
  picked: UUID[]
  mixed: boolean
  playing: Set<UUID>
  played: (playerId: UUID) => { short: string; full: string }
  overLimit: (playerId: UUID) => boolean
  onPick: (playerIds: UUID[]) => void
}

/**
 * One team's pair for one match. A mixed-seed match asks for one player per
 * seed; any other match asks for two players.
 */
function TeamPicker({ teamLabel, players, picked, mixed, playing, played, overLimit, onPick }: TeamPickerProps) {
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
      <p className="truncate text-xs font-semibold tracking-[0.02em] text-muted-ink">{teamLabel}</p>
      {mixed ? (
        ([1, 2] as const).map((seed) => (
          <div className="grid grid-cols-[2.25rem_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2" key={seed}>
            <span className="text-xs font-semibold text-muted-ink">{pa.seedShort(seed)}</span>
            {players.filter((player) => player.seed === seed).map((player) => (
              <PlayerChoice key={player.id} player={player} selected={picked.includes(player.id)} played={played(player.id)} overLimit={overLimit(player.id)} playing={playing.has(player.id)} onClick={() => choose(player)} />
            ))}
          </div>
        ))
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {players.map((player) => (
            <PlayerChoice key={player.id} player={player} selected={picked.includes(player.id)} played={played(player.id)} overLimit={overLimit(player.id)} playing={playing.has(player.id)} onClick={() => choose(player)} />
          ))}
        </div>
      )}
    </div>
  )
}

export function PairAssignmentView({
  snapshot,
  fixtureId,
  role,
  onSave,
  pending = false,
  error = null,
  initialPicks = {},
}: {
  snapshot: TournamentSnapshot
  fixtureId: UUID
  role: StaffRole
  onSave: (input: { fixtureId: UUID; version: number; assignments: (PairDraft & { matchVersion: number })[]; ruleException: boolean }) => void
  pending?: boolean
  error?: string | null
  initialPicks?: Record<string, UUID[]>
}) {
  const [picks, setPicks] = useState<Record<string, UUID[]>>(initialPicks)
  const [exceptionMode, setExceptionMode] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [expandedDeciders, setExpandedDeciders] = useState<Set<UUID>>(new Set())
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
  const played = (playerId: UUID) => {
    const count = fixture ? stageAppearances(projected, fixture.stage, playerId) : 0
    const qualifying = fixture?.stage === 'qualifying'
    return {
      short: qualifying ? `${formatNumber(count)}/3` : formatNumber(count),
      full: qualifying ? pa.played.qualifying(count) : pa.played.other(count),
    }
  }
  // Each player plays one match per qualifying fixture, so three in all; only an exception goes past it.
  const overLimit = (playerId: UUID) => fixture?.stage === 'qualifying' && stageAppearances(projected, 'qualifying', playerId) > 3
  const blocking = issues.filter((issue) => !issue.overridable)
  const overridable = issues.filter((issue) => issue.overridable)
  const needsException = blocking.length === 0 && overridable.length > 0
  const issueTexts = [...new Set(issues.map((issue) => pa.issues[issue.code]))]

  const save = (ruleException: boolean) => {
    if (!fixture) return
    onSave({ fixtureId: fixture.id, version: fixture.version, ruleException,
      assignments: changed.map((draft) => ({ ...draft, matchVersion: matches.find((match) => match.id === draft.matchId)?.version ?? 0 })),
    })
  }

  const teams = messages.common.versus(teamName(snapshot, sideTeamId(fixture, 'a')), teamName(snapshot, sideTeamId(fixture, 'b')))
  const ruleText = !fixture || openMatches.length === 0
    ? null
    : fixture.stage === 'qualifying'
      ? pa.rule.qualifying
      : openMatches.some(isMixed) ? pa.rule['mixed-seed'] : pa.rule.free
  const header = (
    <DialogHeader className="shrink-0 border-b border-hairline px-5 pt-5 pb-4 pr-12 sm:px-6">
      <DialogTitle className="text-base/snug [overflow-wrap:anywhere]">{fixture ? teams : pa.open}</DialogTitle>
      <DialogDescription className="text-[0.8125rem]">
        {fixture ? fixtureLabel(fixture) : null}
        {ruleText ? ` · ${ruleText}` : null}
      </DialogDescription>
    </DialogHeader>
  )

  const unavailable = !fixture || sides.some((side) => sideTeamId(fixture, side) === null)
    ? pa.awaitingTeams
    : (fixture.stage === 'third-place' || fixture.stage === 'final') && snapshot.tournament.finalistsConfirmedAt === null
      ? pa.awaitingFinalists
      : openMatches.length === 0 ? pa.locked : null
  if (unavailable) {
    return <>{header}<p className="px-5 py-5 text-[0.8125rem] text-muted-ink sm:px-6">{unavailable}</p></>
  }

  // A decider that may never be played stays folded until it is needed or already has pairs.
  const folded = (match: FixtureMatch) =>
    match.matchNumber === 3
    && !isDeciderEligible(snapshot, match)
    && !expandedDeciders.has(match.id)
    && sides.every((side) => picked(match, side).length === 0)

  return (
    <>
      {header}
      <div className="min-h-0 flex-1 divide-y divide-hairline overflow-y-auto px-5 sm:px-6">
        {openMatches.map((match) => (
          <section className="py-5" aria-label={messages.common.matchNumber(match.matchNumber)} key={match.id}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h3 className="text-sm font-semibold">
                {messages.common.matchNumber(match.matchNumber)}
                {match.court ? <span className="font-normal text-muted-ink"> · {courtLabel(snapshot, match.court)}</span> : null}
              </h3>
              {!isDeciderEligible(snapshot, match) ? <span className="text-xs text-muted-ink">{messages.scoring.startBlocked.decider}</span> : null}
            </div>
            {folded(match) ? (
              <Button
                variant="outline"
                className="mt-3"
                onClick={() => setExpandedDeciders((current) => new Set([...current, match.id]))}
              >
                {pa.prepareDecider}
              </Button>
            ) : sides.some((side) => sourceOf(match, side)) ? (
              <div className="mt-2">
                <p className="text-xs text-muted-ink">{pa.remainingOf(sourceOf(match, 'a')?.matchNumber ?? sourceOf(match, 'b')?.matchNumber ?? 1)}</p>
                <dl className="mt-2 space-y-1.5 text-[0.8125rem]">
                  {sides.map((side) => {
                    const pair = toPair(picked(match, side))
                    return (
                      <div className="flex flex-wrap gap-x-2" key={side}>
                        <dt className="text-muted-ink">{teamName(snapshot, sideTeamId(fixture, side))}:</dt>
                        <dd className="font-medium">{pair ? pairPlayers(snapshot, pair) : pa.notAssigned}</dd>
                      </div>
                    )
                  })}
                </dl>
              </div>
            ) : (
              <div className="mt-3 grid gap-4 sm:grid-cols-2 sm:gap-6">
                {sides.map((side) => (
                  <TeamPicker
                    key={side}
                    teamLabel={teamName(snapshot, sideTeamId(fixture, side))}
                    players={teamPlayers(side)}
                    picked={picked(match, side)}
                    mixed={isMixed(match) && !exceptionMode}
                    playing={playing}
                    played={played}
                    overLimit={overLimit}
                    onPick={(playerIds) => setPicks((existing) => ({ ...existing, [key(match.id, side)]: playerIds }))}
                  />
                ))}
              </div>
            )}
          </section>
        ))}
      </div>

      <div className="shrink-0 space-y-2 border-t border-hairline bg-white px-5 py-3 sm:px-6">
        {issueTexts.length > 0 ? (
          <ul className="space-y-0.5 text-[0.8125rem] text-destructive" role="status">
            {issueTexts.map((text) => <li key={text}>{text}</li>)}
            {needsException && role !== 'organizer' ? <li>{pa.organizerOnly}</li> : null}
          </ul>
        ) : null}
        {error !== null ? <p className="text-[0.8125rem] text-destructive" role="alert">{error}</p> : null}
        <div className="flex items-center justify-between gap-3">
          {role === 'organizer' && openMatches.some(isMixed) ? (
            <Button type="button" variant="link" className="h-auto min-w-0 px-0 whitespace-normal text-left" onClick={() => { setExceptionMode((value) => !value); setPicks({}) }}>
              {exceptionMode ? pa.hideException : pa.showException}
            </Button>
          ) : <span />}
          {needsException && role === 'organizer' ? (
            <Button variant="outline" className="shrink-0" disabled={pending} onClick={() => setConfirmOpen(true)}>
              {pa.saveException}
            </Button>
          ) : (
            <Button data-guide="pairs-saved" className="shrink-0 px-6" disabled={changed.length === 0 || issues.length > 0 || pending} onClick={() => save(false)}>
              {pending ? messages.common.saving : pa.save}
            </Button>
          )}
        </div>
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
            <AlertDialogAction disabled={pending} onClick={() => save(true)}>
              {pending ? messages.common.saving : pa.confirmException}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
