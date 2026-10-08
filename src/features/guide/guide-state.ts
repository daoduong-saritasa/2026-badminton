import type { FixtureStage, Score } from '@/domain/types'
import type { ScoringState } from '@/features/scoring/scoring-state'
import { guideSnapshot } from './guide-data'
import { messages } from '../../i18n/messages'

export type GuideScreen = 'intro' | 'access' | 'picker' | 'pairs' | 'score' | 'finish'
export interface GuideStep {
  readonly screen: GuideScreen
  readonly target: string
  readonly title: string
  readonly description: string
  readonly stage: FixtureStage
  readonly assigned: boolean
  readonly score: Score
  readonly status: ScoringState['status']
  readonly swapped: boolean
  readonly gameNumber: number
  readonly ownership: boolean
  readonly dialog: 'start' | 'result' | 'takeover' | null
  readonly completed: boolean
}

const examples: Partial<GuideStep>[] = [
  { screen: 'intro', target: 'intro' },
  { screen: 'picker', target: 'access' },
  { screen: 'access', target: 'pin' },
  { screen: 'picker', target: 'matches', assigned: false },
  { screen: 'picker', target: 'blocked', assigned: false },
  { screen: 'pairs', target: 'pairs', assigned: false },
  { screen: 'pairs', target: 'pairs-saved', assigned: false },
  { screen: 'picker', target: 'matches' },
  { screen: 'picker', target: 'court' },
  { screen: 'picker', target: 'confirmation', dialog: 'start' },
  { screen: 'score', target: 'point' },
  { screen: 'score', target: 'save', score: { a: 1, b: 0 }, status: 'saving' },
  { screen: 'score', target: 'point', score: { a: 1, b: 0 } },
  { screen: 'score', target: 'undo', score: { a: 1, b: 0 } },
  { screen: 'score', target: 'point' },
  { screen: 'score', target: 'swap', swapped: true },
  { screen: 'score', target: 'point', score: { a: 20, b: 18 } },
  { screen: 'score', target: 'confirmation', score: { a: 21, b: 18 }, status: 'reviewing', dialog: 'result' },
  { screen: 'picker', target: 'completed', completed: true },
  { screen: 'score', target: 'point', stage: 'final', score: { a: 20, b: 18 } },
  { screen: 'score', target: 'confirmation', stage: 'final', score: { a: 21, b: 18 }, status: 'reviewing', dialog: 'result' },
  { screen: 'score', target: 'game', stage: 'final', gameNumber: 2 },
  { screen: 'score', target: 'save', status: 'failed', score: { a: 6, b: 3 } },
  { screen: 'score', target: 'retry', status: 'failed', score: { a: 6, b: 3 } },
  { screen: 'score', target: 'point', score: { a: 6, b: 3 } },
  { screen: 'score', target: 'takeover', score: { a: 8, b: 6 }, ownership: false },
  { screen: 'score', target: 'confirmation', score: { a: 8, b: 6 }, ownership: false, dialog: 'takeover' },
  { screen: 'score', target: 'point', score: { a: 8, b: 6 } },
  { screen: 'finish', target: 'finish' },
]

/** Every step; titles and descriptions read the current locale's copy. */
export const guideSteps: readonly GuideStep[] = examples.map((example, index) => ({
  screen: 'intro', target: 'intro', stage: 'qualifying', assigned: true, score: { a: 0, b: 0 },
  status: 'idle', swapped: false, gameNumber: 1, ownership: true, dialog: null, completed: false,
  ...example,
  get title() { return messages.guide.steps[index][0] },
  get description() { return messages.guide.steps[index][1] },
}))

export function guideExample(index: number) {
  const step = guideSteps[index]
  if (!step) throw new RangeError('Unknown guide step')
  const snapshot = guideSnapshot(step.stage, step.assigned)
  if (index === 3) {
    snapshot.teams.push({ id: 'guide-c', name: 'Đội Gió' }, { id: 'guide-d', name: 'Đội Sao' })
    snapshot.players.push(...snapshot.players.map((player) => ({ ...player, id: player.id.replace('guide-a', 'guide-c').replace('guide-b', 'guide-d'), teamId: player.teamId === 'guide-a' ? 'guide-c' : 'guide-d' })))
    snapshot.fixtures.push({ id: 'guide-active-fixture', stage: 'qualifying', teamAId: 'guide-c', teamBId: 'guide-d', version: 1 })
    snapshot.matches.push({ ...snapshot.matches[0], id: 'guide-active-match', fixtureId: 'guide-active-fixture', court: 2, state: 'playing',
      pairA: { player1Id: 'guide-c-0', player2Id: 'guide-c-2' }, pairB: { player1Id: 'guide-d-0', player2Id: 'guide-d-2' },
      games: [{ gameNumber: 1, score: { a: 8, b: 6 }, confirmedAt: null }],
    })
  }
  const match = snapshot.matches[0]
  match.state = step.completed ? 'completed' : step.screen === 'score' ? 'playing' : 'unstarted'
  match.games = step.gameNumber === 2 ? [{ gameNumber: 1, score: { a: 21, b: 18 }, confirmedAt: '2026-10-07T00:00:00Z' }] : []
  if (match.state === 'playing') match.games.push({ gameNumber: step.gameNumber, score: { ...step.score }, confirmedAt: null })
  if (step.completed) { match.games = [{ gameNumber: 1, score: { a: 21, b: 18 }, confirmedAt: '2026-10-07T00:00:00Z' }]; match.winnerSide = 'a'; match.resultKind = 'played' }
  const context = { matchId: match.id, stage: step.stage, resetGeneration: 0, gameNumber: step.gameNumber,
    score: { ...step.score }, matchVersion: 1, hasOwnership: step.ownership }
  const pending = { requestId: 'guide-point', resetGeneration: 0, side: 'a' as const, expectedVersion: 1, previousScore: step.status === 'saving' ? { a: 0, b: 0 } : { a: 5, b: 3 } }
  let state: ScoringState
  switch (step.status) {
    case 'saving': state = { ...context, status: 'saving', pending, observed: null }; break
    case 'failed': state = { ...context, status: 'failed', pending, observed: null, reason: 'network', message: messages.scoring.saveFailed }; break
    case 'reviewing': state = { ...context, status: 'reviewing', winningSide: 'a' }; break
    default: state = { ...context, status: 'idle' }
  }
  return { step, snapshot, match, state }
}

export function nextGuideIndex(index: number, direction: 1 | -1): number {
  return Math.max(0, Math.min(guideSteps.length - 1, index + direction))
}
