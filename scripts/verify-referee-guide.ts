/// <reference lib="dom" />
import assert from 'node:assert/strict'
import type { ComponentType, ReactNode } from 'react'

type PairRegressionSnapshot = { matches: { pairA: { player1Id: string; player2Id: string } | null }[] }
import { chromium, expect, type Page } from '@playwright/test'

const baseURL = 'http://127.0.0.1:5181'
const backend = /supabase|\/(auth|rest|realtime|functions)\/v1|:54321/
const browser = await chromium.launch()
const seed = { 'sb-guide-auth-token': 'existing-session-sentinel', 'badminton:sides-swapped:guide-match-1': '1', 'badminton:sides-swapped:live-match': '1' }

async function assertStep(page: Page, index: number) {
  await expect(page.locator('.guide-example')).toHaveAttribute('data-step', String(index))
  await expect(page.locator('.driver-popover')).toBeVisible()
  await expect(page.locator('.driver-active-element')).toBeVisible()
  await expect(page.locator('.driver-active-element')).not.toHaveAttribute('id', 'driver-dummy-element')
  await expect(page.locator('.driver-active-element')).toHaveAttribute('data-guide', (await page.locator('.guide-example').getAttribute('data-target'))!)
  const next = page.locator('.driver-popover-next-btn')
  await expect(next).toBeVisible()
  await expect.poll(async () => {
    const bounds = await next.boundingBox()
    return Boolean(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= page.viewportSize()!.width && bounds.y + bounds.height <= page.viewportSize()!.height)
  }, { message: `Navigation outside viewport at step ${index}` }).toBe(true)
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `Horizontal overflow at step ${index}`)
  await expect(next).toBeFocused()
  if ([2, 5, 6, 16, 25].includes(index)) {
    await page.keyboard.press('Shift+Tab')
    await expect(page.locator('.driver-popover-prev-btn')).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(next).toBeFocused()
  }
}

async function assertPairDraftReset(page: Page) {
  await page.evaluate(async () => {
    const reactPath = '/node_modules/.vite/deps/react.js'
    const domPath = '/node_modules/.vite/deps/react-dom_client.js'
    const viewPath = '/src/features/scoring/PairAssignmentView.tsx'
    const dialogPath = '/src/components/ui/dialog.tsx'
    const dataPath = '/src/features/guide/guide-data.ts'
    const reactModule = await import(reactPath) as typeof import('react') & { default?: typeof import('react') }
    const { createElement } = reactModule.default ?? reactModule
    const domModule = await import(domPath) as typeof import('react-dom/client') & { default?: typeof import('react-dom/client') }
    const { createRoot } = domModule.default ?? domModule
    const { guideSnapshot } = await import(dataPath) as { guideSnapshot: (stage: 'qualifying', assigned: boolean) => PairRegressionSnapshot }
    const { PairAssignmentView } = await import(viewPath) as { PairAssignmentView: ComponentType<{
      snapshot: PairRegressionSnapshot; fixtureId: string; role: 'referee'; initialPicks: Record<string, string[]>;
      onSave: (input: unknown, complete: () => void) => void;
    }> }
    const { Dialog, DialogContent } = await import(dialogPath) as {
      Dialog: ComponentType<{ open: boolean; modal: boolean; children?: ReactNode }>;
      DialogContent: ComponentType<{ children?: ReactNode; 'data-testid': string }>;
    }
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    let snapshot = guideSnapshot('qualifying', false)
    const render = () => root.render(createElement(Dialog, { open: true, modal: false },
      createElement(DialogContent, { 'data-testid': 'pair-regression' }, createElement(PairAssignmentView, {
        snapshot, fixtureId: 'guide-fixture', role: 'referee',
        initialPicks: { 'guide-match-1:a': ['guide-a-0', 'guide-a-2'], 'guide-match-1:b': ['guide-b-0', 'guide-b-2'] },
        onSave: (_input, complete) => {
          complete()
          snapshot = guideSnapshot('qualifying', true)
          snapshot.matches[0].pairA = { player1Id: 'guide-a-1', player2Id: 'guide-a-3' }
          snapshot.matches[1].pairA = { player1Id: 'guide-a-0', player2Id: 'guide-a-2' }
          render()
        },
      })
    )))
    render()
    Reflect.set(window, '__disposePairRegression', () => { root.unmount(); host.remove() })
  })
  const form = page.getByTestId('pair-regression')
  await expect(form.getByRole('button', { name: /An/ }).first()).toHaveAttribute('aria-pressed', 'true')
  await form.getByRole('button', { name: 'Lưu cặp', exact: true }).click()
  await expect(form.getByRole('button', { name: /Bình/ }).first()).toHaveAttribute('aria-pressed', 'true')
  await expect(form.getByRole('button', { name: /An/ }).first()).toHaveAttribute('aria-pressed', 'false')
  await page.evaluate(() => (Reflect.get(window, '__disposePairRegression') as () => void)())
}

try {
  for (const width of [390, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: 'reduce', storageState: { cookies: [], origins: [{ origin: baseURL, localStorage: Object.entries(seed).map(([name, value]) => ({ name, value })) }] } })
    await context.addInitScript(() => {
      const originalGet = Storage.prototype.getItem
      const originalSet = Storage.prototype.setItem
      const originalRemove = Storage.prototype.removeItem
      Storage.prototype.getItem = function (key) { if (/^sb-|^badminton:/.test(key)) console.debug('guide-storage:' + `get:${key}`); return originalGet.call(this, key) }
      Storage.prototype.setItem = function (key, value) { if (/^sb-|^badminton:/.test(key)) console.debug('guide-storage:' + `set:${key}`); return originalSet.call(this, key, value) }
      Storage.prototype.removeItem = function (key) { if (/^sb-|^badminton:/.test(key)) console.debug('guide-storage:' + `remove:${key}`); return originalRemove.call(this, key) }
    })
    const page = await context.newPage()
    const accesses: string[] = []
    page.on('console', (message) => { if (message.text().startsWith('guide-storage:')) accesses.push(message.text()) })
    const errors: string[] = []
    const requests: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('request', (request) => { if (backend.test(request.url())) requests.push(request.url()) })
    page.on('websocket', (socket) => { if (backend.test(socket.url())) requests.push(socket.url()) })
    for (const route of ['/guide', '/guide/']) {
      await page.goto(`${baseURL}${route}`)
      await expect(page.getByRole('heading', { name: 'Hướng dẫn trọng tài' })).toBeVisible()
      await page.reload()
      await expect(page.locator('.guide-example')).toHaveAttribute('data-step', 'closed')
      await page.getByRole('button', { name: 'Bắt đầu hướng dẫn' }).click()
      const count = Number(await page.locator('[data-guide-total]').getAttribute('data-guide-total'))
      for (let index = 0; index < count; index++) {
        await assertStep(page, index)
        if (index > 0) {
          const text = await page.locator('.guide-example').innerText()
          await page.locator('.driver-popover-prev-btn').click()
          await assertStep(page, index - 1)
          await page.locator('.driver-popover-next-btn').click()
          await assertStep(page, index)
          assert.equal(await page.locator('.guide-example').innerText(), text, `Back did not restore step ${index}`)
        }
        await page.locator('.driver-popover-next-btn').click()
      }
      await expect(page.locator('.driver-popover')).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Xem lại từ đầu' })).toBeFocused()
      for (let index = 0; index < count; index++) {
        await page.getByRole('button', { name: 'Xem lại từ đầu' }).click()
        for (let current = 0; current < index; current++) {
          await assertStep(page, current)
          await page.keyboard.press('ArrowRight')
        }
        await assertStep(page, index)
        await page.locator('.driver-popover-close-btn').click()
        await expect(page.locator('.driver-popover')).toHaveCount(0)
        await expect(page.locator('[data-slot="dialog-content"]')).toHaveCount(0)
      }
      await page.getByRole('button', { name: 'Xem lại từ đầu' }).click()
      await assertStep(page, 0)
      await page.keyboard.press('ArrowRight')
      await assertStep(page, 1)
      await page.keyboard.press('ArrowLeft')
      await assertStep(page, 0)
      await page.keyboard.press('Escape')
      await expect(page.locator('.driver-popover')).toHaveCount(0)
      await page.getByRole('button', { name: 'Xem lại từ đầu' }).click()
      for (let index = 0; index < 6; index++) {
        await assertStep(page, index)
        await page.locator('.driver-popover-next-btn').click()
      }
      await assertStep(page, 6)
      await page.screenshot({ path: `/private/tmp/referee-guide-${width}.png`, fullPage: true })
      await page.reload()
      await expect(page.locator('.guide-example')).toHaveAttribute('data-step', 'closed')
      await expect(page.locator('.driver-popover')).toHaveCount(0)
      const storage = await page.evaluate(() => ({ ...localStorage }))
      assert.deepEqual(storage, seed)
      assert.deepEqual(accesses, [])
    }
    await assertPairDraftReset(page)
    assert.deepEqual(errors, [])
    assert.deepEqual(requests, [])
    console.log(`Guide ${width}px: both routes, all steps, Back/Close/Restart, keyboard, isolation, and reload passed`)
    await context.close()
  }
} finally {
  await browser.close()
}
