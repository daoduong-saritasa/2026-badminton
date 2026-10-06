import type { Page } from '@playwright/test'

import { messages } from '../../src/i18n/vi.ts'
import { errorMessage, unknownErrorMessage } from '../../src/i18n/errors.ts'
import { edgeRequest, rpc, signInAnonymously } from '../integration/local-supabase.ts'
import { signInStaff, type LocalSession } from './support/api.ts'
import { openStaffMenuItem, signIn, signOut, staffMenuButton, submitPin, type StaffRole } from './support/staff.ts'
import { expect, test } from './support/test.ts'

const pinAlert = (page: Page) => page.getByRole('dialog', { name: messages.staff.accessTitle }).getByRole('alert')

async function hasStaffAccess(session: LocalSession): Promise<boolean> {
  const response = await rpc('get_staff_access', {}, session)
  return response.ok && (await response.json()) !== null
}

/** A wrong PIN distinct from both real ones. */
function wrongPin(pins: Record<StaffRole, string>): string {
  return ['0000', '1111', '2222'].find((pin) => pin !== pins.organizer && pin !== pins.referee) ?? '3333'
}

test('a wrong PIN is refused with a clear message, and repeated attempts lock the device out', async ({ page, pins }) => {
  await page.goto('/')
  const wrong = wrongPin(pins)

  await submitPin(page, wrong)
  await expect(pinAlert(page)).toHaveText(errorMessage(new Error('The staff PIN is incorrect')))
  await expect(pinAlert(page)).not.toHaveText(unknownErrorMessage)
  await expect(staffMenuButton(page, 'organizer')).toBeHidden()

  for (let attempt = 2; attempt <= 5; attempt += 1) await submitPin(page, wrong)
  await expect(pinAlert(page)).toHaveText(messages.staff.rateLimited(15))

  // The lockout holds even for the right PIN.
  await submitPin(page, pins.organizer)
  await expect(pinAlert(page)).toHaveText(/Đã thử quá nhiều lần/)
})

test('the organizer PIN opens the organizer workspace and its controls', async ({ page, pins }) => {
  await page.goto('/')
  await signIn(page, pins.organizer, 'organizer')

  await expect(page.getByRole('heading', { name: messages.organizer.heading })).toBeVisible()
  await staffMenuButton(page, 'organizer').click()
  await expect(page.getByRole('menuitem', { name: messages.staff.rotateOrganizerPin })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: messages.staff.rotateRefereePin })).toBeVisible()
  await page.keyboard.press('Escape')

  // Access survives a reload: the grant lives on the server, not in the page.
  await page.reload()
  await expect(staffMenuButton(page, 'organizer')).toBeVisible()
})

test('the referee PIN opens scoring but no organizer controls', async ({ page, pins }) => {
  await page.goto('/')
  await signIn(page, pins.referee, 'referee')

  await page.getByRole('button', { name: messages.scoring.backToMatches }).click()

  await staffMenuButton(page, 'referee').click()
  await expect(page.getByRole('menuitem', { name: messages.staff.openWorkspace.referee })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: messages.staff.rotateOrganizerPin })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('heading', { name: messages.organizer.heading })).toHaveCount(0)
})

test('signing out removes staff access from the device', async ({ page, pins }) => {
  await page.goto('/')
  await signIn(page, pins.organizer, 'organizer')
  await page.getByRole('button', { name: messages.organizer.returnToTournament }).click()

  await signOut(page, 'organizer')
  await expect(page.getByRole('button', { name: messages.app.staffAccess, exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: messages.app.staffAccess, exact: true })).toBeVisible()
  await expect(staffMenuButton(page, 'organizer')).toBeHidden()
})

/**
 * `rotating(role, rotated)` records a PIN the test is about to rotate to. Fixture
 * teardown puts the original PIN back, which Playwright awaits even after a
 * failure or timeout.
 */
const rotationTest = test.extend<{ rotating: (role: StaffRole, rotated: string) => void }>({
  rotating: async ({ pins }, provide) => {
    const rotations: Array<{ role: StaffRole; rotated: string }> = []
    await provide((role, rotated) => {
      rotations.push({ role, rotated })
    })
    for (const { role, rotated } of rotations) await restorePin(role, rotated, pins[role], pins.organizer)
  },
})

for (const role of ['referee', 'organizer'] as const) {
  rotationTest(`rotating the ${role} PIN retires the old PIN and signs out other ${role} devices`, async ({ page, pins, rotating }) => {
    const original = pins[role]
    const rotated = ['97531', '86420', '75319'].find((pin) => pin !== pins.organizer && pin !== pins.referee) ?? '64208'
    const otherDevice = await signInStaff(original)
    rotating(role, rotated)

    await page.goto('/')
    await signIn(page, pins.organizer, 'organizer')
    await openStaffMenuItem(page, 'organizer', role === 'organizer' ? messages.staff.rotateOrganizerPin : messages.staff.rotateRefereePin)

    const rotation = page.getByRole('dialog', { name: messages.staff.rotateTitle[role] })
    await rotation.getByLabel(messages.staff.newPinLabel).fill(rotated)
    await rotation.getByRole('button', { name: messages.staff.reviewRotation }).click()
    const confirmation = page.getByRole('alertdialog', { name: messages.staff.confirmRotateTitle[role] })
    await confirmation.getByRole('button', { name: messages.staff.confirmRotate }).click()
    await expect(confirmation).toBeHidden()
    await expect(rotation).toBeHidden()

    expect(await hasStaffAccess(otherDevice)).toBe(false)
    await expect(signInStaff(original)).rejects.toThrow()
    await signInStaff(rotated)
    // The device that rotated keeps working.
    await expect(staffMenuButton(page, 'organizer')).toBeVisible()
  })
}

/** Puts `role`'s PIN back to `original`, whichever PIN it holds now. */
async function restorePin(role: StaffRole, rotated: string, original: string, organizerPin: string): Promise<void> {
  const organizerPins = role === 'organizer' ? [rotated, original] : [organizerPin]
  for (const pin of organizerPins) {
    const session = await signInAnonymously()
    const granted = await edgeRequest('staff-pin', session, pin)
    if (!granted.ok) continue
    const restored = await edgeRequest('rotate-pin', session, original, role)
    if (!restored.ok) throw new Error(`Could not restore the ${role} PIN: rotate-pin returned ${restored.status}`)
    return
  }
  throw new Error(`Could not sign in as organizer to restore the ${role} PIN`)
}
