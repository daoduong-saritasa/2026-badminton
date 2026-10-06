import { spawn } from 'node:child_process'

import { messages } from '../../src/i18n/vi.ts'
import {
  assignCourt,
  clearStandings,
  decideQualifying,
  fixtureMatches,
  fixturesIn,
  matchPairLabel,
  prepareMatch,
  startQualifying,
} from './fixtures/tournament.ts'
import { findMatch, readState, signInStaff } from './support/api.ts'
import { readRoster } from './support/roster.ts'
import { signIn } from './support/staff.ts'
import { localTarget } from './support/target.ts'
import { matchRow } from './support/ui.ts'
import { expect, test } from './support/test.ts'

function maintenanceEnvironment(): NodeJS.ProcessEnv {
  const target = localTarget()
  return {
    ...process.env,
    BADMINTON_MAINTENANCE_URL: target.apiUrl,
    BADMINTON_MAINTENANCE_SERVICE_ROLE_KEY: target.serviceRoleKey,
  }
}

/** Runs `npm run maintenance` against the local stack, typing `answer` once it prompts. */
function maintenance(args: string[], answer?: string): Promise<{ status: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', ['run', '--silent', 'maintenance', '--', ...args], { env: maintenanceEnvironment() })
    let output = ''
    const collect = (chunk: Buffer) => {
      output += chunk.toString()
      if (answer !== undefined && output.includes('to continue: ')) {
        child.stdin.end(`${answer}\n`)
        answer = undefined
      }
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    child.on('error', reject)
    child.on('close', (status) => resolve({ status, output }))
  })
}

/** Enables reset, runs `body`, and always disables reset again. */
async function withResetEnabled(body: () => Promise<void>): Promise<void> {
  expect((await maintenance(['enable'])).status).toBe(0)
  try {
    await body()
  } finally {
    expect((await maintenance(['disable'])).status).toBe(0)
  }
}

test('a progress reset from the maintenance command clears play, keeps the roster, and reloads open pages', async ({ page, pins }) => {
  const organizer = await signInStaff(pins.organizer)
  const started = await startQualifying(organizer)
  const [scheduled] = fixtureMatches(started, fixturesIn(started, 'qualifying')[0].id)
  await assignCourt(organizer, scheduled.id, 2)
  await decideQualifying(organizer, clearStandings)
  const { snapshot: played } = await readState()
  const courts = new Map(played.matches.map((match) => [match.id, match.court]))
  expect(courts.get(scheduled.id)).toBe(2)
  const roster = await readRoster()

  await page.goto('/')
  await expect(page.getByRole('banner').getByText(messages.app.stage[played.tournament.stage], { exact: true })).toBeVisible()

  await withResetEnabled(async () => {
    const cancelled = await maintenance(['reset', '--mode', 'progress'], 'RESET wrong progress')
    expect(cancelled.output).toContain('Reset cancelled')
    expect((await readState()).snapshot.tournament.stage).toBe(played.tournament.stage)

    const reset = await maintenance(['reset', '--mode', 'progress'], `RESET ${played.tournament.id} progress`)
    expect(reset.status, reset.output).toBe(0)
    expect(reset.output).toContain('Reset progress completed')
  })

  // The open page follows the reset without a reload.
  await expect(page.getByRole('banner').getByText(messages.app.stage.setup, { exact: true })).toBeVisible()
  await expect(page.getByText(messages.publicView.setupInProgress)).toBeVisible()

  const { snapshot } = await readState()
  expect(snapshot.tournament.stage).toBe('setup')
  expect(snapshot.games).toEqual([])
  expect(snapshot.matches.every((match) => match.state === 'unstarted' && match.pair_a_player_1_id === null)).toBe(true)
  expect(snapshot.matches.every((match) => courts.get(match.id) === match.court)).toBe(true)
  expect(await readRoster()).toEqual(roster)
})

test('a reset sends a referee who is scoring back to an empty match list', async ({ page, pins }) => {
  const organizer = await signInStaff(pins.organizer)
  await startQualifying(organizer)
  const { snapshot } = await readState()
  const [match] = fixtureMatches(snapshot, fixturesIn(snapshot, 'qualifying')[0].id)
  await prepareMatch(organizer, match.id, 1)
  const prepared = (await readState()).snapshot

  await page.goto('/')
  await signIn(page, pins.referee, 'referee')
  const pointA = page.getByRole('button', { name: messages.scoring.addPoint(matchPairLabel(prepared, findMatch(prepared, match.id), 'a')) })
  await matchRow(page, prepared, findMatch(prepared, match.id)).getByRole('button', { name: messages.scoring.start }).click()
  await page.getByRole('alertdialog', { name: messages.scoring.startTitle })
    .getByRole('button', { name: messages.scoring.start }).click()
  await pointA.click()
  await expect(pointA).toContainText('1')

  await withResetEnabled(async () => {
    const reset = await maintenance(['reset', '--mode', 'progress'], `RESET ${snapshot.tournament.id} progress`)
    expect(reset.status, reset.output).toBe(0)
  })

  await expect(page.getByText(messages.scoring.noMatch)).toBeVisible()
  await expect(pointA).toBeHidden()
  expect((await readState()).snapshot.matches.some((candidate) => candidate.state === 'playing')).toBe(false)
})
