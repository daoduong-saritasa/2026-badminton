import type { FixtureMatch, FixtureStage, TournamentSnapshot } from '@/domain/types'

export function guideSnapshot(stage: FixtureStage = 'qualifying', assigned = true): TournamentSnapshot {
  const teams = [{ id: 'guide-a', name: 'Đội Mây' }, { id: 'guide-b', name: 'Đội Nắng' }]
  const names = [['An', 'Bình', 'Chi', 'Dũng'], ['Hà', 'Linh', 'Minh', 'Nam']]
  const players = teams.flatMap((team, index) => names[index].map((name, playerIndex) => ({
    id: `${team.id}-${playerIndex}`, teamId: team.id, name, seed: playerIndex < 2 ? 1 as const : 2 as const,
  })))
  const matches: FixtureMatch[] = ([1, 2] as const).map((matchNumber) => ({
    id: `guide-match-${matchNumber}`, fixtureId: 'guide-fixture', matchNumber,
    pairA: assigned ? { player1Id: `guide-a-${matchNumber - 1}`, player2Id: `guide-a-${matchNumber + 1}` } : null,
    pairB: assigned ? { player1Id: `guide-b-${matchNumber - 1}`, player2Id: `guide-b-${matchNumber + 1}` } : null,
    court: stage === 'qualifying' ? 1 : matchNumber, state: 'unstarted', resultKind: null, winnerSide: null, games: [], version: 1,
  }))
  return { tournament: { id: 'guide', name: 'Giải minh họa', stage: 'groups', version: 1, resultRevision: 1,
    setupLockedAt: null, courtNames: ['Sân xanh', 'Sân cam'], finalistsConfirmedAt: '2026-10-07T00:00:00Z', currentPlayoffRoundId: null },
    teams, players, fixtures: [{ id: 'guide-fixture', stage, teamAId: 'guide-a', teamBId: 'guide-b', version: 1, qualifyingOrder: stage === 'qualifying' ? 1 : null, qualifyingCourt: stage === 'qualifying' ? 1 : null }], matches, playoffRounds: [],
  }
}

export const guidePicks = {
  'guide-match-1:a': ['guide-a-0', 'guide-a-2'],
  'guide-match-1:b': ['guide-b-0', 'guide-b-2'],
}
