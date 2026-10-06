import { describe, expect, it } from 'vitest'
import { validatePairAssignment } from '../../domain/pair-assignment'
import { gamesToWinMatch, isGameWon } from '../../domain/scoring'
import { guideExample, guideSteps, nextGuideIndex } from './guide-state'

 describe('referee guide examples', () => {
  it('restores every exact example when moving forward and backward', () => {
    for (let index = 0; index < guideSteps.length - 1; index++) {
      const original = guideExample(index)
      const next = nextGuideIndex(index, 1)
      expect(next).toBe(index + 1)
      expect(guideExample(nextGuideIndex(next, -1))).toEqual(original)
    }
    expect(nextGuideIndex(0, -1)).toBe(0)
    expect(nextGuideIndex(guideSteps.length - 1, 1)).toBe(guideSteps.length - 1)
  })
  it('provides fresh data for restart without retaining previous changes', () => {
    const first = guideExample(0)
    first.snapshot.players[0].name = 'Changed'
    first.snapshot.matches[0].games.push({ gameNumber: 1, score: { a: 30, b: 0 }, confirmedAt: null })
    expect(guideExample(0).snapshot.players[0].name).toBe('An')
    expect(guideExample(0).snapshot.matches[0].games).toEqual([])
    expect(() => guideExample(-1)).toThrow(RangeError)
  })
  it('uses valid pairs and stage-appropriate game results', () => {
    for (let index = 0; index < guideSteps.length; index++) {
      const { snapshot, step, state } = guideExample(index)
      const unstarted = structuredClone(snapshot)
      unstarted.matches.forEach((match) => { match.state = 'unstarted' })
      for (const match of unstarted.matches) for (const side of ['a', 'b'] as const) {
        const pair = side === 'a' ? match.pairA : match.pairB
        if (pair) expect(validatePairAssignment(unstarted, match.id, side, pair)).toEqual([])
      }
      if (state.status === 'reviewing') expect(isGameWon(state.score, step.stage)).toBe(true)
      if (step.gameNumber === 2) {
        expect(gamesToWinMatch(step.stage)).toBe(2)
        expect(snapshot.matches[0].games[0].confirmedAt).not.toBeNull()
        expect(state.score).toEqual({ a: 0, b: 0 })
      }
    }
  })
  it('keeps failure recovery and takeover separate from result confirmation', () => {
    expect(guideExample(21).state.status).toBe('failed')
    expect(guideExample(22).state.status).toBe('failed')
    expect(guideExample(23).state).toMatchObject({ status: 'idle', score: { a: 6, b: 3 } })
    expect(guideExample(24).state.hasOwnership).toBe(false)
    expect(guideExample(25).step.dialog).toBe('takeover')
    expect(guideExample(26).state).toMatchObject({ hasOwnership: true, score: { a: 8, b: 6 } })
  })
})
