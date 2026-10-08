import type { Court, CourtAssignment, FixtureMatch, TeamFixture, TournamentSnapshot } from './types'

export function qualifyingRound(fixture: TeamFixture): number | null {
  return fixture.stage === 'qualifying' && fixture.qualifyingOrder !== null
    ? Math.ceil(fixture.qualifyingOrder / 2)
    : null
}

export function qualifyingFixtures(snapshot: TournamentSnapshot): TeamFixture[] {
  return snapshot.fixtures.filter((fixture) => fixture.stage === 'qualifying')
    .toSorted((a, b) => (a.qualifyingOrder ?? Infinity) - (b.qualifyingOrder ?? Infinity))
}

function fixtureCompleted(snapshot: TournamentSnapshot, fixture: TeamFixture): boolean {
  const matches = snapshot.matches.filter((match) => match.fixtureId === fixture.id)
  return [1, 2].every((number) => matches.some((match) => match.matchNumber === number && match.state === 'completed'))
}

export function qualifyingStartBlocker(snapshot: TournamentSnapshot, match: FixtureMatch): 'sequence' | 'round' | null {
  const fixture = snapshot.fixtures.find((candidate) => candidate.id === match.fixtureId)
  if (!fixture || fixture.stage !== 'qualifying') return null
  const round = qualifyingRound(fixture)
  if (round === null) return 'round'
  const earlier = qualifyingFixtures(snapshot).filter((candidate) => (qualifyingRound(candidate) ?? Infinity) < round)
  if (earlier.length !== (round - 1) * 2 || earlier.some((candidate) => !fixtureCompleted(snapshot, candidate))) return 'round'
  if (match.matchNumber === 2 && !snapshot.matches.some((candidate) =>
    candidate.fixtureId === fixture.id && candidate.matchNumber === 1 && candidate.state === 'completed')) return 'sequence'
  return null
}

export function qualifyingCourtLocked(snapshot: TournamentSnapshot, fixture: TeamFixture): boolean {
  const round = qualifyingRound(fixture)
  return snapshot.fixtures.filter((candidate) => qualifyingRound(candidate) === round)
    .some((candidate) => snapshot.matches.some((match) => match.fixtureId === candidate.id
      && (match.state !== 'unstarted' || match.resultKind !== null || match.games.length > 0)))
}

export function qualifyingCourtAssignments(snapshot: TournamentSnapshot, match: FixtureMatch, court: Court): CourtAssignment[] {
  const fixture = snapshot.fixtures.find((candidate) => candidate.id === match.fixtureId)
  if (!fixture || fixture.stage !== 'qualifying') return [{ matchId: match.id, court }]
  if (qualifyingCourtLocked(snapshot, fixture)) return []
  const round = qualifyingRound(fixture)
  const fixtures = snapshot.fixtures.filter((candidate) => qualifyingRound(candidate) === round)
  return fixtures.flatMap((candidate) => snapshot.matches.filter((item) => item.fixtureId === candidate.id)
    .map((item) => ({ matchId: item.id, court: candidate.id === fixture.id ? court : (court === 1 ? 2 : 1) as Court })))
}

export function courtQueue(snapshot: TournamentSnapshot, court: Court): { current: FixtureMatch | undefined; next: FixtureMatch | undefined } {
  if (snapshot.tournament.stage === 'setup') return { current: undefined, next: undefined }
  const ordered = [...snapshot.matches].sort((a, b) => {
    const position = (match: FixtureMatch) => snapshot.fixtures.find((fixture) => fixture.id === match.fixtureId)?.qualifyingOrder ?? Infinity
    return position(a) - position(b) || a.matchNumber - b.matchNumber
  })
  const playing = ordered.find((match) => match.court === court && match.state === 'playing')
  const waiting = ordered.filter((match) => match.court === court && match.state === 'unstarted'
    && snapshot.fixtures.some((fixture) => fixture.id === match.fixtureId && fixture.stage === 'qualifying'))
  const current = playing ?? waiting.find((match) => qualifyingStartBlocker(snapshot, match) === null)
  return { current, next: waiting.find((match) => match.id !== current?.id) }
}
