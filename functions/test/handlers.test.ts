import { describe, expect, it, vi } from "vitest"
import { handleRequest } from "../src/handlers"
import type { ApiRequest, Deps, FetchResult } from "../src/handlers"
import { TokenBucketLimiter } from "../src/rateLimit"

const NOW = Date.UTC(2026, 5, 1, 2, 30) // 02:30 GMT

// An Open-Meteo style location with 96 hourly values starting at 00:00 GMT of the day of NOW
function location(code: number) {
  const day0 = Date.UTC(2026, 5, 1) / 1000
  const hourly: Record<string, number[]> = {
    time: [],
    temperature_2m: [],
    precipitation_probability: [],
    weather_code: [],
    wind_speed_10m: [],
    wind_gusts_10m: [],
    is_day: [],
  }
  for (let h = 0; h < 96; h++) {
    hourly.time.push(day0 + h * 3600)
    hourly.temperature_2m.push(60)
    hourly.precipitation_probability.push(20)
    hourly.weather_code.push(code)
    hourly.wind_speed_10m.push(5)
    hourly.wind_gusts_10m.push(9)
    hourly.is_day.push(1)
  }
  return { hourly }
}

function ok(body: unknown): Promise<FetchResult> {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
}

function makeDeps(fetchImpl: Deps["fetch"], limiter = new TokenBucketLimiter(60, 1)) {
  const logs: Array<Record<string, unknown>> = []
  const deps: Deps = { fetch: fetchImpl, now: () => NOW, limiter, log: (e) => logs.push(e) }
  return { deps, logs }
}

function request(path: string, pts?: string, extra: Partial<ApiRequest> = {}): ApiRequest {
  return { method: "GET", path, query: pts === undefined ? {} : { pts }, ip: "1.2.3.4", ...extra }
}

describe("GET /api/forecast", () => {
  it("makes one batched request for the distinct 0.1 degree cells and answers in input order", async () => {
    const fetchMock = vi.fn((url: string) => {
      const n = new URL(url).searchParams.get("latitude")?.split(",").length as number
      return ok(n === 1 ? location(61) : Array.from({ length: n }, (_, i) => location(61 + i)))
    })
    const { deps } = makeDeps(fetchMock)
    const res = await handleRequest(
      request("/api/forecast", "37.7749,-122.4194;37.81,-122.44;38.5,-121.5"),
      deps
    )
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const url = fetchMock.mock.calls[0][0]
    // snapped to the grid, the first two points share a cell
    expect(url).toContain("latitude=37.8,38.5&longitude=-122.4,-121.5")
    expect(url.startsWith("https://api.open-meteo.com/v1/forecast?")).toBe(true)
    const body = res.body as { hourly: Array<Array<{ t: number; code: number }>> }
    expect(body.hourly).toHaveLength(3)
    expect(body.hourly[0]).toBe(body.hourly[1]) // same cell, same data
    expect(body.hourly[0][0].code).toBe(61)
    expect(body.hourly[2][0].code).toBe(62)
    // sliced to the current hour (02:00)
    expect(body.hourly[0][0].t).toBe(Date.UTC(2026, 5, 1, 2))
    expect(body.hourly[0]).toHaveLength(94)
  })

  it("sets headers that let the Hosting CDN share the response", async () => {
    const { deps } = makeDeps(() => ok(location(0)))
    const res = await handleRequest(request("/api/forecast", "10,10"), deps)
    expect(res.headers["Cache-Control"]).toBe("public, max-age=300, s-maxage=1800")
    expect(res.headers["Content-Type"]).toContain("application/json")
  })

  it.each([
    ["missing pts", undefined, /Missing pts/],
    ["empty pts", "", /Missing pts/],
    ["not numbers", "a,b", /Invalid point/],
    ["one number", "10", /Invalid point/],
    ["three numbers", "10,20,30", /Invalid point/],
    ["latitude out of range", "91,10", /Latitude out of range/],
    ["longitude out of range", "10,-181", /Longitude out of range/],
    ["Infinity", "Infinity,10", /Invalid point/],
  ])("rejects %s with 400", async (_name, pts, message) => {
    const fetchMock = vi.fn()
    const { deps } = makeDeps(fetchMock)
    const res = await handleRequest(request("/api/forecast", pts), deps)
    expect(res.status).toBe(400)
    expect((res.body as { error: string }).error).toMatch(message)
    expect(res.headers["Cache-Control"]).toBe("no-store")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("accepts 200 points and rejects 201", async () => {
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) => i * 0.2 + "," + (i % 170)).join(";")
    const { deps } = makeDeps((url) => {
      const n = new URL(url).searchParams.get("latitude")?.split(",").length as number
      return ok(Array.from({ length: n }, () => location(0)))
    })
    expect((await handleRequest(request("/api/forecast", many(200)), deps)).status).toBe(200)
    const tooMany = await handleRequest(request("/api/forecast", many(201)), deps)
    expect(tooMany.status).toBe(400)
    expect((tooMany.body as { error: string }).error).toMatch(/at most 200/)
  })

  it("answers 502 when Open-Meteo fails, is unreadable or returns the wrong count", async () => {
    const down = makeDeps(() => Promise.reject(new Error("boom")))
    expect((await handleRequest(request("/api/forecast", "1,1"), down.deps)).status).toBe(502)

    const http = makeDeps(() => Promise.resolve({ ok: false, status: 429, json: () => ok({}) }))
    const res = await handleRequest(request("/api/forecast", "1,1"), http.deps)
    expect(res.status).toBe(502)
    expect((res.body as { error: string }).error).toContain("429")
    expect(res.headers["Cache-Control"]).toBe("no-store")

    const bad = makeDeps(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new Error("not json")) })
    )
    expect((await handleRequest(request("/api/forecast", "1,1"), bad.deps)).status).toBe(502)

    const wrong = makeDeps(() => ok([location(0)]))
    expect((await handleRequest(request("/api/forecast", "1,1;5,5"), wrong.deps)).status).toBe(502)
  })
})

describe("GET /api/alerts", () => {
  const feature = (id: string, severity: string, event: string, area = "Fresno County") => ({
    id,
    properties: { severity, event, areaDesc: area, headline: "h" },
  })

  it("proxies NWS with a User-Agent, merges and filters to Moderate and above", async () => {
    const fetchMock = vi.fn((url: string) =>
      ok({
        features: [
          feature("urn:flood", "Severe", "Flood Warning"),
          feature("urn:frost", "Minor", "Frost Advisory"),
          feature(
            url.includes("34.05") ? "urn:wind:a" : "urn:wind:b",
            "Moderate",
            "Wind Advisory",
            "Kern"
          ),
        ],
      })
    )
    const { deps } = makeDeps(fetchMock)
    const res = await handleRequest(
      request("/api/alerts", "36.7378,-119.7871;34.0522,-118.2437"),
      deps
    )
    expect(res.status).toBe(200)
    expect(res.headers["Cache-Control"]).toContain("s-maxage=600")
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string> },
    ]
    expect(url).toBe("https://api.weather.gov/alerts/active?point=36.7400,-119.7900")
    expect(init.headers["User-Agent"]).toBe(
      "RainMan (github.com/prajeshgpat/RainMan-RouteWeatherApp)"
    )
    const body = res.body as {
      alerts: Array<{ event: string; level: string }>
      points: Array<{ alerts: unknown[] }>
    }
    // the same warning from both points appears once; the minor advisory is dropped
    expect(body.alerts.map((a) => a.event)).toEqual(["Flood Warning", "Wind Advisory"])
    expect(body.alerts[0].level).toBe("red")
    expect(body.points).toHaveLength(2)
    expect(body.points[0].alerts).toHaveLength(2)
  })

  it("skips points outside NWS coverage without calling NWS", async () => {
    const fetchMock = vi.fn()
    const { deps } = makeDeps(fetchMock)
    const res = await handleRequest(request("/api/alerts", "51.5,-0.12"), deps)
    expect(res.status).toBe(200)
    expect(fetchMock).not.toHaveBeenCalled()
    expect((res.body as { alerts: unknown[] }).alerts).toEqual([])
  })

  it("does not let the CDN cache a partial answer, and 502s when every lookup fails", async () => {
    let calls = 0
    const partial = makeDeps(() => {
      calls++
      return calls === 1 ? Promise.reject(new Error("x")) : ok({ features: [] })
    })
    const res = await handleRequest(request("/api/alerts", "36,-119;35,-118"), partial.deps)
    expect(res.status).toBe(200)
    expect(res.headers["Cache-Control"]).toBe("no-store")

    const down = makeDeps(() => Promise.resolve({ ok: false, status: 503, json: () => ok({}) }))
    const failed = await handleRequest(request("/api/alerts", "36,-119"), down.deps)
    expect(failed.status).toBe(502)
  })

  it("limits the number of points", async () => {
    const { deps } = makeDeps(() => ok({ features: [] }))
    const many = Array.from({ length: 21 }, () => "36,-119").join(";")
    expect((await handleRequest(request("/api/alerts", many), deps)).status).toBe(400)
  })
})

describe("routing, limits and logging", () => {
  it("answers 404 for other paths and 405 for other methods, as JSON", async () => {
    const { deps } = makeDeps(() => ok({}))
    const missing = await handleRequest(request("/api/nope", "1,1"), deps)
    expect(missing.status).toBe(404)
    expect(missing.body).toEqual({ error: "Not found" })
    const post = await handleRequest(request("/api/forecast", "1,1", { method: "POST" }), deps)
    expect(post.status).toBe(405)
    expect(post.headers["Allow"]).toBe("GET, HEAD")
    expect(typeof (post.body as { error: string }).error).toBe("string")
  })

  it("tolerates a trailing slash", async () => {
    const { deps } = makeDeps(() => ok(location(0)))
    expect((await handleRequest(request("/api/forecast/", "1,1"), deps)).status).toBe(200)
  })

  it("rate limits per IP with 429 and Retry-After, and recovers", async () => {
    const limiter = new TokenBucketLimiter(3, 1)
    let now = NOW
    const { deps } = makeDeps(() => ok(location(0)), limiter)
    deps.now = () => now
    const send = (ip: string) => handleRequest(request("/api/forecast", "1,1", { ip }), deps)
    expect((await send("a")).status).toBe(200)
    expect((await send("a")).status).toBe(200)
    expect((await send("a")).status).toBe(200)
    const limited = await send("a")
    expect(limited.status).toBe(429)
    expect(Number(limited.headers["Retry-After"])).toBeGreaterThanOrEqual(1)
    expect((limited.body as { error: string }).error).toBe("Too many requests")
    expect((await send("b")).status).toBe(200) // another client is unaffected
    now += 2000 // two tokens refill
    expect((await send("a")).status).toBe(200)
  })

  it("logs one structured entry per request", async () => {
    const { deps, logs } = makeDeps(() => ok([location(0), location(0)]))
    await handleRequest(request("/api/forecast", "1,1;2,2"), deps)
    await handleRequest(request("/api/forecast", "x"), deps)
    const entries = logs.filter((l) => l.message === "request")
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({
      severity: "INFO",
      path: "/api/forecast",
      status: 200,
      points: 2,
    })
    expect(entries[1]).toMatchObject({ status: 400 })
  })

  it("turns unexpected errors into a JSON 500", async () => {
    const { deps } = makeDeps(() => ok({}))
    deps.limiter = {
      take: () => {
        throw new Error("kaboom")
      },
    } as unknown as TokenBucketLimiter
    const res = await handleRequest(request("/api/forecast", "1,1"), deps)
    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: "Internal error" })
  })
})
