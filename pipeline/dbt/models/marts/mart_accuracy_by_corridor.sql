{# Day-1 accuracy for each corridor that has trips with complete data. #}
with trips as (

    select
        corridor_id,
        count(*) as n_trips_day1,
        count(*) filter (where trip_class = 'good') as n_green_trips_day1,
        avg(trip_dry::integer) filter (where trip_class = 'good') as green_trip_dry_rate_day1
    from {{ ref('int_trip_departures') }}
    where lead_day = 1
    group by corridor_id

),

points as (

    select
        cp.corridor_id,
        avg(power(f.f_pop - f.obs_wet::integer, 2)) filter (where f.f_pop is not null) as brier_pop_day1
    from {{ ref('stg_corridor_points') }} as cp
    inner join {{ ref('int_point_hour_forecast') }} as f
        on f.lat = cp.lat and f.lng = cp.lng and f.lead_day = 1
    group by cp.corridor_id

)

select
    c.corridor_id,
    c.name,
    t.green_trip_dry_rate_day1,
    p.brier_pop_day1,
    t.n_trips_day1,
    t.n_green_trips_day1
from {{ ref('stg_corridors') }} as c
inner join trips as t on t.corridor_id = c.corridor_id
inner join points as p on p.corridor_id = c.corridor_id
order by c.corridor_id
