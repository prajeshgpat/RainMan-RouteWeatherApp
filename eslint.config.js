import js from "@eslint/js"
import globals from "globals"
import tseslint from "typescript-eslint"
import prettier from "eslint-config-prettier"

export default tseslint.config(
  {
    ignores: [
      "dist",
      "node_modules",
      "coverage",
      "playwright-report",
      "test-results",
      "functions/lib",
      "functions/node_modules",
      "public",
      "pipeline",
      "**/*.old.js",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts", "shared/**/*.ts"],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["vite-plugins/sw.template.js"],
    languageOptions: { globals: { ...globals.serviceworker, ...globals.browser } },
  },
  {
    files: [
      "scripts/**/*.mjs",
      "vite.config.ts",
      "playwright.config.ts",
      "vite-plugins/**/*.ts",
      "functions/**/*.ts",
      "e2e/**/*.ts",
      "tests/**/*.ts",
    ],
    languageOptions: { globals: globals.node },
  },
  {
    // The ported unit tests keep their loose helpers (tests/tsconfig.json); e2e pokes at window.__*
    files: ["tests/**/*.ts", "e2e/**/*.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  prettier
)
