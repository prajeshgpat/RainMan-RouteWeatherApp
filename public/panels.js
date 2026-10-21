// DOM rendering for the route chips, the alert banner, the recent-trip chips and the unit toggle.
// No Google Maps dependency, so each can be driven with fixture data.

function panelEl(tag, className, text) {
  var el = document.createElement(tag)
  if (className) el.className = className
  if (text != null) el.textContent = text
  return el
}

// model = { routes: [{ label, active }], hint: { text } | null }. Hidden with fewer than two routes.
function renderRouteChips(model, onSelect, onHint) {
  var wrap = document.getElementById("route-chips")
  if (!wrap) return
  var routes = (model && model.routes) || []
  wrap.hidden = routes.length < 2
  var list = document.getElementById("rc-list")
  list.textContent = ""
  routes.forEach(function (r, i) {
    var chip = panelEl("button", "rc-chip" + (r.active ? " active" : ""), r.label)
    chip.type = "button"
    chip.setAttribute("aria-pressed", r.active ? "true" : "false")
    chip.addEventListener("click", function () {
      if (onSelect) onSelect(i)
    })
    list.appendChild(chip)
  })
  var hint = document.getElementById("rc-hint")
  hint.hidden = !(model && model.hint)
  if (model && model.hint) {
    hint.textContent = model.hint.text
    hint.onclick = function () {
      if (onHint) onHint(model.hint.index)
    }
  }
}

var alertBannerExpanded = false

// alerts = merged NWS alerts (see mergeAlerts); onDismiss is called by the close button
function renderAlertBanner(alerts, onDismiss) {
  var box = document.getElementById("alert-banner")
  if (!box) return
  box.textContent = ""
  if (!alerts || alerts.length === 0) {
    box.hidden = true
    alertBannerExpanded = false
    return
  }
  box.hidden = false
  var red = alerts.some(function (a) {
    return a.level === "red"
  })
  box.className = "alert-banner " + (red ? "red" : "amber")

  var top = alerts[0]
  var head = panelEl("div", "ab-head")
  var main = panelEl("button", "ab-main")
  main.type = "button"
  main.setAttribute("aria-expanded", alertBannerExpanded ? "true" : "false")
  main.appendChild(panelEl("span", "ab-icon", "⚠"))
  var text = panelEl("span", "ab-text")
  text.appendChild(panelEl("strong", "", top.event))
  var area = truncateText(top.areaDesc, 60)
  if (area) text.appendChild(document.createTextNode(" · " + area))
  main.appendChild(text)
  if (alerts.length > 1) main.appendChild(panelEl("span", "ab-more", "+" + (alerts.length - 1)))
  main.appendChild(panelEl("span", "ab-chevron", alertBannerExpanded ? "▴" : "▾"))
  main.addEventListener("click", function () {
    alertBannerExpanded = !alertBannerExpanded
    renderAlertBanner(alerts, onDismiss)
  })
  head.appendChild(main)
  var close = panelEl("button", "ab-close", "×")
  close.type = "button"
  close.setAttribute("aria-label", "Dismiss weather alerts")
  close.addEventListener("click", function () {
    alertBannerExpanded = false
    if (onDismiss) onDismiss()
  })
  head.appendChild(close)
  box.appendChild(head)

  if (alertBannerExpanded) {
    var list = panelEl("ul", "ab-list")
    alerts.forEach(function (a) {
      var li = panelEl("li", "ab-item " + a.level)
      li.appendChild(panelEl("strong", "", a.event + " (" + a.severity + ")"))
      if (a.areaDesc) li.appendChild(panelEl("span", "ab-area", a.areaDesc))
      list.appendChild(li)
    })
    box.appendChild(list)
  }
}

// trips = [{ from, to }]; shows chips with a delete button each
function renderRecentTrips(trips, onPick, onRemove) {
  var box = document.getElementById("recent-trips")
  if (!box) return
  box.textContent = ""
  box.hidden = !trips || trips.length === 0
  ;(trips || []).forEach(function (trip, i) {
    var chip = panelEl("span", "recent-chip")
    var pick = panelEl("button", "recent-pick", tripLabel(trip))
    pick.type = "button"
    pick.title = shortFull(trip)
    pick.addEventListener("click", function () {
      if (onPick) onPick(trip)
    })
    var del = panelEl("button", "recent-del", "×")
    del.type = "button"
    del.setAttribute("aria-label", "Remove " + tripLabel(trip) + " from recent trips")
    del.addEventListener("click", function () {
      if (onRemove) onRemove(i)
    })
    chip.appendChild(pick)
    chip.appendChild(del)
    box.appendChild(chip)
  })
}

function shortFull(trip) {
  return (trip.from === "current" ? "Current location" : trip.from) + " to " + trip.to
}

function renderUnitToggle(unit) {
  var button = document.getElementById("unit-toggle")
  if (!button) return
  Array.prototype.forEach.call(button.querySelectorAll(".unit-opt"), function (opt) {
    opt.classList.toggle("active", opt.getAttribute("data-unit") === unit)
  })
  button.setAttribute(
    "aria-label",
    "Temperature unit: " + (unit === "C" ? "Celsius. Tap to switch to Fahrenheit" : "Fahrenheit. Tap to switch to Celsius")
  )
}
