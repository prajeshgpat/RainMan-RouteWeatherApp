// DOM rendering for the route chips, the alert banner, the recent-trip chips and the unit
// toggle. No Google Maps dependency, so each can be driven with fixture data.

import type { NwsAlert } from "../../shared/alerts"
import { truncateText } from "../features/alerts"
import { tripLabel, tripTitle } from "../features/recent"
import type { Trip } from "../features/recent"
import type { Unit } from "../features/units"
import { makeEl } from "./dom"

export interface RouteChipsModel {
  routes: Array<{ label: string; active: boolean }>
  hint?: { text: string; index: number } | null
}

// Hidden with fewer than two routes
export function renderRouteChips(
  model: RouteChipsModel,
  onSelect?: (index: number) => void,
  onHint?: (index: number) => void
): void {
  const wrap = document.getElementById("route-chips")
  if (!wrap) return
  const routes = (model && model.routes) || []
  wrap.hidden = routes.length < 2
  const list = document.getElementById("rc-list") as HTMLElement
  list.textContent = ""
  routes.forEach((r, i) => {
    const chip = makeEl("button", "rc-chip" + (r.active ? " active" : ""), r.label)
    chip.type = "button"
    chip.setAttribute("aria-pressed", r.active ? "true" : "false")
    chip.addEventListener("click", () => {
      if (onSelect) onSelect(i)
    })
    list.appendChild(chip)
  })
  const hint = document.getElementById("rc-hint") as HTMLButtonElement
  hint.hidden = !(model && model.hint)
  if (model && model.hint) {
    const target = model.hint
    hint.textContent = target.text
    hint.onclick = () => {
      if (onHint) onHint(target.index)
    }
  }
}

let alertBannerExpanded = false

// alerts = merged NWS alerts (see mergeAlerts); onDismiss is called by the close button
export function renderAlertBanner(alerts: NwsAlert[] | null, onDismiss?: () => void): void {
  const box = document.getElementById("alert-banner")
  if (!box) return
  box.textContent = ""
  if (!alerts || alerts.length === 0) {
    box.hidden = true
    alertBannerExpanded = false
    return
  }
  box.hidden = false
  const red = alerts.some((a) => a.level === "red")
  box.className = "alert-banner " + (red ? "red" : "amber")

  const top = alerts[0]
  const head = makeEl("div", "ab-head")
  const main = makeEl("button", "ab-main")
  main.type = "button"
  main.setAttribute("aria-expanded", alertBannerExpanded ? "true" : "false")
  main.appendChild(makeEl("span", "ab-icon", "⚠"))
  const text = makeEl("span", "ab-text")
  text.appendChild(makeEl("strong", "", top.event))
  const area = truncateText(top.areaDesc, 60)
  if (area) text.appendChild(document.createTextNode(" · " + area))
  main.appendChild(text)
  if (alerts.length > 1) main.appendChild(makeEl("span", "ab-more", "+" + (alerts.length - 1)))
  main.appendChild(makeEl("span", "ab-chevron", alertBannerExpanded ? "▴" : "▾"))
  main.addEventListener("click", () => {
    alertBannerExpanded = !alertBannerExpanded
    renderAlertBanner(alerts, onDismiss)
  })
  head.appendChild(main)
  const close = makeEl("button", "ab-close", "×")
  close.type = "button"
  close.setAttribute("aria-label", "Dismiss weather alerts")
  close.addEventListener("click", () => {
    alertBannerExpanded = false
    if (onDismiss) onDismiss()
  })
  head.appendChild(close)
  box.appendChild(head)

  if (alertBannerExpanded) {
    const list = makeEl("ul", "ab-list")
    alerts.forEach((a) => {
      const li = makeEl("li", "ab-item " + a.level)
      li.appendChild(makeEl("strong", "", a.event + " (" + a.severity + ")"))
      if (a.areaDesc) li.appendChild(makeEl("span", "ab-area", a.areaDesc))
      list.appendChild(li)
    })
    box.appendChild(list)
  }
}

// Shows chips with a delete button each
export function renderRecentTrips(
  trips: Trip[] | null,
  onPick?: (trip: Trip) => void,
  onRemove?: (index: number) => void
): void {
  const box = document.getElementById("recent-trips")
  if (!box) return
  box.textContent = ""
  box.hidden = !trips || trips.length === 0
  ;(trips || []).forEach((trip, i) => {
    const chip = makeEl("span", "recent-chip")
    const pick = makeEl("button", "recent-pick", tripLabel(trip))
    pick.type = "button"
    pick.title = tripTitle(trip)
    pick.addEventListener("click", () => {
      if (onPick) onPick(trip)
    })
    const del = makeEl("button", "recent-del", "×")
    del.type = "button"
    del.setAttribute("aria-label", "Remove " + tripLabel(trip) + " from recent trips")
    del.addEventListener("click", () => {
      if (onRemove) onRemove(i)
    })
    chip.appendChild(pick)
    chip.appendChild(del)
    box.appendChild(chip)
  })
}

export function renderUnitToggle(unit: Unit): void {
  const button = document.getElementById("unit-toggle")
  if (!button) return
  button.querySelectorAll(".unit-opt").forEach((opt) => {
    opt.classList.toggle("active", opt.getAttribute("data-unit") === unit)
  })
  button.setAttribute(
    "aria-label",
    "Temperature unit: " +
      (unit === "C"
        ? "Celsius. Tap to switch to Fahrenheit"
        : "Fahrenheit. Tap to switch to Celsius")
  )
}
