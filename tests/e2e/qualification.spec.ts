import type { Page } from '@playwright/test'

import { messages } from '../../src/i18n/vi.ts'
import {
  clearStandings,
  confirmFinalists,
  decideQualifying,
  fixtureMatches,
  fixturesIn,
  fourTeamTie,
  onlyFixture,
  playoffMatchBetween,
  playSingleGame,
  startQualifying,
  teamName,
  teamOrder,
  threeTeamTie,
  twoTeamTie,
} from './fixtures/tournament.ts'
import { readState, signInStaff, type Snapshot } from './support/api.ts'
import { signIn } from './support/staff.ts'
import { expect, test } from './support/test.ts'

const status = messages.fixtures.status

async function qualificationStatus(page: Page): Promise<string | null> {
  await page.getByRole('tab', { name: messages.app.tabs.standings }).click()
  return page.getByRole('status').textContent()
}

function finalistIds(snapshot: Snapshot): string[] {
  const final = onlyFixture(snapshot, 'final')
  return [final.team_a_id, final.team_b_id].filter((id): id is string => id !== null).sort()
}

async function confirmFinalistsInUi(page: Page): Promise<void> {
  await page.getByRole('button', { name: messages.organizer.finalists.review }).click()
  const confirm = page.getByRole('alertdialog', { name: messages.organizer.finalists.title })
  await confirm.getByRole('button', { name: messages.organizer.finalists.confirm }).click()
  await expect(confirm).toBeHidden()
  await expect(page.getByRole('button', { name: messages.organizer.finalists.review })).toBeHidden()
}

test('clear standings send the top two to the final once the organizer confirms', async ({ page, pins }) => {
  const organizer = await signInStaff(pins.organizer)
  await startQualifying(organizer)
  const snapshot = await decideQualifying(organizer, clearStandings)
  const [first, second, third, fourth] = teamOrder(snapshot)

  await page.goto('/')
  await expect.poll(() => qualificationStatus(page)).toBe(status.awaitingConfirmation)
  const rows = page.getByRole('row')
  await expect(rows.nth(1)).toContainText(teamName(snapshot, first))
  await expect(rows.nth(2)).toContainText(teamName(snapshot, second))

  await signIn(page, pins.organizer, 'organizer')
  const confirmation = page.getByRole('heading', { name: messages.organizer.finalists.heading }).locator('..')
  await expect(confirmation).toContainText(teamName(snapshot, first))
  await expect(confirmation).toContainText(messages.organizer.finalists.basis.standings(2))
  await confirmFinalistsInUi(page)

  const confirmed = (await readState()).snapshot
  expect(confirmed.tournament.finalists_confirmed_at).not.toBeNull()
  expect(finalistIds(confirmed)).toEqual([first, second].sort())
  const thirdPlace = onlyFixture(confirmed, 'third-place')
  expect([thirdPlace.team_a_id, thirdPlace.team_b_id].sort()).toEqual([third, fourth].sort())

  await page.getByRole('button', { name: messages.organizer.returnToTournament }).click()
  await page.getByRole('tab', { name: messages.app.tabs.knockouts }).click()
  await expect(page.getByText(teamName(snapshot, third)).first()).toBeVisible()
})

test('two teams tied for second play one playoff match', async ({ page, pins }) => {
  const organizer = await signInStaff(pins.organizer)
  await startQualifying(organizer)
  let snapshot = await decideQualifying(organizer, twoTeamTie)
  const [leader, tiedA, tiedB] = teamOrder(snapshot)

  await page.goto('/')
  await expect.poll(() => qualificationStatus(page)).toBe(status.playoff['two-team'])
  const [round] = snapshot.playoff_rounds
  expect(round.team_ids.sort()).toEqual([tiedA, tiedB].sort())

  await playSingleGame(organizer, playoffMatchBetween(snapshot, round.id, tiedA, tiedB).id, tiedB, 11, 7)
  snapshot = (await readState()).snapshot
  await expect.poll(() => qualificationStatus(page)).toBe(status.awaitingConfirmation)

  await signIn(page, pins.organizer, 'organizer')
  const confirmation = page.getByRole('heading', { name: messages.organizer.finalists.heading }).locator('..')
  await expect(confirmation).toContainText(messages.organizer.finalists.basis.playoff)
  await confirmFinalistsInUi(page)
  expect(finalistIds((await readState()).snapshot)).toEqual([leader, tiedB].sort())
})

test('three tied teams play a mini round robin, and replay it when still tied', async ({ page, pins }) => {
  const organizer = await signInStaff(pins.organizer)
  await startQualifying(organizer)
  let snapshot = await decideQualifying(organizer, threeTeamTie)
  const [x, y, z] = teamOrder(snapshot)

  await page.goto('/')
  await expect.poll(() => qualificationStatus(page)).toBe(status.playoff['three-team'])
  const [firstRound] = snapshot.playoff_rounds
  expect(firstRound.team_ids.sort()).toEqual([x, y, z].sort())

  // An exact cycle at 11–9 leaves all three level on every criterion.
  await playSingleGame(organizer, playoffMatchBetween(snapshot, firstRound.id, x, y).id, x, 11, 9)
  await playSingleGame(organizer, playoffMatchBetween(snapshot, firstRound.id, y, z).id, y, 11, 9)
  await playSingleGame(organizer, playoffMatchBetween(snapshot, firstRound.id, x, z).id, z, 11, 9)
  snapshot = (await readState()).snapshot
  expect(snapshot.playoff_rounds.map((round) => round.round_number)).toEqual([1, 2])
  const secondRound = snapshot.playoff_rounds[1]
  expect(secondRound.team_ids.sort()).toEqual([x, y, z].sort())

  await signIn(page, pins.organizer, 'organizer')
  await expect(page.getByRole('heading', { name: messages.organizer.playoffRound.heading(2) })).toBeVisible()
  await expect(page.getByRole('button', { name: messages.organizer.finalists.review })).toBeHidden()

  await playSingleGame(organizer, playoffMatchBetween(snapshot, secondRound.id, x, y).id, x, 11, 0)
  await playSingleGame(organizer, playoffMatchBetween(snapshot, secondRound.id, x, z).id, x, 11, 0)
  await playSingleGame(organizer, playoffMatchBetween(snapshot, secondRound.id, y, z).id, y, 11, 0)
  await expect(page.getByRole('button', { name: messages.organizer.finalists.review })).toBeVisible()
  await confirmFinalistsInUi(page)
  expect(finalistIds((await readState()).snapshot)).toEqual([x, y].sort())
})

test('four tied teams need a recorded matchup draw before the playoff', async ({ page, pins }) => {
  const organizer = await signInStaff(pins.organizer)
  await startQualifying(organizer)
  let snapshot = await decideQualifying(organizer, fourTeamTie)
  const [round] = snapshot.playoff_rounds
  expect(round.team_ids).toHaveLength(4)
  const [anchor, opponent, ...rest] = round.team_ids

  await page.goto('/')
  await expect.poll(() => qualificationStatus(page)).toBe(status.playoff['four-team'])
  await signIn(page, pins.organizer, 'organizer')
  await page.getByRole('combobox', { name: messages.organizer.draw.opponentOf(teamName(snapshot, anchor)) }).click()
  await page.getByRole('option', { name: teamName(snapshot, opponent) }).click()
  await expect(page.getByText(messages.organizer.draw.otherMatchup(messages.common.versus(teamName(snapshot, rest[0]), teamName(snapshot, rest[1]))))).toBeVisible()
  await page.getByRole('button', { name: messages.organizer.draw.review }).click()
  const drawConfirm = page.getByRole('alertdialog', { name: messages.organizer.draw.title })
  await drawConfirm.getByRole('button', { name: messages.organizer.draw.confirm }).click()
  await expect(drawConfirm).toBeHidden()

  await expect.poll(async () => fixturesIn((await readState()).snapshot, 'qualification-playoff')
    .filter((fixture) => fixture.playoff_round_id === round.id && fixture.team_a_id !== null)).toHaveLength(2)
  snapshot = (await readState()).snapshot

  await playSingleGame(organizer, playoffMatchBetween(snapshot, round.id, anchor, opponent).id, opponent, 11, 4)
  await playSingleGame(organizer, playoffMatchBetween(snapshot, round.id, rest[0], rest[1]).id, rest[0], 11, 4)
  await confirmFinalists(organizer)
  snapshot = (await readState()).snapshot
  expect(finalistIds(snapshot)).toEqual([opponent, rest[0]].sort())

  await page.getByRole('button', { name: messages.organizer.returnToTournament }).click()
  await page.getByRole('tab', { name: messages.app.tabs.knockouts }).click()
  await expect(page.getByText(messages.fixtures.matchupDrawn(messages.common.versus(teamName(snapshot, anchor), teamName(snapshot, opponent))))).toBeVisible()
  expect(fixturesIn(snapshot, 'qualification-playoff').flatMap((fixture) => fixtureMatches(snapshot, fixture.id))
    .filter((match) => match.state === 'completed')).toHaveLength(2)
})
