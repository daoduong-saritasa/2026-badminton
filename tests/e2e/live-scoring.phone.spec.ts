import type { Page } from '@playwright/test'

import { vi as messages } from '../../src/i18n/vi.ts'
import {
  fixtureMatches,
  fixturesIn,
  matchPairLabel,
  prepareMatch,
  sideTeam,
  startQualifying,
  teamName,
} from './fixtures/tournament.ts'
import { findMatch, readState, signInStaff, type Match, type Side, type Snapshot } from './support/api.ts'
import { signIn } from './support/staff.ts'
import { matchLabel, matchRow, matchTeams, openOrganizerSection } from './support/ui.ts'
import { expect, test } from './support/test.ts'

const scoring = messages.scoring

async function preparedQualifyingMatch(organizerPin: string): Promise<{ snapshot: Snapshot; match: Match }> {
  const organizer = await signInStaff(organizerPin)
  await startQualifying(organizer)
  let { snapshot } = await readState()
  const [fixture] = fixturesIn(snapshot, 'qualifying')
  const [match] = fixtureMatches(snapshot, fixture.id)
  await prepareMatch(organizer, match.id, 1)
  snapshot = (await readState()).snapshot
  return { snapshot, match: findMatch(snapshot, match.id) }
}

function pointButton(page: Page, snapshot: Snapshot, match: Match, side: Side) {
  return page.getByRole('button', { name: scoring.addPoint(matchPairLabel(snapshot, match, side)) })
}

/** Starts `match` from the referee list and waits for the scoring surface. */
async function startFromPicker(page: Page, snapshot: Snapshot, match: Match): Promise<void> {
  await matchRow(page, snapshot, match).getByRole('button', { name: scoring.start }).click()
  await page.getByRole('alertdialog', { name: scoring.startTitle }).getByRole('button', { name: scoring.start }).click()
  await expect(pointButton(page, snapshot, match, 'a')).toBeEnabled()
}

/** Adds points one tap at a time, waiting for each to save. */
async function tap(page: Page, snapshot: Snapshot, match: Match, side: Side, times: number): Promise<void> {
  for (let point = 0; point < times; point += 1) {
    await pointButton(page, snapshot, match, side).click()
    await expect(page.getByText(scoring.savingPoint)).toBeHidden()
  }
}

async function liveScore(matchId: string): Promise<[number, number]> {
  const { snapshot } = await readState()
  const game = snapshot.games.findLast((candidate) => candidate.match_id === matchId && candidate.confirmed_at === null)
  return game ? [game.score_a, game.score_b] : [0, 0]
}

test('a referee scores a game to the cap while the public view follows live', async ({ page, pins, openPage }) => {
  const { snapshot, match } = await preparedQualifyingMatch(pins.organizer)
  const spectator = await openPage('Desktop Chrome')
  await spectator.goto('/')
  const ticket = spectator.getByRole('article', { name: snapshot.tournament.court_names[0] })

  await page.goto('/')
  await signIn(page, pins.referee, 'referee')
  await startFromPicker(page, snapshot, match)
  await expect(ticket.locator('strong')).toHaveText(['0', '0'])

  // Win by two: 21–20 does not end the game.
  for (let rally = 0; rally < 20; rally += 1) {
    await tap(page, snapshot, match, 'a', 1)
    await tap(page, snapshot, match, 'b', 1)
  }
  await tap(page, snapshot, match, 'a', 1)
  await expect(page.getByRole('alertdialog')).toBeHidden()
  expect(await liveScore(match.id)).toEqual([21, 20])
  await expect(ticket.locator('strong')).toHaveText(['21', '20'])

  // Deuce continues to the cap, where 30–29 wins.
  await tap(page, snapshot, match, 'b', 1)
  for (let rally = 0; rally < 8; rally += 1) {
    await tap(page, snapshot, match, 'a', 1)
    await tap(page, snapshot, match, 'b', 1)
  }
  expect(await liveScore(match.id)).toEqual([29, 29])
  await tap(page, snapshot, match, 'b', 1)
  const review = page.getByRole('alertdialog', { name: scoring.confirmTitle(1) })
  await expect(review).toContainText(scoring.confirmBody(29, 30))

  // Undo from the review, then finish the game the other way.
  await review.getByRole('button', { name: scoring.reviewAndUndo }).click()
  await page.getByRole('button', { name: scoring.undo }).click()
  await expect.poll(() => liveScore(match.id)).toEqual([29, 29])
  await tap(page, snapshot, match, 'a', 1)
  await page.getByRole('alertdialog', { name: scoring.confirmTitle(1) })
    .getByRole('button', { name: scoring.confirmResult }).click()

  // A completed match returns the referee to the list.
  await expect(page.getByRole('heading', { name: scoring.pickHeading })).toBeVisible()
  const finished = findMatch((await readState()).snapshot, match.id)
  expect(finished).toMatchObject({ state: 'completed', winner_side: 'a' })

  await spectator.getByRole('tab', { name: messages.app.tabs.standings }).click()
  const winner = teamName(snapshot, sideTeam(snapshot, match, 'a'))
  const row = spectator.getByRole('row').filter({ hasText: winner })
  await expect(row.getByRole('cell')).toContainText([winner, '1', '30', '29', '+1'])
})

test('a second referee takes over scoring and the first device stops scoring', async ({ page, pins, openPage }) => {
  const { snapshot, match } = await preparedQualifyingMatch(pins.organizer)
  await page.goto('/')
  await signIn(page, pins.referee, 'referee')
  await startFromPicker(page, snapshot, match)
  await tap(page, snapshot, match, 'a', 3)

  const second = await openPage()
  await second.goto('/')
  await signIn(second, pins.referee, 'referee')
  await second.getByRole('button', { name: scoring.resume }).click()
  await expect(pointButton(second, snapshot, match, 'a')).toBeDisabled()
  await second.getByRole('button', { name: scoring.takeOverScoring }).click()
  await second.getByRole('alertdialog', { name: scoring.takeoverTitle }).getByRole('button', { name: scoring.takeOver }).click()
  await expect(pointButton(second, snapshot, match, 'b')).toBeEnabled()
  // The score carries over.
  await expect(pointButton(second, snapshot, match, 'a')).toContainText('3')
  await tap(second, snapshot, match, 'b', 2)
  expect(await liveScore(match.id)).toEqual([3, 2])

  // The first device notices it lost ownership and offers to take it back.
  await expect(page.getByRole('button', { name: scoring.takeOverScoring })).toBeVisible({ timeout: 15_000 })
  await expect(pointButton(page, snapshot, match, 'a')).toBeDisabled()
})

test('the organizer awards a walkover from the results list', async ({ page, pins }) => {
  const organizer = await signInStaff(pins.organizer)
  await startQualifying(organizer)
  const { snapshot } = await readState()
  const [fixture] = fixturesIn(snapshot, 'qualifying')
  const [match] = fixtureMatches(snapshot, fixture.id)
  const winner = teamName(snapshot, sideTeam(snapshot, match, 'b'))

  await page.goto('/')
  await signIn(page, pins.organizer, 'organizer')
  await openOrganizerSection(page, 'results')
  // The toggle's label ends with the open-match count; match it without the count.
  await page.getByRole('button', { name: messages.results.showWalkovers(0).replace(/\s*\(.*\)$/, '') }).click()
  await page.getByRole('listitem')
    .filter({ hasText: matchTeams(snapshot, match) })
    .filter({ hasText: matchLabel(snapshot, match) })
    .getByRole('button', { name: messages.results.walkover })
    .click()
  const dialog = page.getByRole('dialog', { name: messages.results.walkoverTitle })
  await dialog.getByRole('combobox', { name: messages.results.walkoverWinner }).click()
  await page.getByRole('option', { name: winner }).click()
  await expect(dialog).toContainText(messages.results.walkoverConsequence(winner))
  await dialog.getByRole('button', { name: messages.results.confirmWalkover }).click()
  await expect(dialog).toBeHidden()

  await expect.poll(async () => findMatch((await readState()).snapshot, match.id))
    .toMatchObject({ state: 'completed', winner_side: 'b' })
})
