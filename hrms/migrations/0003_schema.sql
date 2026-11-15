-- 0003_schema.sql: 3 step(s), from be1a789a839e4fdf20aa83647988ebc23661eb3bce9c0256fedd8bfc61b1fe49 to 93a1bd2bd198617bcbf1a25ec4288137036ca3d8ab4b593082e70ba044b133ec.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- hazard: validating: refuses, naming the constraint and the row count, if existing rows break it.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.

-- step drop:fk:loan_catalog_entry_repayment.loan_catalog_entry_repayment__fk__8bb4d6dc (additive)
-- operational risk: access-exclusive-lock
alter table "loan_catalog_entry_repayment" drop constraint if exists "loan_catalog_entry_repayment__fk__8bb4d6dc";

-- step replace:history:schema:loan_catalog_entry_repayment (additive)
select bolt_history_register('loan_catalog_entry_repayment','{"audit":true,"fields":{"amount":{"kind":"decimal","min":0,"scale":12},"employment_id":{"inverse":"loan_catalog_entry_repayment","kind":"ref","to":"employment"},"entity_id":{"kind":"ref","to":"entity"},"loan_id":{"inverse":"repayments","kind":"ref","on_delete":"cascade","to":"loan_catalog_entry"},"paid_on":{"kind":"date","optional":true},"payment_reference":{"kind":"text","optional":true},"payroll_run_id":{"inverse":"repayment","kind":"ref","on_delete":"set_null","optional":true,"to":"payroll_run"}},"record_label":"record.employment_id.employee_number + '' · '' + string(record.amount) + (record.paid_on != null ? '' · '' + string(record.paid_on) : '''')"}'::jsonb);

-- step create:fk:loan_catalog_entry_repayment.loan_catalog_entry_repayment__fk__9bfc5335 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "loan_catalog_entry_repayment" c where c."loan_id" is not null and not exists (select 1 from "loan_catalog_entry" p where p."id" = c."loan_id")' into n;
	if n > 0 then raise exception 'loan_catalog_entry_repayment__fk__9bfc5335 refuses % existing row(s)', n; end if;
end $store$;
alter table "loan_catalog_entry_repayment" add constraint "loan_catalog_entry_repayment__fk__9bfc5335" foreign key ("loan_id") references "loan_catalog_entry" ("id") on delete cascade on update restrict;
