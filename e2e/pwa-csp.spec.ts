import { expect, test } from "./support/test"
import { BASE_URL, searchSfToLa } from "./support/app"

test.describe("content security policy", () => {
  test("the page is served with the Hosting CSP and the app works under it without violations", async ({
    open,
    request,
  }) => {
    const res = await request.get(BASE_URL + "/")
    const csp = res.headers()["content-security-policy"]
    expect(csp).toBeTruthy()
    expect(csp).toContain("script-src 'self'")
    expect(csp).toContain("api.open-meteo.com")

    const { page, calls } = await open()
    await searchSfToLa(page)
    await page.click("#radar-button")
    await page.waitForFunction(() => (window as any).__map.overlayMapTypes.getLength() === 1)
    await page.locator(".tb-seg").nth(4).click()
    await page.evaluate(() => {
      const m = (window as any).__markers.find(
        (x: any) => x.o.icon && x.o.icon.scaledSize.width > 40
      )
      m.handlers[0]()
    })
    await expect(page.locator("#weather-info-window")).toBeVisible()

    // no blocked script, style, image or connection
    expect(await page.evaluate(() => (window as any).__csp)).toEqual([])
    expect(calls.pageErrors).toEqual([])
    // the weather request is allowed by connect-src (it would have been blocked and fallen over)
    expect(calls.wx.length).toBeGreaterThanOrEqual(1)
  })

  test("a connection to a host outside the policy is blocked", async ({ open }) => {
    const { page } = await open()
    const blocked = await page.evaluate(() =>
      fetch("https://example.com/").then(
        () => false,
        () => true
      )
    )
    expect(blocked).toBe(true)
    expect(
      (await page.evaluate(() => (window as any).__csp)).some((v: string) =>
        v.startsWith("connect-src")
      )
    ).toBe(true)
  })

  test("static asset and worker headers", async ({ request }) => {
    const sw = await request.get(BASE_URL + "/sw.js")
    expect(sw.status()).toBe(200)
    const html = await request.get(BASE_URL + "/accuracy.html")
    expect(html.headers()["content-security-policy"]).toBeTruthy()
    const missing = await request.get(BASE_URL + "/api/forecast?pts=1,1")
    expect(missing.status()).toBe(404) // no SPA fallback: the app relies on a real 404
  })
})

test.describe("installable app", () => {
  test("the service worker precaches the build, the shell opens offline and nothing cross-origin is cached", async ({
    open,
  }) => {
    const { ctx, page } = await open({ serviceWorker: true })
    await page.evaluate(() => navigator.serviceWorker.ready)
    const info = await page.evaluate(async () => {
      const keys = await caches.keys()
      const cache = await caches.open(keys[0])
      const urls = (await cache.keys()).map((r) => new URL(r.url).pathname)
      return { keys, urls }
    })
    expect(info.keys[0]).toMatch(/^rainman-[0-9a-f]{12}$/)
    expect(info.urls).toContain("/")
    expect(info.urls).toContain("/index.html")
    expect(info.urls).toContain("/accuracy.html")
    expect(info.urls.some((u) => /^\/assets\/main-.+\.js$/.test(u))).toBe(true)
    expect(info.urls.some((u) => /^\/assets\/main-.+\.css$/.test(u))).toBe(true)
    expect(info.urls).toContain("/icons/rain.svg")
    expect(info.urls).toContain("/manifest.webmanifest")
    expect(info.urls.some((u) => u.startsWith("/data/") || u.startsWith("/api/"))).toBe(false)

    const manifest = await page.evaluate(() =>
      fetch((document.querySelector("link[rel=manifest]") as HTMLLinkElement).href).then((r) =>
        r.json()
      )
    )
    expect(manifest.name).toBe("RainMan")
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2)

    // reload so the page is controlled, then go offline
    await page.reload()
    await page.evaluate(() => navigator.serviceWorker.ready)
    await page.waitForFunction(() => !!navigator.serviceWorker.controller)
    await ctx.setOffline(true)
    await page.reload().catch(() => {})
    expect(await page.title()).toBe("RainMan")
    expect(await page.locator("#route-card").count()).toBe(1)

    const cross = await page.evaluate(async () => {
      const keys = await caches.keys()
      const cache = await caches.open(keys[0])
      return (await cache.keys()).filter((r) => !r.url.startsWith(location.origin)).length
    })
    expect(cross).toBe(0)
  })
})
