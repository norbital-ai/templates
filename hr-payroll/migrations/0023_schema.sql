-- 0023_schema.sql: 126 step(s), from f33f33c2c06a389c955fd6a6c7d3ba149ba51adbab035ec0d518f5186b4c33cf to 1541027b5f22aab7825aa72f5f08baee7727f1cc32778feba7e042346878595a.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- hazard: DESTRUCTIVE: drops data (a table or a stored column) or rebuilds it; runs only under its accept line.
-- hazard: validating: refuses, naming the constraint and the row count, if existing rows break it.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.

-- step replace:trigger:jurisdiction_settings.store_row_rules (additive)
drop trigger if exists store_row_rules on "jurisdiction_settings";

-- step replace:trigger:adhoc_catalog_entry.store_row_rules (additive)
drop trigger if exists store_row_rules on "adhoc_catalog_entry";

-- step replace:trigger:claim_catalog.store_row_rules (additive)
drop trigger if exists store_row_rules on "claim_catalog";

-- step replace:trigger:claim_catalog_entry.store_row_rules (additive)
drop trigger if exists store_row_rules on "claim_catalog_entry";

-- step replace:trigger:leave_catalog.store_row_rules (additive)
drop trigger if exists store_row_rules on "leave_catalog";

-- step replace:trigger:leave_catalog_entry.store_row_rules (additive)
drop trigger if exists store_row_rules on "leave_catalog_entry";

-- step replace:trigger:loan_catalog.store_row_rules (additive)
drop trigger if exists store_row_rules on "loan_catalog";

-- step replace:trigger:loan_repayment_entry.store_row_rules (additive)
drop trigger if exists store_row_rules on "loan_repayment_entry";

-- step replace:trigger:work_interruption_catalog.store_row_rules (additive)
drop trigger if exists store_row_rules on "work_interruption_catalog";

-- step replace:trigger:workplace_case_catalog.store_row_rules (additive)
drop trigger if exists store_row_rules on "workplace_case_catalog";

-- step replace:trigger:allowance_catalog.store_row_rules (additive)
drop trigger if exists store_row_rules on "allowance_catalog";

-- step replace:trigger:overtime_catalog.store_row_rules (additive)
drop trigger if exists store_row_rules on "overtime_catalog";

-- step replace:trigger:statutory_contribution_catalog.store_row_rules (additive)
drop trigger if exists store_row_rules on "statutory_contribution_catalog";

-- step replace:trigger:subtotal.store_row_rules (additive)
drop trigger if exists store_row_rules on "subtotal";

-- step drop:constraint:allowance_catalog.allowance_catalog__ck__6d503d68 (additive)
-- operational risk: access-exclusive-lock
alter table "allowance_catalog" drop constraint if exists "allowance_catalog__ck__6d503d68";

-- step drop:constraint:employee_contract.employee_contract__ck__16b72586 (additive)
-- operational risk: access-exclusive-lock
alter table "employee_contract" drop constraint if exists "employee_contract__ck__16b72586";

-- step drop:constraint:leave_catalog.leave_catalog__ck__856ea7dc (additive)
-- operational risk: access-exclusive-lock
alter table "leave_catalog" drop constraint if exists "leave_catalog__ck__856ea7dc";

-- step drop:constraint:loan_catalog.loan_catalog__ck__6d503d68 (additive)
-- operational risk: access-exclusive-lock
alter table "loan_catalog" drop constraint if exists "loan_catalog__ck__6d503d68";

-- step drop:constraint:loan_catalog.loan_catalog__ck__856ea7dc (additive)
-- operational risk: access-exclusive-lock
alter table "loan_catalog" drop constraint if exists "loan_catalog__ck__856ea7dc";

-- step drop:constraint:overtime_catalog.overtime_catalog__ck__856ea7dc (additive)
-- operational risk: access-exclusive-lock
alter table "overtime_catalog" drop constraint if exists "overtime_catalog__ck__856ea7dc";

-- step drop:constraint:registered_effect.registered_effect__ck__f4d54380 (additive)
-- operational risk: access-exclusive-lock
alter table "registered_effect" drop constraint if exists "registered_effect__ck__f4d54380";

-- step drop:constraint:registered_rule.registered_rule__ck__f4d54380 (additive)
-- operational risk: access-exclusive-lock
alter table "registered_rule" drop constraint if exists "registered_rule__ck__f4d54380";

-- step drop:notNull:adhoc_catalog_entry.is_reversal (additive)
-- operational risk: access-exclusive-lock
alter table "adhoc_catalog_entry" alter column "is_reversal" drop not null;

-- step drop:notNull:allowance_catalog.direction (additive)
-- operational risk: access-exclusive-lock
alter table "allowance_catalog" alter column "direction" drop not null;

-- step drop:notNull:allowance_catalog.incurred_on (additive)
-- operational risk: access-exclusive-lock
alter table "allowance_catalog" alter column "incurred_on" drop not null;

-- step drop:notNull:allowance_catalog.off_cycle_eligible (additive)
-- operational risk: access-exclusive-lock
alter table "allowance_catalog" alter column "off_cycle_eligible" drop not null;

-- step drop:notNull:claim_catalog.off_cycle_eligible (additive)
-- operational risk: access-exclusive-lock
alter table "claim_catalog" alter column "off_cycle_eligible" drop not null;

-- step drop:notNull:claim_catalog_entry.is_reversal (additive)
-- operational risk: access-exclusive-lock
alter table "claim_catalog_entry" alter column "is_reversal" drop not null;

-- step drop:notNull:leave_catalog.off_cycle_eligible (additive)
-- operational risk: access-exclusive-lock
alter table "leave_catalog" alter column "off_cycle_eligible" drop not null;

-- step drop:notNull:leave_catalog.party (additive)
-- operational risk: access-exclusive-lock
alter table "leave_catalog" alter column "party" drop not null;

-- step drop:notNull:leave_catalog_entry.is_reversal (additive)
-- operational risk: access-exclusive-lock
alter table "leave_catalog_entry" alter column "is_reversal" drop not null;

-- step drop:notNull:loan_catalog.direction (additive)
-- operational risk: access-exclusive-lock
alter table "loan_catalog" alter column "direction" drop not null;

-- step drop:notNull:loan_catalog.off_cycle_eligible (additive)
-- operational risk: access-exclusive-lock
alter table "loan_catalog" alter column "off_cycle_eligible" drop not null;

-- step drop:notNull:loan_catalog.party (additive)
-- operational risk: access-exclusive-lock
alter table "loan_catalog" alter column "party" drop not null;

-- step drop:notNull:loan_repayment_entry.is_reversal (additive)
-- operational risk: access-exclusive-lock
alter table "loan_repayment_entry" alter column "is_reversal" drop not null;

-- step drop:notNull:overtime_catalog.incurred_on (additive)
-- operational risk: access-exclusive-lock
alter table "overtime_catalog" alter column "incurred_on" drop not null;

-- step drop:notNull:overtime_catalog.off_cycle_eligible (additive)
-- operational risk: access-exclusive-lock
alter table "overtime_catalog" alter column "off_cycle_eligible" drop not null;

-- step drop:notNull:overtime_catalog.party (additive)
-- operational risk: access-exclusive-lock
alter table "overtime_catalog" alter column "party" drop not null;

-- step drop:notNull:registered_effect.reads (additive)
-- operational risk: access-exclusive-lock
alter table "registered_effect" alter column "reads" drop not null;

-- step drop:notNull:registered_rule.reads (additive)
-- operational risk: access-exclusive-lock
alter table "registered_rule" alter column "reads" drop not null;

-- step drop:notNull:statutory_contribution_catalog.off_cycle_eligible (additive)
-- operational risk: access-exclusive-lock
alter table "statutory_contribution_catalog" alter column "off_cycle_eligible" drop not null;

-- step drop:notNull:work_interruption_catalog.off_cycle_eligible (additive)
-- operational risk: access-exclusive-lock
alter table "work_interruption_catalog" alter column "off_cycle_eligible" drop not null;

-- step drop:notNull:workplace_case_catalog.off_cycle_eligible (additive)
-- operational risk: access-exclusive-lock
alter table "workplace_case_catalog" alter column "off_cycle_eligible" drop not null;

-- step drop:default:adhoc_catalog_entry.is_reversal (additive)
-- operational risk: access-exclusive-lock
alter table "adhoc_catalog_entry" alter column "is_reversal" drop default;

-- step drop:default:claim_catalog_entry.is_reversal (additive)
-- operational risk: access-exclusive-lock
alter table "claim_catalog_entry" alter column "is_reversal" drop default;

-- step drop:default:leave_catalog.party (additive)
-- operational risk: access-exclusive-lock
alter table "leave_catalog" alter column "party" drop default;

-- step drop:default:leave_catalog_entry.is_reversal (additive)
-- operational risk: access-exclusive-lock
alter table "leave_catalog_entry" alter column "is_reversal" drop default;

-- step drop:default:loan_catalog.direction (additive)
-- operational risk: access-exclusive-lock
alter table "loan_catalog" alter column "direction" drop default;

-- step drop:default:loan_catalog.party (additive)
-- operational risk: access-exclusive-lock
alter table "loan_catalog" alter column "party" drop default;

-- step drop:default:loan_repayment_entry.is_reversal (additive)
-- operational risk: access-exclusive-lock
alter table "loan_repayment_entry" alter column "is_reversal" drop default;

-- step drop:default:overtime_catalog.party (additive)
-- operational risk: access-exclusive-lock
alter table "overtime_catalog" alter column "party" drop default;

-- step drop:default:registered_effect.reads (additive)
-- operational risk: access-exclusive-lock
alter table "registered_effect" alter column "reads" drop default;

-- step drop:default:registered_rule.reads (additive)
-- operational risk: access-exclusive-lock
alter table "registered_rule" alter column "reads" drop default;

-- step drop:column:adhoc_catalog_entry.is_reversal (destructive)
-- accept: drop:column:adhoc_catalog_entry.is_reversal
-- operational risk: access-exclusive-lock
alter table "adhoc_catalog_entry" drop column if exists "is_reversal" cascade;

-- step drop:column:allowance_catalog.direction (destructive)
-- accept: drop:column:allowance_catalog.direction
-- operational risk: access-exclusive-lock
alter table "allowance_catalog" drop column if exists "direction" cascade;

-- step drop:column:allowance_catalog.off_cycle_eligible (destructive)
-- accept: drop:column:allowance_catalog.off_cycle_eligible
-- operational risk: access-exclusive-lock
alter table "allowance_catalog" drop column if exists "off_cycle_eligible" cascade;

-- step drop:column:claim_catalog.off_cycle_eligible (destructive)
-- accept: drop:column:claim_catalog.off_cycle_eligible
-- operational risk: access-exclusive-lock
alter table "claim_catalog" drop column if exists "off_cycle_eligible" cascade;

-- step drop:column:claim_catalog_entry.is_reversal (destructive)
-- accept: drop:column:claim_catalog_entry.is_reversal
-- operational risk: access-exclusive-lock
alter table "claim_catalog_entry" drop column if exists "is_reversal" cascade;

-- step drop:column:leave_catalog.off_cycle_eligible (destructive)
-- accept: drop:column:leave_catalog.off_cycle_eligible
-- operational risk: access-exclusive-lock
alter table "leave_catalog" drop column if exists "off_cycle_eligible" cascade;

-- step drop:column:leave_catalog.party (destructive)
-- accept: drop:column:leave_catalog.party
-- operational risk: access-exclusive-lock
alter table "leave_catalog" drop column if exists "party" cascade;

-- step drop:column:leave_catalog_entry.is_reversal (destructive)
-- accept: drop:column:leave_catalog_entry.is_reversal
-- operational risk: access-exclusive-lock
alter table "leave_catalog_entry" drop column if exists "is_reversal" cascade;

-- step drop:column:loan_catalog.direction (destructive)
-- accept: drop:column:loan_catalog.direction
-- operational risk: access-exclusive-lock
alter table "loan_catalog" drop column if exists "direction" cascade;

-- step drop:column:loan_catalog.off_cycle_eligible (destructive)
-- accept: drop:column:loan_catalog.off_cycle_eligible
-- operational risk: access-exclusive-lock
alter table "loan_catalog" drop column if exists "off_cycle_eligible" cascade;

-- step drop:column:loan_catalog.party (destructive)
-- accept: drop:column:loan_catalog.party
-- operational risk: access-exclusive-lock
alter table "loan_catalog" drop column if exists "party" cascade;

-- step drop:column:loan_repayment_entry.is_reversal (destructive)
-- accept: drop:column:loan_repayment_entry.is_reversal
-- operational risk: access-exclusive-lock
alter table "loan_repayment_entry" drop column if exists "is_reversal" cascade;

-- step drop:column:overtime_catalog.off_cycle_eligible (destructive)
-- accept: drop:column:overtime_catalog.off_cycle_eligible
-- operational risk: access-exclusive-lock
alter table "overtime_catalog" drop column if exists "off_cycle_eligible" cascade;

-- step drop:column:overtime_catalog.party (destructive)
-- accept: drop:column:overtime_catalog.party
-- operational risk: access-exclusive-lock
alter table "overtime_catalog" drop column if exists "party" cascade;

-- step drop:column:statutory_contribution_catalog.off_cycle_eligible (destructive)
-- accept: drop:column:statutory_contribution_catalog.off_cycle_eligible
-- operational risk: access-exclusive-lock
alter table "statutory_contribution_catalog" drop column if exists "off_cycle_eligible" cascade;

-- step drop:column:work_interruption_catalog.off_cycle_eligible (destructive)
-- accept: drop:column:work_interruption_catalog.off_cycle_eligible
-- operational risk: access-exclusive-lock
alter table "work_interruption_catalog" drop column if exists "off_cycle_eligible" cascade;

-- step drop:column:workplace_case_catalog.off_cycle_eligible (destructive)
-- accept: drop:column:workplace_case_catalog.off_cycle_eligible
-- operational risk: access-exclusive-lock
alter table "workplace_case_catalog" drop column if exists "off_cycle_eligible" cascade;

-- step replace:history:schema:ledger_entry (additive)
select bolt_history_register('ledger_entry','{"audit":true,"fields":{"account":{"help":"Catalogue family key, for example leave or claim.","kind":"text"},"amount":{"kind":"decimal","min":0,"optional":true,"scale":12},"balance_id":{"inverse":"entries","kind":"ref","to":"employee_balance"},"code":{"help":"Account code inside the family, for example ANNUAL_LEAVE.","kind":"text"},"effective_on":{"kind":"date"},"measure":{"help":"What is held in that window.","kind":"enum","optional":true,"values":["total","used","entitled","carried","limit","paid"]},"operation":{"kind":"enum","values":["ADD","DEDUCT"]},"period":{"help":"The window the value belongs to, for example MY.S.2026-03-05.","kind":"text","optional":true},"source":{"help":"What caused this movement. Plain text, so a movement outlives what caused it.","kind":"text","optional":true},"unit":{"kind":"enum","optional":true,"values":["DAY","CALENDAR_DAY","HOUR","MONEY","COUNT"]}},"nativeRules":2,"recordLabel":"record.code"}'::jsonb);

-- step replace:history:schema:employee_contract (additive)
select bolt_history_register('employee_contract','{"audit":true,"fields":{"bank":{"kind":"custom","of":"bank","optional":true},"effective_range":{"help":"The dates this agreement applies. A replacement contract continues employment; ending it records a reason.","kind":"period","of":"date"},"employee_extension_data":{"default":{},"help":"The employee data the jurisdiction''s employee extension schema declares.","kind":"json","shape":{"kind":"record","of":{"kind":"json"}}},"employee_id":{"inverse":"employee_contract","kind":"ref","to":"employee_profile"},"employee_name":{"hidden":true,"kind":"text","optional":true},"employee_number":{"kind":"text"},"engagement":{"default":"EMPLOYEE","help":"The contracted role. PAYEE is paid without employment (a commission agent), outside the headcount and separations.","kind":"enum","values":["EMPLOYEE","PART_TIME","CONTRACTOR","INTERN","APPRENTICE","CONSULTANT","PAYEE"]},"entity_id":{"inverse":"employee_contract","kind":"ref","to":"entity"},"final_pay_due_on":{"help":"The actual contractual date the final settlement becomes payable. This differs from the maximum statutory deadline and the run’s actual payment date.","kind":"date","optional":true},"input_schema_version_id":{"inverse":"employee_contract","kind":"ref","onDelete":"restrict","to":"jurisdiction_settings","where":{"status":{"eq":"SEALED"}}},"payroll":{"fields":{"date_of_birth":{"kind":"date","optional":true},"gender":{"kind":"enum","optional":true,"values":["MALE","FEMALE"]},"identity_number":{"kind":"text","optional":true},"marital_status":{"kind":"enum","optional":true,"values":["SINGLE","MARRIED","SEPARATED","DIVORCED","WIDOWED"]}},"kind":"object","label":"Person details","optional":true},"reason":{"help":"Why this record was voided or the employment ended.","kind":"text","optional":true},"service_started_on":{"help":"The date service began for leave and benefit entitlements. A same-jurisdiction replacement keeps the predecessor date; a cross-jurisdiction replacement starts new statutory service.","kind":"date","optional":true},"signed_contract_period":{"kind":"period","of":"date","optional":true},"status":{"initial":"DRAFT","kind":"state","states":{"DRAFT":{"edit":"all","to":["SEALED"]},"SEALED":{"edit":["effective_range","final_pay_due_on","reason","employee_name"],"to":["VOID"]},"VOID":{"edit":"none","to":[]}}},"terms":{"fields":{"allowances":{"help":"The agreed allowances, keyed by the catalog code; the catalog row carries how each behaves.","kind":"record","of":{"fields":{"amount":{"kind":"number","min":0}},"kind":"object"},"optional":true},"annual_leave_carry_limit_days":{"help":"An agreed contractual limit for carrying annual leave into the next leave year.","kind":"number","min":0,"optional":true},"department":{"kind":"text","optional":true},"employer_bears_income_tax":{"help":"The agreement makes the employer bear the employee’s income tax. The jurisdiction formula determines any required gross-up.","kind":"bool","optional":true},"job_title":{"kind":"text","optional":true},"normal_days_per_week":{"help":"The ordinary working days of one week.","kind":"number","max":7,"min":0},"normal_hours_per_day":{"help":"The ordinary hours of one working day. Every overtime, leave and statutory hour reads it.","kind":"number","min":0},"normal_hours_per_week":{"help":"The ordinary hours of one working week.","kind":"number","min":0},"notice_period":{"fields":{"unit":{"kind":"enum","values":["DAYS","WEEKS","MONTHS"]},"value":{"kind":"number","min":0}},"kind":"object","optional":true},"probation_period":{"help":"The original agreed probation dates. Salary amendments retain these dates; they do not start another probation.","kind":"period","of":"date","optional":true},"rate":{"kind":"json","optional":true,"shape":{"arms":{"DAILY":{"amount":{"kind":"number","min":0}},"HOURLY":{"amount":{"kind":"number","min":0}},"MONTHLY":{"amount":{"kind":"number","min":0}}},"by":"unit","kind":"union"}},"residency_status":{"kind":"text","optional":true},"shift_pattern_id":{"kind":"id","of":"shift_pattern","optional":true},"signed_on":{"help":"The actual date this employment agreement was signed.","kind":"date","optional":true},"statutory_work_category":{"kind":"text","optional":true},"wage_payment_method":{"kind":"enum","optional":true,"values":["BANK","CASH","CHEQUE","DIGITAL"]},"work_authorisation_category":{"kind":"text","optional":true},"work_classification":{"kind":"text","optional":true}},"kind":"object"}},"nativeRules":2,"noOverlap":[{"key":["employee_id"],"period":"effective_range","where":{"status":{"eq":"SEALED"}}}],"recordLabel":"[record.employee_name != null ? string(record.employee_name) : '''', record.employee_number != null ? string(record.employee_number) : ''''].filter(part, part != '''').join('' · '')"}'::jsonb);

-- step replace:history:schema:jurisdiction_settings (additive)
select bolt_history_register('jurisdiction_settings','{"audit":true,"fields":{"code":{"kind":"text"},"conversions":{"fields":{"day":{"fields":{"basis":{"kind":"enum","values":["CALENDAR_DAYS","WORKING_DAYS","YEAR","YEAR_REST_DAYS","HOUR","FIXED"]},"days":{"help":"The divisor when the basis is FIXED (Malaysia 26, China 21.75, Thailand and Taiwan 30).","kind":"number","min":0,"optional":true}},"kind":"object"},"hour":{"fields":{"basis":{"kind":"enum","values":["CONTRACT_HOURS","CONTRACT_WEEKLY","FIXED"]},"hours":{"help":"The divisor when the basis is FIXED (Indonesia 173, China 174).","kind":"number","min":0,"optional":true}},"kind":"object"},"proration":{"kind":"enum","values":["CALENDAR_DAYS","WORKING_DAYS"]},"rounding":{"fields":{"mode":{"default":"HALF_UP","kind":"enum","values":["HALF_UP","HALF_EVEN","UP","DOWN","TRUNCATE"]},"scale":{"default":2,"kind":"int","max":12,"min":0}},"kind":"object"}},"kind":"object"},"currency":{"kind":"currency"},"effective_range":{"kind":"period","of":"date"},"employee_extension_schema":{"kind":"json","optional":true},"entity_extension_schema":{"kind":"json","optional":true},"ledger":{"fields":{"ytd_scope":{"default":"JURISDICTION","kind":"enum","values":["JURISDICTION","EMPLOYER"]}},"kind":"object"},"lookup":{"default":{},"kind":"json","shape":{"kind":"record","of":{"kind":"json"}}},"name":{"kind":"text"},"reason":{"kind":"text","optional":true},"status":{"initial":"DRAFT","kind":"state","states":{"DRAFT":{"edit":"all","to":["SEALED","VOID"]},"SEALED":{"edit":["effective_range","reason"],"to":["VOID"]},"VOID":{"edit":"none","to":[]}}},"tax_year_start_month":{"kind":"int","max":12,"min":1},"timezone":{"format":"zone","kind":"text"}},"nativeRules":2,"noOverlap":[{"key":["code"],"period":"effective_range","where":{"status":{"eq":"SEALED"}}}],"recordLabel":"record.name"}'::jsonb);

-- step replace:history:schema:adhoc_catalog (additive)
select bolt_history_register('adhoc_catalog','{"audit":true,"fields":{"code":{"kind":"text"},"conversion":{"kind":"text","max":65536,"optional":true},"description":{"kind":"text","optional":true},"direction":{"default":"ADD","kind":"enum","values":["ADD","DEDUCT"]},"eligibility":{"kind":"text","max":65536,"optional":true},"incurred_on":{"kind":"text","max":65536,"optional":true},"lookup":{"default":{},"kind":"json","shape":{"kind":"record","of":{"kind":"json"}}},"name":{"kind":"text"},"off_cycle_eligible":{"kind":"bool"},"party":{"default":"EMPLOYEE","kind":"enum","values":["EMPLOYEE","EMPLOYER"]},"references":{"kind":"custom","of":"references","optional":true},"settings_id":{"inverse":"adhoc_catalog","kind":"ref","owned":true,"to":"jurisdiction_settings"},"subtotal_id":{"inverse":"adhoc_catalog","kind":"ref","onDelete":"restrict","optional":true,"to":"subtotal"}},"nativeRules":2,"recordLabel":"record.code","unique":[{"fields":["settings_id","code"]}]}'::jsonb);

-- step replace:history:schema:adhoc_catalog_entry (additive)
select bolt_history_register('adhoc_catalog_entry','{"audit":true,"fields":{"catalog_id":{"kind":"ref","onDelete":"restrict","to":"adhoc_catalog"},"description":{"kind":"text"},"employment_id":{"inverse":"adhoc_catalog_entry","kind":"ref","to":"employee_contract"},"entity_id":{"kind":"ref","to":"entity"},"evidence_file":{"accept":["application/pdf","image/*"],"kind":"file","max":"20MiB","optional":true},"incurred_on":{"kind":"date"},"payroll_run_id":{"kind":"ref","onDelete":"setNull","optional":true,"to":"payroll_run"},"quantity":{"kind":"decimal","min":0,"scale":12},"reverses":{"kind":"ref","onDelete":"restrict","optional":true,"to":"adhoc_catalog_entry"},"unit":{"kind":"enum","values":["DAY","CALENDAR_DAY","HOUR","MONEY","COUNT"]}},"nativeRules":2,"recordLabel":"record.description","unique":[{"fields":["reverses"]}]}'::jsonb);

-- step replace:history:schema:claim_catalog (additive)
select bolt_history_register('claim_catalog','{"audit":true,"fields":{"code":{"kind":"text"},"conversion":{"kind":"text","max":65536,"optional":true},"description":{"kind":"text","optional":true},"direction":{"default":"ADD","kind":"enum","values":["ADD","DEDUCT"]},"eligibility":{"kind":"text","max":65536,"optional":true},"incurred_on":{"kind":"text","max":65536,"optional":true},"lookup":{"default":{},"kind":"json","shape":{"kind":"record","of":{"kind":"json"}}},"name":{"kind":"text"},"party":{"default":"EMPLOYEE","kind":"enum","values":["EMPLOYEE","EMPLOYER"]},"references":{"kind":"custom","of":"references","optional":true},"settings_id":{"inverse":"claim_catalog","kind":"ref","owned":true,"to":"jurisdiction_settings"},"subtotal_id":{"inverse":"claim_catalog","kind":"ref","onDelete":"restrict","optional":true,"to":"subtotal"}},"nativeRules":2,"recordLabel":"record.code","unique":[{"fields":["settings_id","code"]}]}'::jsonb);

-- step replace:history:schema:claim_catalog_entry (additive)
select bolt_history_register('claim_catalog_entry','{"audit":true,"fields":{"catalog_id":{"kind":"ref","onDelete":"restrict","to":"claim_catalog"},"employment_id":{"inverse":"claim_catalog_entry","kind":"ref","to":"employee_contract"},"entity_id":{"kind":"ref","to":"entity"},"evidence_file":{"accept":["application/pdf","image/*"],"kind":"file","max":"20MiB","optional":true},"incurred_on":{"kind":"date"},"payroll_run_id":{"kind":"ref","onDelete":"setNull","optional":true,"to":"payroll_run"},"quantity":{"kind":"decimal","label":"Amount","min":0,"scale":12},"reverses":{"kind":"ref","onDelete":"restrict","optional":true,"to":"claim_catalog_entry"},"unit":{"default":"MONEY","kind":"enum","values":["DAY","CALENDAR_DAY","HOUR","MONEY","COUNT"]}},"nativeRules":2,"recordLabel":"string(record.quantity) + '' '' + record.unit","unique":[{"fields":["reverses"]}]}'::jsonb);

-- step replace:history:schema:leave_catalog (additive)
select bolt_history_register('leave_catalog','{"audit":true,"fields":{"code":{"kind":"text"},"conversion":{"kind":"text","max":65536,"optional":true},"description":{"kind":"text","optional":true},"direction":{"default":"ADD","kind":"enum","values":["ADD","DEDUCT"]},"eligibility":{"kind":"text","max":65536,"optional":true},"incurred_on":{"kind":"text","max":65536,"optional":true},"lookup":{"default":{},"kind":"json","shape":{"kind":"record","of":{"kind":"json"}}},"name":{"kind":"text"},"pay_treatment":{"kind":"enum","values":["PAID","UNPAID"]},"references":{"kind":"custom","of":"references","optional":true},"settings_id":{"inverse":"leave_catalog","kind":"ref","owned":true,"to":"jurisdiction_settings"},"subtotal_id":{"inverse":"leave_catalog","kind":"ref","onDelete":"restrict","optional":true,"to":"subtotal"}},"nativeRules":2,"recordLabel":"record.code","unique":[{"fields":["settings_id","code"]}]}'::jsonb);

-- step replace:history:schema:leave_catalog_entry (additive)
select bolt_history_register('leave_catalog_entry','{"audit":true,"fields":{"catalog_id":{"kind":"ref","onDelete":"restrict","to":"leave_catalog"},"days":{"kind":"list","min":1,"of":{"fields":{"date":{"kind":"date"},"part":{"kind":"enum","values":["AM","PM"]}},"kind":"object"}},"employment_id":{"inverse":"leave_catalog_entry","kind":"ref","to":"employee_contract"},"encashment":{"default":false,"hidden":true,"kind":"bool"},"entity_id":{"kind":"ref","to":"entity"},"evidence_file":{"accept":["application/pdf","image/*"],"kind":"file","max":"20MiB","optional":true},"payroll_run_id":{"kind":"ref","onDelete":"setNull","optional":true,"to":"payroll_run"},"reverses":{"kind":"ref","onDelete":"restrict","optional":true,"to":"leave_catalog_entry"}},"nativeRules":2,"recordLabel":"string(size(record.days)) + '' half-days''","unique":[{"fields":["reverses"]}]}'::jsonb);

-- step replace:history:schema:loan_catalog (additive)
select bolt_history_register('loan_catalog','{"audit":true,"fields":{"code":{"kind":"text"},"conversion":{"kind":"text","max":65536,"optional":true},"description":{"kind":"text","optional":true},"eligibility":{"kind":"text","max":65536,"optional":true},"incurred_on":{"kind":"text","max":65536,"optional":true},"lookup":{"default":{},"kind":"json","shape":{"kind":"record","of":{"kind":"json"}}},"name":{"kind":"text"},"references":{"kind":"custom","of":"references","optional":true},"settings_id":{"inverse":"loan_catalog","kind":"ref","owned":true,"to":"jurisdiction_settings"},"subtotal_id":{"inverse":"loan_catalog","kind":"ref","onDelete":"restrict","optional":true,"to":"subtotal"}},"nativeRules":2,"recordLabel":"record.code","unique":[{"fields":["settings_id","code"]}]}'::jsonb);

-- step replace:history:schema:loan_repayment_entry (additive)
select bolt_history_register('loan_repayment_entry','{"audit":true,"fields":{"amount":{"kind":"decimal","min":0,"scale":12},"employment_id":{"inverse":"loan_repayment_entry","kind":"ref","to":"employee_contract"},"entity_id":{"kind":"ref","to":"entity"},"loan_id":{"inverse":"repayments","kind":"ref","onDelete":"restrict","to":"loan_catalog_entry"},"paid_on":{"kind":"date","optional":true},"payment_reference":{"kind":"text","optional":true},"payroll_run_id":{"kind":"ref","onDelete":"setNull","optional":true,"to":"payroll_run"},"reverses":{"kind":"ref","onDelete":"restrict","optional":true,"to":"loan_repayment_entry"}},"nativeRules":2,"recordLabel":"record.payment_reference","unique":[{"fields":["reverses"]}]}'::jsonb);

-- step replace:history:schema:work_interruption_catalog (additive)
select bolt_history_register('work_interruption_catalog','{"audit":true,"fields":{"code":{"kind":"text"},"description":{"kind":"text","optional":true},"events":{"default":{},"kind":"json","shape":{"kind":"record","of":{"kind":"json"}}},"lookup":{"default":{},"kind":"json","shape":{"kind":"record","of":{"kind":"json"}}},"name":{"kind":"text"},"references":{"kind":"custom","of":"references","optional":true},"settings_id":{"inverse":"work_interruption_catalog","kind":"ref","owned":true,"to":"jurisdiction_settings"},"subtotal_id":{"kind":"ref","onDelete":"restrict","optional":true,"to":"subtotal"}},"nativeRules":2,"recordLabel":"record.name","unique":[{"fields":["settings_id","code"]}]}'::jsonb);

-- step replace:history:schema:workplace_case_catalog (additive)
select bolt_history_register('workplace_case_catalog','{"audit":true,"fields":{"code":{"kind":"text"},"description":{"kind":"text","optional":true},"events":{"default":{},"kind":"json","shape":{"kind":"record","of":{"kind":"json"}}},"lookup":{"default":{},"kind":"json","shape":{"kind":"record","of":{"kind":"json"}}},"name":{"kind":"text"},"references":{"kind":"custom","of":"references","optional":true},"settings_id":{"inverse":"workplace_case_catalog","kind":"ref","owned":true,"to":"jurisdiction_settings"},"subtotal_id":{"kind":"ref","onDelete":"restrict","optional":true,"to":"subtotal"}},"nativeRules":2,"recordLabel":"record.name","unique":[{"fields":["settings_id","code"]}]}'::jsonb);

-- step replace:history:schema:allowance_catalog (additive)
select bolt_history_register('allowance_catalog','{"audit":true,"fields":{"code":{"kind":"text"},"conversion":{"kind":"text","max":65536},"eligibility":{"kind":"text","max":65536},"include_in_rate":{"default":false,"kind":"bool"},"incurred_on":{"kind":"text","max":65536,"optional":true},"lookup":{"default":{},"kind":"json","shape":{"kind":"record","of":{"kind":"json"}}},"name":{"kind":"text"},"party":{"default":"EMPLOYEE","kind":"enum","values":["EMPLOYEE","EMPLOYER"]},"prorate":{"default":false,"kind":"bool"},"references":{"kind":"custom","of":"references","optional":true},"settings_id":{"inverse":"allowance_catalog","kind":"ref","owned":true,"to":"jurisdiction_settings"},"subtotal_id":{"inverse":"allowance_catalog","kind":"ref","onDelete":"restrict","optional":true,"to":"subtotal"}},"nativeRules":2,"recordLabel":"record.code","unique":[{"fields":["settings_id","code"]}]}'::jsonb);

-- step replace:history:schema:overtime_catalog (additive)
select bolt_history_register('overtime_catalog','{"audit":true,"fields":{"code":{"kind":"text"},"conversion":{"kind":"text","max":65536},"direction":{"kind":"enum","values":["ADD","DEDUCT"]},"eligibility":{"kind":"text","max":65536},"incurred_on":{"kind":"text","max":65536,"optional":true},"lookup":{"default":{},"kind":"json","shape":{"kind":"record","of":{"kind":"json"}}},"name":{"kind":"text"},"references":{"kind":"custom","of":"references","optional":true},"settings_id":{"inverse":"overtime_catalog","kind":"ref","owned":true,"to":"jurisdiction_settings"},"subtotal_id":{"inverse":"overtime_catalog","kind":"ref","onDelete":"restrict","to":"subtotal"}},"nativeRules":2,"recordLabel":"record.code","unique":[{"fields":["settings_id","code"]}]}'::jsonb);

-- step replace:history:schema:statutory_contribution_catalog (additive)
select bolt_history_register('statutory_contribution_catalog','{"audit":true,"fields":{"balance_window":{"default":"YEAR","kind":"enum","values":["MONTH","YEAR"]},"code":{"kind":"text"},"depends_on":{"kind":"list","of":{"kind":"text"},"optional":true},"eligibility":{"kind":"text","max":65536},"employee_amount":{"kind":"text","max":65536},"employer_amount":{"kind":"text","max":65536,"optional":true},"employer_cost_subtotal_id":{"inverse":"statutory_employer_cost","kind":"ref","onDelete":"restrict","optional":true,"to":"subtotal"},"kind":{"kind":"enum","values":["CONTRIBUTION","TAX"]},"lookup":{"default":{},"kind":"json","shape":{"kind":"record","of":{"kind":"json"}}},"name":{"kind":"text"},"references":{"kind":"custom","of":"references","optional":true},"settings_id":{"inverse":"statutory_contribution_catalog","kind":"ref","owned":true,"to":"jurisdiction_settings"},"subtotal_id":{"inverse":"statutory_contribution_catalog","kind":"ref","onDelete":"restrict","to":"subtotal"}},"nativeRules":2,"recordLabel":"record.code","unique":[{"fields":["settings_id","code"]}]}'::jsonb);

-- step replace:history:schema:registered_effect (additive)
select bolt_history_register('registered_effect','{"audit":true,"fields":{"code":{"kind":"text"},"condition":{"kind":"text","max":65536},"effects":{"kind":"text","max":65536},"events":{"kind":"enum","many":true,"values":["create","update","delete","prepare_request","seal","void","approve","entries_changed","prepare_payroll","after_basic","after_gross","after_contributions","after_tax","after_net","finalise","mark_paid","daily","calendar","after_exit"]},"lookup":{"default":{},"kind":"json","shape":{"kind":"record","of":{"kind":"json"}}},"name":{"kind":"text"},"reads":{"kind":"custom","of":"reads","optional":true},"references":{"kind":"custom","of":"references","optional":true},"settings_id":{"inverse":"registered_effect","kind":"ref","owned":true,"to":"jurisdiction_settings"},"source_collection":{"kind":"text"},"target_action":{"kind":"enum","values":["create","update","delete"]},"target_collection":{"kind":"text"}},"nativeRules":2,"recordLabel":"record.code","unique":[{"fields":["settings_id","code"]}]}'::jsonb);

-- step replace:history:schema:registered_rule (additive)
select bolt_history_register('registered_rule','{"audit":true,"fields":{"code":{"kind":"text"},"condition":{"kind":"text","max":65536,"optional":true},"events":{"kind":"enum","many":true,"values":["create","update","delete","prepare_request","seal","void","approve","entries_changed","prepare_payroll","after_basic","after_gross","after_contributions","after_tax","after_net","finalise","mark_paid","daily","calendar","after_exit"]},"lookup":{"default":{},"kind":"json","shape":{"kind":"record","of":{"kind":"json"}}},"order":{"default":0,"kind":"int"},"reads":{"kind":"custom","of":"reads","optional":true},"references":{"kind":"custom","of":"references","optional":true},"settings_id":{"inverse":"registered_rule","kind":"ref","owned":true,"to":"jurisdiction_settings"},"target_collection":{"kind":"text"},"validate":{"kind":"text","max":65536}},"nativeRules":2,"recordLabel":"record.code","unique":[{"fields":["settings_id","code"]}]}'::jsonb);

-- step replace:history:schema:subtotal (additive)
select bolt_history_register('subtotal','{"audit":true,"fields":{"balance_window":{"default":"YEAR","kind":"enum","values":["MONTH","YEAR"]},"calculation":{"kind":"text","max":65536,"optional":true},"code":{"kind":"text"},"name":{"kind":"text"},"previous_id":{"kind":"ref","onDelete":"restrict","optional":true,"to":"subtotal"},"settings_id":{"inverse":"subtotals","kind":"ref","owned":true,"to":"jurisdiction_settings"}},"nativeRules":2,"recordLabel":"record.name","unique":[{"fields":["settings_id","code"]}]}'::jsonb);

-- step create:column:jurisdiction_settings.conversions (additive)
-- operational risk: access-exclusive-lock
alter table "jurisdiction_settings" add column "conversions" jsonb;

-- step create:column:jurisdiction_settings.ledger (additive)
-- operational risk: access-exclusive-lock
alter table "jurisdiction_settings" add column "ledger" jsonb;

-- step create:column:allowance_catalog.include_in_rate (additive)
-- operational risk: access-exclusive-lock
alter table "allowance_catalog" add column "include_in_rate" boolean default false;

-- step create:column:statutory_contribution_catalog.balance_window (additive)
-- operational risk: access-exclusive-lock
alter table "statutory_contribution_catalog" add column "balance_window" text default 'YEAR'::text;

-- step create:column:subtotal.balance_window (additive)
-- operational risk: access-exclusive-lock
alter table "subtotal" add column "balance_window" text default 'YEAR'::text;

-- step create:column:loan_repayment_entry.reverses (additive)
-- operational risk: access-exclusive-lock
alter table "loan_repayment_entry" add column "reverses" uuid;

-- step data:employee_contract.terms (data)
-- hazard: the shape of employee_contract.terms changed; rows written under the old shape may not decode under the new one.
-- The backfill below rewrites the old shape; the check then counts any row it still refuses.
-- hazard: the shape of employee_contract.terms changed; rows written under the old shape may not decode under the new one.
-- Transform them here (an UPDATE over employee_contract); the check below counts the rows the new shape still refuses.
with base as (
	select id, terms,
		coalesce((terms ->> 'normal_days_per_week')::numeric, 5) as days,
		coalesce(
			(terms ->> 'normal_hours_per_day')::numeric,
			(terms ->> 'normal_hours_per_week')::numeric / nullif((terms ->> 'normal_days_per_week')::numeric, 0),
			8
		) as hours
	from employee_contract
	where terms is not null
)
update employee_contract c
set terms = (
	select jsonb_set(
		b.terms
			- 'normal_hours_per_month'
			|| jsonb_build_object(
				'normal_days_per_week', b.days,
				'normal_hours_per_day', b.hours,
				'normal_hours_per_week', coalesce((b.terms ->> 'normal_hours_per_week')::numeric, b.hours * b.days)
			),
		'{allowances}',
		(
			select coalesce(
				jsonb_object_agg(key, jsonb_build_object('amount', coalesce((value ->> 'amount')::numeric, 0))),
				'{}'::jsonb
			)
			from jsonb_each(coalesce(b.terms -> 'allowances', '{}'::jsonb))
		)
	)
	from base b
	where b.id = c.id
);

-- step check:employee_contract.terms (validating)
do $store$ declare n bigint; begin
	execute 'select count(*) from "employee_contract" where "terms" is null or store_json_valid("terms", ''{"fields":{"allowances":{"help":"The agreed allowances, keyed by the catalog code; the catalog row carries how each behaves.","kind":"record","of":{"fields":{"amount":{"kind":"number","min":0}},"kind":"object"},"optional":true},"annual_leave_carry_limit_days":{"help":"An agreed contractual limit for carrying annual leave into the next leave year.","kind":"number","min":0,"optional":true},"department":{"kind":"text","optional":true},"employer_bears_income_tax":{"help":"The agreement makes the employer bear the employee’s income tax. The jurisdiction formula determines any required gross-up.","kind":"bool","optional":true},"job_title":{"kind":"text","optional":true},"normal_days_per_week":{"help":"The ordinary working days of one week.","kind":"number","max":7,"min":0},"normal_hours_per_day":{"help":"The ordinary hours of one working day. Every overtime, leave and statutory hour reads it.","kind":"number","min":0},"normal_hours_per_week":{"help":"The ordinary hours of one working week.","kind":"number","min":0},"notice_period":{"fields":{"unit":{"kind":"enum","values":["DAYS","WEEKS","MONTHS"]},"value":{"kind":"number","min":0}},"kind":"object","optional":true},"probation_period":{"help":"The original agreed probation dates. Salary amendments retain these dates; they do not start another probation.","kind":"period","of":"date","optional":true},"rate":{"kind":"json","optional":true,"shape":{"arms":{"DAILY":{"amount":{"kind":"number","min":0}},"HOURLY":{"amount":{"kind":"number","min":0}},"MONTHLY":{"amount":{"kind":"number","min":0}}},"by":"unit","kind":"union"}},"residency_status":{"kind":"text","optional":true},"shift_pattern_id":{"kind":"id","of":"shift_pattern","optional":true},"signed_on":{"help":"The actual date this employment agreement was signed.","kind":"date","optional":true},"statutory_work_category":{"kind":"text","optional":true},"wage_payment_method":{"kind":"enum","optional":true,"values":["BANK","CASH","CHEQUE","DIGITAL"]},"work_authorisation_category":{"kind":"text","optional":true},"work_classification":{"kind":"text","optional":true}},"kind":"object"}''::jsonb) is not true' into n;
	if n > 0 then raise exception 'the shape of employee_contract.terms refuses % existing row(s)', n; end if;
end $store$;

-- step data:allowance_catalog.include_in_rate (data)
update "allowance_catalog" a set include_in_rate = case
	when (j.lookup ->> 'allowance_inclusion') in ('FIXED', 'ALL')
		and not (coalesce(j.lookup -> 'excluded_allowances', '[]'::jsonb) ? a.code)
		then true
	else false
end
from "jurisdiction_settings" j
where j.id = a.settings_id;

-- step data:jurisdiction_settings (data)
update "jurisdiction_settings" set
	conversions = jsonb_build_object(
		'day', case
			when jsonb_typeof(lookup -> 'day_basis') = 'string'
				then jsonb_build_object('basis', lookup ->> 'day_basis')
			when jsonb_typeof(lookup -> 'day_basis') = 'object'
				and lookup -> 'day_basis' ? 'fixed'
				then jsonb_build_object('basis', 'FIXED', 'days', (lookup -> 'day_basis' ->> 'fixed')::numeric)
			when jsonb_typeof(lookup -> 'day_basis') = 'object' then lookup -> 'day_basis'
			else '{"basis":"CALENDAR_DAYS"}'::jsonb
		end,
		'hour', case
			when jsonb_typeof(lookup -> 'hour_basis') = 'string'
				then jsonb_build_object('basis', lookup ->> 'hour_basis')
			when jsonb_typeof(lookup -> 'hour_basis') = 'object'
				and lookup -> 'hour_basis' ? 'fixed'
				then jsonb_build_object('basis', 'FIXED', 'hours', (lookup -> 'hour_basis' ->> 'fixed')::numeric)
			when jsonb_typeof(lookup -> 'hour_basis') = 'object' then lookup -> 'hour_basis'
			else '{"basis":"CONTRACT_HOURS"}'::jsonb
		end,
		'proration', coalesce(lookup ->> 'proration_basis', 'CALENDAR_DAYS'),
		'rounding', jsonb_build_object(
			'mode', coalesce(lookup ->> 'rounding', 'HALF_UP'),
			'scale', coalesce((lookup ->> 'rounding_scale')::int, 2)
		)
	),
	ledger = jsonb_build_object(
		'ytd_scope', case
			when lookup ->> 'ytd_scope' = 'EMPLOYER' or coalesce((lookup ->> 'ytd_per_employer')::boolean, false)
				then 'EMPLOYER'
			else 'JURISDICTION'
		end
	),
	lookup = lookup
		- 'day_basis' - 'hour_basis' - 'proration_basis' - 'allowance_inclusion'
		- 'excluded_allowances' - 'rounding' - 'rounding_scale' - 'ytd_scope' - 'ytd_per_employer';

-- step data:balance_window (data)
update "subtotal" s set balance_window = case
	when (j.lookup -> 'month_balance') ? s.code then 'MONTH'
	else 'YEAR'
end
from "jurisdiction_settings" j
where j.id = s.settings_id and j.lookup ? 'month_balance';

update "statutory_contribution_catalog" s set balance_window = case
	when (j.lookup -> 'month_balance') ? (s.code || '.employee')
		or (j.lookup -> 'month_balance') ? (s.code || '.employer')
		then 'MONTH'
	else 'YEAR'
end
from "jurisdiction_settings" j
where j.id = s.settings_id and j.lookup ? 'month_balance';

update "jurisdiction_settings" set lookup = lookup - 'month_balance' where lookup ? 'month_balance';

-- step create:notNull:jurisdiction_settings.conversions (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "jurisdiction_settings" where "conversions" is null' into n;
	if n > 0 then raise exception 'notNull:jurisdiction_settings.conversions refuses % existing row(s)', n; end if;
end $store$;
alter table "jurisdiction_settings" alter column "conversions" set not null;

-- step create:notNull:jurisdiction_settings.ledger (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "jurisdiction_settings" where "ledger" is null' into n;
	if n > 0 then raise exception 'notNull:jurisdiction_settings.ledger refuses % existing row(s)', n; end if;
end $store$;
alter table "jurisdiction_settings" alter column "ledger" set not null;

-- step create:notNull:allowance_catalog.include_in_rate (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "allowance_catalog" where "include_in_rate" is null' into n;
	if n > 0 then raise exception 'notNull:allowance_catalog.include_in_rate refuses % existing row(s)', n; end if;
end $store$;
alter table "allowance_catalog" alter column "include_in_rate" set not null;

-- step create:notNull:statutory_contribution_catalog.balance_window (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "statutory_contribution_catalog" where "balance_window" is null' into n;
	if n > 0 then raise exception 'notNull:statutory_contribution_catalog.balance_window refuses % existing row(s)', n; end if;
end $store$;
alter table "statutory_contribution_catalog" alter column "balance_window" set not null;

-- step create:notNull:subtotal.balance_window (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "subtotal" where "balance_window" is null' into n;
	if n > 0 then raise exception 'notNull:subtotal.balance_window refuses % existing row(s)', n; end if;
end $store$;
alter table "subtotal" alter column "balance_window" set not null;

-- step create:constraint:ledger_entry.ledger_entry__ck__e8abe6c4 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "ledger_entry" where ("measure" in (''total'', ''used'', ''entitled'', ''carried'', ''limit'', ''paid'')) is false' into n;
	if n > 0 then raise exception 'ledger_entry__ck__e8abe6c4 refuses % existing row(s)', n; end if;
end $store$;
alter table "ledger_entry" add constraint "ledger_entry__ck__e8abe6c4" check ("measure" in ('total', 'used', 'entitled', 'carried', 'limit', 'paid'));

-- step create:constraint:employee_contract.employee_contract__ck__52535bbd (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "employee_contract" where (("terms" is null or store_json_valid("terms", ''{"fields":{"allowances":{"help":"The agreed allowances, keyed by the catalog code; the catalog row carries how each behaves.","kind":"record","of":{"fields":{"amount":{"kind":"number","min":0}},"kind":"object"},"optional":true},"annual_leave_carry_limit_days":{"help":"An agreed contractual limit for carrying annual leave into the next leave year.","kind":"number","min":0,"optional":true},"department":{"kind":"text","optional":true},"employer_bears_income_tax":{"help":"The agreement makes the employer bear the employee’s income tax. The jurisdiction formula determines any required gross-up.","kind":"bool","optional":true},"job_title":{"kind":"text","optional":true},"normal_days_per_week":{"help":"The ordinary working days of one week.","kind":"number","max":7,"min":0},"normal_hours_per_day":{"help":"The ordinary hours of one working day. Every overtime, leave and statutory hour reads it.","kind":"number","min":0},"normal_hours_per_week":{"help":"The ordinary hours of one working week.","kind":"number","min":0},"notice_period":{"fields":{"unit":{"kind":"enum","values":["DAYS","WEEKS","MONTHS"]},"value":{"kind":"number","min":0}},"kind":"object","optional":true},"probation_period":{"help":"The original agreed probation dates. Salary amendments retain these dates; they do not start another probation.","kind":"period","of":"date","optional":true},"rate":{"kind":"json","optional":true,"shape":{"arms":{"DAILY":{"amount":{"kind":"number","min":0}},"HOURLY":{"amount":{"kind":"number","min":0}},"MONTHLY":{"amount":{"kind":"number","min":0}}},"by":"unit","kind":"union"}},"residency_status":{"kind":"text","optional":true},"shift_pattern_id":{"kind":"id","of":"shift_pattern","optional":true},"signed_on":{"help":"The actual date this employment agreement was signed.","kind":"date","optional":true},"statutory_work_category":{"kind":"text","optional":true},"wage_payment_method":{"kind":"enum","optional":true,"values":["BANK","CASH","CHEQUE","DIGITAL"]},"work_authorisation_category":{"kind":"text","optional":true},"work_classification":{"kind":"text","optional":true}},"kind":"object"}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'employee_contract__ck__52535bbd refuses % existing row(s)', n; end if;
end $store$;
alter table "employee_contract" add constraint "employee_contract__ck__52535bbd" check (("terms" is null or store_json_valid("terms", '{"fields":{"allowances":{"help":"The agreed allowances, keyed by the catalog code; the catalog row carries how each behaves.","kind":"record","of":{"fields":{"amount":{"kind":"number","min":0}},"kind":"object"},"optional":true},"annual_leave_carry_limit_days":{"help":"An agreed contractual limit for carrying annual leave into the next leave year.","kind":"number","min":0,"optional":true},"department":{"kind":"text","optional":true},"employer_bears_income_tax":{"help":"The agreement makes the employer bear the employee’s income tax. The jurisdiction formula determines any required gross-up.","kind":"bool","optional":true},"job_title":{"kind":"text","optional":true},"normal_days_per_week":{"help":"The ordinary working days of one week.","kind":"number","max":7,"min":0},"normal_hours_per_day":{"help":"The ordinary hours of one working day. Every overtime, leave and statutory hour reads it.","kind":"number","min":0},"normal_hours_per_week":{"help":"The ordinary hours of one working week.","kind":"number","min":0},"notice_period":{"fields":{"unit":{"kind":"enum","values":["DAYS","WEEKS","MONTHS"]},"value":{"kind":"number","min":0}},"kind":"object","optional":true},"probation_period":{"help":"The original agreed probation dates. Salary amendments retain these dates; they do not start another probation.","kind":"period","of":"date","optional":true},"rate":{"kind":"json","optional":true,"shape":{"arms":{"DAILY":{"amount":{"kind":"number","min":0}},"HOURLY":{"amount":{"kind":"number","min":0}},"MONTHLY":{"amount":{"kind":"number","min":0}}},"by":"unit","kind":"union"}},"residency_status":{"kind":"text","optional":true},"shift_pattern_id":{"kind":"id","of":"shift_pattern","optional":true},"signed_on":{"help":"The actual date this employment agreement was signed.","kind":"date","optional":true},"statutory_work_category":{"kind":"text","optional":true},"wage_payment_method":{"kind":"enum","optional":true,"values":["BANK","CASH","CHEQUE","DIGITAL"]},"work_authorisation_category":{"kind":"text","optional":true},"work_classification":{"kind":"text","optional":true}},"kind":"object"}'::jsonb) is true));

-- step create:constraint:jurisdiction_settings.jurisdiction_settings__ck__5e6d7204 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "jurisdiction_settings" where (("conversions" is null or store_json_valid("conversions", ''{"fields":{"day":{"fields":{"basis":{"kind":"enum","values":["CALENDAR_DAYS","WORKING_DAYS","YEAR","YEAR_REST_DAYS","HOUR","FIXED"]},"days":{"help":"The divisor when the basis is FIXED (Malaysia 26, China 21.75, Thailand and Taiwan 30).","kind":"number","min":0,"optional":true}},"kind":"object"},"hour":{"fields":{"basis":{"kind":"enum","values":["CONTRACT_HOURS","CONTRACT_WEEKLY","FIXED"]},"hours":{"help":"The divisor when the basis is FIXED (Indonesia 173, China 174).","kind":"number","min":0,"optional":true}},"kind":"object"},"proration":{"kind":"enum","values":["CALENDAR_DAYS","WORKING_DAYS"]},"rounding":{"fields":{"mode":{"default":"HALF_UP","kind":"enum","values":["HALF_UP","HALF_EVEN","UP","DOWN","TRUNCATE"]},"scale":{"default":2,"kind":"int","max":12,"min":0}},"kind":"object"}},"kind":"object"}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'jurisdiction_settings__ck__5e6d7204 refuses % existing row(s)', n; end if;
end $store$;
alter table "jurisdiction_settings" add constraint "jurisdiction_settings__ck__5e6d7204" check (("conversions" is null or store_json_valid("conversions", '{"fields":{"day":{"fields":{"basis":{"kind":"enum","values":["CALENDAR_DAYS","WORKING_DAYS","YEAR","YEAR_REST_DAYS","HOUR","FIXED"]},"days":{"help":"The divisor when the basis is FIXED (Malaysia 26, China 21.75, Thailand and Taiwan 30).","kind":"number","min":0,"optional":true}},"kind":"object"},"hour":{"fields":{"basis":{"kind":"enum","values":["CONTRACT_HOURS","CONTRACT_WEEKLY","FIXED"]},"hours":{"help":"The divisor when the basis is FIXED (Indonesia 173, China 174).","kind":"number","min":0,"optional":true}},"kind":"object"},"proration":{"kind":"enum","values":["CALENDAR_DAYS","WORKING_DAYS"]},"rounding":{"fields":{"mode":{"default":"HALF_UP","kind":"enum","values":["HALF_UP","HALF_EVEN","UP","DOWN","TRUNCATE"]},"scale":{"default":2,"kind":"int","max":12,"min":0}},"kind":"object"}},"kind":"object"}'::jsonb) is true));

-- step create:constraint:jurisdiction_settings.jurisdiction_settings__ck__d56866f5 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "jurisdiction_settings" where (("ledger" is null or store_json_valid("ledger", ''{"fields":{"ytd_scope":{"default":"JURISDICTION","kind":"enum","values":["JURISDICTION","EMPLOYER"]}},"kind":"object"}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'jurisdiction_settings__ck__d56866f5 refuses % existing row(s)', n; end if;
end $store$;
alter table "jurisdiction_settings" add constraint "jurisdiction_settings__ck__d56866f5" check (("ledger" is null or store_json_valid("ledger", '{"fields":{"ytd_scope":{"default":"JURISDICTION","kind":"enum","values":["JURISDICTION","EMPLOYER"]}},"kind":"object"}'::jsonb) is true));

-- step create:constraint:loan_repayment_entry.loan_repayment_entry__uq__f54a609c (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select coalesce(sum(n - 1), 0)::int as n from (select count(*) as n from "loan_repayment_entry" where "reverses" is not null group by "reverses" having count(*) > 1) d' into n;
	if n > 0 then raise exception 'loan_repayment_entry__uq__f54a609c refuses % existing row(s)', n; end if;
end $store$;
alter table "loan_repayment_entry" add constraint "loan_repayment_entry__uq__f54a609c" unique ("reverses") deferrable initially immediate;

-- step create:constraint:statutory_contribution_catalog.statutory_contribution_catalog__ck__f7025387 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "statutory_contribution_catalog" where ("balance_window" in (''MONTH'', ''YEAR'')) is false' into n;
	if n > 0 then raise exception 'statutory_contribution_catalog__ck__f7025387 refuses % existing row(s)', n; end if;
end $store$;
alter table "statutory_contribution_catalog" add constraint "statutory_contribution_catalog__ck__f7025387" check ("balance_window" in ('MONTH', 'YEAR'));

-- step create:constraint:registered_effect.registered_effect__ck__214b27e5 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "registered_effect" where (("reads" is null or store_json_valid("reads", ''{"kind":"custom","of":"reads","optional":true}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'registered_effect__ck__214b27e5 refuses % existing row(s)', n; end if;
end $store$;
alter table "registered_effect" add constraint "registered_effect__ck__214b27e5" check (("reads" is null or store_json_valid("reads", '{"kind":"custom","of":"reads","optional":true}'::jsonb) is true));

-- step create:constraint:registered_rule.registered_rule__ck__214b27e5 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "registered_rule" where (("reads" is null or store_json_valid("reads", ''{"kind":"custom","of":"reads","optional":true}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'registered_rule__ck__214b27e5 refuses % existing row(s)', n; end if;
end $store$;
alter table "registered_rule" add constraint "registered_rule__ck__214b27e5" check (("reads" is null or store_json_valid("reads", '{"kind":"custom","of":"reads","optional":true}'::jsonb) is true));

-- step create:constraint:subtotal.subtotal__ck__f7025387 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "subtotal" where ("balance_window" in (''MONTH'', ''YEAR'')) is false' into n;
	if n > 0 then raise exception 'subtotal__ck__f7025387 refuses % existing row(s)', n; end if;
end $store$;
alter table "subtotal" add constraint "subtotal__ck__f7025387" check ("balance_window" in ('MONTH', 'YEAR'));

-- step create:fk:loan_repayment_entry.loan_repayment_entry__fk__22aa4272 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "loan_repayment_entry" c where c."reverses" is not null and not exists (select 1 from "loan_repayment_entry" p where p."id" = c."reverses")' into n;
	if n > 0 then raise exception 'loan_repayment_entry__fk__22aa4272 refuses % existing row(s)', n; end if;
end $store$;
alter table "loan_repayment_entry" add constraint "loan_repayment_entry__fk__22aa4272" foreign key ("reverses") references "loan_repayment_entry" ("id") on delete restrict on update restrict;

-- step replace:trigger:jurisdiction_settings.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "jurisdiction_settings" for each row execute function store_row_rules('{"audit":true,"fields":{"code":["code"],"conversions":["conversions"],"currency":["currency"],"effective_range":["effective_range"],"employee_extension_schema":["employee_extension_schema"],"entity_extension_schema":["entity_extension_schema"],"ledger":["ledger"],"lookup":["lookup"],"name":["name"],"reason":["reason"],"status":["status"],"tax_year_start_month":["tax_year_start_month"],"timezone":["timezone"]},"key":["id"],"parents":[],"states":{"status":{"initial":"DRAFT","states":{"DRAFT":{"edit":"all","to":["SEALED","VOID"]},"SEALED":{"edit":["effective_range","reason"],"to":["VOID"]},"VOID":{"edit":"none","to":[]}}}}}');

-- step replace:trigger:adhoc_catalog_entry.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "adhoc_catalog_entry" for each row execute function store_row_rules('{"audit":true,"fields":{"catalog_id":["catalog_id"],"description":["description"],"employment_id":["employment_id"],"entity_id":["entity_id"],"evidence_file":["evidence_file"],"incurred_on":["incurred_on"],"payroll_run_id":["payroll_run_id"],"quantity":["quantity"],"reverses":["reverses"],"unit":["unit"]},"key":["id"],"parents":[],"states":{}}');

-- step replace:trigger:claim_catalog.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "claim_catalog" for each row execute function store_row_rules('{"audit":true,"fields":{"code":["code"],"conversion":["conversion"],"description":["description"],"direction":["direction"],"eligibility":["eligibility"],"incurred_on":["incurred_on"],"lookup":["lookup"],"name":["name"],"party":["party"],"references":["references"],"settings_id":["settings_id"],"subtotal_id":["subtotal_id"]},"key":["id"],"parents":[{"column":"settings_id","key":"id","relation":"claim_catalog","states":{"status":{"initial":"DRAFT","states":{"DRAFT":{"edit":"all","to":["SEALED","VOID"]},"SEALED":{"edit":["effective_range","reason"],"to":["VOID"]},"VOID":{"edit":"none","to":[]}}}},"table":"jurisdiction_settings","type":"uuid"}],"states":{}}');

-- step replace:trigger:claim_catalog_entry.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "claim_catalog_entry" for each row execute function store_row_rules('{"audit":true,"fields":{"catalog_id":["catalog_id"],"employment_id":["employment_id"],"entity_id":["entity_id"],"evidence_file":["evidence_file"],"incurred_on":["incurred_on"],"payroll_run_id":["payroll_run_id"],"quantity":["quantity"],"reverses":["reverses"],"unit":["unit"]},"key":["id"],"parents":[],"states":{}}');

-- step replace:trigger:leave_catalog.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "leave_catalog" for each row execute function store_row_rules('{"audit":true,"fields":{"code":["code"],"conversion":["conversion"],"description":["description"],"direction":["direction"],"eligibility":["eligibility"],"incurred_on":["incurred_on"],"lookup":["lookup"],"name":["name"],"pay_treatment":["pay_treatment"],"references":["references"],"settings_id":["settings_id"],"subtotal_id":["subtotal_id"]},"key":["id"],"parents":[{"column":"settings_id","key":"id","relation":"leave_catalog","states":{"status":{"initial":"DRAFT","states":{"DRAFT":{"edit":"all","to":["SEALED","VOID"]},"SEALED":{"edit":["effective_range","reason"],"to":["VOID"]},"VOID":{"edit":"none","to":[]}}}},"table":"jurisdiction_settings","type":"uuid"}],"states":{}}');

-- step replace:trigger:leave_catalog_entry.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "leave_catalog_entry" for each row execute function store_row_rules('{"audit":true,"fields":{"catalog_id":["catalog_id"],"days":["days"],"employment_id":["employment_id"],"encashment":["encashment"],"entity_id":["entity_id"],"evidence_file":["evidence_file"],"payroll_run_id":["payroll_run_id"],"reverses":["reverses"]},"key":["id"],"parents":[],"states":{}}');

-- step replace:trigger:loan_catalog.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "loan_catalog" for each row execute function store_row_rules('{"audit":true,"fields":{"code":["code"],"conversion":["conversion"],"description":["description"],"eligibility":["eligibility"],"incurred_on":["incurred_on"],"lookup":["lookup"],"name":["name"],"references":["references"],"settings_id":["settings_id"],"subtotal_id":["subtotal_id"]},"key":["id"],"parents":[{"column":"settings_id","key":"id","relation":"loan_catalog","states":{"status":{"initial":"DRAFT","states":{"DRAFT":{"edit":"all","to":["SEALED","VOID"]},"SEALED":{"edit":["effective_range","reason"],"to":["VOID"]},"VOID":{"edit":"none","to":[]}}}},"table":"jurisdiction_settings","type":"uuid"}],"states":{}}');

-- step replace:trigger:loan_repayment_entry.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "loan_repayment_entry" for each row execute function store_row_rules('{"audit":true,"fields":{"amount":["amount"],"employment_id":["employment_id"],"entity_id":["entity_id"],"loan_id":["loan_id"],"paid_on":["paid_on"],"payment_reference":["payment_reference"],"payroll_run_id":["payroll_run_id"],"reverses":["reverses"]},"key":["id"],"parents":[],"states":{}}');

-- step replace:trigger:work_interruption_catalog.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "work_interruption_catalog" for each row execute function store_row_rules('{"audit":true,"fields":{"code":["code"],"description":["description"],"events":["events"],"lookup":["lookup"],"name":["name"],"references":["references"],"settings_id":["settings_id"],"subtotal_id":["subtotal_id"]},"key":["id"],"parents":[{"column":"settings_id","key":"id","relation":"work_interruption_catalog","states":{"status":{"initial":"DRAFT","states":{"DRAFT":{"edit":"all","to":["SEALED","VOID"]},"SEALED":{"edit":["effective_range","reason"],"to":["VOID"]},"VOID":{"edit":"none","to":[]}}}},"table":"jurisdiction_settings","type":"uuid"}],"states":{}}');

-- step replace:trigger:workplace_case_catalog.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "workplace_case_catalog" for each row execute function store_row_rules('{"audit":true,"fields":{"code":["code"],"description":["description"],"events":["events"],"lookup":["lookup"],"name":["name"],"references":["references"],"settings_id":["settings_id"],"subtotal_id":["subtotal_id"]},"key":["id"],"parents":[{"column":"settings_id","key":"id","relation":"workplace_case_catalog","states":{"status":{"initial":"DRAFT","states":{"DRAFT":{"edit":"all","to":["SEALED","VOID"]},"SEALED":{"edit":["effective_range","reason"],"to":["VOID"]},"VOID":{"edit":"none","to":[]}}}},"table":"jurisdiction_settings","type":"uuid"}],"states":{}}');

-- step replace:trigger:allowance_catalog.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "allowance_catalog" for each row execute function store_row_rules('{"audit":true,"fields":{"code":["code"],"conversion":["conversion"],"eligibility":["eligibility"],"include_in_rate":["include_in_rate"],"incurred_on":["incurred_on"],"lookup":["lookup"],"name":["name"],"party":["party"],"prorate":["prorate"],"references":["references"],"settings_id":["settings_id"],"subtotal_id":["subtotal_id"]},"key":["id"],"parents":[{"column":"settings_id","key":"id","relation":"allowance_catalog","states":{"status":{"initial":"DRAFT","states":{"DRAFT":{"edit":"all","to":["SEALED","VOID"]},"SEALED":{"edit":["effective_range","reason"],"to":["VOID"]},"VOID":{"edit":"none","to":[]}}}},"table":"jurisdiction_settings","type":"uuid"}],"states":{}}');

-- step replace:trigger:overtime_catalog.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "overtime_catalog" for each row execute function store_row_rules('{"audit":true,"fields":{"code":["code"],"conversion":["conversion"],"direction":["direction"],"eligibility":["eligibility"],"incurred_on":["incurred_on"],"lookup":["lookup"],"name":["name"],"references":["references"],"settings_id":["settings_id"],"subtotal_id":["subtotal_id"]},"key":["id"],"parents":[{"column":"settings_id","key":"id","relation":"overtime_catalog","states":{"status":{"initial":"DRAFT","states":{"DRAFT":{"edit":"all","to":["SEALED","VOID"]},"SEALED":{"edit":["effective_range","reason"],"to":["VOID"]},"VOID":{"edit":"none","to":[]}}}},"table":"jurisdiction_settings","type":"uuid"}],"states":{}}');

-- step replace:trigger:statutory_contribution_catalog.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "statutory_contribution_catalog" for each row execute function store_row_rules('{"audit":true,"fields":{"balance_window":["balance_window"],"code":["code"],"depends_on":["depends_on"],"eligibility":["eligibility"],"employee_amount":["employee_amount"],"employer_amount":["employer_amount"],"employer_cost_subtotal_id":["employer_cost_subtotal_id"],"kind":["kind"],"lookup":["lookup"],"name":["name"],"references":["references"],"settings_id":["settings_id"],"subtotal_id":["subtotal_id"]},"key":["id"],"parents":[{"column":"settings_id","key":"id","relation":"statutory_contribution_catalog","states":{"status":{"initial":"DRAFT","states":{"DRAFT":{"edit":"all","to":["SEALED","VOID"]},"SEALED":{"edit":["effective_range","reason"],"to":["VOID"]},"VOID":{"edit":"none","to":[]}}}},"table":"jurisdiction_settings","type":"uuid"}],"states":{}}');

-- step replace:trigger:subtotal.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "subtotal" for each row execute function store_row_rules('{"audit":true,"fields":{"balance_window":["balance_window"],"calculation":["calculation"],"code":["code"],"name":["name"],"previous_id":["previous_id"],"settings_id":["settings_id"]},"key":["id"],"parents":[{"column":"settings_id","key":"id","relation":"subtotals","states":{"status":{"initial":"DRAFT","states":{"DRAFT":{"edit":"all","to":["SEALED","VOID"]},"SEALED":{"edit":["effective_range","reason"],"to":["VOID"]},"VOID":{"edit":"none","to":[]}}}},"table":"jurisdiction_settings","type":"uuid"}],"states":{}}');

-- step replace:engine:audit:loan_repayment_entry (additive)
drop trigger if exists bolt_audit_mark on "loan_repayment_entry";
create trigger bolt_audit_mark before insert or update or delete on "loan_repayment_entry" for each row execute function bolt_audit_mark('[]','[["employment_id","employee_contract"],["entity_id","entity"],["loan_id","loan_catalog_entry"],["payroll_run_id","payroll_run"],["reverses","loan_repayment_entry"]]');
drop trigger if exists bolt_audit on "loan_repayment_entry";
create trigger bolt_audit after insert or update or delete on "loan_repayment_entry" for each row execute function bolt_audit('[]','[["employment_id","employee_contract"],["entity_id","entity"],["loan_id","loan_catalog_entry"],["payroll_run_id","payroll_run"],["reverses","loan_repayment_entry"]]');

-- step create:index:loan_repayment_entry.loan_repayment_entry__ix__7a4e31a2 (additive)
-- operational risk: writes-blocked, table-scan
create index "loan_repayment_entry__ix__7a4e31a2" on "loan_repayment_entry" ("reverses");
