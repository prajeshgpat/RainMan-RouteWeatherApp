var OWM_API_KEY = "3c92bd511fa74129ae88ca53365441be"
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
  directionsDisplay = new google.maps.DirectionsRenderer()
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
  var searchBox = new google.maps.places.SearchBox(startInput)
  var destinationSearchBox = new google.maps.places.SearchBox(destinationInput)

  document.getElementById("clear-button").addEventListener("click", clearAll)
  document.getElementById("swap-button").addEventListener("click", swapEndpoints)
  document.getElementById("current-location-button").addEventListener("click", function () {
    getCurrentLocation(true)
  })
  document.getElementById("weather-info-close").addEventListener("click", hidePopup)
  document.getElementById("toast").addEventListener("click", hideToast)

  // Registered once: clicking the map hides the weather popup
  map.addListener("click", hidePopup)

  searchBox.addListener("places_changed", function () {
    var place = firstPlaceWithLocation(searchBox.getPlaces())
    if (!place) return
    startSel = { text: startInput.value, loc: place.geometry.location, source: "user" }
    syncStartMarker()
    if (!routeShown) {
      map.panTo(place.geometry.location)
      map.setZoom(14)
    }
    computeRoute()
  })

  destinationSearchBox.addListener("places_changed", function () {
    var place = firstPlaceWithLocation(destinationSearchBox.getPlaces())
    if (!place) return
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

function firstPlaceWithLocation(places) {
  if (!places || places.length === 0) return null
  var place = places[0]
  if (!place.geometry || !place.geometry.location) {
    showToast("Couldn't find that place. Pick one of the suggestions.", { kind: "error" })
    return null
  }
  return place
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

      barLoading = true
      updateBar()
      showToast("Loading weather along your route…", { kind: "loading", sticky: true })

      Promise.all(
        samples.map(function (s) {
          return fetchHourly(s.latLng)
            .then(function (hourly) {
              s.hourly = hourly
            })
            .catch(function (error) {
              console.error("Weather fetch failed:", error)
              s.failed = true
            })
        })
      ).then(function () {
        if (myRequest !== requestId) return
        onWeatherLoaded(tripHours, myRequest)
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

function fetchHourly(latLng) {
  var exclude = "current,minutely,daily,alerts"
  var url =
    "https://api.openweathermap.org/data/3.0/onecall?lat=" + latLng.lat() +
    "&lon=" + latLng.lng() +
    "&exclude=" + exclude +
    "&units=imperial&appid=" + OWM_API_KEY
  return fetch(url)
    .then(function (response) {
      if (!response.ok) throw new Error("OpenWeather returned HTTP " + response.status)
      return response.json()
    })
    .then(function (data) {
      if (!data || !Array.isArray(data.hourly) || data.hourly.length === 0) {
        throw new Error((data && data.message) || "No hourly forecast in response")
      }
      return data.hourly
    })
}

function onWeatherLoaded(tripHours, myRequest) {
  barLoading = false
  var withData = samples.filter(function (s) {
    return s.hourly
  })
  if (withData.length === 0) {
    renderTimeBar({ hidden: true })
    showToast("Weather is unavailable right now. Please try again later.", { kind: "error" })
    return
  }

  maxD = maxDepartureOffset(tripHours)
  selectedD = 0
  var failed = samples.length - withData.length
  if (maxD < 0) {
    departures = []
    bestRange = null
    renderTimeBar({ hidden: true })
    showToast(
      "This trip takes about " + Math.round(tripHours) +
        " hours, longer than the 48-hour forecast, so departure times can't be compared. Stops near the end show the last available forecast.",
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
  fillPlaces(myRequest)
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
}

// Create or update the weather marker of every sample for the selected departure
function paintMarkers() {
  samples.forEach(function (s, index) {
    var entry = entryFor(s, selectedD)
    if (!entry) {
      if (s.marker) {
        s.marker.setMap(null)
        s.marker = null
      }
      return
    }
    var icon = {
      url: "https://openweathermap.org/img/wn/" + entry.weather[0].icon + ".png",
      scaledSize: new google.maps.Size(50, 50),
    }
    if (s.marker) {
      s.marker.setIcon(icon)
    } else {
      s.marker = new google.maps.Marker({ position: s.latLng, map: map, icon: icon })
      s.marker.addListener("click", function () {
        showPopup(index)
      })
    }
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
  openSampleIndex = index
  var w = entry.weather[0]
  var condition = w.description.replace(/\b\w/g, function (c) {
    return c.toUpperCase()
  })
  document.getElementById("weather-info-summary").textContent =
    "Arrive ~" + formatClock(arrivalMs(s)) + " · " + condition + " · " + Math.round(entry.temp) + "°F"
  document.getElementById("weather-info-extra").textContent =
    "Rain chance " + Math.round((entry.pop || 0) * 100) + "% · Wind " + Math.round(entry.wind_speed || 0) + " mph"
  var icon = document.getElementById("weather-info-icon")
  icon.src = "https://openweathermap.org/img/wn/" + w.icon + "@2x.png"
  icon.alt = condition

  var location = document.getElementById("weather-info-location")
  location.textContent = s.place || "Along your route"
  var popup = document.getElementById("weather-info-window")
  popup.hidden = false
  popup.classList.remove("active")
  void popup.offsetWidth // reflow so the animation replays
  popup.classList.add("active")

  if (!s.place) {
    var myRequest = requestId
    reverseGeocodeLatLng(s.latLng.lat(), s.latLng.lng())
      .then(function (city) {
        s.place = city
        if (myRequest === requestId && openSampleIndex === index) location.textContent = city
      })
      .catch(function (error) {
        console.error("Error getting city name:", error)
      })
  }
}

function hidePopup() {
  openSampleIndex = -1
  var popup = document.getElementById("weather-info-window")
  popup.hidden = true
  popup.classList.remove("active")
}

// Look up place names one at a time (gentle on the geocoder quota) for the time bar text
function fillPlaces(myRequest) {
  var chain = Promise.resolve()
  samples.forEach(function (s) {
    chain = chain.then(function () {
      if (myRequest !== requestId || s.place || !s.hourly) return
      return reverseGeocodeLatLng(s.latLng.lat(), s.latLng.lng())
        .then(function (city) {
          s.place = city
          if (myRequest === requestId) updateBar()
        })
        .catch(function () {})
    })
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
