// Firebase Functions entry point: one HTTPS function, `api`, behind the hosting rewrite
// /api/** -> api (see scripts/firebase-config.mjs).

import { onRequest } from "firebase-functions/v2/https"
import { logger } from "firebase-functions/v2"
import { handleRequest } from "./handlers"
import type { ApiRequest, Deps } from "./handlers"
import { TokenBucketLimiter } from "./rateLimit"

const limiter = new TokenBucketLimiter(60, 1) // per instance: 60 requests per minute per IP

const deps: Deps = {
  fetch: (url, init) => fetch(url, init),
  now: () => Date.now(),
  limiter,
  log: (entry) => {
    const { severity, message, ...fields } = entry
    const text = String(message)
    if (severity === "ERROR") logger.error(text, fields)
    else if (severity === "WARNING") logger.warn(text, fields)
    else logger.info(text, fields)
  },
}

// Behind Firebase Hosting the client address is in fastly-client-ip / x-forwarded-for
function clientIp(
  headers: Record<string, string | string[] | undefined>,
  fallback: string
): string {
  const fastly = headers["fastly-client-ip"]
  if (typeof fastly === "string" && fastly) return fastly
  const forwarded = headers["x-forwarded-for"]
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim()
  return first || fallback || "unknown"
}

export const api = onRequest(
  { region: "us-central1", memory: "256MiB", timeoutSeconds: 30, maxInstances: 10 },
  async (req, res) => {
    const query: ApiRequest["query"] = {}
    for (const [key, value] of Object.entries(req.query)) {
      if (typeof value === "string") query[key] = value
    }
    const result = await handleRequest(
      {
        method: req.method,
        path: req.path,
        query,
        ip: clientIp(req.headers, req.ip ?? ""),
      },
      deps
    )
    res.status(result.status)
    for (const [name, value] of Object.entries(result.headers)) res.set(name, value)
    res.send(JSON.stringify(result.body))
  }
)
