import { test } from "vitest"
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { buildPrecacheList, renderServiceWorker } from "../vite-plugins/precache-sw.ts"

const root = join(import.meta.dirname, "..")
const read = (f: string) => readFileSync(join(root, f), "utf8")

test("the manifest is installable and its icons exist", () => {
  const m = JSON.parse(read("public/manifest.webmanifest"))
  assert.strictEqual(m.name, "RainMan")
  assert.ok(m.short_name)
  assert.strictEqual(m.start_url, "/")
  assert.strictEqual(m.display, "standalone")
  assert.ok(m.theme_color && m.background_color)
  const sizes = m.icons.map((i: { sizes: string }) => i.sizes)
  assert.ok(sizes.includes("192x192") && sizes.includes("512x512"))
  for (const icon of m.icons) assert.ok(existsSync(join(root, "public", icon.src)), icon.src)
  assert.ok(read("index.html").includes('rel="manifest" href="/manifest.webmanifest"'))
})

test("the precache list covers the pages, hashed assets, icons and manifest, and nothing else", () => {
  const list = buildPrecacheList([
    "index.html",
    "accuracy.html",
    "404.html",
    "sw.js",
    "manifest.webmanifest",
    "assets/main-AbC123.js",
    "assets/main-AbC123.css",
    "assets/main-AbC123.js.map",
    "icons/rain.svg",
    "icons/LICENSE",
    "images/icon-192.png",
    "images/favicon.png",
    "images/favicon_package/favicon.ico",
    "data/accuracy.json",
  ])
  assert.deepStrictEqual(list, [
    "/",
    "/accuracy.html",
    "/assets/main-AbC123.css",
    "/assets/main-AbC123.js",
    "/icons/rain.svg",
    "/images/icon-192.png",
    "/index.html",
    "/manifest.webmanifest",
  ])
})

test("the service worker template is filled in and never touches cross-origin or /api requests", () => {
  const template = read("vite-plugins/sw.template.js")
  const sw = renderServiceWorker(template, ["/", "/index.html"], "rainman-test")
  assert.ok(sw.includes('const CACHE_VERSION = "rainman-test"'))
  assert.ok(sw.includes('"/index.html"'))
  assert.ok(!sw.includes("__CACHE_VERSION__") && !sw.includes("__PRECACHE__"))
  // the filled-in worker is valid JavaScript
  assert.doesNotThrow(() => new Function(sw))
  assert.ok(sw.includes("url.origin !== self.location.origin")) // cross-origin is never cached
  assert.ok(sw.includes('startsWith("/api/")') && sw.includes('startsWith("/data/")'))
  assert.ok(sw.includes('request.mode === "navigate"')) // network-first navigation
})

test("firebase.json serves dist, sw.js with no-cache, and sets a CSP that allows the app's hosts", () => {
  const cfg = JSON.parse(read("firebase.json"))
  assert.strictEqual(cfg.hosting.public, "dist")
  const rule = cfg.hosting.headers.find((h: { source: string }) => h.source === "/sw.js")
  assert.ok(rule)
  assert.ok(
    rule.headers.some(
      (h: { key: string; value: string }) => h.key === "Cache-Control" && h.value === "no-cache"
    )
  )
  const all = cfg.hosting.headers.find((h: { source: string }) => h.source === "**")
  const csp: string = all.headers.find(
    (h: { key: string }) => h.key === "Content-Security-Policy"
  ).value
  for (const host of [
    "maps.googleapis.com",
    "maps.gstatic.com",
    "*.googleapis.com",
    "fonts.googleapis.com",
    "fonts.gstatic.com",
    "cdnjs.cloudflare.com",
    "api.open-meteo.com",
    "api.weather.gov",
    "api.rainviewer.com",
    "tilecache.rainviewer.com",
  ]) {
    assert.ok(csp.includes(host), host + " is allowed by the CSP")
  }
  assert.ok(/img-src[^;]*data:/.test(csp), "data: images are allowed")
  // the committed config has no functions rewrite: that is added in CI once functions are deployed
  assert.ok(!JSON.stringify(cfg.hosting).includes('"/api/**"'))
})
