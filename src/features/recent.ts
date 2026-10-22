// Recent trips (last 5, localStorage). Pure apart from the storage passed in.

import { storageGet, storageSet } from "../weather/cache"
import type { StorageLike } from "../weather/cache"

export const RECENT_KEY = "rm:recent"
export const RECENT_MAX = 5

export interface Trip {
  from: string // "current" for the current location
  to: string
}

function sameTrip(a: Trip, b: Trip): boolean {
  return a.from.toLowerCase() === b.from.toLowerCase() && a.to.toLowerCase() === b.to.toLowerCase()
}

// Newest first, no duplicates, at most RECENT_MAX
export function addRecentTrip(list: Trip[], trip: Partial<Trip>): Trip[] {
  const from = String(trip.from || "").trim()
  const to = String(trip.to || "").trim()
  if (!from || !to) return list.slice()
  const entry = { from, to }
  const out = [entry].concat(list.filter((t) => !sameTrip(t, entry)))
  return out.slice(0, RECENT_MAX)
}

export function removeRecentTrip(list: Trip[], index: number): Trip[] {
  return list.filter((_, i) => i !== index)
}

export function loadRecentTrips(storage: StorageLike | null): Trip[] {
  if (!storage) return []
  const list = storageGet<unknown>(storage, RECENT_KEY)
  if (!Array.isArray(list)) return []
  return (list as Array<Partial<Trip> | null>)
    .filter(
      (t): t is Trip =>
        !!t && typeof t.from === "string" && typeof t.to === "string" && !!t.from && !!t.to
    )
    .slice(0, RECENT_MAX)
}

export function saveRecentTrips(storage: StorageLike | null, list: Trip[]): boolean {
  if (!storage) return false
  return storageSet(storage, RECENT_KEY, list)
}

function shortPlace(text: string): string {
  return text === "current" ? "Current location" : String(text).split(",")[0].trim()
}

export function tripLabel(trip: Trip): string {
  return shortPlace(trip.from) + " → " + shortPlace(trip.to)
}

export function tripTitle(trip: Trip): string {
  return (trip.from === "current" ? "Current location" : trip.from) + " to " + trip.to
}
