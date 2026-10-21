// Pure scoring helpers for the departure time bar.
// No DOM or Google Maps dependencies so they can be unit-tested in Node.

var BADNESS_WEIGHT_MAX = 0.6
var BADNESS_WEIGHT_MEAN = 0.4
var GOOD_BELOW = 0.2
var OKAY_BELOW = 0.5
var HOURLY_LENGTH = 48

// Base badness (0..1) for an OpenWeather condition id
function conditionBadness(id) {
  if (id >= 200 && id < 300) return 1.0 // thunderstorm
  if (id >= 300 && id < 400) return 0.3 // drizzle
  if (id >= 500 && id < 600) {
    if (id === 511) return 1.0 // freezing rain
    if ((id >= 502 && id <= 504) || id === 522 || id === 531) return 0.9 // heavy rain
    if (id === 501 || id === 521) return 0.6 // moderate rain
    if (id === 500 || id === 520) return 0.4 // light rain
    return 0.6
  }
  if (id >= 600 && id < 700) return 1.0 // snow
  if (id === 771 || id === 781) return 1.0 // squall, tornado
  if (id >= 700 && id < 800) return 0.4 // fog, dust, smoke
  return 0 // clear or clouds (800-804), unknown ids
}

// Badness of one hourly forecast entry, from 0 (great) to 1 (awful)
function hourBadness(entry) {
  if (!entry) return 0
  var w = entry.weather && entry.weather[0]
  var id = w ? Number(w.id) : 800
  var badness = Math.max(conditionBadness(id), (Number(entry.pop) || 0) * 0.5)
  var wind = Number(entry.wind_speed) || 0
  if (wind > 30) badness += 0.3
  else if (wind > 20) badness += 0.15
  return Math.min(1, Math.max(0, badness))
}

// Index into the hourly array for departure offset d and ETA t (hours), clamped
function hourIndex(d, etaHours, length) {
  var len = length == null ? HOURLY_LENGTH : length
  var idx = Math.round(d + etaHours)
  return Math.min(Math.max(idx, 0), Math.max(len - 1, 0))
}

// The forecast entry a driver meets at a sample when leaving d hours from now
function entryFor(sample, d) {
  if (!sample || !sample.hourly || sample.hourly.length === 0) return null
  return sample.hourly[hourIndex(d, sample.etaHours || 0, sample.hourly.length)]
}

// Score for leaving d hours from now (0 best .. 1 worst), or null if no sample has data
function departureScore(samples, d) {
  var max = 0
  var sum = 0
  var count = 0
  for (var i = 0; i < samples.length; i++) {
    var entry = entryFor(samples[i], d)
    if (!entry) continue
    var b = hourBadness(entry)
    if (b > max) max = b
    sum += b
    count++
  }
  if (count === 0) return null
  return BADNESS_WEIGHT_MAX * max + BADNESS_WEIGHT_MEAN * (sum / count)
}

function classify(score) {
  if (score == null || isNaN(score)) return "unknown"
  if (score < GOOD_BELOW) return "good"
  if (score < OKAY_BELOW) return "okay"
  return "bad"
}

// Earliest run of consecutive hours sharing the lowest score
function bestWindow(scores) {
  var min = Infinity
  for (var i = 0; i < scores.length; i++) {
    if (scores[i] != null && scores[i] < min) min = scores[i]
  }
  if (min === Infinity) return null
  var eps = 1e-9
  var start = -1
  for (var j = 0; j < scores.length; j++) {
    if (scores[j] != null && scores[j] - min < eps) {
      start = j
      break
    }
  }
  var end = start
  while (end + 1 < scores.length && scores[end + 1] != null && scores[end + 1] - min < eps) end++
  return { start: start, end: end, score: min }
}

// Largest departure offset (hours) the 48h forecast can cover; negative if the trip is too long
function maxDepartureOffset(tripHours) {
  return Math.min(24, HOURLY_LENGTH - 1 - Math.ceil(tripHours))
}

// Worst conditions met along the route when leaving d hours from now
function worstStop(samples, d) {
  var worst = null
  for (var i = 0; i < samples.length; i++) {
    var entry = entryFor(samples[i], d)
    if (!entry) continue
    var b = hourBadness(entry)
    if (worst === null || b > worst.badness) {
      var w = entry.weather && entry.weather[0]
      worst = {
        sampleIndex: i,
        badness: b,
        description: w && w.description ? String(w.description).toLowerCase() : "unknown",
      }
    }
  }
  return worst
}

// One record per departure hour 0..maxD for the time bar
function computeDepartures(samples, maxD, nowMs) {
  var hourStart = new Date(nowMs)
  hourStart.setMinutes(0, 0, 0)
  var out = []
  for (var d = 0; d <= maxD; d++) {
    var score = departureScore(samples, d)
    out.push({
      d: d,
      timeMs: d === 0 ? nowMs : hourStart.getTime() + d * 3600000,
      score: score,
      cls: classify(score),
      worst: worstStop(samples, d),
    })
  }
  return out
}

if (typeof module !== "undefined") {
  module.exports = {
    conditionBadness: conditionBadness,
    hourBadness: hourBadness,
    hourIndex: hourIndex,
    entryFor: entryFor,
    departureScore: departureScore,
    classify: classify,
    bestWindow: bestWindow,
    maxDepartureOffset: maxDepartureOffset,
    worstStop: worstStop,
    computeDepartures: computeDepartures,
  }
}
