select
    corridor_id,
    seq,
    label,
    lat,
    lng,
    eta_hours,
    -- hours after departure at which the driver reaches the point (the app rounds the same way)
    cast(floor(eta_hours + 0.5) as integer) as eta_hour_offset
from {{ ref('corridor_points') }}
