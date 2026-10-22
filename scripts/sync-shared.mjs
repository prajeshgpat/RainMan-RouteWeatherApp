#!/usr/bin/env node
// Keeps functions/src/shared/ identical to shared/.
//
// Firebase uploads only the functions/ directory, so the backend cannot import ../shared at
// runtime. shared/ (imported by the app) is the source of truth; this copies every file into the
// backend. `--check` only verifies and exits 1 on a difference. tests/shared-sync.test.ts runs
// the same check in `npm test`.

import { copyFileSync, mkdirSync, readFileSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const from = join(root, "shared")
const to = join(root, "functions", "src", "shared")

export function sharedFiles() {
  return readdirSync(from).filter((f) => f.endsWith(".ts"))
}

export function differences() {
  const diffs = []
  let existing = []
  try {
    existing = readdirSync(to).filter((f) => f.endsWith(".ts"))
  } catch {
    // not created yet
  }
  for (const f of sharedFiles()) {
    let copy = null
    try {
      copy = readFileSync(join(to, f), "utf8")
    } catch {
      // missing
    }
    if (copy !== readFileSync(join(from, f), "utf8")) diffs.push(f)
  }
  for (const f of existing) if (!sharedFiles().includes(f)) diffs.push(f + " (extra)")
  return diffs
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes("--check")) {
    const diffs = differences()
    if (diffs.length) {
      console.error("functions/src/shared is out of date: " + diffs.join(", "))
      console.error("Run: node scripts/sync-shared.mjs")
      process.exit(1)
    }
    console.log("functions/src/shared is in sync")
  } else {
    mkdirSync(to, { recursive: true })
    for (const f of sharedFiles()) copyFileSync(join(from, f), join(to, f))
    console.log("Copied " + sharedFiles().join(", ") + " to functions/src/shared")
  }
}
