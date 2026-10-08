import type { Page } from '@playwright/test'

import { vi as messages } from '../../src/i18n/vi.ts'
import {
  clearStandings,
  confirmFinalists,
  fixtureMatches,
  fixturesIn,
  matchPairLabel,
  onlyFixture,
  playSingleGame,
  prepareMatch,
  sideTeam,
  startQualifying,
  teamOrder,
  walkover,
} from './fixtures/tournament.ts'
import { findMatch, matchCommand, readState, signInStaff, type LocalSession, type Match, type Snapshot } from './support/api.ts'
import { signIn } from './support/staff.ts'
import { matchLabel, matchTeams, openOrganizerSection } from './support/ui.ts'
import { expect, test } from './support/test.ts'

const results = messages.results

/**
 * Qualifying with clear standings, where the second- and third-placed teams'
 * first match is played 21–10 rather than walked over. Returns that match.
 */
async function qualifyingWithPlayedMatch(organizer: LocalSession): Promise<{ snapshot: Snapshot; played: Match }> {
  let snapshot = await startQualifying(organizer)
  const order = teamOrder(snapshot)
  let played: Match | null = null
  for (const fixture of fixturesIn(snapshot, 'qualifying')) {
    const [a, b] = [order.indexOf(fixture.team_a_id ?? ''), order.indexOf(fixture.team_b_id ?? '')]
    const winnerSide = clearStandings(a, b) === 'a' ? 'a' : 'b'
    const [first, second] = fixtureMatches(snapshot, fixture.id)
    if ([a, b].sort().join() === '1,2') {
      await playSingleGame(organizer, first.id, order[1], 21, 10)
      played = first
    } else {
      await walkover(organizer, first.id, winnerSide)
    }
    await walkover(organizer, second.id, winnerSide)
  }
  if (!played) throw new Error('No fixture between the second and third teams')
  snapshot = (await readState()).snapshot
  return { snapshot, played: findMatch(snapshot, played.id) }
}

/** Opens the correction dialog, types the reversed score, and reviews its impact. */
async function reviewReversal(page: Page, snapshot: Snapshot, match: Match): Promise<void> {
  await openOrganizerSection(page, 'results')
  await page.getByRole('listitem')
    .filter({ hasText: matchTeams(snapshot, match) })
    .filter({ hasText: matchLabel(snapshot, match) })
    .getByRole('button', { name: results.correct })
    .click()
  const dialog = page.getByRole('dialog', { name: results.correctTitle })
  const winnerIsA = match.winner_side === 'a'
  await dialog.getByLabel(results.gameScore(1, matchPairLabel(snapshot, match, 'a'))).fill(winnerIsA ? '10' : '21')
  await dialog.getByLabel(results.gameScore(1, matchPairLabel(snapshot, match, 'b'))).fill(winnerIsA ? '21' : '10')
  await dialog.getByRole('button', { name: results.reviewCorrection }).click()
}

test('the organizer corrects a result after reviewing its impact', async ({ page, pins }) => {
  const organizer = await signInStaff(pins.organizer)
  const { snapshot, played } = await qualifyingWithPlayedMatch(organizer)

  await page.goto('/')
  await signIn(page, pins.organizer, 'organizer')
  await reviewReversal(page, snapshot, played)
  const review = page.getByRole('alertdialog', { name: results.confirmCorrectionTitle })
  await expect(review).toContainText(results.reviewBeforeConfirm)
  await expect(review).toContainText(messages.impact.games)
  await review.getByRole('button', { name: results.confirmChange }).click()
  await expect(review).toBeHidden()

  await expect.poll(async () => {
    const { snapshot: after } = await readState()
    const games = after.games.filter((game) => game.match_id === played.id).map((game) => [game.score_a, game.score_b])
    return { winner: findMatch(after, played.id).winner_side, games }
  }).toEqual({ winner: played.winner_side === 'a' ? 'b' : 'a', games: [played.winner_side === 'a' ? [10, 21] : [21, 10]] })
})

test('a correction that changes the finalists revokes their confirmation', async ({ page, pins }) => {
  const organizer = await signInStaff(pins.organizer)
  const { snapshot, played } = await qualifyingWithPlayedMatch(organizer)
  await confirmFinalists(organizer)

  await page.goto('/')
  await signIn(page, pins.organizer, 'organizer')
  await reviewReversal(page, snapshot, played)
  const review = page.getByRole('alertdialog', { name: results.confirmCorrectionTitle })
  await expect(review).toContainText(messages.impact.finalistsRevoked)
  await review.getByRole('button', { name: results.confirmChange }).click()
  await expect(review).toBeHidden()

  await expect.poll(async () => (await readState()).snapshot.tournament.finalists_confirmed_at).toBeNull()
  // Second and third now tie on wins; head-to-head point difference sends third to the final.
  const order = teamOrder(snapshot)
  const reconfirmed = await confirmFinalists(organizer)
  const final = onlyFixture(reconfirmed, 'final')
  expect([final.team_a_id, final.team_b_id].sort()).toEqual([order[0], order[2]].sort())
})

test('a correction that would change the finalists is refused once placement play starts', async ({ page, pins }) => {
  const organizer = await signInStaff(pins.organizer)
  const { snapshot, played } = await qualifyingWithPlayedMatch(organizer)
  const confirmed = await confirmFinalists(organizer)
  const [opener] = fixtureMatches(confirmed, onlyFixture(confirmed, 'third-place').id)
  await prepareMatch(organizer, opener.id, 1)
  await matchCommand(organizer, 'start_match', opener.id)

  await page.goto('/')
  await signIn(page, pins.organizer, 'organizer')
  await reviewReversal(page, snapshot, played)
  const review = page.getByRole('alertdialog', { name: results.confirmCorrectionTitle })
  await expect(review).toContainText(results.cannotApply)
  await expect(review.getByRole('alert')).toContainText(messages.impact.blocked['placement-started'])
  await expect(review.getByRole('button', { name: results.confirmChange })).toBeDisabled()

  const unchanged = findMatch((await readState()).snapshot, played.id)
  expect(unchanged.winner_side).toBe(played.winner_side)
  expect(sideTeam(snapshot, unchanged, unchanged.winner_side ?? 'a')).toBe(teamOrder(snapshot)[1])
})
