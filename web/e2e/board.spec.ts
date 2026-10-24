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
  await expect(page.getByTestId('status-banner')).toHaveCount(0)
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

async function drag(page: import('@playwright/test').Page, from: string, toCell: number) {
  const source = await tile(page, from).boundingBox()
  const target = await page.locator(`[data-cell="${toCell}"]`).boundingBox()
  if (!source || !target) throw new Error('missing element')
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2)
  await page.mouse.down()
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 12 })
  await page.mouse.up()
}

test('dragging a tile moves it, swaps, survives a reload and does not focus', async ({ page, request }) => {
  await page.goto('/')
  await expect(tile(page, 'infra')).toBeVisible()
  const focusedBefore = ((await (await request.get('/api/fake/focused')).json()) as string[]).length

  await drag(page, 'infra', 5)
  await expect(page.locator('[data-cell="5"]').getByTestId('tile')).toHaveAttribute('data-session', 'infra')

  await drag(page, 'billing', 5)
  await expect(page.locator('[data-cell="5"]').getByTestId('tile')).toHaveAttribute('data-session', 'billing')
  await expect(page.locator('[data-cell="0"]').getByTestId('tile')).toHaveAttribute('data-session', 'infra')

  await page.reload()
  await expect(page.locator('[data-cell="5"]').getByTestId('tile')).toHaveAttribute('data-session', 'billing')
  const focusedAfter = ((await (await request.get('/api/fake/focused')).json()) as string[]).length
  expect(focusedAfter).toBe(focusedBefore)
})

test('grid size changes reflow the tiles', async ({ page, request }) => {
  await page.goto('/')
  await expect(page.getByTestId('cell')).toHaveCount(6)
  const r = await request.post('/api/grid', { data: { columns: 2, rows: 2 }, headers: ORIGIN })
  expect(await r.json()).toEqual({ columns: 2, rows: 3 }) // cell 5 is occupied
  await expect(page.getByTestId('cell')).toHaveCount(6)
  await request.post('/api/grid', { data: { columns: 3, rows: 2 }, headers: ORIGIN })
  await expect(page.getByTestId('cell')).toHaveCount(6)
})

async function openMenu(page: import('@playwright/test').Page, target: import('@playwright/test').Locator) {
  await target.click({ button: 'right' })
  const menu = page.getByTestId('cell-menu')
  await expect(menu).toBeVisible()
  return menu
}

/**
 * Move the mouse to an element along a path, as a pointer does. Radix closes a submenu that
 * opened to the left when the pointer jumps into it in one step.
 */
async function pointTo(page: import('@playwright/test').Page, target: import('@playwright/test').Locator) {
  const box = await target.boundingBox()
  if (!box) throw new Error('missing element')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 20 })
}

/** The cell element of the last empty cell, and its index. */
async function lastEmptyCell(page: import('@playwright/test').Page) {
  const cell = page.getByTestId('cell').filter({ has: page.getByTestId('empty-cell') }).last()
  return { cell, index: Number(await cell.getAttribute('data-cell')) }
}

test('acknowledge mutes a waiting tile until its state changes', async ({ page, request }) => {
  await fake(request, '/sessions/e2e-ack', { fields: { name: 'e2e-ack', state: 'waiting', reason: 'done' } })
  await page.goto('/')
  await expect(tile(page, 'e2e-ack')).toHaveAttribute('data-tone', 'wait')
  await (await openMenu(page, tile(page, 'e2e-ack'))).getByRole('menuitem', { name: 'Acknowledge' }).click()
  await expect(tile(page, 'e2e-ack')).toHaveAttribute('data-tone', 'acked')
  await fake(request, '/sessions/e2e-ack', { fields: { state: 'waiting', reason: 'permission' } })
  await expect(tile(page, 'e2e-ack')).toHaveAttribute('data-tone', 'wait')
  await fake(request, '/sessions/e2e-ack/remove')
})

test('rename and description are set in dialogs, saved, and cleared back', async ({ page }) => {
  await page.goto('/')
  const docs = tile(page, 'docs')
  await (await openMenu(page, docs)).getByRole('menuitem', { name: 'Rename…' }).click()
  const name = page.getByRole('textbox', { name: 'Rename tile' })
  await expect(name).toBeFocused()
  await name.fill('Docs site')
  await name.press('Enter')
  await expect(page.getByTestId('dialog')).toHaveCount(0)
  await expect(docs.locator('.tile-name')).toHaveText('Docs site')

  await (await openMenu(page, docs)).getByRole('menuitem', { name: 'Edit description…' }).click()
  await page.getByRole('textbox', { name: 'Tile description' }).fill('migrating to the new theme')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(docs.locator('.tile-subtitle')).toHaveText('migrating to the new theme')

  await page.reload()
  await expect(docs.locator('.tile-name')).toHaveText('Docs site')
  await (await openMenu(page, docs)).getByRole('menuitem', { name: 'Rename…' }).click()
  await page.getByRole('textbox', { name: 'Rename tile' }).fill('')
  await page.keyboard.press('Enter')
  await expect(docs.locator('.tile-name')).toHaveText('docs')
  await (await openMenu(page, docs)).getByRole('menuitem', { name: 'Edit description…' }).click()
  await page.getByRole('textbox', { name: 'Tile description' }).fill('')
  await page.keyboard.press('Enter')
  await expect(docs.locator('.tile-subtitle')).toHaveText('/work/docs')
})

test('hide frees the cell; show hidden puts the tile in the cell right-clicked', async ({ page }) => {
  await page.goto('/')
  await (await openMenu(page, tile(page, 'infra'))).getByRole('menuitem', { name: 'Hide' }).click()
  await expect(tile(page, 'infra')).toHaveCount(0)

  const { cell, index } = await lastEmptyCell(page)
  const menu = await openMenu(page, cell)
  await menu.getByRole('menuitem', { name: /Show hidden \(1\)/ }).hover()
  await pointTo(page, page.getByRole('menuitem', { name: /infra/ }))
  await page.getByRole('menuitem', { name: /infra/ }).click()
  await expect(page.locator(`[data-cell="${index}"]`).getByTestId('tile')).toHaveAttribute('data-session', 'infra')
})

test('the grid size is set from the empty-cell menu', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('cell')).toHaveCount(6)
  let menu = await openMenu(page, (await lastEmptyCell(page)).cell)
  await menu.getByRole('menuitem', { name: /Grid size/ }).hover()
  await pointTo(page, page.getByRole('menuitemradio', { name: '4 × 2' }))
  await page.getByRole('menuitemradio', { name: '4 × 2' }).click()
  await expect(page.getByTestId('cell')).toHaveCount(8)

  menu = await openMenu(page, (await lastEmptyCell(page)).cell)
  await menu.getByRole('menuitem', { name: /Grid size/ }).hover()
  await expect(page.getByRole('menuitemradio', { name: '4 × 2' })).toHaveAttribute('aria-checked', 'true')
  await pointTo(page, page.getByRole('menuitem', { name: 'Custom…' }))
  await page.getByRole('menuitem', { name: 'Custom…' }).click()
  const columns = page.getByRole('spinbutton', { name: 'Columns' })
  await expect(columns).toBeFocused()
  await columns.fill('3')
  await page.getByRole('spinbutton', { name: 'Rows' }).fill('2')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('cell')).toHaveCount(6)
})

test('copy the project path; remove an ended tile', async ({ page, context, request }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/')
  await (await openMenu(page, tile(page, 'auth'))).getByRole('menuitem', { name: 'Copy project path' }).click()
  await expect(page.getByTestId('notice')).toHaveText('Copied /work/auth')
  expect(await page.evaluate('navigator.clipboard.readText()')).toBe('/work/auth')

  await fake(request, '/sessions/e2e-end', { fields: { name: 'e2e-end', state: 'running' } })
  await expect(tile(page, 'e2e-end')).toBeVisible()
  let menu = await openMenu(page, tile(page, 'e2e-end'))
  await expect(menu.getByRole('menuitem', { name: 'Remove' })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await fake(request, '/sessions/e2e-end', { fields: { state: 'ended' } })
  await expect(tile(page, 'e2e-end')).toHaveAttribute('data-tone', 'off')
  menu = await openMenu(page, tile(page, 'e2e-end'))
  await menu.getByRole('menuitem', { name: 'Remove' }).click()
  await expect(tile(page, 'e2e-end')).toHaveCount(0)
  await fake(request, '/sessions/e2e-end/remove')
})
