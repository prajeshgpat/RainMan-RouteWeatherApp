{#
  Use the custom schema exactly as configured (raw, staging, intermediate, marts) instead of
  dbt's default `<target schema>_<custom schema>`, so dev and prod have the same layout.
#}
{% macro generate_schema_name(custom_schema_name, node) -%}
  {%- if custom_schema_name is none -%}
    {{ target.schema }}
  {%- else -%}
    {{ custom_schema_name | trim }}
  {%- endif -%}
{%- endmacro %}
