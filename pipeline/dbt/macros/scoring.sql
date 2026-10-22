{#
  SQL port of public/scoring.js (hourBadness, classify). Keep in lock step with the app:
  pipeline/tests/test_scoring_parity.py replays shared/scoring_cases.json (generated from the JS)
  against these macros and requires agreement to 1e-9.

  Inputs: code (WMO), pop (0..1), temp (F, may be null), wind and gust (mph), is_day (boolean).
  Missing values behave like the app's normaliser: null code/pop/wind/gust count as 0, null
  is_day counts as daytime, null temp never triggers ice.
  Literals use e0 so DuckDB types them as DOUBLE, not DECIMAL.
#}

{% macro rainman_condition_badness(code) -%}
  (case cast({{ code }} as integer)
    when 45 then 0.4e0 when 48 then 0.6e0
    when 51 then 0.2e0 when 53 then 0.3e0 when 55 then 0.4e0
    when 56 then 1.0e0 when 57 then 1.0e0
    when 61 then 0.4e0 when 63 then 0.6e0 when 65 then 0.9e0
    when 66 then 1.0e0 when 67 then 1.0e0
    when 71 then 0.8e0 when 73 then 1.0e0 when 75 then 1.0e0 when 77 then 0.8e0
    when 80 then 0.4e0 when 81 then 0.6e0 when 82 then 0.9e0
    when 85 then 1.0e0 when 86 then 1.0e0
    when 95 then 1.0e0 when 96 then 1.0e0 when 99 then 1.0e0
    else 0.0e0
  end)
{%- endmacro %}

{# Drizzle, rain and showers: liquid precipitation that freezes on cold roads #}
{% macro rainman_is_liquid_precip(code) -%}
  (cast({{ code }} as integer) between 51 and 55
    or cast({{ code }} as integer) between 61 and 65
    or cast({{ code }} as integer) between 80 and 82)
{%- endmacro %}

{% macro rainman_badness(code, pop, temp, wind, gust, is_day) -%}
  least(1.0e0, greatest(0.0e0,
    (case
      when coalesce({{ rainman_is_liquid_precip(code) }}, false)
        and {{ temp }} is not null and {{ temp }} <= 34 then 1.0e0
      else greatest({{ rainman_condition_badness(code) }}, coalesce({{ pop }}, 0.0e0) * 0.5e0)
    end)
    + (case
        when coalesce({{ wind }}, 0.0e0) > 30 then 0.3e0
        when coalesce({{ wind }}, 0.0e0) > 20 then 0.15e0
        else 0.0e0
      end)
    + (case when coalesce({{ gust }}, 0.0e0) > 45 then 0.15e0 else 0.0e0 end)
    + (case when coalesce({{ is_day }}, true) then 0.0e0 else 0.1e0 end)
  ))
{%- endmacro %}

{# good < 0.2 <= okay < 0.5 <= bad #}
{% macro rainman_class(score) -%}
  (case
    when {{ score }} is null then 'unknown'
    when {{ score }} < 0.2e0 then 'good'
    when {{ score }} < 0.5e0 then 'okay'
    else 'bad'
  end)
{%- endmacro %}

{# Observed or forecast precipitation code: drizzle and up, not fog (45/48) #}
{% macro rainman_is_precip_code(code) -%}
  (cast({{ code }} as integer) >= 51)
{%- endmacro %}
