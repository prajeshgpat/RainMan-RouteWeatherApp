// localStorage / sessionStorage cache helpers for forecasts and reverse-geocoded place names.
// No DOM or Google Maps dependencies, so they can be unit-tested with a fake storage.

import { HOUR_MS, sliceFromNow, roundTo, wxCell } from "../../shared/weather"
import type { HourlyEntry } from "../../shared/weather"

export { HOUR_MS, roundTo, wxCell }

export const WX_TTL_MS = 45 * 60 * 1000
export const WX_MAX_CELLS = 300
export const GEO_MAX_ENTRIES = 300

// The subset of the Web Storage API the app uses
export interface StorageLike {
  readonly length: number
  key(index: number): string | null
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

// Reverse geocode cache key: 0.05 degree grid
export function geoKey(lat: number, lng: number): string {
  return "geo:" + roundTo(lat, 0.05, 2) + ":" + roundTo(lng, 0.05, 2)
}

export function storageSet(storage: StorageLike | null, key: string, value: unknown): boolean {
  try {
    if (!storage) return false
    storage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export function storageGet<T = unknown>(storage: StorageLike | null, key: string): T | null {
  try {
    if (!storage) return null
    const raw = storage.getItem(key)
    return raw == null ? null : (JSON.parse(raw) as T)
  } catch {
    return null
  }
}

interface WxRecord {
  fetchedAt: number
  hourly: HourlyEntry[]
}

// Cached hourly forecast for a cell, re-sliced to the current hour, or null on miss/expiry
export function wxCacheGet(
  storage: StorageLike | null,
  key: string,
  nowMs: number
): HourlyEntry[] | null {
  if (!storage) return null
  const rec = storageGet<WxRecord>(storage, key)
  if (!rec || !Array.isArray(rec.hourly) || typeof rec.fetchedAt !== "number") return null
  if (nowMs - rec.fetchedAt > WX_TTL_MS || rec.fetchedAt > nowMs + 60000) return null
  const hourly = sliceFromNow(rec.hourly, nowMs)
  return hourly.length > 0 ? hourly : null
}

export function wxCachePut(
  storage: StorageLike | null,
  key: string,
  hourly: HourlyEntry[],
  nowMs: number
): boolean {
  if (!storage) return false
  return storageSet(storage, key, { fetchedAt: nowMs, hourly })
}

export function storageKeys(storage: StorageLike, prefix: string): string[] {
  const keys: string[] = []
  try {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i)
      if (k && k.indexOf(prefix) === 0) keys.push(k)
    }
  } catch {
    // storage unavailable: no keys
  }
  return keys
}

export function storageRemove(storage: StorageLike, key: string): void {
  try {
    storage.removeItem(key)
  } catch {
    // storage unavailable
  }
}

// Remove expired forecast cells, then evict the oldest beyond the cap
export function wxCachePrune(storage: StorageLike | null, nowMs: number, maxCells?: number): void {
  if (!storage) return
  const cap = maxCells || WX_MAX_CELLS
  const live: Array<{ key: string; at: number }> = []
  storageKeys(storage, "wx:").forEach((key) => {
    const rec = storageGet<WxRecord>(storage, key)
    if (!rec || typeof rec.fetchedAt !== "number" || nowMs - rec.fetchedAt > WX_TTL_MS) {
      storageRemove(storage, key)
    } else {
      live.push({ key, at: rec.fetchedAt })
    }
  })
  live.sort((a, b) => a.at - b.at)
  while (live.length > cap) storageRemove(storage, (live.shift() as { key: string }).key)
}

// Reverse geocode results: { name, at }, no TTL
export function geoCacheGet(storage: StorageLike | null, key: string): string | null {
  if (!storage) return null
  const rec = storageGet<{ name?: unknown }>(storage, key)
  return rec && typeof rec.name === "string" ? rec.name : null
}

export function geoCachePut(
  storage: StorageLike | null,
  key: string,
  name: string,
  nowMs: number
): boolean {
  if (!storage) return false
  const ok = storageSet(storage, key, { name, at: nowMs })
  if (ok) geoCachePrune(storage, GEO_MAX_ENTRIES)
  return ok
}

export function geoCachePrune(storage: StorageLike | null, maxEntries: number): void {
  if (!storage) return
  const keys = storageKeys(storage, "geo:")
  if (keys.length <= maxEntries) return
  const recs = keys.map((key) => {
    const rec = storageGet<{ at?: unknown }>(storage, key)
    return { key, at: rec && typeof rec.at === "number" ? rec.at : 0 }
  })
  recs.sort((a, b) => a.at - b.at)
  for (let i = 0; i < recs.length - maxEntries; i++) storageRemove(storage, recs[i].key)
}
