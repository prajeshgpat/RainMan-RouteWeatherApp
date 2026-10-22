{# One row describing what the accuracy numbers cover. #}
with trips as (

    select
        min(departure_hour)::date as window_start,
        max(departure_hour)::date as window_end,
        count(distinct corridor_id) as corridors,
        count(*) as departures_evaluated
    from {{ ref('int_trip_departures') }}

),

points as (

    select count(distinct f.lat::varchar || ',' || f.lng::varchar) as points
    from {{ ref('int_point_hour_forecast') }} as f
    inner join {{ ref('stg_corridor_points') }} as cp on cp.lat = f.lat and cp.lng = f.lng
    where cp.corridor_id in (select distinct corridor_id from {{ ref('int_trip_departures') }})

)

select
    t.window_start,
    t.window_end,
    t.corridors,
    p.points,
    t.departures_evaluated
from trips as t
cross join points as p
