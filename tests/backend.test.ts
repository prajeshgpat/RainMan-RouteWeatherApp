import { test } from "vitest"
import assert from "node:assert/strict"
import { BackendClient, formatPoints } from "../src/weather/api"
import { loadForecasts, fetchDirect } from "../src/weather/forecast"
import { loadAlerts } from "../src/features/alerts"
import type { FetchResponse } from "../src/weather/forecast"
import type { StorageLike } from "../src/weather/cache"

function memoryStorage(): StorageLike {
  const m = new Map<string, string>()
  return {
    get length() {
      return m.size
    },
    key: (i) => Array.from(m.keys())[i] ?? null,
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => {
      m.set(k, String(v))
    },
    removeItem: (k) => {
      m.delete(k)
    },
  }
}

const reply = (status: number, body: unknown): FetchResponse => ({
  ok: status >= 200 && status < 300,
  status,
  json: () => Promise.resolve(body),
})

const NOW = Date.UTC(2026, 5, 1, 2, 30)
const entry = (hour: number, code = 0) => ({
  t: Date.UTC(2026, 5, 1, hour),
  temp: 60,
  pop: 0.1,
  wind: 5,
  gust: 9,
  code,
  isDay: true,
})
const hourly = (code = 0) => [entry(2, code), entry(3, code), entry(4, code)]

test("formatPoints writes lat,lng pairs with at most 4 decimals", () => {
  assert.strictEqual(
    formatPoints([
      { lat: 37.7749295, lng: -122.4194155 },
      { lat: 40, lng: -100.5 },
    ]),
    "37.7749,-122.4194;40,-100.5"
  )
})

test("the backend answers forecasts: one /api/forecast call, the Open-Meteo path is not used", async () => {
  const calls: string[] = []
  const client = new BackendClient((url) => {
    calls.push(url)
    return Promise.resolve(reply(200, { hourly: [hourly(61), hourly(63)] }))
  }, memoryStorage())
  const result = await client.forecasts([
    { lat: 37.8, lng: -122.4 },
    { lat: 38.5, lng: -121.5 },
  ])
  assert.deepStrictEqual(calls, ["/api/forecast?pts=37.8,-122.4;38.5,-121.5"])
  assert.strictEqual(result?.length, 2)
  assert.strictEqual(result?.[1][0].code, 63)
})

test("a 404 (no backend deployed), a network error or an HTML page switches to direct for the session", async () => {
  for (const make of [
    () => Promise.resolve(reply(404, {})),
    () => Promise.reject(new Error("offline")),
    () =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.reject(new SyntaxError("Unexpected token <")),
      }),
  ]) {
    const session = memoryStorage()
    let calls = 0
    const client = new BackendClient(() => {
      calls++
      return make()
    }, session)
    assert.strictEqual(await client.forecasts([{ lat: 1, lng: 1 }]), null)
    assert.strictEqual(client.usable, false)
    // remembered: no more backend calls, also in a new client sharing the session
    assert.strictEqual(await client.alerts([{ lat: 1, lng: 1 }]), null)
    assert.strictEqual(calls, 1)
    assert.strictEqual(new BackendClient(() => make(), session).usable, false)
  }
})

test("a 429 or 5xx falls back for that call only and keeps trying the backend", async () => {
  const statuses = [429, 503, 200]
  const client = new BackendClient(() => {
    const status = statuses.shift() as number
    return Promise.resolve(reply(status, { hourly: [hourly()] }))
  }, memoryStorage())
  assert.strictEqual(await client.forecasts([{ lat: 1, lng: 1 }]), null)
  assert.strictEqual(client.usable, true)
  assert.strictEqual(await client.forecasts([{ lat: 1, lng: 1 }]), null)
  assert.ok(await client.forecasts([{ lat: 1, lng: 1 }]))
})

test("a malformed backend body (wrong number of lists) is ignored", async () => {
  const client = new BackendClient(
    () => Promise.resolve(reply(200, { hourly: [hourly()] })),
    memoryStorage()
  )
  assert.strictEqual(
    await client.forecasts([
      { lat: 1, lng: 1 },
      { lat: 2, lng: 2 },
    ]),
    null
  )
})

test("loadForecasts uses a custom chunk fetcher and caches what it returns", async () => {
  const storage = memoryStorage()
  let chunks = 0
  const env = {
    fetch: () => Promise.reject(new Error("direct path must not run")),
    storage,
    now: () => NOW,
    fetchChunk: (points: unknown[]) => {
      chunks++
      return Promise.resolve(points.map((_, i) => hourly(61 + i)))
    },
  }
  const points = [
    { lat: 37.01, lng: -122.02 },
    { lat: 38.5, lng: -121.5 },
  ]
  const first = await loadForecasts(points, env)
  assert.strictEqual(first[1]?.[0].code, 62)
  await loadForecasts(points, env)
  assert.strictEqual(chunks, 1) // second call is served from the cache
})

test("fetchDirect asks Open-Meteo for all points in one request", async () => {
  const urls: string[] = []
  const lists = await fetchDirect(
    [
      { lat: 1, lng: 2 },
      { lat: 3, lng: 4 },
    ],
    (url) => {
      urls.push(url)
      return Promise.resolve(
        reply(200, [{ hourly: { time: [NOW / 1000] } }, { hourly: { time: [NOW / 1000] } }])
      )
    },
    NOW
  )
  assert.strictEqual(urls.length, 1)
  assert.ok(urls[0].includes("latitude=1,3&longitude=2,4"))
  assert.strictEqual(lists.length, 2)
})

const alert = (id: string, event: string) => ({
  id,
  event,
  areaDesc: "Fresno",
  severity: "Severe",
  level: "red" as const,
  headline: "",
})

test("loadAlerts asks the backend once for the uncached points and caches per cell", async () => {
  const storage = memoryStorage()
  const calls: string[] = []
  const backend = new BackendClient((url) => {
    calls.push(url)
    return Promise.resolve(
      reply(200, {
        points: [
          { lat: 36.74, lng: -119.79, alerts: [alert("a", "Flood Warning")] },
          { lat: 34.05, lng: -118.24, alerts: [alert("b", "Wind Advisory")] },
        ],
      })
    )
  }, memoryStorage())
  const env = {
    fetch: () => Promise.reject(new Error("direct path must not run")),
    storage,
    now: () => NOW,
    backend,
  }
  const points = [
    { lat: 36.7378, lng: -119.7871 },
    { lat: 34.0522, lng: -118.2437 },
  ]
  const alerts = await loadAlerts(points, env)
  assert.deepStrictEqual(alerts.map((a) => a.event).sort(), ["Flood Warning", "Wind Advisory"])
  assert.strictEqual(calls.length, 1)
  assert.ok(calls[0].startsWith("/api/alerts?pts=36.7378,-119.7871;34.0522,-118.2437"))
  await loadAlerts(points, env) // cached in the session storage
  assert.strictEqual(calls.length, 1)
})

test("loadAlerts falls back to NWS directly when the backend is missing", async () => {
  const direct: string[] = []
  const backend = new BackendClient(() => Promise.resolve(reply(404, {})), memoryStorage())
  const alerts = await loadAlerts([{ lat: 36.7378, lng: -119.7871 }], {
    fetch: (url) => {
      direct.push(url)
      return Promise.resolve(
        reply(200, {
          features: [
            {
              id: "urn:x",
              properties: { severity: "Severe", event: "Flood Warning", areaDesc: "Fresno" },
            },
          ],
        })
      )
    },
    storage: memoryStorage(),
    now: () => NOW,
    backend,
  })
  assert.deepStrictEqual(direct, ["https://api.weather.gov/alerts/active?point=36.7378,-119.7871"])
  assert.strictEqual(alerts.length, 1)
})
