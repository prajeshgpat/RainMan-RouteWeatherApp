// Vite plugin: after the build, writes dist/sw.js from vite-plugins/sw.template.js with the list
// of files to precache (the Vite-hashed assets, the pages, the icons and the manifest) and a
// cache version derived from their contents.

import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { join, relative, sep } from "node:path"
import type { Plugin } from "vite"

const TEMPLATE = join(import.meta.dirname, "sw.template.js")

// Files that are never precached: the worker itself, the 404 page, the accuracy data (it changes
// without a deploy), source maps, licences and the favicon bundle
const EXCLUDE = [
  /^sw\.js$/,
  /^404\.html$/,
  /^data\//,
  /\.map$/,
  /(^|\/)LICENSE$/,
  /^images\/favicon_package\//,
  /^images\/favicon\.png$/,
]

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

// Public URLs to precache for a list of dist-relative file paths (posix separators). The home
// page is cached as both "/" and "/index.html".
export function buildPrecacheList(files: string[]): string[] {
  const urls: string[] = []
  for (const file of files) {
    if (EXCLUDE.some((re) => re.test(file))) continue
    urls.push("/" + file)
    if (file === "index.html") urls.push("/")
  }
  return urls.sort()
}

export function renderServiceWorker(template: string, precache: string[], version: string): string {
  return template
    .replace("__CACHE_VERSION__", version)
    .replace("/*__PRECACHE__*/ []", JSON.stringify(precache, null, 2))
}

export function precacheSw(): Plugin {
  let outDir = "dist"
  return {
    name: "rainman-precache-sw",
    apply: "build",
    configResolved(config) {
      outDir = join(config.root, config.build.outDir)
    },
    closeBundle() {
      if (!existsSync(outDir)) return
      const files = walk(outDir).map((f) => relative(outDir, f).split(sep).join("/"))
      const precache = buildPrecacheList(files)
      const hash = createHash("sha256")
      for (const file of files.filter((f) => !EXCLUDE.some((re) => re.test(f))).sort()) {
        hash.update(file).update(readFileSync(join(outDir, file)))
      }
      const version = "rainman-" + hash.digest("hex").slice(0, 12)
      const template = readFileSync(TEMPLATE, "utf8")
      writeFileSync(join(outDir, "sw.js"), renderServiceWorker(template, precache, version))
    },
  }
}
