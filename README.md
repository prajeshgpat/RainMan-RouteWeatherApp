# RainMan-RouteWeatherApp
Weather can change any time while you’re taking a long road trip so “RainMan” lets you see all weather conditions 
along your way between your location and destination, and recommends the best time to leave so you avoid rain/bad 
weather and drive with clear sunny skies.
https://rainman-394303.web.app


## Departure time bar

Once a route is loaded, a bar along the bottom of the screen shows every departure hour (up to 48 hours ahead) as
green (good), yellow (okay) or red (bad), and highlights the best window to leave. Tap an hour to repaint the
weather markers on the route with the forecast you would meet if you left then. The bar scrolls sideways.

It needs no extra API calls per departure: one batched [Open-Meteo](https://open-meteo.com/) request returns about
96 hourly forecasts for every sampled point on the route. For a departure `d` hours from now and a point reached
`t` hours into the trip, the weather used is `hourly[round(d + t)]`. Hours are scored from the WMO weather code,
rain probability, wind and gusts, with extra penalties for ice (rain at or below 34 F) and night driving.
Scoring lives in `public/scoring.js`, the Open-Meteo request/normalizer, cache helpers and icon mapping in
`public/weather.js`, the map marker SVGs in `public/markers.js` (all pure JS, no DOM or Google dependencies) and
the bar rendering in `public/timebar.js`.

## Keeping API calls low

- Weather: one Open-Meteo request per route (chunked at 150 points). Forecasts are cached in `localStorage` per
  0.1 degree grid cell for 45 minutes, so searching again, swapping start and destination or reloading a route makes
  no weather calls.
- Google Geocoder: only the worst stop of the selected departure and a tapped marker are reverse-geocoded; names are
  cached in memory and `localStorage` (0.05 degree cells).
- Places search uses `google.maps.places.Autocomplete` (one session per picked place).

## Credits

- Weather data by [Open-Meteo.com](https://open-meteo.com/), licensed
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Used under the free non-commercial terms.
- Weather icons: [Meteocons](https://github.com/basmilius/weather-icons) by Bas Milius, MIT license
  (see `public/icons/LICENSE`).

## Running the tests

Requires Node 20 or newer, no dependencies:

```
npm test
# or
node --test tests/*.test.js
```

To try the site locally, serve the `public/` folder, for example `python3 -m http.server -d public`.
