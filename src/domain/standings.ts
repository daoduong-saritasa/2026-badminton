import type {
  FixtureMatch,
  FixtureStage,
  PlayoffFormat,
  PlayoffRequirement,
  RankingCriterion,
  Team,
  TeamFixture,
  TeamStanding,
  UUID,
} from './types'

/** Teams ranked above the qualification cutoff, and the teams tied on it. */
export interface QualificationCutoff {
  fixedFinalistIds: UUID[]
  tiedTeamIds: UUID[]
  availablePlaces: number
}

interface MatchResult {
  teamAId: UUID
  teamBId: UUID
  winnerTeamId: UUID
  /** False for a walkover, which carries no points. */
  played: boolean
  pointsA: number
  pointsB: number
}

interface RankingKey {
  teamId: UUID
  keys: [number, number, number, number]
}

const tieBreakCriteria = [
  'tied-match-wins',
  'tied-point-difference',
  'point-difference',
] as const satisfies readonly RankingCriterion[]

/**
 * Ranks teams on completed qualifying matches by, in order: total match wins,
 * match wins among the tied teams, point difference among the tied teams, and
 * overall point difference. The tied set is fixed by total match wins and the
 * criteria apply once, never restarting on a smaller subset. Mirrors
 * `private.qualifying_standings()`; teams sharing a rank sort by name.
 */
export function qualifyingStandings(
  fixtures: readonly TeamFixture[],
  matches: readonly FixtureMatch[],
  teams: readonly Team[],
): TeamStanding[] {
  const results = matchResults(fixtures, matches, 'qualifying')
  const totals = teams.map((team) => teamTotals(team.id, results))

  const ranked: RankingKey[] = totals.map((total) => {
    const tiedIds = new Set(
      totals
        .filter((other) => other.matchWins === total.matchWins)
        .map((other) => other.teamId),
    )
    const tiedResults = results.filter(
      (result) => tiedIds.has(result.teamAId) && tiedIds.has(result.teamBId),
    )
    const tied = teamTotals(total.teamId, tiedResults)

    return {
      teamId: total.teamId,
      keys: [
        total.matchWins,
        tied.matchWins,
        tied.pointsScored - tied.pointsConceded,
        total.pointsScored - total.pointsConceded,
      ],
    }
  })

  const nameById = new Map(teams.map((team) => [team.id, team.name]))

  return totals
    .map((total, index) => {
      const key = ranked[index]
      return {
        teamId: total.teamId,
        matchWins: total.matchWins,
        pointsScored: total.pointsScored,
        pointsConceded: total.pointsConceded,
        pointDifference: total.pointsScored - total.pointsConceded,
        rank: competitionRank(key, ranked),
        separatedBy: separatingCriterion(key, ranked),
      }
    })
    .sort(
      (left, right) =>
        left.rank - right.rank ||
        (nameById.get(left.teamId) ?? '').localeCompare(nameById.get(right.teamId) ?? ''),
    )
}

/**
 * The cutoff for the two final places: the rank of the second-placed team,
 * the teams above it, and the teams sharing it. Mirrors
 * `private.qualification_requirement()`.
 */
export function qualificationCutoff(
  standings: readonly TeamStanding[],
): QualificationCutoff | null {
  const ordered = [...standings].sort((left, right) => left.rank - right.rank)
  const cutoffRank = ordered[1]?.rank
  if (cutoffRank === undefined) {
    return null
  }

  const fixedFinalistIds = sortedIds(
    ordered.filter((standing) => standing.rank < cutoffRank),
  )
  return {
    fixedFinalistIds,
    tiedTeamIds: sortedIds(ordered.filter((standing) => standing.rank === cutoffRank)),
    availablePlaces: 2 - fixedFinalistIds.length,
  }
}

/**
 * The playoff the standings require: needed only when more teams share the
 * cutoff rank than final places remain. Callers decide whether qualifying has
 * finished; before then the answer is provisional.
 */
export function requiredPlayoff(
  standings: readonly TeamStanding[],
): PlayoffRequirement | null {
  const cutoff = qualificationCutoff(standings)
  if (!cutoff || cutoff.tiedTeamIds.length <= cutoff.availablePlaces) {
    return null
  }

  const format = playoffFormat(cutoff.tiedTeamIds.length)
  const availablePlaces = cutoff.availablePlaces
  if (!format || (availablePlaces !== 1 && availablePlaces !== 2)) {
    return null
  }

  return {
    format,
    fixedFinalistIds: cutoff.fixedFinalistIds,
    tiedTeamIds: cutoff.tiedTeamIds,
    availablePlaces,
  }
}

function matchResults(
  fixtures: readonly TeamFixture[],
  matches: readonly FixtureMatch[],
  stage: FixtureStage,
): MatchResult[] {
  const fixtureById = new Map(
    fixtures
      .filter((fixture) => fixture.stage === stage)
      .map((fixture) => [fixture.id, fixture]),
  )

  return matches.flatMap((match) => {
    const fixture = fixtureById.get(match.fixtureId)
    if (
      !fixture?.teamAId ||
      !fixture.teamBId ||
      match.state !== 'completed' ||
      match.winnerSide === null
    ) {
      return []
    }

    const played = match.resultKind === 'played'
    const confirmedGames = match.games.filter((game) => game.confirmedAt !== null)
    return [
      {
        teamAId: fixture.teamAId,
        teamBId: fixture.teamBId,
        winnerTeamId: match.winnerSide === 'a' ? fixture.teamAId : fixture.teamBId,
        played,
        pointsA: played ? sum(confirmedGames.map((game) => game.score.a)) : 0,
        pointsB: played ? sum(confirmedGames.map((game) => game.score.b)) : 0,
      },
    ]
  })
}

function teamTotals(teamId: UUID, results: readonly MatchResult[]) {
  const own = results.filter(
    (result) => result.teamAId === teamId || result.teamBId === teamId,
  )

  return {
    teamId,
    matchWins: own.filter((result) => result.winnerTeamId === teamId).length,
    pointsScored: sum(
      own.map((result) => (result.teamAId === teamId ? result.pointsA : result.pointsB)),
    ),
    pointsConceded: sum(
      own.map((result) => (result.teamAId === teamId ? result.pointsB : result.pointsA)),
    ),
  }
}

function competitionRank(key: RankingKey, all: readonly RankingKey[]): number {
  return all.filter((other) => compareKeys(other.keys, key.keys) < 0).length + 1
}

/** Negative when `left` ranks above `right`. */
function compareKeys(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return right[index] - left[index]
    }
  }
  return 0
}

function separatingCriterion(
  key: RankingKey,
  all: readonly RankingKey[],
): RankingCriterion | null {
  let rivals = all.filter(
    (other) => other.teamId !== key.teamId && other.keys[0] === key.keys[0],
  )
  if (rivals.length === 0) {
    return 'match-wins'
  }

  for (const [offset, criterion] of tieBreakCriteria.entries()) {
    const index = offset + 1
    rivals = rivals.filter((other) => other.keys[index] === key.keys[index])
    if (rivals.length === 0) {
      return criterion
    }
  }
  return null
}

function playoffFormat(tiedTeamCount: number): PlayoffFormat | null {
  switch (tiedTeamCount) {
    case 2:
      return 'two-team'
    case 3:
      return 'three-team'
    case 4:
      return 'four-team'
    default:
      return null
  }
}

function sortedIds(rows: readonly { teamId: UUID }[]): UUID[] {
  return rows.map(({ teamId }) => teamId).sort()
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}
