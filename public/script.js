var SAMPLE_STEP_METERS = 25 * 1609.34 // a weather sample about every 25 miles
var MAX_SAMPLES = 60
var MIN_END_GAP_METERS = 3 * 1609.34 // drop an intermediate sample this close to the destination
var FALLBACK_LATLNG = { lat: 37.775, lng: -122.434 }

var map
var directionsService
var directionsDisplay
var startInput
var destinationInput

// Selected endpoints: { text: string shown in the input, loc: LatLng | literal, source: "user" | "geo" }
var startSel = null
var destSel = null
var startMarker = null
var userMarker = null
var userLatLng = null
var routeEndMarkers = [] // custom start/end pins for the drawn route

// Weather icon SVG text by icon name, preloaded so marker data URIs can embed them
var iconTextCache = {}
var iconsReady = null
// Reverse-geocoded place names by geoKey (also persisted in localStorage)
var placeCache = {}
var placePending = {}
var store = null // localStorage, or null when unavailable

// Per-route state, all reset by resetRoute()
var requestId = 0 // incremented for every route search/reset; stale async results are ignored
var samples = [] // { latLng, distMeters, etaHours, hourly, place, marker }
var departures = []
var bestRange = null
var selectedD = 0
var maxD = 0
var routeShown = false
var openSampleIndex = -1
var barLoading = false
var toastTimer = null

function initMap() {
  directionsService = new google.maps.DirectionsService()
  directionsDisplay = new google.maps.DirectionsRenderer({ suppressMarkers: true })
  store = getStore()
  wxCachePrune(store, Date.now())
  iconsReady = loadIcons()
  map = new google.maps.Map(document.getElementById("map"), {
    zoom: 13,
    center: FALLBACK_LATLNG,
    mapTypeControlOptions: {
      mapTypeIds: [],
    },
    fullscreenControl: false,
    streetViewControl: false,
    zoomControl: false,
  })

  startInput = document.getElementById("search-input")
  destinationInput = document.getElementById("destination-input")
  var autocompleteOptions = { fields: ["geometry", "name", "formatted_address"] }
  var startAutocomplete = new google.maps.places.Autocomplete(startInput, autocompleteOptions)
  var destinationAutocomplete = new google.maps.places.Autocomplete(destinationInput, autocompleteOptions)

  document.getElementById("clear-button").addEventListener("click", clearAll)
  document.getElementById("swap-button").addEventListener("click", swapEndpoints)
  document.getElementById("current-location-button").addEventListener("click", function () {
    getCurrentLocation(true)
  })
  document.getElementById("weather-info-close").addEventListener("click", hidePopup)
  document.getElementById("toast").addEventListener("click", hideToast)

  // Registered once: clicking the map hides the weather popup
  map.addListener("click", hidePopup)

  startAutocomplete.addListener("place_changed", function () {
    var place = startAutocomplete.getPlace()
    if (!placeLocation(place)) {
      // Enter on typed text: route using the text as an address (see resolveEndpoint)
      if (!startInput.value.trim()) return
      startSel = null
      computeRoute()
      return
    }
    startSel = { text: startInput.value, loc: place.geometry.location, source: "user" }
    syncStartMarker()
    if (!routeShown) {
      map.panTo(place.geometry.location)
      map.setZoom(14)
    }
    computeRoute()
  })

  destinationAutocomplete.addListener("place_changed", function () {
    var place = destinationAutocomplete.getPlace()
    if (!placeLocation(place)) {
      if (!destinationInput.value.trim()) return
      destSel = null
      computeRoute()
      return
    }
    destSel = { text: destinationInput.value, loc: place.geometry.location, source: "user" }
    if (!resolveEndpoint(startSel, startInput)) {
      map.panTo(place.geometry.location)
      map.setZoom(12)
    }
    computeRoute()
  })

  // Default the start to the user's current location
  if (navigator.geolocation) {
    getCurrentLocation(false)
  } else {
    showToast("Geolocation is not supported by your browser.", { kind: "error" })
  }
}

function placeLocation(place) {
  return place && place.geometry && place.geometry.location ? place.geometry.location : null
}

function getStore() {
  try {
    return window.localStorage
  } catch (e) {
    return null
  }
}

// A selected place if the input still matches it, otherwise whatever the user typed (as an address)
function resolveEndpoint(sel, input) {
  var text = input.value.trim()
  if (!text) return null
  if (sel && sel.text === input.value) return sel.loc
  return text
}

function syncStartMarker() {
  if (startMarker) {
    startMarker.setMap(null)
    startMarker = null
  }
  if (startSel && startSel.source === "user" && !routeShown) {
    startMarker = new google.maps.Marker({ position: startSel.loc, map: map })
  }
}

function swapEndpoints() {
  var tmpText = startInput.value
  startInput.value = destinationInput.value
  destinationInput.value = tmpText
  var tmpSel = startSel
  startSel = destSel ? { text: destSel.text, loc: destSel.loc, source: "user" } : null
  destSel = tmpSel ? { text: tmpSel.text, loc: tmpSel.loc, source: "user" } : null
  resetRoute()
  syncStartMarker()
  computeRoute()
}

function clearAll() {
  startInput.value = ""
  destinationInput.value = ""
  startSel = null
  destSel = null
  resetRoute()
  hideToast()
  if (userLatLng) setStartToCurrentLocation()
}

// Single place that resets all route/weather state and UI
function resetRoute() {
  requestId++
  directionsDisplay.setMap(null)
  routeShown = false
  samples.forEach(function (s) {
    if (s.marker) s.marker.setMap(null)
  })
  routeEndMarkers.forEach(function (m) {
    m.setMap(null)
  })
  routeEndMarkers = []
  samples = []
  departures = []
  bestRange = null
  selectedD = 0
  maxD = 0
  barLoading = false
  hidePopup()
  renderTimeBar({ hidden: true })
  syncStartMarker()
}

function computeRoute() {
  var origin = resolveEndpoint(startSel, startInput)
  var destination = resolveEndpoint(destSel, destinationInput)
  if (!destination) return
  if (!origin) {
    resetRoute()
    showToast("Enter a starting point or tap Current Location.", { kind: "info" })
    return
  }

  resetRoute()
  var myRequest = requestId
  showToast("Finding route…", { kind: "loading", sticky: true })

  directionsService.route(
    { origin: origin, destination: destination, travelMode: google.maps.TravelMode.DRIVING },
    function (result, status) {
      if (myRequest !== requestId) return
      if (status !== google.maps.DirectionsStatus.OK) {
        showToast("Couldn't find a driving route (" + status + ").", { kind: "error" })
        return
      }
      directionsDisplay.setDirections(result)
      directionsDisplay.setMap(map)
      routeShown = true
      syncStartMarker()

      var leg = result.routes[0].legs[0]
      var path = result.routes[0].overview_path
      var tripHours = leg.duration.value / 3600
      samples = buildSamples(path, tripHours)
      drawEndpointPins(leg)

      barLoading = true
      updateBar()
      showToast("Loading weather along your route…", { kind: "loading", sticky: true })

      loadWeather(samples).then(function () {
        if (myRequest !== requestId) return
        onWeatherLoaded(tripHours)
      })
    }
  )
}

// Weather sample points along the path: the true origin, about every 25 mi, and the true destination
function buildSamples(path, tripHours) {
  var cum = [0]
  for (var i = 1; i < path.length; i++) {
    cum.push(cum[i - 1] + google.maps.geometry.spherical.computeDistanceBetween(path[i - 1], path[i]))
  }
  var total = cum[cum.length - 1]
  var step = Math.max(SAMPLE_STEP_METERS, total / (MAX_SAMPLES - 1))
  var distances = [0]
  if (total > 0) {
    for (var d = step; d < total - MIN_END_GAP_METERS; d += step) distances.push(d)
    distances.push(total)
  }

  var j = 0
  return distances.map(function (dist) {
    while (j < path.length - 2 && cum[j + 1] < dist) j++
    var latLng
    if (path.length === 1) {
      latLng = path[0]
    } else {
      var segLen = cum[j + 1] - cum[j]
      var frac = segLen > 0 ? Math.min(1, Math.max(0, (dist - cum[j]) / segLen)) : 0
      latLng = google.maps.geometry.spherical.interpolate(path[j], path[j + 1], frac)
    }
    return {
      latLng: latLng,
      distMeters: dist,
      etaHours: total > 0 ? (dist / total) * tripHours : 0,
      hourly: null,
      place: null,
      marker: null,
    }
  })
}

// Attach hourly forecasts to samples with one batched, cached Open-Meteo request.
// Takes any list of samples (phase B passes the samples of several routes at once).
function loadWeather(list) {
  var points = list.map(function (s) {
    return { lat: s.latLng.lat(), lng: s.latLng.lng() }
  })
  var env = {
    fetch: function (url) {
      return fetch(url)
    },
    storage: store,
    now: function () {
      return Date.now()
    },
  }
  return loadForecasts(points, env).then(function (results) {
    list.forEach(function (s, i) {
      if (results[i]) s.hourly = results[i]
      else s.failed = true
    })
  })
}

function onWeatherLoaded(tripHours) {
  barLoading = false
  var withData = samples.filter(function (s) {
    return s.hourly
  })
  if (withData.length === 0) {
    renderTimeBar({ hidden: true })
    showToast("Weather is unavailable right now. Please try again later.", { kind: "error" })
    return
  }

  var hourlyLen = Math.min.apply(
    null,
    withData.map(function (s) {
      return s.hourly.length
    })
  )
  maxD = maxDepartureOffset(tripHours, hourlyLen)
  selectedD = 0
  var failed = samples.length - withData.length
  if (maxD < 0) {
    departures = []
    bestRange = null
    renderTimeBar({ hidden: true })
    showToast(
      "This trip takes about " + Math.round(tripHours) +
        " hours, longer than the available forecast, so departure times can't be compared. Stops near the end show the last available forecast.",
      { kind: "error", sticky: true }
    )
  } else {
    departures = computeDepartures(samples, maxD, Date.now())
    bestRange = bestWindow(
      departures.map(function (dep) {
        return dep.score
      })
    )
    updateBar()
    if (failed > 0) {
      showToast("Weather unavailable for " + failed + " of " + samples.length + " stops on this route.", { kind: "error" })
    } else {
      hideToast()
    }
  }
  paintMarkers()
  ensureWorstPlace()
}

function updateBar() {
  renderTimeBar(
    {
      departures: departures,
      best: bestRange,
      selected: selectedD,
      loading: barLoading,
      places: samples.map(function (s) {
        return s.place
      }),
    },
    selectDeparture
  )
}

function selectDeparture(d) {
  selectedD = d
  updateBar()
  paintMarkers()
  if (openSampleIndex >= 0) showPopup(openSampleIndex)
  ensureWorstPlace()
}

// ---- Icons and markers ----

function loadIcons() {
  return Promise.all(
    WEATHER_ICONS.map(function (name) {
      return fetch("icons/" + name + ".svg")
        .then(function (response) {
          return response.ok ? response.text() : ""
        })
        .catch(function () {
          return ""
        })
        .then(function (text) {
          iconTextCache[name] = text
        })
    })
  )
}

function entryIconName(entry) {
  return weatherIconName(entry.code, entry.isDay, entry.wind)
}

function weatherMarkerIcon(entry, selected) {
  var cls = classify(hourBadness(entry))
  var svg = markerSvg({
    iconSvgText: iconTextCache[entryIconName(entry)],
    cls: cls,
    temp: entry.temp == null ? null : Math.round(entry.temp),
    selected: selected,
  })
  var g = markerGeometry(selected)
  return {
    url: svgDataUri(svg),
    scaledSize: new google.maps.Size(g.width, g.height),
    anchor: new google.maps.Point(g.cx, g.cy),
  }
}

function pinIcon(kind) {
  var g = pinGeometry()
  return {
    url: svgDataUri(pinSvg(kind)),
    scaledSize: new google.maps.Size(g.width, g.height),
    anchor: new google.maps.Point(g.cx, g.cy),
  }
}

function drawEndpointPins(leg) {
  routeEndMarkers = [
    new google.maps.Marker({ position: leg.start_location, map: map, icon: pinIcon("start"), title: "Start", zIndex: 5 }),
    new google.maps.Marker({ position: leg.end_location, map: map, icon: pinIcon("end"), title: "Destination", zIndex: 5 }),
  ]
}

// Create or update the weather marker of every sample for the selected departure
function paintMarkers() {
  var ready = iconsReady || Promise.resolve()
  var myRequest = requestId
  ready.then(function () {
    if (myRequest !== requestId) return
    samples.forEach(function (s, index) {
      var entry = entryFor(s, selectedD)
      if (!entry) {
        if (s.marker) {
          s.marker.setMap(null)
          s.marker = null
        }
        return
      }
      var selected = index === openSampleIndex
      var icon = weatherMarkerIcon(entry, selected)
      if (s.marker) {
        if (s.markerUrl !== icon.url) s.marker.setIcon(icon)
        s.marker.setZIndex(selected ? 4 : 1)
      } else {
        s.marker = new google.maps.Marker({ position: s.latLng, map: map, icon: icon, zIndex: selected ? 4 : 1 })
        s.marker.addListener("click", function () {
          showPopup(index)
        })
      }
      s.markerUrl = icon.url
    })
  })
}

function formatClock(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
}

function arrivalMs(sample) {
  var dep = departures[selectedD]
  var base = dep ? dep.timeMs : Date.now()
  return base + sample.etaHours * 3600000
}

function showPopup(index) {
  var s = samples[index]
  var entry = s && entryFor(s, selectedD)
  if (!entry) return
  var previous = openSampleIndex
  openSampleIndex = index
  var condition = entryDescription(entry).replace(/^\w/, function (c) {
    return c.toUpperCase()
  })
  var temp = entry.temp == null ? "" : " · " + Math.round(entry.temp) + "°F"
  document.getElementById("weather-info-summary").textContent =
    "Arrive ~" + formatClock(arrivalMs(s)) + " · " + condition + temp
  var wind = Math.round(entry.wind || 0)
  var gust = Math.round(entry.gust || 0)
  document.getElementById("weather-info-extra").textContent =
    "Rain chance " + Math.round((entry.pop || 0) * 100) + "% · Wind " + wind + " mph" +
    (gust > wind + 5 ? " (gusts " + gust + ")" : "")
  var icon = document.getElementById("weather-info-icon")
  icon.src = "icons/" + entryIconName(entry) + ".svg"
  icon.alt = condition

  var location = document.getElementById("weather-info-location")
  location.textContent = s.place || "Along your route"
  var popup = document.getElementById("weather-info-window")
  popup.hidden = false
  popup.classList.remove("active")
  void popup.offsetWidth // reflow so the animation replays
  popup.classList.add("active")
  if (previous !== index) paintMarkers()

  if (!s.place) {
    var myRequest = requestId
    ensurePlace(index).then(function (city) {
      if (city && myRequest === requestId && openSampleIndex === index) location.textContent = city
    })
  }
}

function hidePopup() {
  var wasOpen = openSampleIndex >= 0
  openSampleIndex = -1
  var popup = document.getElementById("weather-info-window")
  popup.hidden = true
  popup.classList.remove("active")
  if (wasOpen) paintMarkers()
}

// ---- Place names (reverse geocoding is only done on demand, and cached) ----

function cachedPlace(latLng) {
  var key = geoKey(latLng.lat(), latLng.lng())
  if (placeCache[key]) return placeCache[key]
  var stored = geoCacheGet(store, key)
  if (stored) placeCache[key] = stored
  return stored
}

// Resolve the place name of a sample (from memory, localStorage, then the Geocoder). Results for
// an older search are dropped. Resolves to the name, or null when unknown.
function ensurePlace(index) {
  var s = samples[index]
  if (!s) return Promise.resolve(null)
  if (s.place) return Promise.resolve(s.place)
  var cached = cachedPlace(s.latLng)
  if (cached) {
    s.place = cached
    return Promise.resolve(cached)
  }
  var key = geoKey(s.latLng.lat(), s.latLng.lng())
  var myRequest = requestId
  if (!placePending[key]) {
    placePending[key] = reverseGeocodeLatLng(s.latLng.lat(), s.latLng.lng())
      .then(function (city) {
        placeCache[key] = city
        geoCachePut(store, key, city, Date.now())
        return city
      })
      .catch(function (error) {
        console.error("Error getting city name:", error)
        return null
      })
      .then(function (city) {
        delete placePending[key]
        return city
      })
  }
  return placePending[key].then(function (city) {
    if (city && myRequest === requestId && samples[index] === s) s.place = city
    return myRequest === requestId ? city : null
  })
}

// The time bar subtitle names the worst stop of the selected departure: look up only that one
function ensureWorstPlace() {
  var dep = departures[selectedD]
  if (!dep || !dep.worst) return
  var myRequest = requestId
  var index = dep.worst.sampleIndex
  var had = !!(samples[index] && samples[index].place)
  ensurePlace(index).then(function (city) {
    if (city && !had && myRequest === requestId) updateBar()
  })
}

function setStartToCurrentLocation() {
  startSel = { text: "Current location", loc: userLatLng, source: "geo" }
  startInput.value = "Current location"
  syncStartMarker()
}

// Show the user's position and default the start to it; explicit = the user pressed the button
function getCurrentLocation(explicit) {
  if (!navigator.geolocation) {
    showToast("Geolocation is not supported by your browser.", { kind: "error" })
    return
  }
  navigator.geolocation.getCurrentPosition(
    function (position) {
      userLatLng = new google.maps.LatLng(position.coords.latitude, position.coords.longitude)
      var hadRoute = !!destSel

      if (userMarker) userMarker.setMap(null)
      userMarker = new google.maps.Marker({
        position: userLatLng,
        map: map,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          fillColor: "blue",
          fillOpacity: 0.7,
          strokeColor: "white",
          strokeOpacity: 0.7,
          strokeWeight: 3,
          scale: 10,
        },
      })

      if (!routeShown) {
        map.setCenter({ lat: userLatLng.lat() + 0.005, lng: userLatLng.lng() })
        map.setZoom(13)
      }

      // Don't override a start the user picked themselves unless they asked for the current location
      if (explicit || !startSel || startSel.source === "geo") {
        if (!explicit && startInput.value.trim() && !startSel) return // user is typing a start
        setStartToCurrentLocation()
        if (hadRoute) computeRoute()
      }
    },
    function () {
      showToast("Unable to retrieve your location. You can type a starting point instead.", { kind: "info" })
    }
  )
}

function showToast(message, options) {
  options = options || {}
  var toast = document.getElementById("toast")
  clearTimeout(toastTimer)
  toast.textContent = ""
  if (options.kind === "loading") {
    var spinner = document.createElement("span")
    spinner.className = "spinner"
    spinner.setAttribute("aria-hidden", "true")
    toast.appendChild(spinner)
  }
  toast.appendChild(document.createTextNode(message))
  toast.className = "toast " + (options.kind || "info")
  toast.hidden = false
  if (!options.sticky) toastTimer = setTimeout(hideToast, 7000)
}

function hideToast() {
  clearTimeout(toastTimer)
  document.getElementById("toast").hidden = true
}

function reverseGeocodeLatLng(lat, lng) {
  var geocoder = new google.maps.Geocoder()
  var latLng = new google.maps.LatLng(lat, lng)

  return new Promise(function (resolve, reject) {
    geocoder.geocode({ location: latLng }, function (results, status) {
      if (status !== google.maps.GeocoderStatus.OK) {
        reject("Geocoder failed due to: " + status)
        return
      }
      if (!results[0]) {
        reject("No results found")
        return
      }
      var city = null
      results[0].address_components.forEach(function (component) {
        if (city) return
        if (
          component.types.indexOf("locality") !== -1 ||
          component.types.indexOf("administrative_area_level_1") !== -1
        ) {
          city = component.long_name
        }
      })
      if (city) resolve(city)
      else reject("City not found in the address")
    })
  })
}
