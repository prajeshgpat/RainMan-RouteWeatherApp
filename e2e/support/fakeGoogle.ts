// A stand-in for the Google Maps JavaScript API, served in place of
// https://maps.googleapis.com/maps/api/js. @googlemaps/js-api-loader injects that script with
// callback=google.maps.__ib__; this script fills in google.maps with just enough of the API for
// RainMan (map, markers, autocomplete, directions with three routes, geocoder, geometry) and
// then calls the callback. Everything the app does to the map is recorded on window for the tests:
// __markers, __ac (autocompletes), __map, __routeReq, __routeIndexCalls, __geocodes, ...

export const FAKE_GOOGLE_JS = `
(function () {
  function LatLng(lat, lng) { this._lat = lat; this._lng = lng }
  LatLng.prototype.lat = function () { return this._lat }
  LatLng.prototype.lng = function () { return this._lng }
  window.__markers = []; window.__geocodes = 0; window.__ac = []; window.__routeIndexCalls = []
  function rad(d) { return d * Math.PI / 180 }
  function dist(a, b) {
    var R = 6371000, dl = rad(b.lat() - a.lat()), dn = rad(b.lng() - a.lng())
    var x = Math.sin(dl / 2) ** 2 + Math.cos(rad(a.lat())) * Math.cos(rad(b.lat())) * Math.sin(dn / 2) ** 2
    return 2 * R * Math.asin(Math.sqrt(x))
  }
  function Marker(o) { this.o = o; this.map = o.map; this.handlers = []; this.visible = true; window.__markers.push(this) }
  Marker.prototype.setMap = function (m) { this.map = m }
  Marker.prototype.setIcon = function (i) { this.o.icon = i }
  Marker.prototype.setZIndex = function (z) { this.o.zIndex = z }
  Marker.prototype.setVisible = function (v) { this.visible = v }
  Marker.prototype.addListener = function (n, f) { this.handlers.push(f) }
  function Autocomplete(input, opts) { this.input = input; this.opts = opts; this.h = []; this.place = null; window.__ac.push(this) }
  Autocomplete.prototype.addListener = function (n, f) { this.h.push(f) }
  Autocomplete.prototype.getPlace = function () { return this.place }
  function MVC() { this.a = [] }
  MVC.prototype.push = function (x) { this.a.push(x) }
  MVC.prototype.getLength = function () { return this.a.length }
  MVC.prototype.getAt = function (i) { return this.a[i] }
  MVC.prototype.removeAt = function (i) { this.a.splice(i, 1) }
  function GMap(el, opts) {
    window.__map = this; this.zoom = opts.zoom; this.h = {}; this.overlayMapTypes = new MVC(); window.__mapStyles = opts.styles
  }
  GMap.prototype.panTo = function () {}
  GMap.prototype.setCenter = function () {}
  GMap.prototype.setZoom = function (z) { this.zoom = z; this.__fire("zoom_changed") }
  GMap.prototype.getZoom = function () { return this.zoom }
  GMap.prototype.setOptions = function (o) { window.__mapStyles = o.styles; window.__styleCalls = (window.__styleCalls || 0) + 1 }
  GMap.prototype.addListener = function (n, f) { (this.h[n] = this.h[n] || []).push(f) }
  GMap.prototype.__fire = function (n) { (this.h[n] || []).forEach(function (f) { f() }) }
  GMap.prototype.getProjection = function () { return { fromLatLngToPoint: function (ll) {
    var s = Math.sin(rad(ll.lat()))
    return { x: (ll.lng() + 180) / 360 * 256, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 256 } } } }
  function path(a, b, bulge) {
    var p = []
    for (var i = 0; i <= 200; i++) {
      var t = i / 200
      p.push(new LatLng(a.lat() + (b.lat() - a.lat()) * t, a.lng() + (b.lng() - a.lng()) * t + bulge * Math.sin(Math.PI * t)))
    }
    return p
  }
  var maps = window.google.maps
  var callback = maps.__ib__
  Object.assign(maps, {
    Map: GMap,
    LatLng: LatLng, Size: function (w, h) { this.width = w; this.height = h }, Point: function (x, y) { this.x = x; this.y = y },
    Marker: Marker, SymbolPath: { CIRCLE: 0 }, TravelMode: { DRIVING: "DRIVING" },
    ImageMapType: function (o) { this.o = o; window.__imt = this },
    DirectionsStatus: { OK: "OK" }, GeocoderStatus: { OK: "OK" },
    DirectionsRenderer: function (o) { window.__renderer = o; this.setDirections = function () {}; this.setMap = function () {}
      this.setRouteIndex = function (i) { window.__routeIndexCalls.push(i) } },
    DirectionsService: function () { this.route = function (req, cb) {
      window.__routeReq = req
      var a = new LatLng(37.7749, -122.4194), b = new LatLng(34.0522, -118.2437)
      if (/Fresno/.test(req.origin)) { a = new LatLng(36.7378, -119.7871) }
      var mk = function (summary, secs, bulge) { return { summary: summary, overview_path: path(a, b, bulge), legs: [{ duration: { value: secs }, start_location: a, end_location: b }] } }
      var routes = [mk("I-5", 6 * 3600, 0), mk("CA-99", 6 * 3600 + 8 * 60, 1.6), mk("US-101", 7 * 3600 + 20 * 60, -0.8)]
      if (window.__oneRoute) routes = routes.slice(0, 1)
      setTimeout(function () { cb({ routes: routes }, "OK") }, 20)
    } },
    Geocoder: function () { this.geocode = function (req, cb) { window.__geocodes++; setTimeout(function () {
      cb([{ address_components: [{ long_name: "Fresno " + req.location.lat().toFixed(1), types: ["locality"] }] }], "OK") }, 10) } },
    geometry: { spherical: {
      computeDistanceBetween: dist,
      interpolate: function (a, b, f) { return new LatLng(a.lat() + (b.lat() - a.lat()) * f, a.lng() + (b.lng() - a.lng()) * f) } } },
    places: { Autocomplete: Autocomplete },
    importLibrary: function () { return Promise.resolve({}) },
  })
  window.__mapsReady = true
  if (callback) callback()
})()
`
