import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { requireLocalSupabase } from '../integration/local-supabase.ts'
import { signInStaff } from './support/api.ts'
import { staffPins } from './support/pins.ts'
import { readRoster, rosterProblem } from './support/roster.ts'
import { localTarget } from './support/target.ts'

export const rosterSnapshotPath = path.resolve('test-results', 'roster.json')

export default async function globalSetup(): Promise<void> {
  localTarget()
  await requireLocalSupabase()
  const pins = staffPins()

  const roster = await readRoster()
  const problem = rosterProblem(roster)
  if (problem) throw new Error(`The local roster cannot run the suite: ${problem}`)

  try {
    await signInStaff(pins.organizer)
    await signInStaff(pins.referee)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`E2E_ORGANIZER_PIN or E2E_REFEREE_PIN does not match the local stack. ${reason}`)
  }

  mkdirSync(path.dirname(rosterSnapshotPath), { recursive: true })
  writeFileSync(rosterSnapshotPath, JSON.stringify(roster, null, 2))
}
