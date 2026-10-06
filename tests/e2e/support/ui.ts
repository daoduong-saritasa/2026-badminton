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

/** A match's row in the organizer's court schedule. */
export function scheduleRow(page: Page, snapshot: Snapshot, match: Match): Locator {
  const court = messages.organizer.schedule.courtFor(`${matchLabel(snapshot, match)} · ${matchTeams(snapshot, match)}`)
  return page.getByRole('combobox', { name: court, exact: true }).locator('..')
}

/** A third match is played only once the first two finished one each. */
function deciderEligible(snapshot: Snapshot, decider: Match): boolean {
  const openers = snapshot.matches.filter((match) => match.fixture_id === decider.fixture_id && match.match_number !== 3)
  return openers.length === 2
    && openers.every((match) => match.state === 'completed')
    && openers[0].winner_side !== openers[1].winner_side
}

/**
 * A match's row in the referee's match list. Rows carry no team names, so the
 * row is found by its position among the matches staff can prepare.
 */
export function pickerRow(page: Page, snapshot: Snapshot, match: Match): Locator {
  const upcoming = snapshot.matches.filter((candidate) => {
    const fixture = fixtureOf(snapshot, candidate)
    const placement = fixture.stage === 'third-place' || fixture.stage === 'final'
    return candidate.state === 'unstarted'
      && fixture.team_a_id !== null
      && fixture.team_b_id !== null
      && (!placement || snapshot.tournament.finalists_confirmed_at !== null)
      && (candidate.match_number !== 3 || deciderEligible(snapshot, candidate))
  })
  const index = upcoming.findIndex((candidate) => candidate.id === match.id)
  if (index < 0) throw new Error(`Match ${match.id} is not in the referee's list`)
  return page.getByRole('heading', { name: messages.scoring.startHeading, exact: true })
    .locator('..')
    .getByRole('listitem')
    .nth(index)
}

export function pairDialog(page: Page, snapshot: Snapshot, match: Match): Locator {
  return page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: messages.pairAssignment.title(matchLabel(snapshot, match)) }),
  })
}

/** One team's card inside the pair assignment dialog. */
export function sideCard(dialog: Locator, team: string): Locator {
  return dialog.getByRole('heading', { level: 4, name: team, exact: true }).locator('../..')
}
