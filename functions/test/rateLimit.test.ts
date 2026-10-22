import { describe, expect, it } from "vitest"
import { TokenBucketLimiter } from "../src/rateLimit"

describe("TokenBucketLimiter", () => {
  it("allows a burst up to the capacity, then refills over time", () => {
    const limiter = new TokenBucketLimiter(5, 1)
    for (let i = 0; i < 5; i++) expect(limiter.take("k", 0).allowed).toBe(true)
    const blocked = limiter.take("k", 0)
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterSeconds).toBe(1)
    expect(limiter.take("k", 1000).allowed).toBe(true)
    expect(limiter.take("k", 1000).allowed).toBe(false)
    expect(limiter.take("k", 60000).allowed).toBe(true) // refilled, capped at the capacity
  })

  it("keeps separate buckets per key", () => {
    const limiter = new TokenBucketLimiter(1, 1)
    expect(limiter.take("a", 0).allowed).toBe(true)
    expect(limiter.take("a", 0).allowed).toBe(false)
    expect(limiter.take("b", 0).allowed).toBe(true)
  })

  it("reports a longer wait for a slower refill", () => {
    const limiter = new TokenBucketLimiter(1, 0.25)
    limiter.take("a", 0)
    expect(limiter.take("a", 0).retryAfterSeconds).toBe(4)
  })

  it("bounds its memory by pruning old keys", () => {
    const limiter = new TokenBucketLimiter(2, 1, 10)
    for (let i = 0; i < 100; i++) limiter.take("ip" + i, i)
    expect(limiter.size).toBeLessThanOrEqual(10)
  })
})
