#!/usr/bin/env node
// Edits firebase.json for a deploy.
//
//   node scripts/firebase-config.mjs --with-functions
//
// adds the hosting rewrite that sends /api/** to the `api` Cloud Function. The committed
// firebase.json deliberately has no such rewrite: a hosting deploy that rewrites to a function
// that does not exist yet fails. CI runs this only when the repository variable
// FUNCTIONS_ENABLED is "true" (see README, "Backend (Firebase Functions)").

import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { resolve } from "node:path"

export const API_REWRITE = {
  source: "/api/**",
  function: { functionId: "api", region: "us-central1" },
}

// Returns a copy of the config with the API rewrite in front of any other rewrites (once)
export function withFunctionsRewrite(config) {
  const next = JSON.parse(JSON.stringify(config))
  const hosting = next.hosting
  const rewrites = (hosting.rewrites || []).filter((r) => r.source !== API_REWRITE.source)
  hosting.rewrites = [API_REWRITE, ...rewrites]
  return next
}

function main(argv) {
  const file = resolve(fileURLToPath(import.meta.url), "../../firebase.json")
  if (!argv.includes("--with-functions")) {
    console.error("Usage: node scripts/firebase-config.mjs --with-functions")
    process.exit(2)
  }
  const config = JSON.parse(readFileSync(file, "utf8"))
  writeFileSync(file, JSON.stringify(withFunctionsRewrite(config), null, 2) + "\n")
  console.log("firebase.json: added the /api/** -> function api rewrite")
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2))
}
