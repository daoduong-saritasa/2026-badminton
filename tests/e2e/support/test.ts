import { test as base } from '@playwright/test'

import { staffPins, type StaffPins } from './pins.ts'
import { resetProgress } from './reset.ts'

export { expect } from '@playwright/test'

/** Playwright's `test`, with every test starting from a progress reset. */
export const test = base.extend<{ pins: StaffPins; freshTournament: void }>({
  // Playwright requires an object pattern as the first fixture argument.
  // oxlint-disable-next-line no-empty-pattern
  pins: async ({}, use) => {
    await use(staffPins())
  },
  freshTournament: [
    // oxlint-disable-next-line no-empty-pattern
    async ({}, use) => {
      await resetProgress()
      await use()
    },
    { auto: true },
  ],
})
