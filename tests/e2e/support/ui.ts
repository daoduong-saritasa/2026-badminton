import type { Locator, Page } from '@playwright/test'

import { messages } from '../../../src/i18n/vi.ts'
import { fixtureOf, sideTeam, teamName } from '../fixtures/tournament.ts'
import type { Match, Snapshot } from './api.ts'

const stageLabels = messages.stages

/** "Vòng loại · Trận 1": how the interface names a match. */
export function matchLabel(snapshot: Snapshot, match: Match): string {
  return messages.common.fixtureMatch(stageLabels[fixtureOf(snapshot, match).stage], match.match_number)
}

/** "Team A - Team B" for a match's fixture. */
export function matchTeams(snapshot: Snapshot, match: Match): string {
  return messages.common.versus(teamName(snapshot, sideTeam(snapshot, match, 'a')), teamName(snapshot, sideTeam(snapshot, match, 'b')))
}

export async function openOrganizerSection(page: Page, section: keyof typeof messages.organizer.navigation): Promise<void> {
  await page.getByRole('navigation', { name: messages.organizer.navigationLabel })
    .getByRole('button', { name: messages.organizer.navigation[section] })
    .click()
}

/**
 * A fixture's row in the organizer's schedule or the referee's match list,
 * holding the fixture's pair assignment button and its match rows.
 */
export function fixtureRow(page: Page, snapshot: Snapshot, match: Match): Locator {
  const label = `${stageLabels[fixtureOf(snapshot, match).stage]} · ${matchTeams(snapshot, match)}`
  return page.getByRole('listitem', { name: label, exact: true })
}

/** One match's row inside its fixture row. */
export function matchRow(page: Page, snapshot: Snapshot, match: Match): Locator {
  return fixtureRow(page, snapshot, match).getByRole('listitem', { name: messages.common.matchNumber(match.match_number), exact: true })
}

/** The pair assignment dialog for a match's fixture. */
export function pairDialog(page: Page, snapshot: Snapshot, match: Match): Locator {
  const fixture = fixtureOf(snapshot, match)
  return page.getByRole('dialog', {
    name: messages.pairAssignment.title(stageLabels[fixture.stage], matchTeams(snapshot, match)),
  })
}

/** One team's player choices for one match inside the pair assignment dialog. */
export function teamPicker(dialog: Locator, matchNumber: 1 | 2 | 3, team: string): Locator {
  return dialog.getByRole('region', { name: messages.common.matchNumber(matchNumber), exact: true })
    .getByRole('group', { name: team, exact: true })
}
