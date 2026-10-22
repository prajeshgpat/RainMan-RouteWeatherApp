select
    corridor_id,
    name,
    origin,
    destination,
    highway,
    total_miles
from {{ ref('corridors') }}
