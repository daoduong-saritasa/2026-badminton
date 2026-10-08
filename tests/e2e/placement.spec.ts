import { vi as messages } from '../../src/i18n/vi.ts'
import { errorMessage } from '../../src/i18n/errors.ts'
import {
  assignCourt,
  assignPair,
  clearStandings,
  confirmFinalists,
  decideQualifying,
  fixtureMatches,
  mixedPair,
  onlyFixture,
  playMatch,
  prepareMatch,
  seeds,
  sideTeam,
  startQualifying,
  teamName,
  teamOrder,
} from './fixtures/tournament.ts'
import { findMatch, readState, signInStaff, type Snapshot } from './support/api.ts'
import { signIn } from './support/staff.ts'
import { fixtureRow, matchRow, openOrganizerSection, pairDialog, teamPicker } from './support/ui.ts'
import { expect, test } from './support/test.ts'

function placementMatches(snapshot: Snapshot, stage: 'third-place' | 'final') {
  return fixtureMatches(snapshot, onlyFixture(snapshot, stage).id)
}

test('third place finishes first, a 1–1 tie goes to a free-pairing decider, and the final completes the tournament', async ({ page, pins, openPage }) => {
  const organizer = await signInStaff(pins.organizer)
  await startQualifying(organizer)
  await decideQualifying(organizer, clearStandings)
  let snapshot = await confirmFinalists(organizer)
  const [champion, runnerUp, third, fourth] = teamOrder(snapshot)
  const [thirdOne, thirdTwo, decider] = placementMatches(snapshot, 'third-place')
  const [finalOne, finalTwo] = placementMatches(snapshot, 'final')

  // The final cannot start while third place is unfinished.
  await prepareMatch(organizer, thirdOne.id, 1)
  await prepareMatch(organizer, finalOne.id, 2)
  snapshot = (await readState()).snapshot
  await page.goto('/')
  await signIn(page, pins.organizer, 'organizer')
  await openOrganizerSection(page, 'matches')
  await matchRow(page, snapshot, findMatch(snapshot, finalOne.id))
    .getByRole('button', { name: messages.organizer.schedule.startShort }).click()
  await page.getByRole('alertdialog', { name: messages.organizer.schedule.startTitle })
    .getByRole('button', { name: messages.organizer.schedule.start }).click()
  await expect(page.getByRole('alert')).toHaveText(errorMessage(new Error('Third place must finish before the final starts')))
  expect(findMatch((await readState()).snapshot, finalOne.id).state).toBe('unstarted')

  // Third place splits 1–1; the second match reaches the 21–20 cap.
  await playMatch(organizer, thirdOne.id, [[15, 10], [15, 12]])
  await prepareMatch(organizer, thirdTwo.id, 2)
  await playMatch(organizer, thirdTwo.id, [[10, 15], [21, 20], [12, 15]])
  snapshot = (await readState()).snapshot
  expect(findMatch(snapshot, thirdOne.id).winner_side).not.toBe(findMatch(snapshot, thirdTwo.id).winner_side)

  // A referee pairs two seed-1 players for the decider: any two teammates are allowed.
  await assignCourt(organizer, decider.id, 1)
  await assignPair(organizer, decider.id, 'b', mixedPair(snapshot, sideTeam(snapshot, decider, 'b'), 0))
  snapshot = (await readState()).snapshot
  const deciderTeam = sideTeam(snapshot, decider, 'a')
  const { seed1 } = seeds(snapshot, deciderTeam)
  const refereePage = await openPage()
  await refereePage.goto('/')
  await signIn(refereePage, pins.referee, 'referee')
  await fixtureRow(refereePage, snapshot, findMatch(snapshot, decider.id)).getByRole('button', { name: messages.pairAssignment.open }).click()
  const dialog = pairDialog(refereePage, snapshot, findMatch(snapshot, decider.id))
  await expect(dialog).toContainText(messages.pairAssignment.rule.free)
  const card = teamPicker(dialog, 3, teamName(snapshot, deciderTeam))
  for (const playerId of seed1) {
    await card.getByRole('button', { name: snapshot.players.find((player) => player.id === playerId)?.name }).click()
  }
  await dialog.getByRole('button', { name: messages.pairAssignment.save }).click()
  await expect(dialog).toBeHidden()
  expect([findMatch((await readState()).snapshot, decider.id).pair_a_player_1_id, findMatch((await readState()).snapshot, decider.id).pair_a_player_2_id].sort())
    .toEqual([...seed1].sort())

  await playMatch(organizer, decider.id, [[15, 5], [15, 5]])
  snapshot = (await readState()).snapshot
  const thirdPlaceWinner = sideTeam(snapshot, decider, 'a')

  // The final: two straight wins make the third match unnecessary.
  await playMatch(organizer, finalOne.id, [[21, 15], [21, 15]])
  await prepareMatch(organizer, finalTwo.id, 2)
  const finalTwoWinner = sideTeam(snapshot, finalTwo, 'a') === sideTeam(snapshot, finalOne, 'a') ? 'a' : 'b'
  await playMatch(organizer, finalTwo.id, [finalTwoWinner === 'a' ? [21, 19] : [19, 21], finalTwoWinner === 'a' ? [21, 19] : [19, 21]])

  snapshot = (await readState()).snapshot
  expect(snapshot.tournament.stage).toBe('completed')
  expect(placementMatches(snapshot, 'final')[2].state).toBe('unnecessary')
  const finalWinner = sideTeam(snapshot, finalOne, 'a')

  await page.getByRole('button', { name: messages.organizer.returnToTournament }).click()
  const celebration = page.getByRole('dialog', { name: teamName(snapshot, finalWinner) })
  await expect(celebration).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(celebration).toBeHidden()

  await page.getByRole('tab', { name: messages.app.tabs.final }).click()
  await expect(page.getByText(messages.fixtures.championLabel)).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: teamName(snapshot, finalWinner) })).toBeVisible()

  const positions = page.getByRole('heading', { name: messages.fixtures.positionsHeading }).locator('..')
  const fourthPlace = [third, fourth].find((teamId) => teamId !== thirdPlaceWinner) ?? ''
  const expected = [finalWinner, [champion, runnerUp].find((teamId) => teamId !== finalWinner) ?? '', thirdPlaceWinner, fourthPlace]
  await expect(positions.getByRole('listitem')).toHaveText(
    expected.map((teamId, index) => `${messages.fixtures.position(index + 1)}${teamName(snapshot, teamId)}`),
  )
})
