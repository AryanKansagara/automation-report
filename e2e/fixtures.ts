import { test as base, expect, type Page } from '@playwright/test'

// Hosts the page may try to reach and we deliberately fail: web fonts only. Anything else
// (Supabase, the Hugging Face model CDN, ...) means the app reached out when it should not have.
const ALLOWED_BLOCKED = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//

export const test = base.extend<{ blocked: string[]; guard: void }>({
  blocked: async ({ context }, use) => {
    const blocked: string[] = []
    // Local requests pass. Everything else is aborted, so tests run signed out with no network.
    await context.route(url => !/^http:\/\/localhost:/.test(url.href) && url.protocol !== 'data:' && url.protocol !== 'blob:', route => {
      blocked.push(route.request().url())
      return route.abort()
    })
    await use(blocked)
  },
  // Runs for every test: no uncaught page errors, and no request left the machine except
  // for web fonts (so Supabase and model downloads stayed blocked and unused).
  guard: [async ({ page, blocked }, use) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    await use()
    expect(errors, 'uncaught page errors').toEqual([])
    expect(blocked.filter(u => !ALLOWED_BLOCKED.test(u)), 'unexpected external requests').toEqual([])
  }, { auto: true }],
})

export { expect }

/** Builds the precomputed sample project (no model download) and waits for its overview. */
export async function openSample(page: Page) {
  await page.goto('/app?sample=1')
  await page.waitForURL(/\/app\/p\/[^/]+$/, { timeout: 60_000 })
  await expect(page.getByRole('heading', { name: /Northwind Outfitters/ })).toBeVisible()
  await expect(page.getByText('Intent map')).toBeVisible()
}
