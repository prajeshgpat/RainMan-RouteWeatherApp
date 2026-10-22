import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { defineConfig } from "vitest/config"
import { precacheSw } from "./vite-plugins/precache-sw.ts"

interface HostingHeaderRule {
  source: string
  headers: Array<{ key: string; value: string }>
}

// `vite preview` (and so the e2e suite) serves dist with the same headers as Firebase Hosting
function hostingHeaders(): Record<string, string> {
  const config = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "firebase.json"), "utf8")
  ) as {
    hosting: { headers: HostingHeaderRule[] }
  }
  const out: Record<string, string> = {}
  for (const rule of config.hosting.headers) {
    if (rule.source !== "**") continue
    for (const h of rule.headers) out[h.key] = h.value
  }
  return out
}

export default defineConfig({
  appType: "mpa", // unknown paths are real 404s (the app relies on that to detect a missing backend)
  plugins: [precacheSw()],
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        accuracy: resolve(import.meta.dirname, "accuracy.html"),
      },
    },
  },
  preview: {
    port: 4173,
    strictPort: true,
    headers: hostingHeaders(),
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
})
