-- 0005_schema.sql: 83 step(s), from 390651bc32d7f0a94b9e2b79660c35cbc04dcbbe2ef7eb2033eabbd6bc53ec15 to 05c31189618b6cca886663970445b5162676ee64827aaafcf5f142e20bba55b0.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- hazard: backfill: a derived column is filled from every row (time grows with the table).
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-rewrite: may rewrite the table; disk use and work grow with existing data.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.

-- step drop:index:employee_balance.employee_balance__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "employee_balance__gin__73732636";

-- step drop:index:loan_catalog_entry_repayment.loan_catalog_entry_repayment__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "loan_catalog_entry_repayment__gin__73732636";

-- step drop:index:pay_amendment.pay_amendment__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "pay_amendment__gin__73732636";

-- step drop:index:payslip.payslip__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "payslip__gin__73732636";

-- step drop:index:roster_entry.roster_entry__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "roster_entry__gin__73732636";

-- step replace:index:ledger_entry.ledger_entry__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "ledger_entry__gin__73732636";

-- step replace:index:contract_change.contract_change__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "contract_change__gin__73732636";

-- step replace:index:entity_change.entity_change__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "entity_change__gin__73732636";

-- step replace:index:holiday.holiday__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "holiday__gin__73732636";

-- step replace:index:workplace_case_catalog_entry.workplace_case_catalog_entry__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "workplace_case_catalog_entry__gin__73732636";

-- step replace:index:payroll_run.payroll_run__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "payroll_run__gin__73732636";

-- step drop:column:employee_balance.bolt_record_label (additive)
-- operational risk: access-exclusive-lock
alter table "employee_balance" drop column if exists "bolt_record_label" cascade;

-- step drop:column:employee_balance.bolt_search (additive)
-- operational risk: access-exclusive-lock
alter table "employee_balance" drop column if exists bolt_search cascade;

-- step drop:column:loan_catalog_entry_repayment.bolt_record_label (additive)
-- operational risk: access-exclusive-lock
alter table "loan_catalog_entry_repayment" drop column if exists "bolt_record_label" cascade;

-- step drop:column:loan_catalog_entry_repayment.bolt_search (additive)
-- operational risk: access-exclusive-lock
alter table "loan_catalog_entry_repayment" drop column if exists bolt_search cascade;

-- step drop:column:pay_amendment.bolt_record_label (additive)
-- operational risk: access-exclusive-lock
alter table "pay_amendment" drop column if exists "bolt_record_label" cascade;

-- step drop:column:pay_amendment.bolt_search (additive)
-- operational risk: access-exclusive-lock
alter table "pay_amendment" drop column if exists bolt_search cascade;

-- step drop:column:payslip.bolt_record_label (additive)
-- operational risk: access-exclusive-lock
alter table "payslip" drop column if exists "bolt_record_label" cascade;

-- step drop:column:payslip.bolt_search (additive)
-- operational risk: access-exclusive-lock
alter table "payslip" drop column if exists bolt_search cascade;

-- step drop:column:roster_entry.bolt_record_label (additive)
-- operational risk: access-exclusive-lock
alter table "roster_entry" drop column if exists "bolt_record_label" cascade;

-- step drop:column:roster_entry.bolt_search (additive)
-- operational risk: access-exclusive-lock
alter table "roster_entry" drop column if exists bolt_search cascade;

-- step replace:column:ledger_entry.bolt_record_label (backfill)
-- operational risk: access-exclusive-lock
alter table "ledger_entry" drop column if exists "bolt_record_label" cascade;

-- step replace:column:ledger_entry.bolt_search (backfill)
-- operational risk: access-exclusive-lock
alter table "ledger_entry" drop column if exists bolt_search cascade;

-- step replace:column:contract_change.bolt_record_label (backfill)
-- operational risk: access-exclusive-lock
alter table "contract_change" drop column if exists "bolt_record_label" cascade;

-- step replace:column:contract_change.bolt_search (backfill)
-- operational risk: access-exclusive-lock
alter table "contract_change" drop column if exists bolt_search cascade;

-- step replace:column:entity_change.bolt_record_label (backfill)
-- operational risk: access-exclusive-lock
alter table "entity_change" drop column if exists "bolt_record_label" cascade;

-- step replace:column:entity_change.bolt_search (backfill)
-- operational risk: access-exclusive-lock
alter table "entity_change" drop column if exists bolt_search cascade;

-- step replace:column:holiday.bolt_record_label (backfill)
-- operational risk: access-exclusive-lock
alter table "holiday" drop column if exists "bolt_record_label" cascade;

-- step replace:column:holiday.bolt_search (backfill)
-- operational risk: access-exclusive-lock
alter table "holiday" drop column if exists bolt_search cascade;

-- step replace:column:workplace_case_catalog_entry.bolt_record_label (backfill)
-- operational risk: access-exclusive-lock
alter table "workplace_case_catalog_entry" drop column if exists "bolt_record_label" cascade;

-- step replace:column:workplace_case_catalog_entry.bolt_search (backfill)
-- operational risk: access-exclusive-lock
alter table "workplace_case_catalog_entry" drop column if exists bolt_search cascade;

-- step replace:column:payroll_run.bolt_record_label (backfill)
-- operational risk: access-exclusive-lock
alter table "payroll_run" drop column if exists "bolt_record_label" cascade;

-- step replace:column:payroll_run.bolt_search (backfill)
-- operational risk: access-exclusive-lock
alter table "payroll_run" drop column if exists bolt_search cascade;

-- step drop:function:bolt_record_label_contract_change_b26ebd75 (additive)
drop function if exists "bolt_record_label_contract_change_b26ebd75"(text) cascade;

-- step drop:function:bolt_record_label_employee_balance_61d5b847 (additive)
drop function if exists "bolt_record_label_employee_balance_61d5b847"() cascade;

-- step drop:function:bolt_record_label_entity_change_b26ebd75 (additive)
drop function if exists "bolt_record_label_entity_change_b26ebd75"(text) cascade;

-- step drop:function:bolt_record_label_holiday_c0a9a654 (additive)
drop function if exists "bolt_record_label_holiday_c0a9a654"(date) cascade;

-- step drop:function:bolt_record_label_ledger_entry_1d6aa255 (additive)
drop function if exists "bolt_record_label_ledger_entry_1d6aa255"(text) cascade;

-- step drop:function:bolt_record_label_loan_catalog_entry_rep_6b8b30eb (additive)
drop function if exists "bolt_record_label_loan_catalog_entry_rep_6b8b30eb"(text) cascade;

-- step drop:function:bolt_record_label_pay_amendment_17185e46 (additive)
drop function if exists "bolt_record_label_pay_amendment_17185e46"(text) cascade;

-- step drop:function:bolt_record_label_payroll_run_24bef971 (additive)
drop function if exists "bolt_record_label_payroll_run_24bef971"(int) cascade;

-- step drop:function:bolt_record_label_payslip_e54569f4 (additive)
drop function if exists "bolt_record_label_payslip_e54569f4"(numeric) cascade;

-- step drop:function:bolt_record_label_roster_entry_10a4d23a (additive)
drop function if exists "bolt_record_label_roster_entry_10a4d23a"(date) cascade;

-- step drop:function:bolt_record_label_workplace_case_catalog_c652d599 (additive)
drop function if exists "bolt_record_label_workplace_case_catalog_c652d599"(text) cascade;

-- step create:function:bolt_record_label_ledger_entry_b5edd145 (additive)
create function "bolt_record_label_ledger_entry_b5edd145"(text, date) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT ((SELECT CASE WHEN jsonb_typeof(label_1.left_value) = 'string' AND jsonb_typeof(label_1.right_value) = 'string' THEN to_jsonb((label_1.left_value #>> '{}') || (label_1.right_value #>> '{}')) WHEN jsonb_typeof(label_1.left_value) = 'array' AND jsonb_typeof(label_1.right_value) = 'array' THEN label_1.left_value || label_1.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_1.left_value) = 'number' THEN (label_1.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_1.right_value) = 'number' THEN (label_1.right_value #>> '{}') END)::numeric) END FROM (SELECT (SELECT CASE WHEN jsonb_typeof(label_0.left_value) = 'string' AND jsonb_typeof(label_0.right_value) = 'string' THEN to_jsonb((label_0.left_value #>> '{}') || (label_0.right_value #>> '{}')) WHEN jsonb_typeof(label_0.left_value) = 'array' AND jsonb_typeof(label_0.right_value) = 'array' THEN label_0.left_value || label_0.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_0.left_value) = 'number' THEN (label_0.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_0.right_value) = 'number' THEN (label_0.right_value #>> '{}') END)::numeric) END FROM (SELECT coalesce((label_row.j #> ARRAY['code']), 'null'::jsonb) AS left_value, to_jsonb(' · '::text) AS right_value) label_0) AS left_value, to_jsonb((coalesce((label_row.j #> ARRAY['effective_on']), 'null'::jsonb) #>> '{}')) AS right_value) label_1) #>> '{}') AS value FROM (SELECT jsonb_build_object('code', to_jsonb("code"), 'effective_on', to_jsonb("effective_on"::text)) AS j FROM (SELECT $1 AS "code", $2 AS "effective_on") label_inputs) label_row) label_value$record_label$;

-- step create:function:bolt_record_label_contract_change_82edb7c6 (additive)
create function "bolt_record_label_contract_change_82edb7c6"(date, text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT ((SELECT CASE WHEN jsonb_typeof(label_1.left_value) = 'string' AND jsonb_typeof(label_1.right_value) = 'string' THEN to_jsonb((label_1.left_value #>> '{}') || (label_1.right_value #>> '{}')) WHEN jsonb_typeof(label_1.left_value) = 'array' AND jsonb_typeof(label_1.right_value) = 'array' THEN label_1.left_value || label_1.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_1.left_value) = 'number' THEN (label_1.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_1.right_value) = 'number' THEN (label_1.right_value #>> '{}') END)::numeric) END FROM (SELECT (SELECT CASE WHEN jsonb_typeof(label_0.left_value) = 'string' AND jsonb_typeof(label_0.right_value) = 'string' THEN to_jsonb((label_0.left_value #>> '{}') || (label_0.right_value #>> '{}')) WHEN jsonb_typeof(label_0.left_value) = 'array' AND jsonb_typeof(label_0.right_value) = 'array' THEN label_0.left_value || label_0.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_0.left_value) = 'number' THEN (label_0.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_0.right_value) = 'number' THEN (label_0.right_value #>> '{}') END)::numeric) END FROM (SELECT coalesce((label_row.j #> ARRAY['field_path']), 'null'::jsonb) AS left_value, to_jsonb(' · '::text) AS right_value) label_0) AS left_value, to_jsonb((coalesce((label_row.j #> ARRAY['effective_from']), 'null'::jsonb) #>> '{}')) AS right_value) label_1) #>> '{}') AS value FROM (SELECT jsonb_build_object('field_path', to_jsonb("field_path"), 'effective_from', to_jsonb("effective_from"::text)) AS j FROM (SELECT $1 AS "effective_from", $2 AS "field_path") label_inputs) label_row) label_value$record_label$;

-- step create:function:bolt_record_label_entity_change_82edb7c6 (additive)
create function "bolt_record_label_entity_change_82edb7c6"(date, text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT ((SELECT CASE WHEN jsonb_typeof(label_1.left_value) = 'string' AND jsonb_typeof(label_1.right_value) = 'string' THEN to_jsonb((label_1.left_value #>> '{}') || (label_1.right_value #>> '{}')) WHEN jsonb_typeof(label_1.left_value) = 'array' AND jsonb_typeof(label_1.right_value) = 'array' THEN label_1.left_value || label_1.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_1.left_value) = 'number' THEN (label_1.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_1.right_value) = 'number' THEN (label_1.right_value #>> '{}') END)::numeric) END FROM (SELECT (SELECT CASE WHEN jsonb_typeof(label_0.left_value) = 'string' AND jsonb_typeof(label_0.right_value) = 'string' THEN to_jsonb((label_0.left_value #>> '{}') || (label_0.right_value #>> '{}')) WHEN jsonb_typeof(label_0.left_value) = 'array' AND jsonb_typeof(label_0.right_value) = 'array' THEN label_0.left_value || label_0.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_0.left_value) = 'number' THEN (label_0.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_0.right_value) = 'number' THEN (label_0.right_value #>> '{}') END)::numeric) END FROM (SELECT coalesce((label_row.j #> ARRAY['field_path']), 'null'::jsonb) AS left_value, to_jsonb(' · '::text) AS right_value) label_0) AS left_value, to_jsonb((coalesce((label_row.j #> ARRAY['effective_from']), 'null'::jsonb) #>> '{}')) AS right_value) label_1) #>> '{}') AS value FROM (SELECT jsonb_build_object('field_path', to_jsonb("field_path"), 'effective_from', to_jsonb("effective_from"::text)) AS j FROM (SELECT $1 AS "effective_from", $2 AS "field_path") label_inputs) label_row) label_value$record_label$;

-- step create:function:bolt_record_label_holiday_926befc4 (additive)
create function "bolt_record_label_holiday_926befc4"(date, text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT ((SELECT CASE WHEN jsonb_typeof(label_1.left_value) = 'string' AND jsonb_typeof(label_1.right_value) = 'string' THEN to_jsonb((label_1.left_value #>> '{}') || (label_1.right_value #>> '{}')) WHEN jsonb_typeof(label_1.left_value) = 'array' AND jsonb_typeof(label_1.right_value) = 'array' THEN label_1.left_value || label_1.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_1.left_value) = 'number' THEN (label_1.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_1.right_value) = 'number' THEN (label_1.right_value #>> '{}') END)::numeric) END FROM (SELECT (SELECT CASE WHEN jsonb_typeof(label_0.left_value) = 'string' AND jsonb_typeof(label_0.right_value) = 'string' THEN to_jsonb((label_0.left_value #>> '{}') || (label_0.right_value #>> '{}')) WHEN jsonb_typeof(label_0.left_value) = 'array' AND jsonb_typeof(label_0.right_value) = 'array' THEN label_0.left_value || label_0.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_0.left_value) = 'number' THEN (label_0.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_0.right_value) = 'number' THEN (label_0.right_value #>> '{}') END)::numeric) END FROM (SELECT coalesce((label_row.j #> ARRAY['name']), 'null'::jsonb) AS left_value, to_jsonb(' · '::text) AS right_value) label_0) AS left_value, to_jsonb((coalesce((label_row.j #> ARRAY['date']), 'null'::jsonb) #>> '{}')) AS right_value) label_1) #>> '{}') AS value FROM (SELECT jsonb_build_object('name', to_jsonb("name"), 'date', to_jsonb("date"::text)) AS j FROM (SELECT $1 AS "date", $2 AS "name") label_inputs) label_row) label_value$record_label$;

-- step create:function:bolt_record_label_workplace_case_catalog_a812210f (additive)
create function "bolt_record_label_workplace_case_catalog_a812210f"(text, date) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT ((SELECT CASE WHEN jsonb_typeof(label_1.left_value) = 'string' AND jsonb_typeof(label_1.right_value) = 'string' THEN to_jsonb((label_1.left_value #>> '{}') || (label_1.right_value #>> '{}')) WHEN jsonb_typeof(label_1.left_value) = 'array' AND jsonb_typeof(label_1.right_value) = 'array' THEN label_1.left_value || label_1.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_1.left_value) = 'number' THEN (label_1.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_1.right_value) = 'number' THEN (label_1.right_value #>> '{}') END)::numeric) END FROM (SELECT (SELECT CASE WHEN jsonb_typeof(label_0.left_value) = 'string' AND jsonb_typeof(label_0.right_value) = 'string' THEN to_jsonb((label_0.left_value #>> '{}') || (label_0.right_value #>> '{}')) WHEN jsonb_typeof(label_0.left_value) = 'array' AND jsonb_typeof(label_0.right_value) = 'array' THEN label_0.left_value || label_0.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_0.left_value) = 'number' THEN (label_0.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_0.right_value) = 'number' THEN (label_0.right_value #>> '{}') END)::numeric) END FROM (SELECT coalesce((label_row.j #> ARRAY['kind']), 'null'::jsonb) AS left_value, to_jsonb(' · '::text) AS right_value) label_0) AS left_value, to_jsonb((coalesce((label_row.j #> ARRAY['opened_on']), 'null'::jsonb) #>> '{}')) AS right_value) label_1) #>> '{}') AS value FROM (SELECT jsonb_build_object('kind', to_jsonb("kind"), 'opened_on', to_jsonb("opened_on"::text)) AS j FROM (SELECT $1 AS "kind", $2 AS "opened_on") label_inputs) label_row) label_value$record_label$;

-- step create:function:bolt_record_label_payroll_run_8635e840 (additive)
create function "bolt_record_label_payroll_run_8635e840"(text, int) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT ((SELECT CASE WHEN jsonb_typeof(label_2.left_value) = 'string' AND jsonb_typeof(label_2.right_value) = 'string' THEN to_jsonb((label_2.left_value #>> '{}') || (label_2.right_value #>> '{}')) WHEN jsonb_typeof(label_2.left_value) = 'array' AND jsonb_typeof(label_2.right_value) = 'array' THEN label_2.left_value || label_2.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_2.left_value) = 'number' THEN (label_2.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_2.right_value) = 'number' THEN (label_2.right_value #>> '{}') END)::numeric) END FROM (SELECT (SELECT CASE WHEN jsonb_typeof(label_1.left_value) = 'string' AND jsonb_typeof(label_1.right_value) = 'string' THEN to_jsonb((label_1.left_value #>> '{}') || (label_1.right_value #>> '{}')) WHEN jsonb_typeof(label_1.left_value) = 'array' AND jsonb_typeof(label_1.right_value) = 'array' THEN label_1.left_value || label_1.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_1.left_value) = 'number' THEN (label_1.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_1.right_value) = 'number' THEN (label_1.right_value #>> '{}') END)::numeric) END FROM (SELECT (SELECT CASE WHEN jsonb_typeof(label_0.left_value) = 'string' AND jsonb_typeof(label_0.right_value) = 'string' THEN to_jsonb((label_0.left_value #>> '{}') || (label_0.right_value #>> '{}')) WHEN jsonb_typeof(label_0.left_value) = 'array' AND jsonb_typeof(label_0.right_value) = 'array' THEN label_0.left_value || label_0.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_0.left_value) = 'number' THEN (label_0.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_0.right_value) = 'number' THEN (label_0.right_value #>> '{}') END)::numeric) END FROM (SELECT to_jsonb('Run '::text) AS left_value, to_jsonb((coalesce((label_row.j #> ARRAY['run_number']), 'null'::jsonb) #>> '{}')) AS right_value) label_0) AS left_value, to_jsonb(' · '::text) AS right_value) label_1) AS left_value, coalesce((label_row.j #> ARRAY['period']), 'null'::jsonb) AS right_value) label_2) #>> '{}') AS value FROM (SELECT jsonb_build_object('run_number', to_jsonb("run_number"), 'period', to_jsonb("period")) AS j FROM (SELECT $1 AS "period", $2 AS "run_number") label_inputs) label_row) label_value$record_label$;

-- step replace:column:ledger_entry.bolt_record_label (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "ledger_entry" add column "bolt_record_label" text generated always as ("bolt_record_label_ledger_entry_b5edd145"("code", "effective_on")) stored;

-- step replace:column:ledger_entry.bolt_search (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "ledger_entry" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_ledger_entry_b5edd145"("code", "effective_on"), ''))) stored;

-- step replace:column:contract_change.bolt_record_label (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "contract_change" add column "bolt_record_label" text generated always as ("bolt_record_label_contract_change_82edb7c6"("effective_from", "field_path")) stored;

-- step replace:column:contract_change.bolt_search (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "contract_change" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_contract_change_82edb7c6"("effective_from", "field_path"), ''))) stored;

-- step replace:column:entity_change.bolt_record_label (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "entity_change" add column "bolt_record_label" text generated always as ("bolt_record_label_entity_change_82edb7c6"("effective_from", "field_path")) stored;

-- step replace:column:entity_change.bolt_search (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "entity_change" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_entity_change_82edb7c6"("effective_from", "field_path"), ''))) stored;

-- step replace:column:holiday.bolt_record_label (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "holiday" add column "bolt_record_label" text generated always as ("bolt_record_label_holiday_926befc4"("date", "name")) stored;

-- step replace:column:holiday.bolt_search (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "holiday" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_holiday_926befc4"("date", "name"), ''))) stored;

-- step replace:column:workplace_case_catalog_entry.bolt_record_label (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "workplace_case_catalog_entry" add column "bolt_record_label" text generated always as ("bolt_record_label_workplace_case_catalog_a812210f"("kind", "opened_on")) stored;

-- step replace:column:workplace_case_catalog_entry.bolt_search (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "workplace_case_catalog_entry" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_workplace_case_catalog_a812210f"("kind", "opened_on"), ''))) stored;

-- step replace:column:payroll_run.bolt_record_label (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "payroll_run" add column "bolt_record_label" text generated always as ("bolt_record_label_payroll_run_8635e840"("period", "run_number")) stored;

-- step replace:column:payroll_run.bolt_search (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "payroll_run" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_payroll_run_8635e840"("period", "run_number"), ''))) stored;

-- step replace:history:schema:employee_balance (additive)
select bolt_history_register('employee_balance','{"audit":true,"fields":{"account":{"default":{},"kind":"json","shape":{"kind":"record","of":{"kind":"record","of":{"kind":"json"}}}},"employee_id":{"kind":"ref","to":"employee_profile"}},"record_label":"has(record.employee_id.name) ? record.employee_id.name : ''Balance''","unique":[{"fields":["employee_id"],"name":"one_balance"}]}'::jsonb);

-- step replace:history:schema:ledger_entry (additive)
select bolt_history_register('ledger_entry','{"audit":true,"check":{"names_its_movement":{"amount":{"is_null":false},"measure":{"is_null":false},"period":{"is_null":false},"source":{"is_null":false}}},"fields":{"account":{"kind":"text"},"amount":{"kind":"decimal","min":0,"optional":true,"scale":12},"balance_id":{"inverse":"entries","kind":"ref","to":"employee_balance"},"code":{"kind":"text"},"effective_on":{"kind":"date"},"measure":{"kind":"enum","optional":true,"values":["total","used","entitled","carried","limit","paid"]},"note":{"kind":"text","optional":true},"operation":{"kind":"enum","values":["ADD","DEDUCT"]},"period":{"kind":"text","optional":true},"source":{"kind":"text","optional":true},"unit":{"kind":"enum","optional":true,"values":["DAY","CALENDAR_DAY","HOUR","MONEY","COUNT"]}},"record_label":"record.code + '' · '' + string(record.effective_on)"}'::jsonb);

-- step replace:history:schema:employee_contract (additive)
select bolt_history_register('employee_contract','{"audit":true,"fields":{"bank":{"kind":"custom","of":"bank","optional":true},"effective_range":{"kind":"period","of":"date"},"employee_extension_data":{"default":{},"kind":"json","shape":{"kind":"record","of":{"kind":"json"}}},"employee_id":{"inverse":"employee_contract","kind":"ref","to":"employee_profile"},"employee_number":{"kind":"text"},"encash_leave":{"default":true,"kind":"bool"},"engagement":{"default":"EMPLOYEE","kind":"enum","values":["EMPLOYEE","PART_TIME","CONTRACTOR","INTERN","APPRENTICE","CONSULTANT","PAYEE"]},"entity_id":{"inverse":"employee_contract","kind":"ref","to":"entity"},"events":{"fields":{"allocated_days":{"kind":"int","optional":true},"ended_on":{"kind":"date","optional":true},"kind":{"kind":"text"},"on":{"kind":"date"},"opened_on":{"kind":"date","optional":true}},"kind":"object","many":true,"optional":true},"exit_ground":{"kind":"enum","optional":true,"values":["RETRENCHMENT","RETIREMENT","RESIGNATION","DISMISSAL","MISCONDUCT_DISMISSAL","END_OF_CONTRACT","MUTUAL","DEATH","UNILATERAL","BREACH_BY_EMPLOYER"]},"family":{"fields":{"allocations":{"kind":"record","of":{"kind":"number","min":0},"optional":true},"born_on":{"kind":"date","optional":true},"disabled":{"kind":"bool","optional":true},"expected_on":{"kind":"date","optional":true},"has_income":{"kind":"bool","optional":true},"relation":{"kind":"enum","values":["CHILD","SPOUSE","PARENT"]},"studying":{"kind":"bool","optional":true}},"kind":"object","many":true,"optional":true},"final_pay_due_on":{"kind":"date","optional":true},"pay_group_id":{"inverse":"employee_contract","kind":"ref","on_delete":"restrict","optional":true,"to":"pay_group"},"payroll":{"fields":{"birth_city":{"kind":"text","optional":true},"date_of_birth":{"kind":"date","optional":true},"gender":{"kind":"enum","optional":true,"values":["MALE","FEMALE"]},"identity_number":{"kind":"text","optional":true},"marital_status":{"kind":"enum","optional":true,"values":["SINGLE","MARRIED","SEPARATED","DIVORCED","WIDOWED"]},"nationality":{"kind":"text","optional":true},"passport_number":{"kind":"text","optional":true}},"kind":"object","optional":true},"reason":{"kind":"text","optional":true},"service_started_on":{"kind":"date","optional":true},"signed_contract_period":{"kind":"period","of":"date","optional":true},"status":{"initial":"DRAFT","kind":"state","states":{"DRAFT":{"to":["SEALED"]},"SEALED":{"to":["VOID"]},"VOID":{"to":[]}}},"terms":{"fields":{"allowances":{"kind":"record","of":{"fields":{"amount":{"kind":"number","min":0}},"kind":"object"},"optional":true},"annual_leave_carry_limit_days":{"kind":"number","min":0,"optional":true},"department":{"kind":"text","optional":true},"employee_borne_tax_items":{"kind":"text","many":true,"optional":true},"employer_bears_income_tax":{"kind":"bool","optional":true},"job_title":{"kind":"text","optional":true},"normal_days_per_week":{"kind":"number","max":7,"min":0},"normal_hours_per_day":{"kind":"number","min":0},"normal_hours_per_week":{"kind":"number","min":0},"notice_period":{"fields":{"unit":{"kind":"enum","values":["DAYS","WEEKS","MONTHS"]},"value":{"kind":"number","min":0}},"kind":"object","optional":true},"probation_period":{"kind":"period","of":"date","optional":true},"rate":{"kind":"json","optional":true,"shape":{"arms":{"DAILY":{"amount":{"kind":"number","min":0}},"HOURLY":{"amount":{"kind":"number","min":0}},"MONTHLY":{"amount":{"kind":"number","min":0}}},"by":"unit","kind":"union"}},"residency_status":{"kind":"text","optional":true},"shift_pattern_id":{"kind":"ref","optional":true,"to":"shift_pattern"},"signed_on":{"kind":"date","optional":true},"statutory_work_category":{"kind":"text","optional":true},"wage_payment_method":{"kind":"enum","optional":true,"values":["BANK","CASH","CHEQUE","DIGITAL"]},"work_authorisation_category":{"kind":"text","optional":true},"work_authorisation_expires_on":{"kind":"date","optional":true},"work_classification":{"kind":"text","optional":true},"work_region":{"kind":"text","optional":true},"worksite":{"kind":"text","optional":true}},"kind":"object"}},"locks":{"sealed_version":{"except":["effective_range","final_pay_due_on","reason","exit_ground","encash_leave","employee_extension_data","status"],"where":{"status":{"eq":"SEALED"}}},"void_version":{"where":{"status":{"eq":"VOID"}}}},"no_overlap":[{"key":["employee_id"],"name":"sealed_range","period":"effective_range","where":{"status":{"eq":"SEALED"}}}],"record_label":"(has(record.employee_id.name) ? record.employee_id.name + '' · '' : '''') + record.employee_number + '' · '' + string(record.effective_range.from)","search":{"text":["employee_number","employee_id"]}}'::jsonb);

-- step replace:history:schema:contract_change (additive)
select bolt_history_register('contract_change','{"audit":true,"fields":{"applied_version_id":{"kind":"ref","on_delete":"restrict","optional":true,"to":"employee_contract"},"effective_from":{"kind":"date"},"employee_id":{"inverse":"contract_changes","kind":"ref","on_delete":"cascade","to":"employee_profile"},"field_path":{"kind":"text"},"new_value":{"kind":"json","optional":true},"notes":{"kind":"text","optional":true},"old_value":{"kind":"json","optional":true}},"locks":{"applied_change":{"where":{"applied_version_id":{"is_null":false}}}},"record_label":"record.field_path + '' · '' + string(record.effective_from)"}'::jsonb);

-- step replace:history:schema:entity_change (additive)
select bolt_history_register('entity_change','{"audit":true,"fields":{"applied_version_id":{"kind":"ref","on_delete":"restrict","optional":true,"to":"entity_profile_version"},"effective_from":{"kind":"date"},"entity_id":{"inverse":"entity_changes","kind":"ref","on_delete":"cascade","to":"entity"},"field_path":{"kind":"text"},"new_value":{"kind":"json","optional":true},"notes":{"kind":"text","optional":true},"old_value":{"hidden":true,"kind":"json","optional":true}},"locks":{"applied_change":{"where":{"applied_version_id":{"is_null":false}}}},"record_label":"record.field_path + '' · '' + string(record.effective_from)","unique":[{"fields":["entity_id","field_path","effective_from"],"name":"one_change"}]}'::jsonb);

-- step replace:history:schema:holiday (additive)
select bolt_history_register('holiday','{"audit":true,"fields":{"date":{"kind":"date"},"employee_id":{"inverse":"holiday","kind":"ref","optional":true,"to":"employee_profile"},"entity_id":{"inverse":"holiday","kind":"ref","to":"entity"},"given_to":{"default":"EVERYONE","kind":"enum","values":["EVERYONE","ONLY_IF_OFF_ON_REPLACED_DATE"]},"kind":{"default":"PUBLIC_HOLIDAY","kind":"enum","values":["PUBLIC_HOLIDAY","SPECIAL_HOLIDAY","SUBSTITUTE","DOUBLE_HOLIDAY","DOUBLE_SPECIAL","MAKEUP_WORKDAY"]},"name":{"kind":"text"},"published_at":{"hidden":true,"kind":"instant","optional":true},"replaces":{"kind":"date","optional":true}},"record_label":"record.name + '' · '' + string(record.date)"}'::jsonb);

-- step replace:history:schema:adhoc_catalog_entry (additive)
select bolt_history_register('adhoc_catalog_entry','{"audit":true,"fields":{"catalog_id":{"kind":"ref","on_delete":"restrict","to":"adhoc_catalog"},"description":{"kind":"text"},"employment_id":{"inverse":"adhoc_catalog_entry","kind":"ref","to":"employee_contract"},"entity_id":{"kind":"ref","to":"entity"},"evidence_file":{"accept":["application/pdf","image/*"],"kind":"file","max":"20MiB","optional":true},"incurred_on":{"kind":"date"},"payroll_run_id":{"inverse":"adhoc","kind":"ref","on_delete":"set_null","optional":true,"to":"payroll_run"},"quantity":{"kind":"decimal","min":0,"scale":12},"unit":{"default":"MONEY","kind":"enum","values":["DAY","CALENDAR_DAY","HOUR","MONEY","COUNT"]}},"record_label":"record.employment_id.employee_number + '' · '' + record.catalog_id.code + '' · '' + string(record.quantity)"}'::jsonb);

-- step replace:history:schema:claim_catalog_entry (additive)
select bolt_history_register('claim_catalog_entry','{"audit":true,"fields":{"catalog_id":{"kind":"ref","on_delete":"restrict","to":"claim_catalog"},"employment_id":{"inverse":"claim_catalog_entry","kind":"ref","to":"employee_contract"},"entity_id":{"kind":"ref","to":"entity"},"evidence_file":{"accept":["application/pdf","image/*"],"kind":"file","max":"20MiB","optional":true},"incurred_on":{"kind":"date"},"payroll_run_id":{"inverse":"claim","kind":"ref","on_delete":"set_null","optional":true,"to":"payroll_run"},"quantity":{"kind":"decimal","min":0,"scale":12},"unit":{"default":"MONEY","kind":"enum","values":["DAY","CALENDAR_DAY","HOUR","MONEY","COUNT"]}},"record_label":"record.employment_id.employee_number + '' · '' + record.catalog_id.code + '' · '' + string(record.quantity) + (record.unit == ''MONEY'' ? '''' : '' '' + record.unit)"}'::jsonb);

-- step replace:history:schema:loan_catalog_entry (additive)
select bolt_history_register('loan_catalog_entry','{"audit":true,"fields":{"catalog_id":{"kind":"ref","on_delete":"restrict","to":"loan_catalog"},"employment_id":{"inverse":"loan_catalog_entry","kind":"ref","to":"employee_contract"},"entity_id":{"kind":"ref","to":"entity"},"evidence_file":{"accept":["application/pdf","image/*"],"kind":"file","max":"20MiB","optional":true},"payroll_run_id":{"kind":"ref","on_delete":"set_null","optional":true,"to":"payroll_run"},"quantity":{"kind":"decimal","min":0,"scale":12},"recovered":{"hidden":true,"kind":"sum","of":"repayments.amount"},"repayment_period":{"kind":"period","of":"date"}},"record_label":"record.employment_id.employee_number + '' · '' + record.catalog_id.code"}'::jsonb);

-- step replace:history:schema:loan_catalog_entry_repayment (additive)
select bolt_history_register('loan_catalog_entry_repayment','{"audit":true,"fields":{"amount":{"kind":"decimal","min":0,"scale":12},"employment_id":{"inverse":"loan_catalog_entry_repayment","kind":"ref","to":"employee_contract"},"entity_id":{"kind":"ref","to":"entity"},"loan_id":{"inverse":"repayments","kind":"ref","on_delete":"restrict","to":"loan_catalog_entry"},"paid_on":{"kind":"date","optional":true},"payment_reference":{"kind":"text","optional":true},"payroll_run_id":{"inverse":"repayment","kind":"ref","on_delete":"set_null","optional":true,"to":"payroll_run"}},"record_label":"record.employment_id.employee_number + '' · '' + string(record.amount) + (record.paid_on != null ? '' · '' + string(record.paid_on) : '''')"}'::jsonb);

-- step replace:history:schema:workplace_case_catalog_entry (additive)
select bolt_history_register('workplace_case_catalog_entry','{"audit":true,"fields":{"catalog_id":{"inverse":"entries","kind":"ref","on_delete":"restrict","to":"workplace_case_catalog"},"closed_on":{"kind":"date","optional":true},"description":{"kind":"text","optional":true},"employment_id":{"inverse":"workplace_case_catalog_entry","kind":"ref","on_delete":"restrict","to":"employee_contract"},"entity_id":{"inverse":"workplace_case_catalog_entries","kind":"ref","to":"entity"},"evidence_file":{"accept":["*/*"],"kind":"file","max":"20MiB","optional":true},"inputs":{"default":{},"kind":"json","shape":{"kind":"record","of":{"kind":"json"}}},"kind":{"kind":"text"},"location":{"kind":"text","optional":true},"occurred_on":{"kind":"date","optional":true},"opened_on":{"kind":"date"},"payroll_run_id":{"inverse":"case","kind":"ref","on_delete":"set_null","optional":true,"to":"payroll_run"},"reference":{"kind":"text","optional":true},"scheduled_on":{"kind":"date","optional":true},"severity":{"default":"N/A","kind":"enum","values":["DEATH","PERMANENT_TOTAL_DISABILITY","SERIOUS_INJURY","MINOR_INJURY","NEAR_MISS","PROPERTY_DAMAGE","N/A"]}},"locks":{"captured":{"where":{"payroll_run_id":{"is_null":false}}}},"record_label":"record.kind + '' · '' + string(record.opened_on)"}'::jsonb);

-- step replace:history:schema:payroll_run (additive)
select bolt_history_register('payroll_run','{"audit":true,"fields":{"entity_id":{"inverse":"payroll_runs","kind":"ref","to":"entity"},"kind":{"default":"ON_CYCLE","kind":"enum","values":["ON_CYCLE","OFF_CYCLE"]},"pay_date":{"kind":"date"},"pay_group_id":{"inverse":"payroll_runs","kind":"ref","on_delete":"restrict","to":"pay_group"},"period":{"kind":"text"},"run_number":{"kind":"seq"},"salary_coverage":{"kind":"period","of":"date"},"settings_id":{"kind":"ref","on_delete":"restrict","to":"jurisdiction_settings"},"state":{"initial":"UNPAID","kind":"state","states":{"PAID":{"to":[]},"UNPAID":{"to":["PAID"]}}}},"locks":{"paid_run":{"where":{"state":{"eq":"PAID"}}}},"record_label":"''Run '' + string(record.run_number) + '' · '' + record.period","unique":[{"fields":["pay_group_id","period"],"name":"one_cycle_run","where":{"kind":{"eq":"ON_CYCLE"}}}]}'::jsonb);

-- step replace:history:schema:pay_amendment (additive)
select bolt_history_register('pay_amendment','{"audit":true,"fields":{"employee_id":{"inverse":"pay_amendments","kind":"ref","to":"employee_profile"},"pay_group_id":{"kind":"ref","on_delete":"restrict","to":"pay_group"},"payroll_run_id":{"inverse":"amendments","kind":"ref","on_delete":"set_null","optional":true,"to":"payroll_run"},"period":{"kind":"text"}},"record_label":"(has(record.employee_id.name) ? record.employee_id.name + '' · '' : '''') + record.period","unique":[{"fields":["employee_id","pay_group_id","period"],"name":"open_period","where":{"payroll_run_id":{"is_null":true}}}]}'::jsonb);

-- step replace:history:schema:payslip (additive)
select bolt_history_register('payslip','{"audit":true,"fields":{"basic_earnings":{"kind":"decimal","optional":true,"scale":12},"breakdown":{"default":{},"kind":"json","shape":{"kind":"record","of":{"kind":"json"}}},"employee_id":{"inverse":"payslips","kind":"ref","to":"employee_profile"},"employee_statutory":{"default":0,"kind":"decimal","min":0,"scale":12},"employer_cost":{"default":0,"kind":"decimal","min":0,"scale":12},"employment_id":{"inverse":"payslips","kind":"ref","to":"employee_contract"},"entity_id":{"kind":"ref","to":"entity"},"gross_earnings":{"kind":"decimal","optional":true,"scale":12},"net_pay":{"kind":"decimal","scale":12},"ordinary_wages":{"default":0,"kind":"decimal","min":0,"scale":12},"payroll_run_id":{"inverse":"payslips","kind":"ref","on_delete":"cascade","to":"payroll_run"},"period":{"kind":"text","optional":true},"settings_id":{"kind":"ref","on_delete":"restrict","to":"jurisdiction_settings"},"tax_withheld":{"default":0,"kind":"decimal","min":0,"scale":12},"total_deductions":{"kind":"decimal","min":0,"scale":12}},"record_label":"(has(record.employee_id.name) ? record.employee_id.name + '' · '' : '''') + (record.period != null ? record.period : '''')","unique":[{"fields":["payroll_run_id","employee_id","entity_id"],"name":"run_person"}]}'::jsonb);

-- step replace:history:schema:roster_entry (additive)
select bolt_history_register('roster_entry','{"audit":true,"fields":{"actual_worked_intervals":{"fields":{"break_minutes":{"kind":"number","min":0,"optional":true},"breaks":{"fields":{"end":{"kind":"instant"},"start":{"kind":"instant"}},"kind":"object","many":true,"optional":true},"end":{"kind":"instant","optional":true},"start":{"kind":"instant"}},"kind":"object","many":true,"optional":true,"was":"worked_intervals"},"consent":{"kind":"json","optional":true,"shape":{"fields":{"night_work":{"kind":"bool"},"overtime":{"kind":"bool"},"reference":{"kind":"text"}},"kind":"object"}},"employment_id":{"inverse":"roster_entry","kind":"ref","to":"employee_contract"},"findings":{"default":[],"kind":"json"},"overtime_as_time_off":{"default":false,"kind":"bool"},"payroll_run_id":{"inverse":"roster_entry","kind":"ref","on_delete":"set_null","optional":true,"to":"payroll_run"},"planned_overtime_intervals":{"fields":{"break_minutes":{"kind":"number","min":0,"optional":true},"breaks":{"fields":{"end":{"kind":"instant"},"start":{"kind":"instant"}},"kind":"object","many":true,"optional":true},"end":{"kind":"instant"},"start":{"kind":"instant"}},"kind":"object","many":true,"optional":true},"shift_definition_id":{"kind":"ref","on_delete":"restrict","optional":true,"to":"shift_definition"},"work_date":{"kind":"date"}},"record_label":"(has(record.employment_id.employee_number) ? record.employment_id.employee_number + '' · '' : '''') + string(record.work_date)","unique":[{"fields":["employment_id","work_date"],"import_key":true,"name":"one_day"}]}'::jsonb);

-- step replace:index:ledger_entry.ledger_entry__gin__73732636 (additive)
-- operational risk: writes-blocked, table-scan
create index "ledger_entry__gin__73732636" on "ledger_entry" using gin (bolt_search);

-- step replace:index:contract_change.contract_change__gin__73732636 (additive)
-- operational risk: writes-blocked, table-scan
create index "contract_change__gin__73732636" on "contract_change" using gin (bolt_search);

-- step replace:index:entity_change.entity_change__gin__73732636 (additive)
-- operational risk: writes-blocked, table-scan
create index "entity_change__gin__73732636" on "entity_change" using gin (bolt_search);

-- step replace:index:holiday.holiday__gin__73732636 (additive)
-- operational risk: writes-blocked, table-scan
create index "holiday__gin__73732636" on "holiday" using gin (bolt_search);

-- step replace:index:workplace_case_catalog_entry.workplace_case_catalog_entry__gin__73732636 (additive)
-- operational risk: writes-blocked, table-scan
create index "workplace_case_catalog_entry__gin__73732636" on "workplace_case_catalog_entry" using gin (bolt_search);

-- step replace:index:payroll_run.payroll_run__gin__73732636 (additive)
-- operational risk: writes-blocked, table-scan
create index "payroll_run__gin__73732636" on "payroll_run" using gin (bolt_search);
