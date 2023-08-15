var startingLocation
var userMarker
var points = [] // Array to store points along the route
var weatherMarkers = []
var weatherData = {}

function initMap() {
  var directionsService = new google.maps.DirectionsService()
  var directionsDisplay = new google.maps.DirectionsRenderer()
  var tempMarker
  var fallbackLatLng = { lat: 37.775, lng: -122.434 } // Fallback coordinate
  points = []
  var map = new google.maps.Map(document.getElementById("map"), {
    zoom: 13,
    center: fallbackLatLng,
    mapTypeControlOptions: {
      mapTypeIds: [],
    },
    fullscreenControl: false,
    streetViewControl: false,
    zoomControl: false,
  })

  // Create the search box and link it to the UI element
  var input = document.getElementById("search-input")
  var destinationInput = document.getElementById("destination-input")
  var searchBox = new google.maps.places.SearchBox(input)
  var destinationSearchBox = new google.maps.places.SearchBox(destinationInput)

  // Create the clear button and link it to the UI element
  var clearButton = document.getElementById("clear-button")
  clearButton.addEventListener("click", function () {
    input.value = ""
    destinationInput.value = "" // Clear the destination search box as well
    if (tempMarker) {
      tempMarker.setMap(null)
    }
    directionsDisplay.setMap(null) // Clear the displayed directions

    weatherMarkers.forEach(function (marker) {
      marker.setMap(null)
    })
    weatherMarkers = []
    points = []
    weatherData = {}

    var weatherInfoWindow = document.getElementById("weather-info-window")
    weatherInfoWindow.style.display = "none"
    weatherInfoWindow.classList.remove("active")
  })

  // Create the current location button and link it to the UI element
  var currentLocationButton = document.getElementById("current-location-button")
  currentLocationButton.addEventListener("click", function () {
    getCurrentLocation(map, input, true) // Pass the starting point input field as a parameter
  })

  // Add a click event listener to the map to hide the custom InfoWindow
  map.addListener("click", function () {
    document.getElementById("weather-info-window").style.display = "none"
  })

  // Check if the browser supports Geolocation
  if (navigator.geolocation) {
    // Get the user's current position
    getCurrentLocation(map, input, false)
  } else {
    // If the browser doesn't support Geolocation, use the fallback coordinate
    map.setCenter(fallbackLatLng)
    map.setZoom(13) // Set initial zoom level (adjust as needed)
  }

  // Listen for the event when a place is selected (starting point)
  searchBox.addListener("places_changed", function () {
    var places = searchBox.getPlaces()
    if (places.length === 0) {
      return
    }

    // Remove the temporary marker if it exists
    if (tempMarker) {
      tempMarker.setMap(null)
    }

    // Add the selected place to the map as a temporary marker
    var location = places[0].geometry.location
    tempMarker = new google.maps.Marker({
      position: location,
      map: map,
    })

    // Set the map viewport to the bounds of the selected place
    map.panTo(location)
    map.setZoom(14) // Set zoom level when location is searched (adjust as needed)

    // Store the selected starting point location
    startingLocation = location
  })

  // Listen for the event when a place is selected (destination)
  destinationSearchBox.addListener("places_changed", function () {
    var destinationPlaces = destinationSearchBox.getPlaces()
    if (destinationPlaces.length === 0) {
      return
    }

    // Remove the temporary destination marker if it exists
    if (directionsDisplay) {
      directionsDisplay.setMap(null)
    }

    // Add the selected destination place to the map as a temporary marker
    var destinationLocation = destinationPlaces[0].geometry.location

    // Set the map viewport to the bounds of the selected destination
    map.panTo(destinationLocation)
    map.setZoom(14) // Set zoom level when destination is searched (adjust as needed)

    // Get directions between the starting point and destination
    var request = {
      origin: startingLocation, // Use the stored starting point location
      destination: destinationLocation,
      travelMode: google.maps.TravelMode.DRIVING,
    }

    directionsService.route(request, function (result, status) {
      if (status == google.maps.DirectionsStatus.OK) {
        // Display the directions on the map
        directionsDisplay.setDirections(result)
        directionsDisplay.setMap(map)

        // Process the route and get the points every 25 miles
        var route = result.routes[0].overview_path
        var totalDistance = 0
        var timeTakenHours = 0
        var speedMph = 57
        var pointDistance = 25 * 1609.34
        points = []
        weatherData = {}

        const fetchPromises = [] // Initialize an array to store all the fetch requests

        for (var i = 0; i < route.length - 1; i++) {
          var distanceBetweenPoints = google.maps.geometry.spherical.computeDistanceBetween(
            route[i],
            route[i + 1]
          )

          if (totalDistance >= pointDistance || i == 0 || i == route.length - 2) {
            // Calculate the time taken to travel between the two points at an average speed (e.g., 50 mph)
            timeTakenHours += totalDistance / (speedMph * 1609.34) // Convert distance from meters to miles
            totalDistance = 0
            // Calculate the time of passage for the current location
            points.push({ latLng: route[i] })
            fetchPromises.push(getWeatherForLatLng(route[i], timeTakenHours)) // Push the fetch request promise to the array
          }
          totalDistance += distanceBetweenPoints
        }
        // Wait for all fetch requests to complete using Promise.all
        Promise.all(fetchPromises)
          .then(() => {
            displayWeatherOnMap(map, points)
          })
          .catch((error) => {
            console.error("Error fetching weather data:", error)
          })
      } else {
        // If directions request fails, show an alert
        alert("Directions request failed.")
      }
    })
  })
}

// Function to get weather for a specific location using OpenWeatherMap API
function getWeatherForLatLng(latLng, timeTakenHours) {
  const apiKey = "3c92bd511fa74129ae88ca53365441be"
  const latitude = latLng.lat()
  const longitude = latLng.lng()
  const exclude = "current,minutely,daily,alerts"
  const weatherURL = `https://api.openweathermap.org/data/3.0/onecall?lat=${latitude}&lon=${longitude}&exclude=${exclude}&appid=${apiKey}`
  // First, fetch the weather data for the given latitude and longitude
  return fetch(weatherURL)
    .then((response) => response.json())
    .then((data) => {
      var hour = Math.round(timeTakenHours)
      const forecastTime = new Date(data.hourly[hour].dt * 1000) // Gets forecast at location at specific hour
      const temperature = Math.round(((data.hourly[hour].temp - 273.15) * 9) / 5 + 32) // Gets temperature in F
      const weatherCondition = capitalizeWords(data.hourly[hour].weather[0].description) // Gets weather conditions
      const weatherIcon = data.hourly[hour].weather[0].icon // Gets weather icon
      var weatherIconURL = `https://openweathermap.org/img/wn/${weatherIcon}.png`

      weatherData[`${latitude},${longitude}`] = {
        condition: weatherCondition,
        temperature: temperature,
        iconURL: weatherIconURL,
      }
    })
    .catch((error) => {
      console.error("Error fetching weather data:", error)
    })
}

// Function to display weather markers on the map
function displayWeatherOnMap(map, points) {
  // Remove the previous weather markers, if any
  weatherMarkers.forEach((marker) => marker.setMap(null))
  weatherMarkers = []

  // Loop through the points and create weather markers
  points.forEach((point, index) => {
    var marker = new google.maps.Marker({
      position: point.latLng,
      map: map,
      icon: {
        url: weatherData[`${point.latLng.lat()},${point.latLng.lng()}`].iconURL,
        scaledSize: new google.maps.Size(50, 50), // Set the size of the weather icon
      },
    })

    // Add a click event listener to the weather marker
    marker.addListener("click", function () {
      // Get the weather data for the clicked location from the weather object
      const { condition, temperature, iconURL } =
        weatherData[`${point.latLng.lat()},${point.latLng.lng()}`]

      reverseGeocodeLatLng(point.latLng.lat(), point.latLng.lng())
        .then((city) => {
          // Set the content of the custom InfoWindow using JavaScript
          document.getElementById("weather-info-location").textContent = `${city}`
          document.getElementById("weather-info-conditions").textContent = `${condition}`
          document.getElementById("weather-info-temperature").textContent = `${temperature} °F`
          document.getElementById("weather-info-icon").src = iconURL

          // Show the custom InfoWindow near the bottom of the map
          var infoWindow = document.getElementById("weather-info-window")
          infoWindow.style.display = "flex"
          infoWindow.classList.remove("active")
          void infoWindow.offsetWidth // This line triggers a reflow, allowing the animation to work on successive clicks
          infoWindow.classList.add("active")

          // Add a click event listener to the map to hide the custom InfoWindow when the map is clicked
          map.addListener("click", function () {
            infoWindow.style.display = "none"
            infoWindow.classList.remove("active")
          })
        })
        .catch((error) => {
          console.error("Error getting city name:", error)
        })
    })

    // Push the marker to the weatherMarkers array
    weatherMarkers.push(marker)
  })
}

// Retrieve the user's current location and center the map
function getCurrentLocation(map, startingPointInput, bool) {
  const latitudeOffset = 0.005
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      function (position) {
        var userLatLng = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        }
        // Apply the offset to the map center
        var mapCenter = {
          lat: userLatLng.lat + latitudeOffset,
          lng: userLatLng.lng,
        }

        map.setCenter(mapCenter)
        map.setZoom(13) // Set initial zoom level (adjust as needed)

        // Remove the previous user marker if it exists
        if (map.userMarker) {
          map.userMarker.setMap(null)
        }
        // Create a blue circle icon
        var circleIcon = {
          path: google.maps.SymbolPath.CIRCLE,
          fillColor: "blue",
          fillOpacity: 0.7,
          strokeColor: "white",
          strokeOpacity: 0.7,
          strokeWeight: 3,
          scale: 10,
        }

        // Add the blue circle marker at the user's location
        map.userMarker = new google.maps.Marker({
          position: userLatLng,
          map: map,
          icon: circleIcon,
        })

        if (bool) {
          startingPointInput.value = userLatLng.lat + ", " + userLatLng.lng
          startingLocation = startingPointInput.value
        }
      },
      function () {
        // If the user denies location access or an error occurs, show an alert
        alert("Unable to retrieve your location.")
      }
    )
  } else {
    // If the browser doesn't support Geolocation, show an alert
    alert("Geolocation is not supported by your browser.")
  }
}

function capitalizeWords(inputString) {
  if (typeof inputString !== "string") {
    throw new Error("Input must be a string.")
  }

  return inputString.replace(/\b\w/g, function (word) {
    return word.toUpperCase()
  })
}

function reverseGeocodeLatLng(lat, lng) {
  const geocoder = new google.maps.Geocoder()
  const latLng = new google.maps.LatLng(lat, lng)

  return new Promise((resolve, reject) => {
    geocoder.geocode({ location: latLng }, (results, status) => {
      if (status === google.maps.GeocoderStatus.OK) {
        if (results[0]) {
          // Find the address component that contains the city
          const addressComponents = results[0].address_components
          let city = null
          for (const component of addressComponents) {
            for (const type of component.types) {
              if (type === "locality" || type === "administrative_area_level_1") {
                city = component.long_name
                break
              }
            }
            if (city) {
              break
            }
          }

          if (city) {
            resolve(city)
          } else {
            reject("City not found in the address")
          }
        } else {
          reject("No results found")
        }
      } else {
        reject("Geocoder failed due to: " + status)
      }
    })
  })
}
