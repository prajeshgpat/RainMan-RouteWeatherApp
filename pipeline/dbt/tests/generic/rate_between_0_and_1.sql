{% test rate_between_0_and_1(model, column_name) %}
select {{ column_name }} from {{ model }}
where {{ column_name }} is not null and ({{ column_name }} < 0 or {{ column_name }} > 1)
{% endtest %}
