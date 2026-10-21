const test = require("node:test")
const assert = require("node:assert")
const fs = require("node:fs")
const path = require("node:path")

const pub = path.join(__dirname, "../public")
const read = (f) => fs.readFileSync(path.join(pub, f), "utf8")

test("the manifest is installable and its icons exist", () => {
  const m = JSON.parse(read("manifest.webmanifest"))
  assert.strictEqual(m.name, "RainMan")
  assert.ok(m.short_name)
  assert.strictEqual(m.start_url, "/")
  assert.strictEqual(m.display, "standalone")
  assert.ok(m.theme_color && m.background_color)
  const sizes = m.icons.map((i) => i.sizes)
  assert.ok(sizes.includes("192x192") && sizes.includes("512x512"))
  for (const icon of m.icons) assert.ok(fs.existsSync(path.join(pub, icon.src)), icon.src)
  assert.ok(read("index.html").includes('rel="manifest" href="manifest.webmanifest"'))
})

test("every file the service worker precaches exists, and the shell scripts are all listed", () => {
  const sw = read("sw.js")
  const shell = JSON.parse(sw.match(/var SHELL = (\[[\s\S]*?\])\n/)[1].replace(/,\s*\]$/, "]"))
  for (const f of shell) {
    if (f === "/") continue
    assert.ok(fs.existsSync(path.join(pub, f)), f)
  }
  const scripts = [...read("index.html").matchAll(/<script src="([^"]+\.js)"/g)].map((m) => "/" + m[1])
  for (const s of scripts) assert.ok(shell.includes(s), s + " is not precached")
  assert.ok(shell.includes("/styles.css"))
  assert.ok(/CACHE_VERSION = "rainman-v\d+"/.test(sw))
  assert.ok(sw.includes("url.origin !== self.location.origin")) // cross-origin is never cached
})

test("firebase.json serves sw.js with no-cache", () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "../firebase.json"), "utf8"))
  const rule = cfg.hosting.headers.find((h) => h.source === "/sw.js")
  assert.ok(rule)
  assert.ok(rule.headers.some((h) => h.key === "Cache-Control" && h.value === "no-cache"))
})
