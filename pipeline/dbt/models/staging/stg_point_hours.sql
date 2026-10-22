{#
  Unnests the raw Open-Meteo Previous Runs responses into one row per
  (point, valid hour, lead day).

  raw.previous_runs holds one JSON response per (requested lat, lng, window). Windows overlap
  between incremental runs, so the newest fetch wins per (point, hour).
  Lead day N reads the *_previous_dayN variables: the forecast that was issued N days before the
  valid hour. Actuals are the analysis-hour weather_code / precipitation for the same hour.
#}
{% set leads = [1, 2, 3, 4, 5] %}

with raw as (

    select
        lat,
        lng,
        fetched_at,
        cast(response as json) as r
    from {{ source('raw', 'previous_runs') }}

),

unnested as (

    select
        lat,
        lng,
        fetched_at,
        unnest(from_json(r -> '$.hourly.time', '["BIGINT"]')) as ts,
        unnest(from_json(r -> '$.hourly.weather_code', '["DOUBLE"]')) as obs_code,
        unnest(from_json(r -> '$.hourly.precipitation', '["DOUBLE"]')) as obs_precip_mm,
        unnest(from_json(r -> '$.hourly.is_day', '["DOUBLE"]')) as is_day
        {%- for n in leads %},
        unnest(from_json(r -> '$.hourly.weather_code_previous_day{{ n }}', '["DOUBLE"]')) as code_{{ n }},
        unnest(from_json(r -> '$.hourly.precipitation_probability_previous_day{{ n }}', '["DOUBLE"]')) as pop_{{ n }},
        unnest(from_json(r -> '$.hourly.temperature_2m_previous_day{{ n }}', '["DOUBLE"]')) as temp_{{ n }},
        unnest(from_json(r -> '$.hourly.wind_speed_10m_previous_day{{ n }}', '["DOUBLE"]')) as wind_{{ n }},
        unnest(from_json(r -> '$.hourly.wind_gusts_10m_previous_day{{ n }}', '["DOUBLE"]')) as gust_{{ n }}
        {%- endfor %}
    from raw

),

latest as (

    select *
    from unnested
    qualify row_number() over (partition by lat, lng, ts order by fetched_at desc) = 1

),

long as (
    {% for n in leads %}
    select
        lat,
        lng,
        to_timestamp(ts)::timestamp as valid_hour,
        {{ n }} as lead_day,
        code_{{ n }} as f_code,
        pop_{{ n }} / 100.0 as f_pop,
        temp_{{ n }} as f_temp,
        wind_{{ n }} as f_wind,
        gust_{{ n }} as f_gust,
        is_day = 1 as is_day,
        obs_code,
        obs_precip_mm
    from latest
    {% if not loop.last %}union all{% endif %}
    {% endfor %}
)

select * from long
