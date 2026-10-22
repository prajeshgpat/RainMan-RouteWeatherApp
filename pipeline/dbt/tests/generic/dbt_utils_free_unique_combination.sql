{# Model-level uniqueness over several columns, so we do not need the dbt_utils package. #}
{% test dbt_utils_free_unique_combination(model, columns) %}
select {{ columns | join(', ') }}, count(*) as n
from {{ model }}
group by {{ columns | join(', ') }}
having count(*) > 1
{% endtest %}
