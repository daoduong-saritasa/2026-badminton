import { isDeepStrictEqual } from 'node:util'
import { readFileSync } from 'node:fs'

import { rosterSnapshotPath } from './global-setup.ts'
import { readRoster, type Roster } from './support/roster.ts'

export default async function globalTeardown(): Promise<void> {
  const before = JSON.parse(readFileSync(rosterSnapshotPath, 'utf8')) as Roster
  const after = await readRoster()
  if (!isDeepStrictEqual(before, after)) {
    throw new Error(`The suite changed the roster. The roster before the run is in ${rosterSnapshotPath}`)
  }
}
