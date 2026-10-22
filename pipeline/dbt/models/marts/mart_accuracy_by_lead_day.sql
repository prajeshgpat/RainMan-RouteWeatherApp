{#
  Headline accuracy by lead day.
  Trip level: how often was a drive RainMan rated green/yellow/red actually dry/wet.
  Point level (over the points of the corridors): Brier score of the rain probability, and the
  probability of detection (POD) and false alarm ratio (FAR) of "forecast wet".
#}
with trips as (

    select
        lead_day,
        count(*) as n_trips,
        count(*) filter (where trip_class = 'good') as n_green_trips,
        count(*) filter (where trip_class = 'okay') as n_okay_trips,
        count(*) filter (where trip_class = 'bad') as n_bad_trips,
        avg(trip_dry::integer) filter (where trip_class = 'good') as green_trip_dry_rate,
        avg(trip_dry::integer) filter (where trip_class = 'okay') as okay_trip_dry_rate,
        avg(trip_wet::integer) filter (where trip_class = 'bad') as bad_trip_wet_rate
    from {{ ref('int_trip_departures') }}
    group by lead_day

),

used_points as (

    select distinct lat, lng from {{ ref('stg_corridor_points') }}

),

points as (

    select
        f.lead_day,
        count(*) as n_point_hours,
        avg(power(f.f_pop - f.obs_wet::integer, 2)) filter (where f.f_pop is not null) as brier_pop,
        count(*) filter (where f.f_wet and f.obs_wet) as hits,
        count(*) filter (where not f.f_wet and f.obs_wet) as misses,
        count(*) filter (where f.f_wet and not f.obs_wet) as false_alarms
    from {{ ref('int_point_hour_forecast') }} as f
    inner join used_points as u on u.lat = f.lat and u.lng = f.lng
    group by f.lead_day

)

select
    t.lead_day,
    t.green_trip_dry_rate,
    t.okay_trip_dry_rate,
    t.bad_trip_wet_rate,
    p.brier_pop,
    p.hits::double / nullif(p.hits + p.misses, 0) as rain_pod,
    p.false_alarms::double / nullif(p.hits + p.false_alarms, 0) as rain_far,
    t.n_trips,
    t.n_green_trips,
    t.n_okay_trips,
    t.n_bad_trips,
    p.n_point_hours
from trips as t
inner join points as p on p.lead_day = t.lead_day
order by t.lead_day
