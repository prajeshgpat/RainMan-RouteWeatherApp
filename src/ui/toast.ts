import { state } from "../state"

export type ToastKind = "info" | "error" | "loading" | "success"

export interface ToastOptions {
  kind?: ToastKind
  sticky?: boolean
}

export function showToast(message: string, options: ToastOptions = {}): void {
  const toast = document.getElementById("toast") as HTMLElement
  if (state.toastTimer) clearTimeout(state.toastTimer)
  toast.textContent = ""
  if (options.kind === "loading") {
    const spinner = document.createElement("span")
    spinner.className = "spinner"
    spinner.setAttribute("aria-hidden", "true")
    toast.appendChild(spinner)
  }
  toast.appendChild(document.createTextNode(message))
  toast.className = "toast " + (options.kind || "info")
  toast.hidden = false
  if (!options.sticky) state.toastTimer = setTimeout(hideToast, 7000)
}

export function hideToast(): void {
  if (state.toastTimer) clearTimeout(state.toastTimer)
  ;(document.getElementById("toast") as HTMLElement).hidden = true
}
