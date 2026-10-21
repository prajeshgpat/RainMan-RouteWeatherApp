# RainMan-RouteWeatherApp
Weather can change any time while you’re taking a long road trip so “RainMan” lets you see all weather conditions 
along your way between your location and destination, and recommends the best time to leave so you avoid rain/bad 
weather and drive with clear sunny skies.
https://rainman-394303.web.app


## Departure time bar

Once a route is loaded, a bar along the bottom of the screen shows every departure hour for the next 24 hours as
green (good), yellow (okay) or red (bad), and highlights the best window to leave. Tap an hour to repaint the
weather markers on the route with the forecast you would meet if you left then.

It needs no extra API calls: each sampled point on the route already fetches OpenWeather One Call 3.0, which returns
48 hourly forecasts. For a departure `d` hours from now and a point reached `t` hours into the trip, the weather
used is `hourly[round(d + t)]`. Scoring lives in `public/scoring.js` (pure JS, no DOM or Google dependencies) and the
bar rendering in `public/timebar.js`. Trips longer than about 47 hours are too long to forecast, so the bar is hidden.

## Running the tests

Requires Node 20 or newer, no dependencies:

```
npm test
# or
node --test tests/*.test.js
```

To try the site locally, serve the `public/` folder, for example `python3 -m http.server -d public`.
