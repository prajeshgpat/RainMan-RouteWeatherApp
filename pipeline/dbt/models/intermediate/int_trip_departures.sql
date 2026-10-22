{#
  One row per (corridor, departure hour, lead day): what RainMan would have rated the drive,
  and whether the drive was actually dry.

  Mirrors departureScore() in public/scoring.js: for a departure at hour D the driver meets point
  i at hour D + round(eta_i), and the trip score is 0.6 * max(badness) + 0.4 * mean(badness).
  The forecast is the one issued `lead_day` days before each point's arrival hour.
  Only departures where every point of the corridor has data are kept.
#}
with arrivals as (

    select
        cp.corridor_id,
        cp.seq,
        f.valid_hour - cp.eta_hour_offset * interval 1 hour as departure_hour,
        f.lead_day,
        f.badness,
        f.obs_wet
    from {{ ref('stg_corridor_points') }} as cp
    inner join {{ ref('int_point_hour_forecast') }} as f
        on f.lat = cp.lat and f.lng = cp.lng

),

point_counts as (

    select corridor_id, count(*) as n_points
    from {{ ref('stg_corridor_points') }}
    group by corridor_id

),

trips as (

    select
        a.corridor_id,
        a.departure_hour,
        a.lead_day,
        count(*) as n_points_found,
        0.6e0 * max(a.badness) + 0.4e0 * avg(a.badness) as trip_score,
        bool_or(a.obs_wet) as trip_wet
    from arrivals as a
    group by a.corridor_id, a.departure_hour, a.lead_day

)

select
    t.corridor_id,
    t.departure_hour,
    t.lead_day,
    t.trip_score,
    {{ rainman_class('t.trip_score') }} as trip_class,
    t.trip_wet,
    not t.trip_wet as trip_dry
from trips as t
inner join point_counts as pc
    on pc.corridor_id = t.corridor_id and pc.n_points = t.n_points_found
