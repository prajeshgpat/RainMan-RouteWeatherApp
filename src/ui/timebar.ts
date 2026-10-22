// Departure time bar rendering. DOM only: no dependency on Google Maps, so it can be driven with
// fixture data (see renderTimeBar below).
//
// A departure with night: true starts after dark and gets a night stripe.

import type { BestWindow, Departure, Severity } from "../scoring/scoring"
import { weatherIconName } from "../weather/icons"
import { assetUrl, byId } from "./dom"

export interface TimeBarModel {
  hidden?: boolean
  departures?: Departure[]
  best?: BestWindow | null // indexes into departures
  selected?: number // selected departure offset
  loading?: boolean // show the "Updating forecast..." spinner
  places?: Array<string | null> // optional place name per sample index
  note?: string // optional message shown instead of the segments
}

const TB_CLASS_LABEL: Record<Severity, string> = {
  good: "good",
  okay: "okay",
  bad: "bad",
  unknown: "no data",
}

function tbHourLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "numeric" })
}

function tbDescribe(model: TimeBarModel, dep: Departure | undefined): string {
  if (!dep || !dep.worst) return "no forecast"
  const place = model.places && model.places[dep.worst.sampleIndex]
  return dep.worst.description + (place ? " near " + place : "")
}

function tbSegmentText(model: TimeBarModel, dep: Departure): string {
  const when = dep.d === 0 ? "now" : tbHourLabel(dep.timeMs)
  return (
    "Leave " +
    when +
    (dep.night ? " (night)" : "") +
    ": " +
    TB_CLASS_LABEL[dep.cls] +
    ", " +
    tbDescribe(model, dep)
  )
}

function tbTitle(model: TimeBarModel): string {
  const deps = model.departures || []
  if (model.note) return model.note
  if (deps.length === 0) return model.loading ? "Updating forecast…" : ""
  if (!model.best) return "No forecast available for this route"
  const first = deps[model.best.start]
  const last = deps[model.best.end]
  let range: string
  if (model.best.start === 0 && model.best.end === 0) range = "now"
  else if (model.best.start === model.best.end) range = tbHourLabel(first.timeMs)
  else
    range = (first.d === 0 ? "now" : tbHourLabel(first.timeMs)) + " – " + tbHourLabel(last.timeMs)
  return (
    "Best time to leave: " +
    range +
    " (" +
    (first.worst ? first.worst.description : "no data") +
    ")"
  )
}

function tbSubtitle(model: TimeBarModel): string {
  const deps = model.departures || []
  const dep = deps[model.selected as number]
  if (model.note || !dep) return ""
  const when = dep.d === 0 ? "Leaving now" : "Leaving " + tbHourLabel(dep.timeMs)
  return when + ": " + TB_CLASS_LABEL[dep.cls] + " — " + tbDescribe(model, dep)
}

// Icon for the best window: the worst condition met when leaving at its first hour
function tbIconName(model: TimeBarModel): string | null {
  const deps = model.departures || []
  if (model.note || !model.best) return null
  const dep = deps[model.best.start]
  if (!dep || !dep.worst) return null
  return weatherIconName(dep.worst.code, dep.worst.isDay, dep.worst.wind)
}

export function renderTimeBar(model: TimeBarModel, onSelect?: (d: number) => void): void {
  const bar = document.getElementById("time-bar")
  if (!bar) return
  if (model.hidden) {
    bar.hidden = true
    return
  }
  bar.hidden = false
  byId("tb-title").textContent = tbTitle(model)
  byId("tb-sub").textContent = tbSubtitle(model)
  const iconName = tbIconName(model)
  const iconEl = byId<HTMLImageElement>("tb-icon")
  iconEl.hidden = !iconName
  if (iconName) {
    iconEl.src = assetUrl("icons/" + iconName + ".svg")
    iconEl.alt = ""
  }
  byId("tb-spinner").hidden = !model.loading
  bar.setAttribute("aria-busy", model.loading ? "true" : "false")

  const scroller = byId("tb-scroll")
  const seg = byId("tb-segments")
  const prevScroll = scroller.scrollLeft
  seg.textContent = ""
  scroller.hidden = !model.departures || model.departures.length === 0

  const best = model.best
  ;(model.departures || []).forEach((dep, i) => {
    const date = new Date(dep.timeMs)
    const hour = date.getHours()
    const isMidnight = hour === 0 && dep.d !== 0
    const inBest = !!best && i >= best.start && i <= best.end

    const btn = document.createElement("button")
    btn.type = "button"
    btn.className = "tb-seg " + dep.cls
    if (dep.d === model.selected) btn.classList.add("selected")
    if (inBest && best) {
      btn.classList.add("best")
      if (i === best.start) btn.classList.add("best-first")
      if (i === best.end) btn.classList.add("best-last")
    }
    if (isMidnight) btn.classList.add("day-start")
    if (dep.night) btn.classList.add("night")
    btn.setAttribute("aria-pressed", dep.d === model.selected ? "true" : "false")
    const text = tbSegmentText(model, dep)
    btn.setAttribute("aria-label", text)
    btn.title = text + (inBest ? " (best window)" : "")

    const block = document.createElement("span")
    block.className = "tb-block"
    block.setAttribute("aria-hidden", "true")
    if (inBest && best && i === best.start) block.textContent = "★"
    btn.appendChild(block)

    const nightMark = document.createElement("span")
    nightMark.className = "tb-night"
    nightMark.setAttribute("aria-hidden", "true")
    btn.appendChild(nightMark)

    const label = document.createElement("span")
    label.className = "tb-label"
    label.setAttribute("aria-hidden", "true")
    if (dep.d === 0) label.textContent = "Now"
    else if (isMidnight) label.textContent = date.toLocaleDateString([], { weekday: "short" })
    else if (hour % 3 === 0) label.textContent = tbHourLabel(dep.timeMs)
    btn.appendChild(label)

    btn.addEventListener("click", () => {
      if (onSelect) onSelect(dep.d)
    })
    seg.appendChild(btn)
  })
  scroller.scrollLeft = prevScroll
}
