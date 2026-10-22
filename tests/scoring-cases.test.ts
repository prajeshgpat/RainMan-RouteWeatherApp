import { test } from "vitest"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { hourBadness, classify } from "../src/scoring/scoring"

// shared/scoring_cases.json is also replayed against the dbt SQL macros
// (pipeline/tests/test_scoring_parity.py), so the app and the accuracy pipeline score alike.
// Regenerate it with scripts/gen_scoring_cases.mjs after changing the scoring.
const cases = JSON.parse(
  readFileSync(new URL("../shared/scoring_cases.json", import.meta.url), "utf8")
)

test("hourBadness matches every shared scoring case", () => {
  for (const c of cases.hourBadness) {
    const got = hourBadness(c.input)
    assert.ok(
      Math.abs(got - c.expected) < 1e-9,
      `${JSON.stringify(c.input)}: ${got} !== ${c.expected}`
    )
    assert.equal(classify(got), c.class)
  }
})

test("classify matches every shared boundary case", () => {
  for (const c of cases.classify) assert.equal(classify(c.score), c.expected, `score ${c.score}`)
})
