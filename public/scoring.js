// Pure scoring helpers for the departure time bar.
// No DOM or Google Maps dependencies so they can be unit-tested in Node.

var BADNESS_WEIGHT_MAX = 0.6
var BADNESS_WEIGHT_MEAN = 0.4
var GOOD_BELOW = 0.2
var OKAY_BELOW = 0.5
var MAX_DEPARTURE_HOURS = 48
var ICE_MAX_TEMP_F = 34
var NIGHT_PENALTY = 0.1

// Base badness (0..1) by WMO weather code (Open-Meteo weather_code)
var WMO_BADNESS = {
  0: 0, 1: 0, 2: 0, 3: 0,
  45: 0.4, 48: 0.6,
  51: 0.2, 53: 0.3, 55: 0.4,
  56: 1.0, 57: 1.0,
  61: 0.4, 63: 0.6, 65: 0.9,
  66: 1.0, 67: 1.0,
  71: 0.8, 73: 1.0, 75: 1.0, 77: 0.8,
  80: 0.4, 81: 0.6, 82: 0.9,
  85: 1.0, 86: 1.0,
  95: 1.0, 96: 1.0, 99: 1.0,
}

var WMO_DESCRIPTIONS = {
  0: "clear sky", 1: "mainly clear", 2: "partly cloudy", 3: "overcast",
  45: "fog", 48: "rime fog",
  51: "light drizzle", 53: "drizzle", 55: "heavy drizzle",
  56: "freezing drizzle", 57: "heavy freezing drizzle",
  61: "light rain", 63: "rain", 65: "heavy rain",
  66: "freezing rain", 67: "heavy freezing rain",
  71: "light snow", 73: "snow", 75: "heavy snow", 77: "snow grains",
  80: "light showers", 81: "showers", 82: "heavy showers",
  85: "light snow showers", 86: "snow showers",
  95: "thunderstorm", 96: "thunderstorm with hail", 99: "thunderstorm with heavy hail",
}

// Base badness (0..1) for a WMO weather code; unknown codes count as fine
function conditionBadness(code) {
  var b = WMO_BADNESS[Number(code)]
  return b === undefined ? 0 : b
}

function conditionDescription(code) {
  return WMO_DESCRIPTIONS[Number(code)] || "unknown"
}

// Liquid precipitation (drizzle, rain, showers) that freezes into ice on cold roads
function isLiquidPrecip(code) {
  var c = Number(code)
  return (c >= 51 && c <= 55) || (c >= 61 && c <= 65) || (c >= 80 && c <= 82)
}

function isIcy(entry) {
  return !!entry && isLiquidPrecip(entry.code) && entry.temp != null && Number(entry.temp) <= ICE_MAX_TEMP_F
}

function isNight(entry) {
  return !!entry && entry.isDay === false
}

// Human description of an hourly entry, e.g. "heavy rain (icy) at night"
function entryDescription(entry) {
  var description = conditionDescription(entry.code)
  if (isIcy(entry)) description += " (icy)"
  if (isNight(entry)) description += " at night"
  return description
}

// Badness of one hourly forecast entry { temp, pop, wind, gust, code, isDay }, 0 (great) to 1 (awful)
function hourBadness(entry) {
  if (!entry) return 0
  var badness = Math.max(conditionBadness(entry.code), (Number(entry.pop) || 0) * 0.5)
  if (isIcy(entry)) badness = 1
  var wind = Number(entry.wind) || 0
  if (wind > 30) badness += 0.3
  else if (wind > 20) badness += 0.15
  if ((Number(entry.gust) || 0) > 45) badness += 0.15
  if (isNight(entry)) badness += NIGHT_PENALTY
  return Math.min(1, Math.max(0, badness))
}

// Index into the hourly array for departure offset d and ETA t (hours), clamped
function hourIndex(d, etaHours, length) {
  var idx = Math.round(d + etaHours)
  if (length != null) idx = Math.min(idx, Math.max(length - 1, 0))
  return Math.max(idx, 0)
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

// Largest departure offset (hours) the forecast can cover; negative if the trip is too long
function maxDepartureOffset(tripHours, hourlyLength) {
  return Math.min(MAX_DEPARTURE_HOURS, hourlyLength - 1 - Math.ceil(tripHours))
}

// Worst conditions met along the route when leaving d hours from now
function worstStop(samples, d) {
  var worst = null
  for (var i = 0; i < samples.length; i++) {
    var entry = entryFor(samples[i], d)
    if (!entry) continue
    var b = hourBadness(entry)
    if (worst === null || b > worst.badness) {
      worst = {
        sampleIndex: i,
        badness: b,
        description: entryDescription(entry),
        code: entry.code,
        isDay: entry.isDay !== false,
        wind: Number(entry.wind) || 0,
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
    var first = entryFor(samples[0], d)
    out.push({
      d: d,
      timeMs: d === 0 ? nowMs : hourStart.getTime() + d * 3600000,
      score: score,
      cls: classify(score),
      worst: worstStop(samples, d),
      night: isNight(first), // it is dark at the start of the drive
    })
  }
  return out
}

if (typeof module !== "undefined") {
  module.exports = {
    WMO_BADNESS: WMO_BADNESS,
    WMO_DESCRIPTIONS: WMO_DESCRIPTIONS,
    conditionBadness: conditionBadness,
    conditionDescription: conditionDescription,
    isIcy: isIcy,
    entryDescription: entryDescription,
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
