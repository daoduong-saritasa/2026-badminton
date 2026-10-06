import { messages } from '../../src/i18n/vi.ts'
import {
  assignCourt,
  assignPair,
  fixtureMatches,
  fixturesIn,
  mixedPair,
  pairLabel,
  prepareMatch,
  seeds,
  sideTeam,
  startQualifying,
  teamName,
} from './fixtures/tournament.ts'
import { findMatch, matchCommand, readState, RpcError, signInStaff, type Snapshot } from './support/api.ts'
import { signIn } from './support/staff.ts'
import { openOrganizerSection, pairDialog, pickerRow, scheduleRow, sideCard } from './support/ui.ts'
import { expect, test } from './support/test.ts'

const pa = messages.pairAssignment

function firstFixture(snapshot: Snapshot) {
  const [fixture] = fixturesIn(snapshot, 'qualifying')
  const [first, second] = fixtureMatches(snapshot, fixture.id)
  return { fixture, first, second }
}

test('the organizer starts qualifying, which locks the roster', async ({ page, pins }) => {
  await page.goto('/')
  await signIn(page, pins.organizer, 'organizer')

  await page.getByRole('button', { name: messages.organizer.qualifying.review }).click()
  const confirm = page.getByRole('alertdialog', { name: messages.organizer.qualifying.title })
  await confirm.getByRole('button', { name: messages.organizer.qualifying.confirm }).click()
  await expect(page.getByText(messages.organizer.stageBadge(messages.app.stage.groups))).toBeVisible()

  await openOrganizerSection(page, 'teams')
  await expect(page.getByText(messages.setup.lockedTitle)).toBeVisible()
  expect((await readState()).snapshot.tournament.stage).toBe('groups')
})

test('a referee assigns both pairs from the valid arrangements and starts the match', async ({ page, pins }) => {
  const organizer = await signInStaff(pins.organizer)
  const referee = await signInStaff(pins.referee)
  await startQualifying(organizer)
  let { snapshot } = await readState()
  const { first } = firstFixture(snapshot)
  await assignCourt(organizer, first.id, 1)
  snapshot = (await readState()).snapshot

  await page.goto('/')
  await signIn(page, pins.referee, 'referee')
  await pickerRow(page, snapshot, first).getByRole('button', { name: pa.open }).click()
  const dialog = pairDialog(page, snapshot, first)

  for (const side of ['a', 'b'] as const) {
    const teamId = sideTeam(snapshot, first, side)
    const card = sideCard(dialog, teamName(snapshot, teamId))
    await expect(card.getByText(pa.qualifyingRule)).toBeVisible()
    // Only mixed-seed pairs are offered; a same-seed pair has no button.
    const { seed1, seed2 } = seeds(snapshot, teamId)
    for (const one of seed1) {
      for (const two of seed2) await expect(card.getByRole('button', { name: pairLabel(snapshot, { player1Id: one, player2Id: two }) })).toBeVisible()
    }
    await expect(card.getByRole('button', { name: pairLabel(snapshot, { player1Id: seed1[0], player2Id: seed1[1] }) })).toHaveCount(0)
    await card.getByRole('button', { name: pairLabel(snapshot, mixedPair(snapshot, teamId, 0)) }).click()
    await card.getByRole('button', { name: pa.save }).click()
    await expect(card.getByText(pa.saved, { exact: true })).toBeVisible()
  }

  // The server refuses a same-seed pair from a referee even outside the form.
  const teamA = sideTeam(snapshot, first, 'a')
  const { seed1 } = seeds(snapshot, teamA)
  await expect(assignPair(referee, first.id, 'a', { player1Id: seed1[0], player2Id: seed1[1] }))
    .rejects.toThrow('Pair must mix seeds')

  await page.keyboard.press('Escape')
  snapshot = (await readState()).snapshot
  await pickerRow(page, snapshot, findMatch(snapshot, first.id)).getByRole('button', { name: messages.scoring.start }).click()
  await page.getByRole('alertdialog', { name: messages.scoring.startTitle })
    .getByRole('button', { name: messages.scoring.start }).click()
  await expect(page.getByRole('button', { name: messages.scoring.addPoint(pairLabel(snapshot, mixedPair(snapshot, teamA, 0))) })).toBeVisible()
  expect(findMatch((await readState()).snapshot, first.id).state).toBe('playing')
})

test('a player already in the fixture needs the organizer, and a referee cannot grant it', async ({ page, pins }) => {
  const organizer = await signInStaff(pins.organizer)
  await startQualifying(organizer)
  let { snapshot } = await readState()
  const { first, second } = firstFixture(snapshot)
  const teamA = sideTeam(snapshot, first, 'a')
  await assignPair(organizer, first.id, 'a', mixedPair(snapshot, teamA, 0))
  snapshot = (await readState()).snapshot

  await page.goto('/')
  await signIn(page, pins.referee, 'referee')
  await pickerRow(page, snapshot, second).getByRole('button', { name: pa.open }).click()
  const card = sideCard(pairDialog(page, snapshot, second), teamName(snapshot, teamA))
  // The first arrangement's pair shares a player with match 1.
  const { seed1, seed2 } = seeds(snapshot, teamA)
  await card.getByRole('button', { name: pairLabel(snapshot, { player1Id: seed1[0], player2Id: seed2[1] }) }).click()
  await expect(card.getByText(pa.issues['qualifying-player-reused'])).toBeVisible()
  await expect(card.getByText(pa.organizerOnly)).toBeVisible()
  await expect(card.getByRole('button', { name: pa.save })).toBeDisabled()

  await expect(assignPair(await signInStaff(pins.referee), second.id, 'a', { player1Id: seed1[0], player2Id: seed2[1] }, true))
    .rejects.toThrow('Organizer access required')
})

test('the organizer saves a same-seed pair as a confirmed exception', async ({ page, pins }) => {
  const organizer = await signInStaff(pins.organizer)
  await startQualifying(organizer)
  const { snapshot } = await readState()
  const { first } = firstFixture(snapshot)
  const teamA = sideTeam(snapshot, first, 'a')
  const { seed1 } = seeds(snapshot, teamA)

  await page.goto('/')
  await signIn(page, pins.organizer, 'organizer')
  await openOrganizerSection(page, 'matches')
  await scheduleRow(page, snapshot, first).getByRole('button', { name: pa.open }).click()
  const card = sideCard(pairDialog(page, snapshot, first), teamName(snapshot, teamA))
  await card.getByRole('button', { name: pa.showException }).click()
  await card.getByRole('button', { name: snapshot.players.find((player) => player.id === seed1[0])?.name }).click()
  await card.getByRole('button', { name: snapshot.players.find((player) => player.id === seed1[1])?.name }).click()
  await expect(card.getByText(pa.issues['same-seed'])).toBeVisible()

  await card.getByRole('button', { name: pa.saveException }).click()
  const confirm = page.getByRole('alertdialog', { name: pa.exceptionTitle })
  await confirm.getByRole('button', { name: pa.confirmException }).click()
  await expect(confirm).toBeHidden()
  await expect(card.getByText(pa.saved, { exact: true })).toBeVisible()

  const saved = findMatch((await readState()).snapshot, first.id)
  expect([saved.pair_a_player_1_id, saved.pair_a_player_2_id].sort()).toEqual([...seed1].sort())
  // Nothing public marks the exception.
  expect(JSON.stringify((await readState()).snapshot)).not.toMatch(/exception/i)
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

  // Another fixture of the same team, played while the first is on court.
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
  await scheduleRow(page, snapshot, target).getByRole('button', { name: pa.open }).click()
  const card = sideCard(pairDialog(page, snapshot, target), teamName(snapshot, teamA))
  await expect(card.getByText(pa.playing, { exact: true })).toHaveCount(2)
  await card.getByRole('button', { name: pa.showException }).click()
  await card.getByRole('button', { name: snapshot.players.find((player) => player.id === busy)?.name }).click()
  await card.getByRole('button', { name: partner.name }).click()
  await expect(card.getByText(pa.issues['player-playing'])).toBeVisible()
  await expect(card.getByRole('button', { name: pa.save })).toBeDisabled()
})

test('a saved pair can change until the match starts, and is fixed after', async ({ page, pins }) => {
  const organizer = await signInStaff(pins.organizer)
  const referee = await signInStaff(pins.referee)
  await startQualifying(organizer)
  let { snapshot } = await readState()
  const { first } = firstFixture(snapshot)
  const teamA = sideTeam(snapshot, first, 'a')
  await prepareMatch(organizer, first.id, 1)
  snapshot = (await readState()).snapshot

  await page.goto('/')
  await signIn(page, pins.referee, 'referee')
  await pickerRow(page, snapshot, first).getByRole('button', { name: pa.open }).click()
  const dialog = pairDialog(page, snapshot, first)
  const card = sideCard(dialog, teamName(snapshot, teamA))
  const replacement = mixedPair(snapshot, teamA, 1)
  await card.getByRole('button', { name: pairLabel(snapshot, replacement) }).click()
  await card.getByRole('button', { name: pa.save }).click()
  await expect.poll(async () => {
    const changed = findMatch((await readState()).snapshot, first.id)
    return [changed.pair_a_player_1_id, changed.pair_a_player_2_id]
  }).toEqual([replacement.player1Id, replacement.player2Id])
  await page.keyboard.press('Escape')
  snapshot = (await readState()).snapshot

  await matchCommand(referee, 'start_match', first.id)
  await expect(assignPair(organizer, first.id, 'a', mixedPair(snapshot, teamA, 0), true))
    .rejects.toThrow(RpcError)
  await expect(assignPair(organizer, first.id, 'a', mixedPair(snapshot, teamA, 0), true))
    .rejects.toThrow('Pairs are fixed after the match starts')

  // The started match leaves the referee's list of matches to prepare.
  await expect(page.getByRole('heading', { name: messages.scoring.resumeHeading })).toBeVisible()
})
