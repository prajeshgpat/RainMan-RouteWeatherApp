// A per-key token bucket held in memory. Each function instance has its own buckets, so this is
// a best-effort guard against a single client hammering one instance, not a global quota. The
// CDN in front of the function absorbs repeated identical requests anyway.

export interface RateLimitResult {
  allowed: boolean
  retryAfterSeconds: number
}

interface Bucket {
  tokens: number
  updatedAt: number
}

export class TokenBucketLimiter {
  private readonly buckets = new Map<string, Bucket>()

  constructor(
    private readonly capacity = 60, // burst size
    private readonly refillPerSecond = 1, // 60 requests per minute sustained
    private readonly maxKeys = 10000
  ) {}

  take(key: string, nowMs: number): RateLimitResult {
    let bucket = this.buckets.get(key)
    if (!bucket) {
      if (this.buckets.size >= this.maxKeys) this.prune(nowMs)
      bucket = { tokens: this.capacity, updatedAt: nowMs }
      this.buckets.set(key, bucket)
    }
    const elapsed = Math.max(0, nowMs - bucket.updatedAt) / 1000
    bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsed * this.refillPerSecond)
    bucket.updatedAt = nowMs
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1
      return { allowed: true, retryAfterSeconds: 0 }
    }
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((1 - bucket.tokens) / this.refillPerSecond)),
    }
  }

  // Drop buckets that have refilled completely (they carry no information), then, if the map is
  // still full, the oldest half
  private prune(nowMs: number): void {
    for (const [key, bucket] of this.buckets) {
      const tokens = bucket.tokens + ((nowMs - bucket.updatedAt) / 1000) * this.refillPerSecond
      if (tokens >= this.capacity) this.buckets.delete(key)
    }
    if (this.buckets.size >= this.maxKeys) {
      const oldest = [...this.buckets.entries()]
        .sort((a, b) => a[1].updatedAt - b[1].updatedAt)
        .slice(0, Math.ceil(this.maxKeys / 2))
      for (const [key] of oldest) this.buckets.delete(key)
    }
  }

  get size(): number {
    return this.buckets.size
  }
}
