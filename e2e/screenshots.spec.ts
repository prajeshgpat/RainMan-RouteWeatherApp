// Takes screenshots of the app and the accuracy page (light and dark, phone and desktop) into
// $SCREENSHOT_DIR. Skipped unless that variable is set:
//   SCREENSHOT_DIR=/tmp/shots npx playwright test e2e/screenshots.spec.ts
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { Page } from "@playwright/test"
import { expect, test } from "./support/test"
import { searchSfToLa } from "./support/app"

const dir = process.env.SCREENSHOT_DIR
const accuracy = readFileSync(join(import.meta.dirname, "fixtures/accuracy.json"), "utf8")
const sizes = [
  { w: 390, h: 844, tag: "390x844", zoom: 6 },
  { w: 1280, h: 800, tag: "1280x800", zoom: 7 },
]

// The fake map has no tiles: draw the route line and the markers the app created, at a zoom level
async function drawMap(page: Page, zoom: number) {
  await page.evaluate((zoom) => {
    const w = window as any
    const map = document.getElementById("map") as HTMLElement
    map.querySelectorAll(".fake").forEach((n) => n.remove())
    w.__map.zoom = zoom
    w.__map.__fire("zoom_changed")
    w.__map.__fire("idle")
    const dark = matchMedia("(prefers-color-scheme: dark)").matches
    map.style.background = dark
      ? "linear-gradient(135deg,#1b2a2f,#17263c)"
      : "linear-gradient(135deg,#dfe8da,#cfe0ea)"
    const width = map.clientWidth
    const height = map.clientHeight
    const proj = w.__map.getProjection()
    const scale = Math.pow(2, zoom)
    const c = proj.fromLatLngToPoint(new w.google.maps.LatLng(36.0, -120.3))
    const px = (ll: any) => {
      const p = proj.fromLatLngToPoint(ll)
      return { x: (p.x - c.x) * scale + width / 2, y: (p.y - c.y) * scale + height * 0.62 }
    }
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    svg.setAttribute("class", "fake")
    svg.setAttribute("style", "position:absolute;inset:0;width:100%;height:100%")
    const a = new w.google.maps.LatLng(37.7749, -122.4194)
    const b = new w.google.maps.LatLng(34.0522, -118.2437)
    const pts = []
    for (let i = 0; i <= 60; i++) {
      const t = i / 60
      pts.push(
        px(
          new w.google.maps.LatLng(
            a.lat() + (b.lat() - a.lat()) * t,
            a.lng() + (b.lng() - a.lng()) * t
          )
        )
      )
    }
    svg.innerHTML =
      '<polyline fill="none" stroke="#4285f4" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" points="' +
      pts.map((p) => p.x + "," + p.y).join(" ") +
      '"/>'
    map.insertBefore(svg, map.firstChild)
    w.__markers
      .filter((m: any) => m.map && m.o.icon && m.o.icon.url && m.visible !== false)
      .forEach((m: any) => {
        const ic = m.o.icon
        const p = px(m.o.position)
        const im = document.createElement("img")
        im.className = "fake"
        im.src = ic.url
        im.style.cssText =
          "position:absolute;pointer-events:none;width:" +
          ic.scaledSize.width +
          "px;height:" +
          ic.scaledSize.height +
          "px;left:" +
          (p.x - ic.anchor.x) +
          "px;top:" +
          (p.y - ic.anchor.y) +
          "px;z-index:" +
          (m.o.zIndex || 1)
        map.appendChild(im)
      })
  }, zoom)
}

test.describe("screenshots", () => {
  test.skip(!dir, "set SCREENSHOT_DIR to take screenshots")

  for (const scheme of ["light", "dark"] as const) {
    for (const size of sizes) {
      test(`app ${scheme} ${size.tag}`, async ({ open }) => {
        const { page } = await open({ width: size.w, height: size.h, scheme })
        await searchSfToLa(page)
        await page.evaluate(() => {
          const bad = document.querySelector(".tb-seg.bad") as HTMLElement | null
          bad?.click()
        })
        await page.waitForTimeout(200)
        await drawMap(page, size.zoom)
        await page.waitForTimeout(400)
        await page.screenshot({ path: join(dir as string, `c-app-${scheme}-${size.tag}.png`) })

        await page.evaluate(() => {
          const markers = (window as any).__markers.filter(
            (m: any) => m.o.icon && m.o.icon.scaledSize.width > 40
          )
          markers[Math.floor(markers.length / 2)].handlers[0]()
        })
        await page.waitForTimeout(600)
        await drawMap(page, size.zoom)
        await page.screenshot({
          path: join(dir as string, `c-app-popup-${scheme}-${size.tag}.png`),
        })
      })

      test(`accuracy ${scheme} ${size.tag}`, async ({ browser }) => {
        const ctx = await browser.newContext({
          viewport: { width: size.w, height: size.h },
          colorScheme: scheme,
        })
        const page = await ctx.newPage()
        await page.route("**/data/accuracy.json", (route) =>
          route.fulfill({ status: 200, contentType: "application/json", body: accuracy })
        )
        await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort())
        await page.goto("/accuracy.html")
        await expect(page.locator(".headline .big")).toBeVisible()
        await page.screenshot({
          path: join(dir as string, `c-accuracy-${scheme}-${size.tag}.png`),
          fullPage: true,
        })
        await ctx.close()
      })
    }
  }

  test("accuracy page without data", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 600 } })
    const page = await ctx.newPage()
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort())
    await page.goto("/accuracy.html")
    await expect(page.locator(".empty")).toBeVisible()
    await page.screenshot({ path: join(dir as string, "c-accuracy-empty-390x600.png") })
    await ctx.close()
  })
})
