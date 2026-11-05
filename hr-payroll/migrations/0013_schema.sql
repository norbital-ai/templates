-- 0013_schema.sql: 6 step(s), from 4571d4cd49e45d940a3e9dfe145e8e0dd30536005acf258d8be945c3020730f5 to 778ed0fed7d8a9b74c973f868de5daa030ac8e9107cac5c82fcf4bf78f1c5ec1.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- hazard: validating: refuses, naming the constraint and the row count, if existing rows break it.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.

-- step replace:trigger:payslip.store_row_rules (additive)
drop trigger if exists store_row_rules on "payslip";

-- step replace:history:schema:payslip (additive)
select bolt_history_register('payslip','{"audit":true,"fields":{"additional_wages":{"default":0,"kind":"decimal","min":0,"scale":12},"basic_earnings":{"kind":"decimal","optional":true,"scale":12},"breakdown":{"default":{},"kind":"json","shape":{"kind":"record","of":{"kind":"json"}}},"employee_id":{"inverse":"payslips","kind":"ref","to":"employee_profile"},"employee_statutory":{"default":0,"kind":"decimal","min":0,"scale":12},"employee_statutory_schemes":{"default":{},"help":"Each contribution''s employee amount by scheme code, for a rule that relieves schemes apart.","kind":"json","shape":{"kind":"record","of":{"kind":"json"}}},"employer_cost":{"default":0,"kind":"decimal","min":0,"scale":12},"employer_statutory":{"default":0,"kind":"decimal","min":0,"scale":12},"employer_statutory_schemes":{"default":{},"help":"Each contribution''s employer amount by scheme code, for a rule that taxes premiums apart.","kind":"json","shape":{"kind":"record","of":{"kind":"json"}}},"employment_id":{"inverse":"payslips","kind":"ref","to":"employee_contract"},"entity_id":{"kind":"ref","to":"entity"},"gross_earnings":{"kind":"decimal","optional":true,"scale":12},"net_pay":{"kind":"decimal","scale":12},"ordinary_wages":{"default":0,"kind":"decimal","min":0,"scale":12},"payroll_run_id":{"inverse":"payslips","kind":"ref","onDelete":"cascade","to":"payroll_run"},"period":{"kind":"text","optional":true},"settings_id":{"kind":"ref","onDelete":"restrict","to":"jurisdiction_settings"},"state":{"initial":"FINALISED","kind":"state","states":{"FINALISED":{"edit":["state"],"to":["PAID"]},"PAID":{"edit":"none","to":[]}}},"tax_withheld":{"default":0,"kind":"decimal","min":0,"scale":12},"total_deductions":{"kind":"decimal","min":0,"scale":12}},"nativeRules":2,"recordLabel":"record.state + '' · '' + string(record.net_pay)","unique":[{"fields":["payroll_run_id","employee_id","entity_id"]}]}'::jsonb);

-- step create:column:payslip.employer_statutory_schemes (additive)
-- operational risk: access-exclusive-lock
alter table "payslip" add column "employer_statutory_schemes" jsonb default '{}'::jsonb;

-- step create:notNull:payslip.employer_statutory_schemes (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "payslip" where "employer_statutory_schemes" is null' into n;
	if n > 0 then raise exception 'notNull:payslip.employer_statutory_schemes refuses % existing row(s)', n; end if;
end $store$;
alter table "payslip" alter column "employer_statutory_schemes" set not null;

-- step create:constraint:payslip.payslip__ck__ae87f561 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "payslip" where (("employer_statutory_schemes" is null or store_json_valid("employer_statutory_schemes", ''{"default":{},"help":"Each contribution''''s employer amount by scheme code, for a rule that taxes premiums apart.","kind":"json","shape":{"kind":"record","of":{"kind":"json"}}}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'payslip__ck__ae87f561 refuses % existing row(s)', n; end if;
end $store$;
alter table "payslip" add constraint "payslip__ck__ae87f561" check (("employer_statutory_schemes" is null or store_json_valid("employer_statutory_schemes", '{"default":{},"help":"Each contribution''s employer amount by scheme code, for a rule that taxes premiums apart.","kind":"json","shape":{"kind":"record","of":{"kind":"json"}}}'::jsonb) is true));

-- step replace:trigger:payslip.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "payslip" for each row execute function store_row_rules('{"audit":true,"fields":{"additional_wages":["additional_wages"],"basic_earnings":["basic_earnings"],"breakdown":["breakdown"],"employee_id":["employee_id"],"employee_statutory":["employee_statutory"],"employee_statutory_schemes":["employee_statutory_schemes"],"employer_cost":["employer_cost"],"employer_statutory":["employer_statutory"],"employer_statutory_schemes":["employer_statutory_schemes"],"employment_id":["employment_id"],"entity_id":["entity_id"],"gross_earnings":["gross_earnings"],"net_pay":["net_pay"],"ordinary_wages":["ordinary_wages"],"payroll_run_id":["payroll_run_id"],"period":["period"],"settings_id":["settings_id"],"state":["state"],"tax_withheld":["tax_withheld"],"total_deductions":["total_deductions"]},"key":["id"],"parents":[],"states":{"state":{"initial":"FINALISED","states":{"FINALISED":{"edit":["state"],"to":["PAID"]},"PAID":{"edit":"none","to":[]}}}}}');
