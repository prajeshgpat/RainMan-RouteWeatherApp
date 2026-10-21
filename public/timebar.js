// Departure time bar rendering. DOM only: no dependency on Google Maps,
// so it can be driven with fixture data (see renderTimeBar below).
//
// model = {
//   departures: [{ d, timeMs, score, cls, worst: { sampleIndex, description } | null }],
//   best: { start, end } | null,   // indexes into departures
//   selected: 0,                   // selected departure offset
//   loading: false,                // show the "Updating forecast..." spinner
//   places: [],                    // optional place name per sample index
//   note: ""                       // optional message shown instead of the segments
// }

var TB_CLASS_LABEL = { good: "good", okay: "okay", bad: "bad", unknown: "no data" }

function tbHourLabel(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: "numeric" })
}

function tbDescribe(model, dep) {
  if (!dep || !dep.worst) return "no forecast"
  var place = model.places && model.places[dep.worst.sampleIndex]
  return dep.worst.description + (place ? " near " + place : "")
}

function tbSegmentText(model, dep) {
  var when = dep.d === 0 ? "now" : tbHourLabel(dep.timeMs)
  return "Leave " + when + ": " + TB_CLASS_LABEL[dep.cls] + ", " + tbDescribe(model, dep)
}

function tbTitle(model) {
  var deps = model.departures || []
  if (model.note) return model.note
  if (deps.length === 0) return model.loading ? "Updating forecast…" : ""
  if (!model.best) return "No forecast available for this route"
  var first = deps[model.best.start]
  var last = deps[model.best.end]
  var range
  if (model.best.start === 0 && model.best.end === 0) range = "now"
  else if (model.best.start === model.best.end) range = tbHourLabel(first.timeMs)
  else range = (first.d === 0 ? "now" : tbHourLabel(first.timeMs)) + " – " + tbHourLabel(last.timeMs)
  return "Best time to leave: " + range + " (" + (first.worst ? first.worst.description : "no data") + ")"
}

function tbSubtitle(model) {
  var deps = model.departures || []
  var dep = deps[model.selected]
  if (model.note || !dep) return ""
  var when = dep.d === 0 ? "Leaving now" : "Leaving " + tbHourLabel(dep.timeMs)
  return when + ": " + TB_CLASS_LABEL[dep.cls] + " — " + tbDescribe(model, dep)
}

function renderTimeBar(model, onSelect) {
  var bar = document.getElementById("time-bar")
  if (!bar) return
  if (model.hidden) {
    bar.hidden = true
    return
  }
  bar.hidden = false
  document.getElementById("tb-title").textContent = tbTitle(model)
  document.getElementById("tb-sub").textContent = tbSubtitle(model)
  document.getElementById("tb-spinner").hidden = !model.loading
  bar.setAttribute("aria-busy", model.loading ? "true" : "false")

  var scroller = document.getElementById("tb-scroll")
  var seg = document.getElementById("tb-segments")
  var prevScroll = scroller.scrollLeft
  seg.textContent = ""
  scroller.hidden = !model.departures || model.departures.length === 0

  ;(model.departures || []).forEach(function (dep, i) {
    var date = new Date(dep.timeMs)
    var hour = date.getHours()
    var isMidnight = hour === 0 && dep.d !== 0
    var inBest = model.best && i >= model.best.start && i <= model.best.end

    var btn = document.createElement("button")
    btn.type = "button"
    btn.className = "tb-seg " + dep.cls
    if (dep.d === model.selected) btn.classList.add("selected")
    if (inBest) {
      btn.classList.add("best")
      if (i === model.best.start) btn.classList.add("best-first")
      if (i === model.best.end) btn.classList.add("best-last")
    }
    if (isMidnight) btn.classList.add("day-start")
    btn.setAttribute("aria-pressed", dep.d === model.selected ? "true" : "false")
    var text = tbSegmentText(model, dep)
    btn.setAttribute("aria-label", text)
    btn.title = text + (inBest ? " (best window)" : "")

    var block = document.createElement("span")
    block.className = "tb-block"
    block.setAttribute("aria-hidden", "true")
    if (inBest && i === model.best.start) block.textContent = "★"
    btn.appendChild(block)

    var label = document.createElement("span")
    label.className = "tb-label"
    label.setAttribute("aria-hidden", "true")
    if (dep.d === 0) label.textContent = "Now"
    else if (isMidnight) label.textContent = date.toLocaleDateString([], { weekday: "short" })
    else if (hour % 3 === 0) label.textContent = tbHourLabel(dep.timeMs)
    btn.appendChild(label)

    btn.addEventListener("click", function () {
      if (onSelect) onSelect(dep.d)
    })
    seg.appendChild(btn)
  })
  scroller.scrollLeft = prevScroll
}
