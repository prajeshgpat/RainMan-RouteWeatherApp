import { test as base, expect } from "@playwright/test"
import { openApp } from "./app"
import type { App, OpenOptions } from "./app"

// `open()` starts a fully mocked RainMan page; every page it opened is closed after the test
export const test = base.extend<{ open: (opts?: OpenOptions) => Promise<App> }>({
  open: async ({ browser }, use) => {
    const apps: App[] = []
    await use(async (opts) => {
      const app = await openApp(browser, opts)
      apps.push(app)
      return app
    })
    for (const app of apps) await app.ctx.close()
  },
})

export { expect }
