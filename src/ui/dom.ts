// Small DOM helpers.

// The element with this id (the ids are all in index.html)
export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T
}

export function makeEl<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string | null
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  if (className) el.className = className
  if (text != null) el.textContent = text
  return el
}

// Path of a file in public/, honouring the Vite base
export function assetUrl(path: string): string {
  return import.meta.env.BASE_URL + path
}
