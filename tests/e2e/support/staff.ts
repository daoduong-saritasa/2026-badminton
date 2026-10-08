import { expect, type Page } from '@playwright/test'

import { vi as messages } from '../../../src/i18n/vi.ts'

export type StaffRole = 'organizer' | 'referee'

/** Opens the staff dialog from the public header and submits `pin`. */
export async function submitPin(page: Page, pin: string): Promise<void> {
  const dialog = page.getByRole('dialog', { name: messages.staff.accessTitle })
  if (!(await dialog.isVisible())) {
    await page.getByRole('button', { name: messages.app.staffAccess, exact: true }).click()
  }
  await dialog.getByLabel(messages.staff.pinLabel).fill(pin)
  await dialog.getByRole('button', { name: messages.staff.continueAction }).click()
}

const workspaceHeading: Record<StaffRole, string> = {
  organizer: messages.organizer.heading,
  referee: messages.scoring.pickHeading,
}

/** Signs in with `pin` and waits for the workspace that role lands on. */
export async function signIn(page: Page, pin: string, role: StaffRole): Promise<void> {
  await submitPin(page, pin)
  await expect(page.getByRole('dialog', { name: messages.staff.accessTitle })).toBeHidden()
  await expect(page.getByRole('heading', { name: workspaceHeading[role], exact: true })).toBeVisible()
}

export function staffMenuButton(page: Page, role: StaffRole) {
  return page.getByRole('button', { name: messages.staff.role[role], exact: true })
}

export async function openStaffMenuItem(page: Page, role: StaffRole, item: string): Promise<void> {
  await staffMenuButton(page, role).click()
  await page.getByRole('menuitem', { name: item }).click()
}

export async function signOut(page: Page, role: StaffRole): Promise<void> {
  await openStaffMenuItem(page, role, messages.staff.signOut)
  await expect(staffMenuButton(page, role)).toBeHidden()
}
