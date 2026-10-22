{{ config(severity='warn') }}
{# Warn (never fail) when the newest observed hour is older than var('freshness_warn_days'). #}
select max(valid_hour) as latest_valid_hour
from {{ ref('int_point_hour_forecast') }}
having max(valid_hour) < current_timestamp::timestamp - interval {{ var('freshness_warn_days') }} day
