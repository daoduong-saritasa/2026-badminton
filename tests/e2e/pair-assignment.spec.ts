import type { Locator } from '@playwright/test'

import { messages } from '../../src/i18n/vi.ts'
import {
  assignCourt,
  assignFixturePairs,
  assignPair,
  fixtureMatches,
  fixturesIn,
  mixedPair,
  pairLabel,
  playerName,
  playMatch,
  prepareMatch,
  seeds,
  sideTeam,
  startQualifying,
  teamName,
} from './fixtures/tournament.ts'
import { findMatch, matchCommand, readState, signInStaff, type Match, type Pair, type Snapshot } from './support/api.ts'
import { signIn } from './support/staff.ts'
import { fixtureRow, matchRow, openOrganizerSection, pairDialog, teamPicker } from './support/ui.ts'
import { expect, test } from './support/test.ts'

const pa = messages.pairAssignment

function firstFixture(snapshot: Snapshot) {
  const [fixture] = fixturesIn(snapshot, 'qualifying')
  const [first, second] = fixtureMatches(snapshot, fixture.id)
  return { fixture, first, second }
}

function sidePair(match: Match, side: 'a' | 'b'): string[] {
  const ids = side === 'a'
    ? [match.pair_a_player_1_id, match.pair_a_player_2_id]
    : [match.pair_b_player_1_id, match.pair_b_player_2_id]
  return ids.filter((id): id is string => id !== null).sort()
}

const ids = (pair: Pair) => [pair.player1Id, pair.player2Id].sort()

/** Taps each player of `pair` in a team's picker. */
async function pick(picker: Locator, snapshot: Snapshot, pair: Pair): Promise<void> {
  for (const playerId of [pair.player1Id, pair.player2Id]) {
    await picker.getByRole('button', { name: playerName(snapshot, playerId) }).click()
  }
}

test('the organizer starts qualifying, which locks the roster', async ({ page, pins }) => {
  await page.goto('/')
  await signIn(page, pins.organizer, 'organizer')

  await page.getByRole('button', { name: messages.organizer.qualifying.review }).click()
  const confirm = page.getByRole('alertdialog', { name: messages.organizer.qualifying.title })
  await confirm.getByRole('button', { name: messages.organizer.qualifying.confirm }).click()
  await expect(confirm).not.toBeVisible()

  await openOrganizerSection(page, 'teams')
  await expect(page.getByText(messages.setup.lockedTitle)).toBeVisible()
  expect((await readState()).snapshot.tournament.stage).toBe('groups')
})

test('a referee picks one seed 1 and one seed 2 per team, and match 2 takes the rest', async ({ page, pins }) => {
  const organizer = await signInStaff(pins.organizer)
  const referee = await signInStaff(pins.referee)
  await startQualifying(organizer)
  let { snapshot } = await readState()
  const { first, second } = firstFixture(snapshot)
  await assignCourt(organizer, first.id, 1)
  snapshot = (await readState()).snapshot

  await page.goto('/')
  await signIn(page, pins.referee, 'referee')
  await expect(matchRow(page, snapshot, first)).toContainText(pa.notAssigned)
  await expect(matchRow(page, snapshot, second)).toBeVisible()
  await fixtureRow(page, snapshot, first).getByRole('button', { name: pa.open }).click()
  const dialog = pairDialog(page, snapshot, first)
  await expect(dialog).toContainText(pa.rule.qualifying)

  const chosen: Record<'a' | 'b', Pair> = {
    a: mixedPair(snapshot, sideTeam(snapshot, first, 'a'), 0),
    b: mixedPair(snapshot, sideTeam(snapshot, first, 'b'), 1),
  }
  const rest: Record<'a' | 'b', Pair> = {
    a: mixedPair(snapshot, sideTeam(snapshot, first, 'a'), 1),
    b: mixedPair(snapshot, sideTeam(snapshot, first, 'b'), 0),
  }
  const matchTwo = dialog.getByRole('region', { name: messages.common.matchNumber(2) })
  for (const side of ['a', 'b'] as const) {
    const team = teamName(snapshot, sideTeam(snapshot, first, side))
    const picker = teamPicker(dialog, 1, team)
    await expect(picker.getByRole('button')).toHaveCount(4)
    await pick(picker, snapshot, chosen[side])
    // Match 2 needs no choice: it takes the two players left over.
    await expect(matchTwo).toContainText(pairLabel(snapshot, rest[side]))
  }
  await expect(matchTwo.getByRole('button')).toHaveCount(0)

  await dialog.getByRole('button', { name: pa.save }).click()
  await expect(dialog).toBeHidden()
  const saved = (await readState()).snapshot
  for (const side of ['a', 'b'] as const) {
    expect(sidePair(findMatch(saved, first.id), side)).toEqual(ids(chosen[side]))
    expect(sidePair(findMatch(saved, second.id), side)).toEqual(ids(rest[side]))
  }

  // The server refuses a same-seed pair from a referee even outside the form.
  const { seed1 } = seeds(snapshot, sideTeam(snapshot, first, 'a'))
  await expect(assignPair(referee, first.id, 'a', { player1Id: seed1[0], player2Id: seed1[1] }))
    .rejects.toThrow('Pair must mix seeds')

  // With pairs and a court, match 1 can start; match 2 says it still needs a court.
  const waitingRow = matchRow(page, saved, findMatch(saved, second.id))
  await expect(waitingRow.getByRole('button', { name: messages.scoring.start })).toBeDisabled()
  await expect(waitingRow).toContainText(messages.scoring.startBlocked.court)
  await matchRow(page, saved, findMatch(saved, first.id)).getByRole('button', { name: messages.scoring.start }).click()
  await page.getByRole('alertdialog', { name: messages.scoring.startTitle })
    .getByRole('button', { name: messages.scoring.start }).click()
  await expect(page.getByRole('button', { name: messages.scoring.addPoint(pairLabel(saved, chosen.a)) })).toBeVisible()
  expect(findMatch((await readState()).snapshot, first.id).state).toBe('playing')
})

test('a fixture save is all or nothing', async ({ pins }) => {
  const organizer = await signInStaff(pins.organizer)
  await startQualifying(organizer)
  const { snapshot } = await readState()
  const { fixture, first, second } = firstFixture(snapshot)
  const teamA = sideTeam(snapshot, first, 'a')
  const { seed1 } = seeds(snapshot, teamA)

  await expect(assignFixturePairs(organizer, fixture.id, [
    { matchId: first.id, side: 'a', pair: mixedPair(snapshot, teamA, 0) },
    { matchId: second.id, side: 'a', pair: { player1Id: seed1[0], player2Id: seed1[1] } },
  ])).rejects.toThrow('Pair must mix seeds')
  expect(sidePair(findMatch((await readState()).snapshot, first.id), 'a')).toEqual([])
})

test('a referee cannot save a rule exception through either command', async ({ pins }) => {
  const organizer = await signInStaff(pins.organizer)
  const referee = await signInStaff(pins.referee)
  await startQualifying(organizer)
  const { snapshot } = await readState()
  const { fixture, first } = firstFixture(snapshot)
  const { seed1 } = seeds(snapshot, sideTeam(snapshot, first, 'a'))
  const sameSeed = { player1Id: seed1[0], player2Id: seed1[1] }

  await expect(assignPair(referee, first.id, 'a', sameSeed, true)).rejects.toThrow('Organizer access required')
  await expect(assignFixturePairs(referee, fixture.id, [{ matchId: first.id, side: 'a', pair: sameSeed }], true))
    .rejects.toThrow('Organizer access required')
})

test('the organizer saves a doubled-up player as a confirmed exception', async ({ page, pins }) => {
  const organizer = await signInStaff(pins.organizer)
  await startQualifying(organizer)
  const { snapshot } = await readState()
  const { first, second } = firstFixture(snapshot)
  const teamA = sideTeam(snapshot, first, 'a')
  const team = teamName(snapshot, teamA)
  const { seed1, seed2 } = seeds(snapshot, teamA)

  await page.goto('/')
  await signIn(page, pins.organizer, 'organizer')
  await openOrganizerSection(page, 'matches')
  await fixtureRow(page, snapshot, first).getByRole('button', { name: pa.open }).click()
  const dialog = pairDialog(page, snapshot, first)
  await dialog.getByRole('button', { name: pa.showException }).click()

  // seed1[0] plays both matches, as when a teammate is absent.
  await pick(teamPicker(dialog, 1, team), snapshot, { player1Id: seed1[0], player2Id: seed2[0] })
  await pick(teamPicker(dialog, 2, team), snapshot, { player1Id: seed1[0], player2Id: seed2[1] })
  await expect(dialog).toContainText(pa.issues['concurrent-player-reused'])

  await dialog.getByRole('button', { name: pa.saveException }).click()
  const confirm = page.getByRole('alertdialog', { name: pa.exceptionTitle })
  await confirm.getByRole('button', { name: pa.confirmException }).click()
  await expect(confirm).toBeHidden()
  await expect(dialog).toBeHidden()

  const saved = (await readState()).snapshot
  expect(sidePair(findMatch(saved, first.id), 'a')).toEqual([seed1[0], seed2[0]].sort())
  expect(sidePair(findMatch(saved, second.id), 'a')).toEqual([seed1[0], seed2[1]].sort())
  // Nothing public marks the exception.
  expect(JSON.stringify(saved)).not.toMatch(/exception/i)
})

test('nobody can pair a player twice or use a player who is on court', async ({ page, pins }) => {
  const organizer = await signInStaff(pins.organizer)
  await startQualifying(organizer)
  let { snapshot } = await readState()
  const { first } = firstFixture(snapshot)
  const teamA = sideTeam(snapshot, first, 'a')
  await prepareMatch(organizer, first.id, 1)
  await matchCommand(organizer, 'start_match', first.id)
  snapshot = (await readState()).snapshot
  const busy = findMatch(snapshot, first.id).pair_a_player_1_id
  if (!busy) throw new Error('The started match has no pair')

  const other = fixturesIn(snapshot, 'qualifying')
    .find((fixture) => fixture.id !== first.fixture_id && (fixture.team_a_id === teamA || fixture.team_b_id === teamA))
  if (!other) throw new Error('The team has no other qualifying fixture')
  const [target] = fixtureMatches(snapshot, other.id)
  const side = other.team_a_id === teamA ? 'a' : 'b'
  const partner = snapshot.players.find((player) => player.team_id === teamA && player.id !== busy)
  if (!partner) throw new Error('The team has no partner for the busy player')

  await expect(assignPair(organizer, target.id, side, { player1Id: busy, player2Id: busy }, true))
    .rejects.toThrow('A pair requires two distinct players')
  await expect(assignPair(organizer, target.id, side, { player1Id: busy, player2Id: partner.id }, true))
    .rejects.toThrow('A player is already playing')

  await page.goto('/')
  await signIn(page, pins.organizer, 'organizer')
  await openOrganizerSection(page, 'matches')
  await fixtureRow(page, snapshot, target).getByRole('button', { name: pa.open }).click()
  const dialog = pairDialog(page, snapshot, target)
  await dialog.getByRole('button', { name: pa.showException }).click()
  const picker = teamPicker(dialog, 1, teamName(snapshot, teamA))
  await expect(picker.getByRole('button', { name: pa.playing })).toHaveCount(2)
  await pick(picker, snapshot, { player1Id: busy, player2Id: partner.id })
  await expect(dialog).toContainText(pa.issues['player-playing'])
  await expect(dialog.getByRole('button', { name: pa.save })).toBeDisabled()
})

test('saved pairs can be swapped until the match starts, and are fixed after', async ({ page, pins }) => {
  const organizer = await signInStaff(pins.organizer)
  const referee = await signInStaff(pins.referee)
  await startQualifying(organizer)
  let { snapshot } = await readState()
  const { first, second } = firstFixture(snapshot)
  const teamA = sideTeam(snapshot, first, 'a')
  await prepareMatch(organizer, first.id, 1)
  await prepareMatch(organizer, second.id, 2)
  snapshot = (await readState()).snapshot

  // Swapping which pair plays which match reuses every player in the fixture,
  // so it saves only because the server clears both sides before checking.
  await page.goto('/')
  await signIn(page, pins.referee, 'referee')
  await fixtureRow(page, snapshot, findMatch(snapshot, first.id)).getByRole('button', { name: pa.open }).click()
  const dialog = pairDialog(page, snapshot, first)
  const swapped: [Pair, Pair] = [mixedPair(snapshot, teamA, 1), mixedPair(snapshot, teamA, 0)]
  await pick(teamPicker(dialog, 1, teamName(snapshot, teamA)), snapshot, swapped[0])
  await dialog.getByRole('button', { name: pa.save }).click()
  await expect(dialog).toBeHidden()

  snapshot = (await readState()).snapshot
  expect(sidePair(findMatch(snapshot, first.id), 'a')).toEqual(ids(swapped[0]))
  expect(sidePair(findMatch(snapshot, second.id), 'a')).toEqual(ids(swapped[1]))

  await matchCommand(referee, 'start_match', first.id)
  await expect(assignPair(organizer, first.id, 'a', mixedPair(snapshot, teamA, 0), true))
    .rejects.toThrow('Pairs are fixed after the match starts')
  await expect(page.getByRole('heading', { name: messages.scoring.resumeHeading })).toBeVisible()
})

test('once match 1 is played, match 2 can only take the two players left', async ({ page, pins }) => {
  const organizer = await signInStaff(pins.organizer)
  await startQualifying(organizer)
  let { snapshot } = await readState()
  const { first, second } = firstFixture(snapshot)
  await prepareMatch(organizer, first.id, 1)
  await playMatch(organizer, first.id, [[21, 15]])
  await assignCourt(organizer, second.id, 2)
  snapshot = (await readState()).snapshot

  await page.goto('/')
  await signIn(page, pins.referee, 'referee')
  await fixtureRow(page, snapshot, second).getByRole('button', { name: pa.open }).click()
  const dialog = pairDialog(page, snapshot, second)
  await expect(dialog.getByRole('region', { name: messages.common.matchNumber(1) })).toHaveCount(0)
  const matchTwo = dialog.getByRole('region', { name: messages.common.matchNumber(2) })
  // Nothing to choose: the pairs that played match 1 cannot play again.
  await expect(matchTwo.getByRole('button')).toHaveCount(0)
  const rest = {
    a: mixedPair(snapshot, sideTeam(snapshot, first, 'a'), 1),
    b: mixedPair(snapshot, sideTeam(snapshot, first, 'b'), 1),
  }
  for (const side of ['a', 'b'] as const) {
    await expect(matchTwo).toContainText(pairLabel(snapshot, rest[side]))
  }
  await expect(matchTwo).toContainText(pa.remainingOf(1))

  await dialog.getByRole('button', { name: pa.save }).click()
  await expect(dialog).toBeHidden()
  const saved = findMatch((await readState()).snapshot, second.id)
  expect(sidePair(saved, 'a')).toEqual(ids(rest.a))
  expect(sidePair(saved, 'b')).toEqual(ids(rest.b))
})

test('when match 2 is played first, match 1 takes the two players left', async ({ page, pins }) => {
  const organizer = await signInStaff(pins.organizer)
  await startQualifying(organizer)
  let { snapshot } = await readState()
  const { first, second } = firstFixture(snapshot)
  await prepareMatch(organizer, second.id, 2)
  await playMatch(organizer, second.id, [[21, 15]])
  await assignCourt(organizer, first.id, 1)
  snapshot = (await readState()).snapshot

  await page.goto('/')
  await signIn(page, pins.referee, 'referee')
  await fixtureRow(page, snapshot, first).getByRole('button', { name: pa.open }).click()
  const dialog = pairDialog(page, snapshot, first)
  const matchOne = dialog.getByRole('region', { name: messages.common.matchNumber(1) })
  await expect(matchOne.getByRole('button')).toHaveCount(0)
  await expect(matchOne).toContainText(pa.remainingOf(2))

  await dialog.getByRole('button', { name: pa.save }).click()
  await expect(dialog).toBeHidden()
  const saved = findMatch((await readState()).snapshot, first.id)
  expect(sidePair(saved, 'a')).toEqual(ids(mixedPair(snapshot, sideTeam(snapshot, first, 'a'), 0)))
  expect(sidePair(saved, 'b')).toEqual(ids(mixedPair(snapshot, sideTeam(snapshot, first, 'b'), 0)))
})
