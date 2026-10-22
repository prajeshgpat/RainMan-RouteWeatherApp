import { readFileSync } from "node:fs"
import { join } from "node:path"
import { expect, test } from "./support/test"

const fixture = readFileSync(join(import.meta.dirname, "fixtures/accuracy.json"), "utf8")

test.describe("accuracy page", () => {
  test("shows the headline, the chart and the tables from /data/accuracy.json", async ({
    browser,
  }) => {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    const errors: string[] = []
    page.on("pageerror", (e) => errors.push(String(e)))
    await page.route("**/data/accuracy.json", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: fixture })
    )
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort())
    await page.goto("/accuracy.html")

    await expect(page.locator("h1")).toHaveText("How accurate is the green light?")
    await expect(page.locator(".headline .big")).toHaveText("91%")
    await expect(page.locator(".headline")).toContainText("stayed dry")
    await expect(page.locator(".headline")).toContainText("8,123 green trips on 12 corridors")
    await expect(page.locator(".headline")).toContainText("Jul 24, 2026 to Oct 20, 2026")

    // chart: an accessible SVG with a bar per lead day
    const chart = page.locator("svg.chart")
    await expect(chart).toHaveAttribute("role", "img")
    await expect(chart.locator("rect.bar")).toHaveCount(5)
    await expect(chart.locator("desc")).toContainText("day 1: 91%")
    await expect(chart.locator("text.value").first()).toHaveText("91%")

    // tables
    const lead = page.locator("table").nth(0)
    await expect(lead.locator("tbody tr")).toHaveCount(5)
    await expect(lead.locator("tbody tr").first()).toContainText("Day 1")
    await expect(lead.locator("tbody tr").first()).toContainText("25,000")
    const corridors = page.locator("table").nth(1)
    await expect(corridors.locator("tbody tr")).toHaveCount(4)
    await expect(corridors).toContainText("San Francisco → Los Angeles (I-5)")
    await expect(corridors).toContainText("97%")

    // methodology
    const link = page.getByRole("link", { name: /methodology/i })
    await expect(link).toHaveAttribute(
      "href",
      "https://github.com/prajeshgpat/RainMan-RouteWeatherApp/blob/main/pipeline/README.md"
    )
    await expect(page.locator(".generated")).toContainText("Oct 22, 2026")
    expect(errors).toEqual([])
    await ctx.close()
  })

  test("says so when the data is not available yet (missing file, error, or not JSON)", async ({
    browser,
  }) => {
    for (const reply of [
      { status: 404, contentType: "text/html", body: "Not found" },
      { status: 500, contentType: "text/plain", body: "boom" },
      { status: 200, contentType: "text/html", body: "<!doctype html><title>x" },
      { status: 200, contentType: "application/json", body: '{"hello":1}' },
    ]) {
      const ctx = await browser.newContext()
      const page = await ctx.newPage()
      await page.route("**/data/accuracy.json", (route) => route.fulfill(reply))
      await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort())
      await page.goto("/accuracy.html")
      await expect(page.locator(".empty")).toHaveText("Accuracy data not available yet")
      await expect(page.locator("svg.chart")).toHaveCount(0)
      await ctx.close()
    }
  })

  test("the real preview server has no data file: the page degrades gracefully", async ({
    browser,
  }) => {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort())
    await page.goto("/accuracy.html")
    await expect(page.locator(".empty")).toHaveText("Accuracy data not available yet")
    await ctx.close()
  })

  test("is linked from the map page's navbar and links back", async ({ open }) => {
    const { page } = await open()
    const link = page.locator(".navbar .nav-link")
    await expect(link).toHaveText("Accuracy")
    await expect(link).toHaveAttribute("href", "/accuracy.html")
    await page.route("**/data/accuracy.json", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: fixture })
    )
    await link.click()
    await expect(page).toHaveURL(/\/accuracy\.html$/)
    await expect(page.locator(".headline .big")).toHaveText("91%")
    await page.getByRole("link", { name: /Map/ }).click()
    await expect(page).toHaveURL(/\/$/)
  })

  test("follows the system colour scheme", async ({ browser }) => {
    const bg = async (scheme: "light" | "dark") => {
      const ctx = await browser.newContext({ colorScheme: scheme })
      const page = await ctx.newPage()
      await page.route("**/data/accuracy.json", (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: fixture })
      )
      await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort())
      await page.goto("/accuracy.html")
      await expect(page.locator(".headline .big")).toBeVisible()
      const colors = await page.evaluate(() => ({
        body: getComputedStyle(document.body).backgroundColor,
        bar: getComputedStyle(document.querySelector("rect.bar") as Element).fill,
      }))
      await ctx.close()
      return colors
    }
    const light = await bg("light")
    const dark = await bg("dark")
    expect(light.body).toBe("rgb(255, 255, 255)")
    expect(dark.body).toBe("rgb(17, 22, 29)")
    expect(light.bar).not.toBe(dark.bar)
  })

  test("fits a phone screen without horizontal page scroll", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await ctx.newPage()
    await page.route("**/data/accuracy.json", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: fixture })
    )
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort())
    await page.goto("/accuracy.html")
    await expect(page.locator(".headline .big")).toBeVisible()
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )
    expect(overflow).toBe(0)
    await ctx.close()
  })
})
