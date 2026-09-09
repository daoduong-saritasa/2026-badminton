import type {
  CompletedPlayedMatch,
  CompletedWalkoverMatch,
  Group,
  Standing,
  StandingTieStatus,
  TieResolution,
  TournamentSnapshot,
  UUID,
} from './types'

type CompletedMatch = CompletedPlayedMatch | CompletedWalkoverMatch

interface MutableStanding {
  pairId: UUID
  played: number
  wins: number
  losses: number
  pointsFor: number
  pointsAgainst: number
}

interface RankedStanding {
  standing: MutableStanding
  rank: number | null
  tieStatus: StandingTieStatus
}

function completedGroupMatches(
  snapshot: TournamentSnapshot,
  group: Group,
  activePairIds: ReadonlySet<UUID>,
): CompletedMatch[] {
  return snapshot.matches.filter(
    (match): match is CompletedMatch =>
      match.round === 'group' &&
      match.group === group &&
      match.state === 'completed' &&
      match.pairAId !== null &&
      match.pairBId !== null &&
      activePairIds.has(match.pairAId) &&
      activePairIds.has(match.pairBId),
  )
}

function recordMatch(
  standings: Map<UUID, MutableStanding>,
  match: CompletedMatch,
): void {
  if (match.pairAId === null || match.pairBId === null) {
    return
  }

  const pairA = standings.get(match.pairAId)
  const pairB = standings.get(match.pairBId)

  if (!pairA || !pairB) {
    return
  }

  pairA.played += 1
  pairB.played += 1

  if (match.winnerId === pairA.pairId) {
    pairA.wins += 1
    pairB.losses += 1
  } else if (match.winnerId === pairB.pairId) {
    pairB.wins += 1
    pairA.losses += 1
  }

  if (match.resultKind === 'played') {
    pairA.pointsFor += match.score.a
    pairA.pointsAgainst += match.score.b
    pairB.pointsFor += match.score.b
    pairB.pointsAgainst += match.score.a
  }
}

function matchingResolution(
  resolutions: readonly TieResolution[],
  group: Group,
  pairIds: readonly UUID[],
): TieResolution | undefined {
  const expectedIds = new Set(pairIds)

  return resolutions.find(
    (resolution) =>
      resolution.group === group &&
      resolution.explanation.trim().length > 0 &&
      resolution.orderedPairIds.length === pairIds.length &&
      new Set(resolution.orderedPairIds).size === pairIds.length &&
      resolution.orderedPairIds.every((pairId) => expectedIds.has(pairId)),
  )
}

function manuallyRank(
  standings: readonly MutableStanding[],
  resolutions: readonly TieResolution[],
  group: Group,
  startRank: number,
): RankedStanding[] {
  const resolution = matchingResolution(
    resolutions,
    group,
    standings.map((standing) => standing.pairId),
  )

  if (!resolution) {
    return standings.map((standing) => ({
      standing,
      rank: null,
      tieStatus: 'manual',
    }))
  }

  const byPairId = new Map(standings.map((standing) => [standing.pairId, standing]))

  return resolution.orderedPairIds.map((pairId, index) => ({
    standing: byPairId.get(pairId) as MutableStanding,
    rank: startRank + index,
    tieStatus: 'manual',
  }))
}

function rankTwoPairTie(
  standings: readonly [MutableStanding, MutableStanding],
  matches: readonly CompletedMatch[],
  resolutions: readonly TieResolution[],
  group: Group,
  startRank: number,
): RankedStanding[] {
  const [first, second] = standings
  const headToHead = matches.find(
    (match) =>
      (match.pairAId === first.pairId && match.pairBId === second.pairId) ||
      (match.pairAId === second.pairId && match.pairBId === first.pairId),
  )

  if (headToHead?.winnerId === first.pairId || headToHead?.winnerId === second.pairId) {
    const winner = headToHead.winnerId === first.pairId ? first : second
    const loser = winner === first ? second : first

    return [
      { standing: winner, rank: startRank, tieStatus: 'head-to-head' },
      { standing: loser, rank: startRank + 1, tieStatus: 'head-to-head' },
    ]
  }

  return manuallyRank(standings, resolutions, group, startRank)
}

function miniTableDifferences(
  standings: readonly MutableStanding[],
  matches: readonly CompletedMatch[],
): Map<UUID, number> {
  const pairIds = new Set(standings.map((standing) => standing.pairId))
  const differences = new Map(standings.map((standing) => [standing.pairId, 0]))

  for (const match of matches) {
    if (
      match.resultKind !== 'played' ||
      match.pairAId === null ||
      match.pairBId === null ||
      !pairIds.has(match.pairAId) ||
      !pairIds.has(match.pairBId)
    ) {
      continue
    }

    const difference = match.score.a - match.score.b
    differences.set(match.pairAId, (differences.get(match.pairAId) ?? 0) + difference)
    differences.set(match.pairBId, (differences.get(match.pairBId) ?? 0) - difference)
  }

  return differences
}

function rankMultiPairTie(
  standings: readonly MutableStanding[],
  matches: readonly CompletedMatch[],
  resolutions: readonly TieResolution[],
  group: Group,
  startRank: number,
): RankedStanding[] {
  const differences = miniTableDifferences(standings, matches)
  const sorted = [...standings].sort(
    (left, right) =>
      (differences.get(right.pairId) ?? 0) - (differences.get(left.pairId) ?? 0),
  )
  const ranked: RankedStanding[] = []
  let index = 0

  while (index < sorted.length) {
    const difference = differences.get(sorted[index]?.pairId ?? '') ?? 0
    const tiedOnDifference = sorted.slice(index).filter(
      (standing) => (differences.get(standing.pairId) ?? 0) === difference,
    )

    if (tiedOnDifference.length === 1) {
      ranked.push({
        standing: tiedOnDifference[0] as MutableStanding,
        rank: startRank + index,
        tieStatus: 'mini-table',
      })
    } else {
      ranked.push(
        ...manuallyRank(
          tiedOnDifference,
          resolutions,
          group,
          startRank + index,
        ),
      )
    }

    index += tiedOnDifference.length
  }

  return ranked
}

function groupByWins(
  standings: Iterable<MutableStanding>,
): Map<number, MutableStanding[]> {
  const grouped = new Map<number, MutableStanding[]>()

  for (const standing of standings) {
    const cohort = grouped.get(standing.wins) ?? []
    cohort.push(standing)
    grouped.set(standing.wins, cohort)
  }

  return grouped
}

export function calculateStandings(
  snapshot: TournamentSnapshot,
  group: Group,
): Standing[] {
  const activePairs = snapshot.pairs.filter(
    (pair) => pair.group === group && !pair.withdrawn,
  )
  const standings = new Map<UUID, MutableStanding>(
    activePairs.map((pair) => [
      pair.id,
      {
        pairId: pair.id,
        played: 0,
        wins: 0,
        losses: 0,
        pointsFor: 0,
        pointsAgainst: 0,
      },
    ]),
  )
  const matches = completedGroupMatches(snapshot, group, new Set(standings.keys()))

  for (const match of matches) {
    recordMatch(standings, match)
  }

  const byWins = groupByWins(standings.values())
  const ranked: RankedStanding[] = []
  let startRank = 1

  for (const wins of [...byWins.keys()].toSorted((left, right) => right - left)) {
    const cohort = byWins.get(wins) ?? []

    if (cohort.length === 1) {
      ranked.push({
        standing: cohort[0] as MutableStanding,
        rank: startRank,
        tieStatus: 'clear',
      })
    } else if (cohort.length === 2) {
      ranked.push(
        ...rankTwoPairTie(
          cohort as [MutableStanding, MutableStanding],
          matches,
          snapshot.tieResolutions,
          group,
          startRank,
        ),
      )
    } else {
      ranked.push(
        ...rankMultiPairTie(
          cohort,
          matches,
          snapshot.tieResolutions,
          group,
          startRank,
        ),
      )
    }

    startRank += cohort.length
  }

  return ranked.map(({ standing, rank, tieStatus }) => ({
    ...standing,
    rank,
    pointDifference: standing.pointsFor - standing.pointsAgainst,
    tieStatus,
  }))
}
