#!/usr/bin/env node
// Smoke test of the real Firebase emulators: Hosting rewriting /api/** to the `api` function.
//
//   npm run build && npm --prefix functions run build && node scripts/emulator-smoke.mjs
//
// Needs the Firebase CLI (FIREBASE_BIN, or `npx firebase-tools`). The emulators run offline, so
// the checks do not depend on Open-Meteo or NWS being reachable: a valid forecast request
// answers 200 (network available) or a JSON 502 (it is not), never anything else.

import { spawn } from "node:child_process"
import { unlinkSync, writeFileSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { withFunctionsRewrite } from "./firebase-config.mjs"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const configFile = join(root, "firebase.emulator.json")
const HOSTING = "http://127.0.0.1:5057"

const config = withFunctionsRewrite(JSON.parse(readFileSync(join(root, "firebase.json"), "utf8")))
config.functions[0].predeploy = []
config.emulators = {
  hosting: { host: "127.0.0.1", port: 5057 },
  functions: { host: "127.0.0.1", port: 5058 },
  ui: { enabled: false },
  singleProjectMode: false,
}
writeFileSync(configFile, JSON.stringify(config, null, 2))

const bin = process.env.FIREBASE_BIN
const args = [
  "emulators:start",
  "--only",
  "functions,hosting",
  "--config",
  "firebase.emulator.json",
  "--project",
  "demo-rainman",
]
const child = bin
  ? spawn(bin, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] })
  : spawn("npx", ["--yes", "firebase-tools@13", ...args], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    })
let output = ""
child.stdout.on("data", (d) => (output += d))
child.stderr.on("data", (d) => (output += d))

let failures = 0
function check(name, ok, detail = "") {
  if (!ok) failures++
  console.log((ok ? "PASS " : "FAIL ") + name + (detail ? "  [" + detail + "]" : ""))
}

async function waitForEmulator() {
  for (let i = 0; i < 90; i++) {
    try {
      const res = await fetch(HOSTING + "/api/nope")
      if (res.headers.get("content-type")?.includes("json")) return true
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  return false
}

async function main() {
  if (!(await waitForEmulator())) {
    console.error(output.slice(-3000))
    throw new Error("emulators did not start")
  }
  const get = async (path) => {
    const res = await fetch(HOSTING + path)
    const text = await res.text()
    let body = null
    try {
      body = JSON.parse(text)
    } catch {
      // not json
    }
    return { status: res.status, headers: res.headers, body }
  }

  const missing = await get("/api/nope")
  check("unknown path: 404 JSON {error}", missing.status === 404 && !!missing.body?.error)

  const bad = await get("/api/forecast?pts=91,0")
  check("latitude out of range: 400 JSON {error}", bad.status === 400 && !!bad.body?.error)

  const none = await get("/api/forecast")
  check("missing pts: 400", none.status === 400)

  const tooMany = await get(
    "/api/forecast?pts=" + Array.from({ length: 201 }, (_, i) => `${i / 10},10`).join(";")
  )
  check("more than 200 points: 400", tooMany.status === 400)

  const ok = await get("/api/forecast?pts=37.77,-122.42;34.05,-118.24")
  check(
    "valid forecast request: 200 with CDN cache headers, or a JSON 502 when offline",
    (ok.status === 200 &&
      ok.headers.get("cache-control") === "public, max-age=300, s-maxage=1800" &&
      ok.body.hourly.length === 2) ||
      (ok.status === 502 && !!ok.body?.error),
    "status " + ok.status
  )

  const page = await fetch(HOSTING + "/")
  check(
    "static hosting still serves the app with the CSP header",
    page.status === 200 && !!page.headers.get("content-security-policy")
  )

  let limited = 0
  for (let i = 0; i < 80; i++) {
    if ((await get("/api/forecast?pts=1,1")).status === 429) limited++
  }
  check("rate limit answers 429 after the burst", limited > 0, limited + " of 80 limited")
}

try {
  await main()
} catch (error) {
  failures++
  console.error(String(error))
} finally {
  child.kill("SIGINT")
  setTimeout(() => child.kill("SIGKILL"), 5000).unref()
  try {
    unlinkSync(configFile)
  } catch {
    // already gone
  }
}
console.log(failures ? "FAILED " + failures : "ALL PASSED")
process.exit(failures ? 1 : 0)
