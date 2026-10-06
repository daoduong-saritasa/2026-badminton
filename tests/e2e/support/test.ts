import { devices, test as base, type BrowserContext, type BrowserContextOptions, type Page } from '@playwright/test'

import { staffPins, type StaffPins } from './pins.ts'
import { resetProgress } from './reset.ts'

export { expect } from '@playwright/test'

/**
 * Opens a page in a fresh browser context, so with its own anonymous session.
 * Uses the project's device unless `device` names another one.
 */
export type OpenPage = (device?: keyof typeof devices) => Promise<Page>

/** Playwright's `test`, with every test starting from a progress reset. */
export const test = base.extend<{ pins: StaffPins; freshTournament: void; openPage: OpenPage }>({
  // Playwright requires an object pattern as the first fixture argument.
  // oxlint-disable-next-line no-empty-pattern
  pins: async ({}, provide) => {
    await provide(staffPins())
  },
  freshTournament: [
    // oxlint-disable-next-line no-empty-pattern
    async ({}, provide) => {
      await resetProgress()
      await provide()
    },
    { auto: true },
  ],
  openPage: async ({ browser }, provide, testInfo) => {
    const contexts: BrowserContext[] = []
    await provide(async (device) => {
      const { baseURL, locale } = testInfo.project.use
      const options: BrowserContextOptions = device ? { ...devices[device], baseURL, locale } : { ...testInfo.project.use }
      const context = await browser.newContext(options)
      contexts.push(context)
      return context.newPage()
    })
    for (const context of contexts) await context.close()
  },
})
