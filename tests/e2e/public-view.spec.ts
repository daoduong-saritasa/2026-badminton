import { messages } from '../../src/i18n/vi.ts'
import { readRoster } from './support/roster.ts'
import { expect, test } from './support/test.ts'

test('a spectator sees the tournament in setup without staff controls', async ({ page }) => {
  const roster = await readRoster()
  await page.goto('/')

  await expect(page.getByRole('heading', { level: 1, name: roster.tournamentName })).toBeVisible()
  await expect(page.getByRole('banner').getByText(messages.app.stage.setup, { exact: true })).toBeVisible()
  await expect(page.getByText(messages.publicView.setupInProgress)).toBeVisible()

  const tabs = page.getByRole('tab')
  await expect(tabs).toHaveText([messages.app.tabs.matches, messages.app.tabs.standings, messages.app.tabs.knockouts])
  await expect(page.getByRole('button', { name: messages.app.staffAccess, exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: messages.organizer.heading })).toHaveCount(0)

  await page.getByRole('tab', { name: messages.app.tabs.standings }).click()
  for (const team of roster.teams) {
    await expect(page.getByRole('heading', { level: 4, name: team.name })).toBeVisible()
    for (const player of team.players) await expect(page.getByText(player.name, { exact: true })).toBeVisible()
  }
})
