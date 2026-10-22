// Dark mode: the page colours follow the CSS media query; the Google map needs its night style
// set in code.

import { MAP_DARK_STYLES } from "../features/darkStyle"
import { state } from "../state"

function darkModeQuery(): MediaQueryList | null {
  return window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null
}

export function darkModeOn(): boolean {
  const query = darkModeQuery()
  return !!query && query.matches
}

export function watchDarkMode(): void {
  const query = darkModeQuery()
  if (!query) return
  const apply = () => {
    state.map.setOptions({ styles: query.matches ? MAP_DARK_STYLES : null })
  }
  if (query.addEventListener) query.addEventListener("change", apply)
  else if (query.addListener) query.addListener(apply)
}
