import { type APIRequestContext, expect, test } from '@playwright/test'

const ORIGIN = { origin: 'http://127.0.0.1:7791' }

async function fake(request: APIRequestContext, path: string, data: unknown = {}) {
  const r = await request.post(`/api/fake${path}`, { data, headers: ORIGIN })
  expect(r.ok()).toBe(true)
}

function tile(page: import('@playwright/test').Page, sessionId: string) {
  return page.locator(`[data-testid="tile"][data-session="${sessionId}"]`)
}

test('shows the demo sessions with their states', async ({ page }) => {
  await page.goto('/')
  await expect(tile(page, 'billing')).toHaveAttribute('data-tone', 'run')
  await expect(tile(page, 'billing').getByTestId('activity')).toBeVisible()
  await expect(tile(page, 'auth')).toHaveAttribute('data-tone', 'wait')
  await expect(tile(page, 'auth')).toContainText('permission')
  await expect(tile(page, 'auth')).toContainText('asking to use Edit')
  await expect(tile(page, 'docs')).toContainText('done')
  await expect(tile(page, 'infra')).toHaveAttribute('data-tone', 'idle')
  await expect(page.getByRole('status')).toHaveCount(0)
})

test('a new session appears and a state change pulses', async ({ page, request }) => {
  await page.goto('/')
  await expect(tile(page, 'billing')).toBeVisible()
  await fake(request, '/sessions/e2e-new', { fields: { name: 'e2e-new', state: 'running' } })
  await expect(tile(page, 'e2e-new')).toHaveAttribute('data-tone', 'run')

  await fake(request, '/sessions/e2e-new', {
    fields: { state: 'waiting', reason: 'done', last_event_text: 'finished its turn' },
  })
  await expect(tile(page, 'e2e-new')).toHaveAttribute('data-tone', 'wait')
  await expect(tile(page, 'e2e-new').getByTestId('pulse')).toBeAttached()
  await expect(tile(page, 'e2e-new')).toContainText('finished its turn')

  await fake(request, '/sessions/e2e-new/remove')
  await expect(tile(page, 'e2e-new')).toHaveCount(0)
})

test('clicking a tile focuses its session', async ({ page, request }) => {
  await page.goto('/')
  await tile(page, 'docs').click()
  await expect
    .poll(async () => (await (await request.get('/api/fake/focused')).json()) as string[])
    .toContain('docs')
})

test('a failed focus shows on the tile', async ({ page, request }) => {
  await fake(request, '/focus-error', { message: 'session infra is not running in tmux' })
  await page.goto('/')
  await tile(page, 'infra').click()
  await expect(tile(page, 'infra').getByRole('alert')).toHaveText('session infra is not running in tmux')
  await fake(request, '/focus-error', { message: null })
})
