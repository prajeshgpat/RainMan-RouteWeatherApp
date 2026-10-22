// Opens RainMan in a browser context with every external service mocked: the Google Maps
// script is replaced by a fake, and Open-Meteo, NWS, RainViewer and the /api backend answer
// from page.route handlers. Requests are recorded in `calls`.

import type { Browser, BrowserContext, Page } from "@playwright/test"
import { normalizeResponse } from "../../shared/weather"
import { FAKE_GOOGLE_JS } from "./fakeGoogle"
import { nwsBody, openMeteoBody } from "./mockData"

export const BASE_URL = "http://localhost:4173"

export interface OpenOptions {
  width?: number
  height?: number
  scheme?: "light" | "dark"
  url?: string // path or URL to open, default "/"
  serviceWorker?: boolean
  radarFail?: boolean
  // "missing": /api answers 404 like Hosting without the function; "up": the backend answers;
  // "html": /api answers 200 with an HTML page
  backend?: "missing" | "up" | "html"
  geolocation?: { lat: number; lng: number } | null
  oneRoute?: boolean
}

export interface Calls {
  wx: string[] // Open-Meteo requests
  nws: string[] // api.weather.gov requests
  radar: string[]
  api: string[] // /api/** requests
  pageErrors: string[]
}

export interface App {
  ctx: BrowserContext
  page: Page
  calls: Calls
}

// Waits until the route is drawn: the time bar is shown and the weather markers are painted
export async function waitForRoute(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const w = window as any
      return (
        !(document.getElementById("time-bar") as HTMLElement).hidden &&
        document.querySelectorAll(".tb-seg").length > 10 &&
        w.__markers.filter(
          (m: any) => m.map && m.o.icon && m.o.icon.url && m.o.icon.url.includes("%3Csvg")
        ).length >= 9
      )
    },
    undefined,
    { timeout: 15000 }
  )
}

// Choose a place in the start (0) or destination (1) autocomplete, like picking a suggestion
export async function pick(
  page: Page,
  which: 0 | 1,
  text: string,
  lat: number,
  lng: number
): Promise<void> {
  await page.evaluate(
    ([which, text, lat, lng]) => {
      const w = window as any
      const ac = w.__ac[which as number]
      ac.input.value = text
      ac.place = { geometry: { location: new w.google.maps.LatLng(lat, lng) }, name: text }
      ac.h.forEach((f: () => void) => f())
    },
    [which, text, lat, lng] as const
  )
}

export async function searchSfToLa(page: Page): Promise<void> {
  await pick(page, 0, "San Francisco, CA, USA", 37.7749, -122.4194)
  await pick(page, 1, "Los Angeles, CA, USA", 34.0522, -118.2437)
  await waitForRoute(page)
}

export async function openApp(browser: Browser, opts: OpenOptions = {}): Promise<App> {
  const ctx = await browser.newContext({
    baseURL: BASE_URL,
    viewport: { width: opts.width ?? 390, height: opts.height ?? 844 },
    colorScheme: opts.scheme ?? "light",
    permissions: ["clipboard-read", "clipboard-write"],
    serviceWorkers: opts.serviceWorker ? "allow" : "block",
  })
  const page = await ctx.newPage()
  const calls: Calls = { wx: [], nws: [], radar: [], api: [], pageErrors: [] }
  page.on("pageerror", (e) => calls.pageErrors.push(String(e)))

  await page.addInitScript(
    ([geo, oneRoute]) => {
      const w = window as any
      w.__oneRoute = oneRoute
      w.__csp = []
      document.addEventListener("securitypolicyviolation", (e) => {
        w.__csp.push(e.violatedDirective + " " + e.blockedURI)
      })
      Object.defineProperty(navigator, "geolocation", {
        value: {
          getCurrentPosition(ok: (p: unknown) => void, err: (e: unknown) => void) {
            if (geo) ok({ coords: { latitude: geo.lat, longitude: geo.lng } })
            else err({})
          },
        },
        configurable: true,
      })
    },
    [opts.geolocation ?? null, !!opts.oneRoute] as const
  )

  // The map, fonts and icon CSS come from the network in production; here they are faked or dropped
  await page.route(/maps\.googleapis\.com\/maps\/api\/js/, (route) =>
    route.fulfill({ status: 200, contentType: "text/javascript", body: FAKE_GOOGLE_JS })
  )
  await page.route(/fonts\.(googleapis|gstatic)\.com|cdnjs\.cloudflare\.com/, (route) =>
    route.abort()
  )

  await page.route(/api\.open-meteo\.com/, (route) => {
    const url = route.request().url()
    calls.wx.push(url)
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(openMeteoBody(url, Date.now())),
    })
  })
  await page.route(/api\.weather\.gov/, (route) => {
    const url = route.request().url()
    calls.nws.push(url)
    const m = url.match(/point=([-\d.]+),([-\d.]+)/)
    return route.fulfill({
      status: 200,
      contentType: "application/geo+json",
      body: JSON.stringify(nwsBody(m ? Number(m[2]) : 0)),
    })
  })
  await page.route(/api\.rainviewer\.com/, (route) => {
    calls.radar.push(route.request().url())
    if (opts.radarFail) return route.fulfill({ status: 503, body: "no" })
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        host: "https://tilecache.rainviewer.com",
        radar: { past: [{ path: "/v2/radar/1" }, { path: "/v2/radar/2" }] },
      }),
    })
  })

  // The backend: `vite preview` answers /api/** with a real 404, like Hosting without a function
  await page.route(/localhost:\d+\/api\//, (route) => {
    const url = route.request().url()
    calls.api.push(url)
    const mode = opts.backend ?? "missing"
    if (mode === "missing") {
      return route.fulfill({ status: 404, contentType: "text/html", body: "Not found" })
    }
    if (mode === "html") {
      return route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><title>x",
      })
    }
    const parsed = new URL(url)
    const pts = (parsed.searchParams.get("pts") || "")
      .split(";")
      .map((p) => p.split(",").map(Number))
    const now = Date.now()
    if (parsed.pathname === "/api/forecast") {
      const lists = pts.map(([lat, lng]) => {
        const mock = openMeteoBody("https://x/?latitude=" + lat + "&longitude=" + lng, now)
        return normalizeResponse(mock, now)[0]
      })
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ generatedAt: new Date(now).toISOString(), hourly: lists }),
      })
    }
    // /api/alerts
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        alerts: [],
        points: pts.map(([lat, lng]) => ({ lat, lng, alerts: [] })),
      }),
    })
  })

  await page.goto(opts.url ?? "/")
  await page.waitForFunction(() => (window as any).__mapsReady === true)
  await page.waitForFunction(() => (window as any).__ac?.length === 2)
  return { ctx, page, calls }
}
