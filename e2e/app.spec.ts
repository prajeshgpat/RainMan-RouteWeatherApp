import { expect, test } from "./support/test"
import { pick, searchSfToLa, waitForRoute } from "./support/app"

const SVG_ICON = "%3Csvg"

// Number of weather markers (not the A/B pins) currently on the fake map
const weatherMarkers = (page: import("@playwright/test").Page) =>
  page.evaluate(
    () =>
      (window as any).__markers.filter(
        (m: any) => m.map && m.o.icon && m.o.icon.url && m.o.icon.scaledSize.width > 40
      ).length
  )

test.describe("route search", () => {
  test("searching a route shows the time bar, markers and route chips from ONE weather request", async ({
    open,
  }) => {
    const { page, calls } = await open()
    await searchSfToLa(page)

    await expect(page.locator("#time-bar")).toBeVisible()
    expect(await page.locator(".tb-seg").count()).toBeGreaterThan(30)
    expect(await weatherMarkers(page)).toBeGreaterThanOrEqual(9)
    expect(await page.evaluate(() => (window as any).__routeReq.provideRouteAlternatives)).toBe(
      true
    )

    // the three alternatives share one batched Open-Meteo request
    expect(calls.wx).toHaveLength(1)
    const cells = calls.wx[0].split("latitude=")[1].split("&")[0].split(",")
    expect(cells.length).toBeGreaterThan(9)
    expect(calls.wx[0]).toContain("hourly=temperature_2m,precipitation_probability,weather_code")
    // the backend is probed first; it is not deployed here, so the app fell back to Open-Meteo
    expect(calls.api.length).toBeGreaterThanOrEqual(1)
    expect(calls.pageErrors).toEqual([])

    const title = await page.textContent("#tb-title")
    expect(title).toMatch(/^Best time to leave: /)
  })

  test("a single route shows no route chips", async ({ open }) => {
    const { page } = await open({ oneRoute: true })
    await searchSfToLa(page)
    await expect(page.locator("#route-chips")).toBeHidden()
  })

  test("typed text with no picked suggestion is routed as an address", async ({ open }) => {
    const { page } = await open()
    await page.fill("#search-input", "Fresno, CA")
    await page.fill("#destination-input", "Los Angeles, CA")
    await page.evaluate(() => (window as any).__ac[1].h.forEach((f: () => void) => f()))
    await waitForRoute(page)
    expect(await page.evaluate(() => (window as any).__routeReq.origin)).toBe("Fresno, CA")
  })
})

test.describe("weather cache", () => {
  test("swapping start and destination makes no new weather calls (cache hit)", async ({
    open,
  }) => {
    const { page, calls } = await open()
    await searchSfToLa(page)
    expect(calls.wx).toHaveLength(1)
    const nws = calls.nws.length

    await page.click("#swap-button")
    await expect(page.locator("#search-input")).toHaveValue("Los Angeles, CA, USA")
    await waitForRoute(page)
    await page.waitForTimeout(300)
    expect(calls.wx).toHaveLength(1)
    expect(calls.nws.length - nws).toBeLessThanOrEqual(8) // cells are cached in sessionStorage
    expect(
      await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("wx:")).length)
    ).toBeGreaterThan(5)
  })
})

test.describe("time bar", () => {
  test("choosing a departure repaints the markers and updates the link", async ({ open }) => {
    const { page } = await open()
    await searchSfToLa(page)

    const before = await page.evaluate(() =>
      (window as any).__markers
        .filter((m: any) => m.o.icon && m.o.icon.scaledSize.width > 40)
        .map((m: any) => m.o.icon.url)
        .join("|")
    )
    const bad = page.locator(".tb-seg.bad").first()
    await expect(bad).toBeVisible()
    await bad.click()
    await expect(bad).toHaveAttribute("aria-pressed", "true")
    await expect(page.locator(".tb-seg[aria-pressed=true]")).toHaveCount(1)
    await expect(page.locator("#tb-sub")).toContainText("bad")

    const after = await page.evaluate(() =>
      (window as any).__markers
        .filter((m: any) => m.o.icon && m.o.icon.scaledSize.width > 40)
        .map((m: any) => m.o.icon.url)
        .join("|")
    )
    expect(after).not.toBe(before)

    const leave = await page.evaluate(() => new URLSearchParams(location.search).get("leave"))
    expect(leave).toMatch(/^\d+$/)
    expect(Number(leave) % 3600000).toBe(0)

    // night departures are striped, the best window is starred
    expect(await page.locator(".tb-seg.night").count()).toBeGreaterThan(3)
    await expect(page.locator(".tb-seg.best-first .tb-block")).toHaveText("★")
    await expect(page.locator(".tb-legend")).toContainText("Night")
  })

  test("tapping a marker opens the weather popup, the close button hides it", async ({ open }) => {
    const { page } = await open()
    await searchSfToLa(page)
    await page.evaluate(() => {
      const m = (window as any).__markers.find(
        (x: any) => x.o.icon && x.o.icon.scaledSize.width > 40
      )
      m.handlers[0]()
    })
    await expect(page.locator("#weather-info-window")).toBeVisible()
    await expect(page.locator("#weather-info-summary")).toContainText("Arrive ~")
    await expect(page.locator("#weather-info-extra")).toContainText("Rain chance")
    await expect(page.locator("#weather-info-location")).not.toHaveText("Along your route")
    await page.click("#weather-info-close")
    await expect(page.locator("#weather-info-window")).toBeHidden()
  })
})

test.describe("alternative routes", () => {
  test("three chips; a drier route is suggested and switching needs no weather call", async ({
    open,
  }) => {
    const { page, calls } = await open()
    await searchSfToLa(page)

    const chips = await page.locator(".rc-chip").allTextContents()
    expect(chips).toHaveLength(3)
    expect(chips[0]).toMatch(/^Via I-5 · 6h · (Good|Okay|Bad)$/)
    expect(chips[1]).toMatch(/^Via CA-99 · 6h 8m/)
    expect(chips[2]).toMatch(/^Via US-101 · 7h 20m/)

    // walk the departures until one makes the hint appear
    const count = await page.locator(".tb-seg").count()
    let shown = false
    for (let i = 0; i < count && !shown; i++) {
      await page.locator(".tb-seg").nth(i).click()
      shown = await page.locator("#rc-hint").isVisible()
    }
    expect(shown).toBe(true)
    await expect(page.locator("#rc-hint")).toHaveText(
      /^Drier route via (CA-99|US-101) \([+−]?\d+ min\)$/
    )

    await page.locator(".rc-chip").nth(1).click()
    await expect(page.locator(".rc-chip.active")).toContainText("CA-99")
    expect(await page.evaluate(() => (window as any).__routeIndexCalls)).toContain(1)
    expect(calls.wx).toHaveLength(1)
  })

  test("the hint button switches to the suggested route", async ({ open }) => {
    const { page } = await open()
    await searchSfToLa(page)
    const count = await page.locator(".tb-seg").count()
    for (let i = 0; i < count; i++) {
      await page.locator(".tb-seg").nth(i).click()
      if (await page.locator("#rc-hint").isVisible()) break
    }
    const text = (await page.textContent("#rc-hint")) as string
    const name = (text.match(/via (\S+)/) as RegExpMatchArray)[1]
    await page.click("#rc-hint")
    await expect(page.locator(".rc-chip.active")).toContainText(name)
  })
})

test.describe("severe weather alerts", () => {
  test("a banner lists deduplicated alerts, expands and can be dismissed", async ({ open }) => {
    const { page, calls } = await open()
    await searchSfToLa(page)
    await expect(page.locator("#alert-banner")).toBeVisible()

    expect(calls.nws.length).toBeGreaterThanOrEqual(1)
    expect(calls.nws.length).toBeLessThanOrEqual(8)
    expect(calls.nws[0]).toMatch(/point=\d+\.\d{4},-\d+\.\d{4}$/)

    await expect(page.locator("#alert-banner")).toHaveClass(/red/)
    await expect(page.locator(".ab-text")).toContainText("Flood Warning")
    const more = Number(((await page.textContent(".ab-more")) as string).replace("+", ""))
    await page.click(".ab-main")
    await expect(page.locator(".ab-main")).toHaveAttribute("aria-expanded", "true")
    await expect(page.locator(".ab-item")).toHaveCount(1 + more)
    await page.click(".ab-main")

    await page.click(".ab-close")
    await expect(page.locator("#alert-banner")).toBeHidden()
  })
})

test.describe("shareable links", () => {
  test("the address bar follows the route and a shared link restores trip and departure", async ({
    open,
  }) => {
    const { page } = await open()
    await searchSfToLa(page)
    await page.locator(".tb-seg").nth(5).click()
    const search = await page.evaluate(() => location.search)
    expect(search).toMatch(
      /^\?from=San\+Francisco%2C\+CA%2C\+USA&to=Los\+Angeles%2C\+CA%2C\+USA&leave=\d{12,13}$/
    )

    await page.click("#share-button")
    await expect(page.locator("#toast")).toContainText("copied")
    const url = await page.evaluate(() => navigator.clipboard.readText())
    expect(url).toContain(search)

    const second = await open({ url })
    await waitForRoute(second.page)
    await expect(second.page.locator("#search-input")).toHaveValue("San Francisco, CA, USA")
    await expect(second.page.locator("#destination-input")).toHaveValue("Los Angeles, CA, USA")
    const restored = await second.page.evaluate(() =>
      new URLSearchParams(location.search).get("leave")
    )
    expect(restored).toBe(new URLSearchParams(search).get("leave"))
    await expect(second.page.locator(".tb-seg[aria-pressed=true]")).toHaveCount(1)
    expect(await second.page.locator(".tb-seg").nth(5).getAttribute("aria-pressed")).toBe("true")
  })

  test("from=current without location permission shows a hint and no error", async ({ open }) => {
    const { page, calls } = await open({ url: "/?from=current&to=Reno" })
    await expect(page.locator("#toast")).toContainText("Allow location")
    expect(calls.pageErrors).toEqual([])
  })

  test("a share link starting at the current location routes once it is known", async ({
    open,
  }) => {
    const { page } = await open({
      url: "/?from=current&to=Los%20Angeles",
      geolocation: { lat: 37.7749, lng: -122.4194 },
    })
    await waitForRoute(page)
    await expect(page.locator("#search-input")).toHaveValue("Current location")
  })
})

test.describe("recent trips", () => {
  test("chips appear after a search, route again on tap and can be removed", async ({ open }) => {
    const { page } = await open()
    await searchSfToLa(page)
    await page.click("#clear-button")
    await expect(page.locator(".recent-chip")).toHaveCount(1)
    await expect(page.locator(".recent-pick")).toHaveText("San Francisco → Los Angeles")

    await page.locator(".recent-pick").click()
    await waitForRoute(page)
    await expect(page.locator("#destination-input")).toHaveValue("Los Angeles, CA, USA")

    await page.click("#clear-button")
    await page.locator(".recent-del").click()
    await expect(page.locator(".recent-chip")).toHaveCount(0)
  })
})

test.describe("temperature unit", () => {
  test("the °C toggle converts markers and the popup, and is remembered", async ({ open }) => {
    const { page } = await open()
    await searchSfToLa(page)
    const pill = () =>
      page.evaluate(() => {
        const m = (window as any).__markers.find(
          (x: any) => x.o.icon && x.o.icon.scaledSize.width > 40
        )
        return Number(decodeURIComponent(m.o.icon.url).match(/>(-?\d+)°</)![1])
      })
    const f = await pill()
    await page.click("#unit-toggle")
    const c = await pill()
    expect(c).not.toBe(f)
    expect(Math.abs(Math.round(((f - 32) * 5) / 9) - c)).toBeLessThanOrEqual(1)
    expect(await page.evaluate(() => localStorage.getItem("rm:unit"))).toBe('"C"')
    await expect(page.locator("#unit-toggle .unit-opt.active")).toHaveText("°C")

    await page.evaluate(() => {
      const m = (window as any).__markers.find(
        (x: any) => x.o.icon && x.o.icon.scaledSize.width > 40
      )
      m.handlers[0]()
    })
    await expect(page.locator("#weather-info-summary")).toContainText("°C")

    await page.reload()
    await expect(page.locator("#unit-toggle .unit-opt.active")).toHaveText("°C")
    await page.click("#unit-toggle")
    await expect(page.locator("#unit-toggle .unit-opt.active")).toHaveText("°F")
  })
})

test.describe("dark mode", () => {
  test("follows the system setting: page colours and the map's night style", async ({ open }) => {
    const dark = await open({ scheme: "dark" })
    expect(await dark.page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
      "rgb(17, 22, 29)"
    )
    expect(
      await dark.page.evaluate(() => {
        const s = (window as any).__mapStyles
        return Array.isArray(s) && s.length > 10
      })
    ).toBe(true)

    const light = await open({ scheme: "light" })
    expect(await light.page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
      "rgb(255, 255, 255)"
    )
    expect(await light.page.evaluate(() => !(window as any).__mapStyles)).toBe(true)

    // switching the system setting while the app is open restyles the map
    await light.page.emulateMedia({ colorScheme: "dark" })
    await light.page.waitForFunction(() => (window as any).__styleCalls >= 1)
    expect(await light.page.evaluate(() => (window as any).__mapStyles.length > 10)).toBe(true)
  })
})

test.describe("marker declutter", () => {
  // Screen position of a marker at the map's current zoom, like the app computes it
  async function visibleSpacing(page: import("@playwright/test").Page) {
    return page.evaluate(() => {
      const w = window as any
      const scale = Math.pow(2, w.__map.zoom)
      const proj = w.__map.getProjection()
      const pts = w.__markers
        .filter(
          (m: any) => m.o.icon && m.o.icon.scaledSize.width > 40 && m.visible !== false && m.map
        )
        .map((m: any) => proj.fromLatLngToPoint(m.o.position))
        .map((p: any) => ({ x: p.x * scale, y: p.y * scale }))
      let min = Infinity
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const dx = Math.abs(pts[i].x - pts[j].x)
          const dy = Math.abs(pts[i].y - pts[j].y)
          min = Math.min(min, Math.max(dx, (dy * 56) / 64))
        }
      }
      return { shown: pts.length, min }
    })
  }

  test("zooming out hides overlapping markers, zooming in shows them, the open one stays", async ({
    open,
  }) => {
    const { page } = await open({ width: 1280, height: 800 })
    await searchSfToLa(page)
    const total = await weatherMarkers(page)

    await page.evaluate(() => {
      const w = window as any
      w.__map.zoom = 6
      w.__map.__fire("idle")
    })
    const far = await visibleSpacing(page)
    expect(far.shown).toBeGreaterThanOrEqual(1)
    expect(far.shown).toBeLessThan(total)
    expect(far.min).toBeGreaterThanOrEqual(55.9)

    await page.evaluate(() => {
      const w = window as any
      w.__map.zoom = 10
      w.__map.__fire("idle")
    })
    const near = await visibleSpacing(page)
    expect(near.shown).toBeGreaterThan(far.shown)

    // open a marker, zoom out: it is kept
    const kept = await page.evaluate(() => {
      const w = window as any
      const markers = w.__markers.filter((m: any) => m.o.icon && m.o.icon.scaledSize.width > 40)
      const m = markers[Math.floor(markers.length / 2)]
      m.handlers[0]()
      w.__map.zoom = 6
      w.__map.__fire("idle")
      return m.visible
    })
    expect(kept).toBe(true)
  })
})

test.describe("rain radar", () => {
  test("toggles the RainViewer overlay with its credit", async ({ open }) => {
    const { page, calls } = await open()
    await page.click("#radar-button")
    await page.waitForFunction(() => (window as any).__map.overlayMapTypes.getLength() === 1)
    await expect(page.locator("#radar-credit")).toBeVisible()
    await expect(page.locator("#radar-button")).toHaveAttribute("aria-pressed", "true")
    expect(calls.radar).toHaveLength(1)
    const tiles = await page.evaluate(() => {
      const t = (window as any).__imt
      return [t.o.getTileUrl({ x: 10, y: 24 }, 6), t.o.getTileUrl({ x: 1, y: 1 }, 9), t.o.opacity]
    })
    expect(tiles).toEqual([
      "https://tilecache.rainviewer.com/v2/radar/2/256/6/10/24/2/1_1.png",
      null,
      0.6,
    ])
    await page.click("#radar-button")
    expect(await page.evaluate(() => (window as any).__map.overlayMapTypes.getLength())).toBe(0)
    await expect(page.locator("#radar-credit")).toBeHidden()
  })

  test("a RainViewer failure disables the button and says so", async ({ open }) => {
    const { page } = await open({ radarFail: true })
    await page.click("#radar-button")
    await expect(page.locator("#radar-button")).toBeDisabled()
    await expect(page.locator("#toast")).toContainText("Rain radar is unavailable")
  })
})

test.describe("backend (/api)", () => {
  test("when the backend answers, the weather comes from /api/forecast and Open-Meteo is not called", async ({
    open,
  }) => {
    const { page, calls } = await open({ backend: "up" })
    await searchSfToLa(page)
    expect(calls.wx).toHaveLength(0)
    const forecast = calls.api.filter((u) => u.includes("/api/forecast"))
    expect(forecast).toHaveLength(1)
    expect(forecast[0]).toMatch(/pts=37\.\d,-122\.\d;/)
    expect(calls.api.some((u) => u.includes("/api/alerts"))).toBe(true)
    expect(calls.nws).toHaveLength(0)
    expect(await weatherMarkers(page)).toBeGreaterThanOrEqual(9)
  })

  test("a missing backend (404) is remembered: one probe, then Open-Meteo directly", async ({
    open,
  }) => {
    const { page, calls } = await open({ backend: "missing" })
    await searchSfToLa(page)
    expect(calls.api).toHaveLength(1)
    expect(calls.wx).toHaveLength(1)
    expect(await page.evaluate(() => sessionStorage.getItem("rm:api"))).toBe('"direct"')
    await page.click("#swap-button")
    await waitForRoute(page)
    expect(calls.api).toHaveLength(1) // not probed again this session
  })

  test("an HTML page where JSON should be (a SPA fallback) also falls back", async ({ open }) => {
    const { page, calls } = await open({ backend: "html" })
    await searchSfToLa(page)
    expect(calls.wx).toHaveLength(1)
    expect(await weatherMarkers(page)).toBeGreaterThanOrEqual(9)
  })
})

test("marker images are SVG data URIs", async ({ open }) => {
  const { page } = await open()
  await searchSfToLa(page)
  const ok = await page.evaluate(
    (marker) =>
      (window as any).__markers
        .filter((m: any) => m.o.icon && m.o.icon.url)
        .every(
          (m: any) => m.o.icon.url.startsWith("data:image/svg+xml") && m.o.icon.url.includes(marker)
        ),
    SVG_ICON
  )
  expect(ok).toBe(true)
})

test("two picks are enough: picking only the destination asks for a start", async ({ open }) => {
  const { page } = await open()
  await pick(page, 1, "Los Angeles, CA, USA", 34.0522, -118.2437)
  await expect(page.locator("#toast")).toContainText("starting point")
})
