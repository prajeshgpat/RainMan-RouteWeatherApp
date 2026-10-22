// The accuracy page: how often the drive was actually dry when RainMan rated it green.

import { renderLeadDayChart } from "./chart"
import { ACCURACY_URL, count, decimal, formatDate, parseAccuracy, percent } from "./data"
import type { AccuracyData } from "./data"

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

function section(title: string): HTMLElement {
  const s = el("section")
  s.appendChild(el("h2", "", title))
  return s
}

function table(caption: string, headers: string[], rows: string[][]): HTMLElement {
  const wrap = el("div", "table-wrap")
  const t = el("table")
  t.appendChild(el("caption", "", caption))
  const thead = el("thead")
  const hr = el("tr")
  headers.forEach((h) => {
    const th = el("th", "", h)
    th.scope = "col"
    hr.appendChild(th)
  })
  thead.appendChild(hr)
  t.appendChild(thead)
  const tbody = el("tbody")
  rows.forEach((cells) => {
    const tr = el("tr")
    cells.forEach((c, i) => {
      if (i === 0) {
        const th = el("th", "", c)
        th.scope = "row"
        tr.appendChild(th)
      } else {
        tr.appendChild(el("td", "", c))
      }
    })
    tbody.appendChild(tr)
  })
  t.appendChild(tbody)
  wrap.appendChild(t)
  return wrap
}

function leadLabel(day: number): string {
  return day === 1 ? "1 day ahead" : day + " days ahead"
}

export function renderAccuracy(root: HTMLElement, data: AccuracyData): void {
  root.textContent = ""
  root.appendChild(el("h1", "", "How accurate is the green light?"))
  root.appendChild(
    el(
      "p",
      "lede",
      "If you had trusted RainMan’s green, yellow or red rating several days ahead, how often was the drive actually dry? Here is the track record."
    )
  )

  const head = el("div", "headline")
  head.appendChild(el("div", "big", percent(data.headline.green_trip_dry_rate)))
  const text = el("div")
  text.appendChild(
    el("p", "", "of trips rated green " + leadLabel(data.headline.lead_day) + " stayed dry.")
  )
  text.appendChild(
    el(
      "p",
      "sub",
      count(data.headline.n_green_trips) +
        " green trips on " +
        data.corridors +
        " corridors, " +
        formatDate(data.window.start) +
        " to " +
        formatDate(data.window.end)
    )
  )
  head.appendChild(text)
  root.appendChild(head)

  const chartSection = section("Green trips that stayed dry, by days ahead")
  const chartWrap = el("div", "chart-wrap")
  chartWrap.innerHTML = renderLeadDayChart(data.by_lead_day)
  chartSection.appendChild(chartWrap)
  root.appendChild(chartSection)

  const leadSection = section("By days ahead")
  leadSection.appendChild(
    table(
      "Dry rates by rating, and how well rain calls held up.",
      [
        "Days ahead",
        "Green dry",
        "Yellow dry",
        "Red wet",
        "Rain-chance error",
        "Rain caught",
        "False alarms",
        "Trips",
      ],
      data.by_lead_day.map((r) => [
        "Day " + r.lead_day,
        percent(r.green_trip_dry_rate),
        percent(r.okay_trip_dry_rate),
        percent(r.bad_trip_wet_rate),
        decimal(r.brier_pop),
        percent(r.rain_pod),
        percent(r.rain_far),
        count(r.n_trips),
      ])
    )
  )
  root.appendChild(leadSection)

  const corridorSection = section("By corridor, 1 day ahead")
  corridorSection.appendChild(
    table(
      "Green trips that stayed dry, per corridor.",
      ["Corridor", "Green dry", "Rain-chance error", "Trips"],
      data.by_corridor.map((c) => [
        c.name,
        percent(c.green_trip_dry_rate_day1),
        decimal(c.brier_pop_day1),
        count(c.n_trips_day1),
      ])
    )
  )
  root.appendChild(corridorSection)

  const method = section("How this is measured")
  method.classList.add("method")
  method.appendChild(
    el(
      "p",
      "",
      "Every day a pipeline replays the past forecasts that Open-Meteo kept for " +
        data.points +
        " points along " +
        data.corridors +
        " popular drives. For each possible departure hour it rates the trip with the same green, yellow and red scoring the app uses, then checks the weather that was actually observed along the route. A trip counts as dry when no point on it had rain at the time you would have passed."
    )
  )
  const link = el("a", "", "Read the full methodology and its limits")
  link.href = data.methodology_url
  link.rel = "noopener"
  const p = el("p")
  p.appendChild(link)
  p.appendChild(document.createTextNode("."))
  method.appendChild(p)
  root.appendChild(method)

  root.appendChild(
    el(
      "p",
      "generated",
      "Updated " +
        formatDate(data.generated_at) +
        " · " +
        count(data.departures_evaluated) +
        " departures evaluated · Weather data by Open-Meteo.com (CC BY 4.0)"
    )
  )
}

export function renderUnavailable(root: HTMLElement): void {
  root.textContent = ""
  root.appendChild(el("h1", "", "How accurate is the green light?"))
  root.appendChild(el("p", "empty", "Accuracy data not available yet"))
  root.appendChild(
    el(
      "p",
      "muted",
      "The accuracy numbers are refreshed once a day. Check back soon, or head back to the map."
    )
  )
}

async function load(): Promise<void> {
  const root = document.getElementById("accuracy") as HTMLElement
  try {
    const response = await fetch(ACCURACY_URL, { cache: "no-cache" })
    if (!response.ok) throw new Error("HTTP " + response.status)
    const data = parseAccuracy(await response.json())
    if (!data) throw new Error("Unexpected file format")
    renderAccuracy(root, data)
  } catch (error) {
    console.warn("Accuracy data unavailable:", error)
    renderUnavailable(root)
  }
}

void load()
