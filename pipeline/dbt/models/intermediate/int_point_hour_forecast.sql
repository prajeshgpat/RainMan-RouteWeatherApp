{#
  Scores every (point, valid hour, lead day) with the app's hour badness and compares the
  forecast with what was observed.

  Rows without a forecast code or without observations are dropped: they cannot be judged.
  A missing probability is kept (the app treats it as 0 when scoring) but the marts leave it out
  of the Brier score.
#}
select
    lat,
    lng,
    valid_hour,
    lead_day,
    f_code,
    f_pop,
    f_temp,
    f_wind,
    f_gust,
    is_day,
    obs_code,
    obs_precip_mm,
    {{ rainman_badness('f_code', 'f_pop', 'f_temp', 'f_wind', 'f_gust', 'is_day') }} as badness,
    {{ rainman_class(rainman_badness('f_code', 'f_pop', 'f_temp', 'f_wind', 'f_gust', 'is_day')) }}
        as badness_class,
    -- observed wet: at least 0.1 mm in the hour, or a drizzle/rain/snow/thunder analysis code
    (obs_precip_mm >= 0.1 or {{ rainman_is_precip_code('obs_code') }}) as obs_wet,
    -- forecast wet (for POD / FAR): rain probability of 50% or more, or a precipitation code
    (coalesce(f_pop, 0) >= 0.5 or {{ rainman_is_precip_code('f_code') }}) as f_wet
from {{ ref('stg_point_hours') }}
where f_code is not null
  and obs_code is not null
  and obs_precip_mm is not null
