// Temperature units (data stays in F, converted for display only). Pure.

export const UNIT_KEY = "rm:unit"

export type Unit = "F" | "C"

export function normalizeUnit(value: unknown): Unit {
  return value === "C" ? "C" : "F"
}

export function convertTemp(f: number | string | null | undefined, unit: Unit): number | null {
  if (f == null || isNaN(Number(f))) return null
  return unit === "C" ? Math.round(((Number(f) - 32) * 5) / 9) : Math.round(Number(f))
}

// "58°F" / "14°C"
export function tempLabel(f: number | string | null | undefined, unit: Unit): string {
  const v = convertTemp(f, unit)
  return v === null ? "" : v + "°" + normalizeUnit(unit)
}
