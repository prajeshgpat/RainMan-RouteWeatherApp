// Shareable links: ?from=&to=&leave=. Pure.

import { HOUR_MS } from "../../shared/weather"

export interface ShareState {
  from: string
  to: string
  leave: "now" | number
}

// ?from=<text|current>&to=<text>&leave=<epoch-hour ms|now> -> state or null
export function parseShareUrl(search: string | null | undefined): ShareState | null {
  const params = new URLSearchParams(search || "")
  const from = (params.get("from") || "").trim()
  const to = (params.get("to") || "").trim()
  if (!from || !to) return null
  const leaveRaw = params.get("leave")
  let leave: "now" | number = "now"
  if (leaveRaw && /^\d{10,14}$/.test(leaveRaw)) leave = Number(leaveRaw)
  return { from, to, leave }
}

// state -> query string starting with "?" (empty when there is no route)
export function serializeShareState(
  state: { from?: string; to?: string; leave?: "now" | number } | null
): string {
  if (!state || !state.from || !state.to) return ""
  const params = new URLSearchParams()
  params.set("from", state.from)
  params.set("to", state.to)
  params.set("leave", typeof state.leave === "number" ? String(state.leave) : "now")
  return "?" + params.toString()
}

// Start of the hour containing ms (UTC hours are the same instant for whole-hour offsets, and
// leave links use the whole-hour instant the sharer saw)
export function hourFloor(ms: number): number {
  return Math.floor(ms / HOUR_MS) * HOUR_MS
}
