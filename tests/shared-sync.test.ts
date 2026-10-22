import { test } from "vitest"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { differences, sharedFiles } from "../scripts/sync-shared.mjs"
import { API_REWRITE, withFunctionsRewrite } from "../scripts/firebase-config.mjs"

const root = join(import.meta.dirname, "..")

test("functions/src/shared is a byte-for-byte copy of shared/ (run `node scripts/sync-shared.mjs`)", () => {
  assert.ok(sharedFiles().length >= 2)
  assert.deepStrictEqual(differences(), [])
  for (const f of sharedFiles()) {
    assert.strictEqual(
      readFileSync(join(root, "functions/src/shared", f), "utf8"),
      readFileSync(join(root, "shared", f), "utf8"),
      f
    )
  }
})

test("firebase-config adds the /api rewrite once, in front, without touching the input", () => {
  const base = {
    hosting: { public: "dist", rewrites: [{ source: "**", destination: "/index.html" }] },
  }
  const out = withFunctionsRewrite(base)
  assert.deepStrictEqual(out.hosting.rewrites[0], API_REWRITE)
  assert.strictEqual(out.hosting.rewrites.length, 2)
  assert.strictEqual(base.hosting.rewrites.length, 1)
  assert.deepStrictEqual(withFunctionsRewrite(out), out) // idempotent
  assert.deepStrictEqual(withFunctionsRewrite({ hosting: { public: "dist" } }).hosting.rewrites, [
    API_REWRITE,
  ])
  assert.strictEqual(API_REWRITE.source, "/api/**")
  assert.strictEqual(API_REWRITE.function.functionId, "api")
})
