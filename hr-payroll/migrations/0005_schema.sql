-- 0005_schema.sql: 51 step(s), from 7d5790197809af745e91c4d5229b99f8618f944561804d391eee27b237bc364e to 8b6db9558fef73f61ea7b82406f0be20f6ac3290f9c106ed51f25fcf0b420f26.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- hazard: DESTRUCTIVE: drops data (a table or a stored column) or rebuilds it; runs only under its accept line.
-- hazard: validating: refuses, naming the constraint and the row count, if existing rows break it.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.

-- step replace:trigger:employee_profile.store_row_rules (additive)
drop trigger if exists store_row_rules on "employee_profile";

-- step replace:trigger:employee_contract.store_row_rules (additive)
drop trigger if exists store_row_rules on "employee_contract";

-- step replace:trigger:loan_catalog.store_row_rules (additive)
drop trigger if exists store_row_rules on "loan_catalog";

-- step replace:trigger:work_event_catalog.store_row_rules (additive)
drop trigger if exists store_row_rules on "work_event_catalog";

-- step replace:trigger:obligation.store_row_rules (additive)
drop trigger if exists store_row_rules on "obligation";

-- step replace:trigger:payslip.store_row_rules (additive)
drop trigger if exists store_row_rules on "payslip";

-- step drop:constraint:approval_request.approval_request__ck__8e3c4626 (additive)
-- operational risk: access-exclusive-lock
alter table "approval_request" drop constraint if exists "approval_request__ck__8e3c4626";

-- step drop:constraint:employee_contract.employee_contract__ck__2e1043ee (additive)
-- operational risk: access-exclusive-lock
alter table "employee_contract" drop constraint if exists "employee_contract__ck__2e1043ee";

-- step drop:constraint:employee_profile.employee_profile__ck__e6363abe (additive)
-- operational risk: access-exclusive-lock
alter table "employee_profile" drop constraint if exists "employee_profile__ck__e6363abe";

-- step drop:constraint:employee_profile.employee_profile__ck__d60d3d86 (additive)
-- operational risk: access-exclusive-lock
alter table "employee_profile" drop constraint if exists "employee_profile__ck__d60d3d86";

-- step drop:constraint:entity_profile_version.entity_profile_version__ck__d103a317 (additive)
-- operational risk: access-exclusive-lock
alter table "entity_profile_version" drop constraint if exists "entity_profile_version__ck__d103a317";

-- step drop:constraint:loan_catalog.loan_catalog__ck__b517fae2 (additive)
-- operational risk: access-exclusive-lock
alter table "loan_catalog" drop constraint if exists "loan_catalog__ck__b517fae2";

-- step drop:constraint:payslip.payslip__ck__3d55e4fa (additive)
-- operational risk: access-exclusive-lock
alter table "payslip" drop constraint if exists "payslip__ck__3d55e4fa";

-- step drop:constraint:payslip.payslip__ck__d22c95a0 (additive)
-- operational risk: access-exclusive-lock
alter table "payslip" drop constraint if exists "payslip__ck__d22c95a0";

-- step drop:constraint:registered_effect.registered_effect__ck__9ceb5efd (additive)
-- operational risk: access-exclusive-lock
alter table "registered_effect" drop constraint if exists "registered_effect__ck__9ceb5efd";

-- step drop:constraint:registered_rule.registered_rule__ck__0b01c0b9 (additive)
-- operational risk: access-exclusive-lock
alter table "registered_rule" drop constraint if exists "registered_rule__ck__0b01c0b9";

-- step drop:constraint:work_event_catalog.work_event_catalog__ck__38965ec0 (additive)
-- operational risk: access-exclusive-lock
alter table "work_event_catalog" drop constraint if exists "work_event_catalog__ck__38965ec0";

-- step drop:notNull:employee_profile.face_match_count (additive)
-- operational risk: access-exclusive-lock
alter table "employee_profile" alter column "face_match_count" drop not null;

-- step drop:notNull:payslip.additional_wages (additive)
-- operational risk: access-exclusive-lock
alter table "payslip" alter column "additional_wages" drop not null;

-- step drop:notNull:payslip.employer_statutory (additive)
-- operational risk: access-exclusive-lock
alter table "payslip" alter column "employer_statutory" drop not null;

-- step drop:notNull:work_event_catalog.events (additive)
-- operational risk: access-exclusive-lock
alter table "work_event_catalog" alter column "events" drop not null;

-- step drop:default:employee_profile.face_match_count (additive)
-- operational risk: access-exclusive-lock
alter table "employee_profile" alter column "face_match_count" drop default;

-- step drop:default:payslip.additional_wages (additive)
-- operational risk: access-exclusive-lock
alter table "payslip" alter column "additional_wages" drop default;

-- step drop:default:payslip.employer_statutory (additive)
-- operational risk: access-exclusive-lock
alter table "payslip" alter column "employer_statutory" drop default;

-- step drop:default:work_event_catalog.events (additive)
-- operational risk: access-exclusive-lock
alter table "work_event_catalog" alter column "events" drop default;

-- step drop:column:employee_contract.work_pass_valid_until (destructive)
-- accept: drop:column:employee_contract.work_pass_valid_until
-- operational risk: access-exclusive-lock
alter table "employee_contract" drop column if exists "work_pass_valid_until" cascade;

-- step drop:column:employee_profile.face_last_match_at (destructive)
-- accept: drop:column:employee_profile.face_last_match_at
-- operational risk: access-exclusive-lock
alter table "employee_profile" drop column if exists "face_last_match_at" cascade;

-- step drop:column:employee_profile.face_match_count (destructive)
-- accept: drop:column:employee_profile.face_match_count
-- operational risk: access-exclusive-lock
alter table "employee_profile" drop column if exists "face_match_count" cascade;

-- step drop:column:loan_catalog.conversion (destructive)
-- accept: drop:column:loan_catalog.conversion
-- operational risk: access-exclusive-lock
alter table "loan_catalog" drop column if exists "conversion" cascade;

-- step drop:column:payslip.additional_wages (destructive)
-- accept: drop:column:payslip.additional_wages
-- operational risk: access-exclusive-lock
alter table "payslip" drop column if exists "additional_wages" cascade;

-- step drop:column:payslip.employer_statutory (destructive)
-- accept: drop:column:payslip.employer_statutory
-- operational risk: access-exclusive-lock
alter table "payslip" drop column if exists "employer_statutory" cascade;

-- step drop:column:work_event_catalog.events (destructive)
-- accept: drop:column:work_event_catalog.events
-- operational risk: access-exclusive-lock
alter table "work_event_catalog" drop column if exists "events" cascade;

-- step replace:history:schema:employee_profile (additive)
select bolt_history_register('employee_profile','{"audit":true,"fields":{"address":{"kind":"text","optional":true},"cumulative_service":{"default":false,"help":"Service counts every stint at the employer, rehires included. Off, only the current unbroken stint counts: the statutory continuous service.","kind":"bool"},"documents":{"accept":["application/pdf","image/*"],"kind":"file","max":"20MiB","multiple":true,"optional":true},"email":{"format":"email","kind":"text","optional":true},"face_consent_at":{"kind":"instant","optional":true},"face_embedding":{"dim":1024,"kind":"vector","metric":"cosine","optional":true},"face_enrolled_at":{"kind":"instant","optional":true},"face_enrollment_status":{"default":"NONE","kind":"enum","values":["NONE","PENDING","APPROVED","SUSPENDED"]},"face_photo":{"accept":["image/jpeg","image/png"],"kind":"file","max":"5MiB","optional":true},"invitation_id":{"kind":"ref","onDelete":"setNull","optional":true,"to":"sys_invitation"},"location":{"kind":"point","optional":true},"name":{"kind":"text"},"phone":{"format":"phone","kind":"text","optional":true},"source_reference":{"kind":"text","label":"Source reference","optional":true},"user_id":{"kind":"ref","onDelete":"restrict","optional":true,"to":"sys_user"}},"nativeRules":2,"recordLabel":"record.name","search":{"semantic":{"dim":1536,"fields":["address"],"model":"default"},"text":["name","email","phone"]},"unique":[{"fields":["invitation_id"]},{"fields":["user_id"]}]}'::jsonb);

-- step replace:history:schema:employee_contract (additive)
select bolt_history_register('employee_contract','{"audit":true,"fields":{"bank":{"kind":"custom","of":"bank","optional":true},"effective_range":{"help":"The dates this agreement applies. A replacement contract continues employment; ending it records a reason.","kind":"period","of":"date"},"employee_extension_data":{"default":{},"help":"The employee data the jurisdiction''s employee extension schema declares.","kind":"json","shape":{"kind":"record","of":{"kind":"json"}}},"employee_id":{"inverse":"employee_contract","kind":"ref","to":"employee_profile"},"employee_number":{"kind":"text"},"engagement":{"default":"EMPLOYEE","help":"The contracted role. PAYEE is paid without employment (a commission agent), outside the headcount and separations.","kind":"enum","values":["EMPLOYEE","PART_TIME","CONTRACTOR","INTERN","APPRENTICE","CONSULTANT","PAYEE"]},"entity_id":{"inverse":"employee_contract","kind":"ref","to":"entity"},"events":{"help":"Dated statutory events on this contract: illness, bereavement, marriage, work injury, confinement and similar. A child is a `family` member; termination is the contract status and reason.","kind":"list","of":{"fields":{"allocated_days":{"kind":"int","optional":true},"ended_on":{"kind":"date","optional":true},"kind":{"kind":"text"},"on":{"kind":"date"},"opened_on":{"kind":"date","optional":true}},"kind":"object"},"optional":true},"exit_ground":{"help":"The statutory ground for ending the employment. It decides severance eligibility and exit duties; reason carries the narrative.","kind":"enum","optional":true,"values":["RETRENCHMENT","RETIREMENT","RESIGNATION","DISMISSAL","MISCONDUCT_DISMISSAL","END_OF_CONTRACT","MUTUAL","DEATH","UNILATERAL","BREACH_BY_EMPLOYER"]},"family":{"help":"The person''s family. Every count or flag a scheme reads (dependants, a spouse''s income, births) is worked out from this list. A child''s `allocations` are HR''s approved leave days for that child, keyed by leave code.","kind":"list","of":{"fields":{"allocations":{"kind":"record","of":{"kind":"number","min":0},"optional":true},"born_on":{"kind":"date","optional":true},"disabled":{"kind":"bool","optional":true},"expected_on":{"kind":"date","optional":true},"has_income":{"kind":"bool","optional":true},"relation":{"kind":"enum","values":["CHILD","SPOUSE","PARENT"]},"studying":{"kind":"bool","optional":true}},"kind":"object"},"optional":true},"final_pay_due_on":{"help":"The actual contractual date the final settlement becomes payable. This differs from the maximum statutory deadline and the run’s actual payment date.","kind":"date","optional":true},"pay_group_id":{"inverse":"employee_contract","kind":"ref","onDelete":"restrict","optional":true,"to":"pay_group"},"payroll":{"fields":{"birth_city":{"kind":"text","optional":true},"date_of_birth":{"kind":"date","optional":true},"gender":{"kind":"enum","optional":true,"values":["MALE","FEMALE"]},"identity_number":{"kind":"text","optional":true},"marital_status":{"kind":"enum","optional":true,"values":["SINGLE","MARRIED","SEPARATED","DIVORCED","WIDOWED"]},"nationality":{"help":"ISO 3166-1 alpha-2 country code.","kind":"text","optional":true},"passport_number":{"kind":"text","optional":true}},"kind":"object","label":"Person details","optional":true},"reason":{"help":"Why this record was voided or the employment ended.","kind":"text","optional":true},"service_started_on":{"help":"Only for service credited from elsewhere. Service is otherwise worked out from the stints under this jurisdiction: the current unbroken one, or every one, rehires included, where the profile counts every stint.","kind":"date","optional":true},"signed_contract_period":{"kind":"period","of":"date","optional":true},"status":{"initial":"DRAFT","kind":"state","states":{"DRAFT":{"edit":"all","to":["SEALED"]},"SEALED":{"edit":["effective_range","final_pay_due_on","reason","exit_ground","employee_extension_data"],"to":["VOID"]},"VOID":{"edit":"none","to":[]}}},"terms":{"fields":{"allowances":{"help":"The agreed allowances, keyed by the catalog code; the catalog row carries how each behaves.","kind":"record","of":{"fields":{"amount":{"kind":"number","min":0}},"kind":"object"},"optional":true},"annual_leave_carry_limit_days":{"help":"An agreed contractual limit for carrying annual leave into the next leave year.","kind":"number","min":0,"optional":true},"department":{"kind":"text","optional":true},"employee_borne_tax_items":{"help":"Where the employer bears the income tax: the agreed allowances whose tax the employee still pays, at their own rate.","kind":"list","of":{"kind":"text"},"optional":true},"employer_bears_income_tax":{"help":"The agreement makes the employer bear the employee’s income tax. The jurisdiction formula determines any required gross-up.","kind":"bool","optional":true},"job_title":{"kind":"text","optional":true},"normal_days_per_week":{"help":"The ordinary working days of one week.","kind":"number","max":7,"min":0},"normal_hours_per_day":{"help":"The ordinary hours of one working day. Every overtime, leave and statutory hour reads it.","kind":"number","min":0},"normal_hours_per_week":{"help":"The ordinary hours of one working week.","kind":"number","min":0},"notice_period":{"fields":{"unit":{"kind":"enum","values":["DAYS","WEEKS","MONTHS"]},"value":{"kind":"number","min":0}},"kind":"object","optional":true},"probation_period":{"help":"The original agreed probation dates. Salary amendments retain these dates; they do not start another probation.","kind":"period","of":"date","optional":true},"rate":{"kind":"json","optional":true,"shape":{"arms":{"DAILY":{"amount":{"kind":"number","min":0}},"HOURLY":{"amount":{"kind":"number","min":0}},"MONTHLY":{"amount":{"kind":"number","min":0}}},"by":"unit","kind":"union"}},"residency_status":{"kind":"text","optional":true},"shift_pattern_id":{"kind":"id","of":"shift_pattern","optional":true},"signed_on":{"help":"The actual date this employment agreement was signed.","kind":"date","optional":true},"statutory_work_category":{"kind":"text","optional":true},"wage_payment_method":{"kind":"enum","optional":true,"values":["BANK","CASH","CHEQUE","DIGITAL"]},"work_authorisation_category":{"kind":"text","optional":true},"work_authorisation_expires_on":{"help":"The day the work pass or permit ends, an extension included. Where the law ties a contribution to the pass (Malaysia: provident fund stops in its last two months), the rule reads this day.","kind":"date","optional":true},"work_classification":{"kind":"text","optional":true},"work_region":{"help":"The worksite region key the jurisdiction minimum-wage tables use, where it differs from the employer region.","kind":"text","optional":true},"worksite":{"help":"The establishment or site the person works at, where the law applies thresholds by site.","kind":"text","optional":true}},"kind":"object"}},"nativeRules":2,"noOverlap":[{"key":["employee_id"],"period":"effective_range","where":{"status":{"eq":"SEALED"}}}],"recordLabel":"has(record.employee_id.name) ? record.employee_id.name + '' · '' + record.employee_number : record.employee_number","search":{"text":["employee_number","employee_id"]}}'::jsonb);

-- step replace:history:schema:entity_profile_version (additive)
select bolt_history_register('entity_profile_version','{"audit":true,"fields":{"bank":{"kind":"custom","of":"bank","optional":true},"effective_range":{"kind":"period","of":"date"},"entity_extension_data":{"default":{},"help":"The entity data the jurisdiction''s entity extension schema declares.","kind":"json","shape":{"kind":"record","of":{"kind":"json"}}},"entity_id":{"inverse":"payroll_versions","kind":"ref","onDelete":"restrict","to":"entity"},"final_pay_loan_floor_percent":{"default":10,"help":"The share of expected final pay that must remain after loan recovery.","kind":"int","max":100,"min":0},"input_schema_version_id":{"inverse":"employer_payroll_versions","kind":"ref","onDelete":"restrict","to":"jurisdiction_settings","where":{"status":{"eq":"SEALED"}}},"name":{"kind":"text"},"overtime_full_award_percent":{"default":100,"help":"How much of planned overtime the clock must cover to pay all of it. Below this, the clocked time pays, rounded down to the half hour.","kind":"int","max":100,"min":1},"pay_methods":{"fields":{"benefit_exclusion":{"default":"POOLED","help":"How a benefit paid past its own tax-free limit is taxed. Pooled: the excess joins the yearly exclusion for bonuses and benefits. Excess taxed: it is taxed on the payslip of the month it is paid. The year’s last payslip settles either way, so only the month the tax is withheld changes. Only the Philippines’ rows read it; it changes nothing in other countries.","kind":"enum","label":"Benefits over their tax-free limit","values":["POOLED","EXCESS_TAXED"]},"contribution_split":{"default":"EVEN","help":"How a month’s contributions fall on the two payslips of a twice-monthly group. Even: half on each. First run: the whole month on the first payslip, on an estimate, and the second settles the month’s actual wages. Only the Philippines’ rows read it; it changes nothing in other countries.","kind":"enum","label":"Contributions over two runs a month","values":["EVEN","FIRST_RUN"]},"night_differential_basis":{"default":"WORKED","help":"Which hours earn the night premium. Worked: the hours worked inside the night window. Clock span: every clocked hour in the window, unpaid breaks and overtime included, at the ordinary hour rate. Whole night: a worked night shift earns eight full hours of premium at the day’s rate. It changes the night premium line of a payslip. Only the Philippines’ rows read it; it changes nothing in other countries.","kind":"enum","label":"Night premium hours","values":["WORKED","CLOCK_SPAN","WHOLE_NIGHT"]},"overtime_hour_basis":{"default":"STATUTORY","help":"What one overtime hour is priced on. Statutory: the hour rate the law works out. Contract weekly: the monthly wage × 12 ÷ (52 × the contract''s weekly hours). It changes the overtime lines of a payslip.","kind":"enum","label":"Overtime hour rate","values":["STATUTORY","CONTRACT_WEEKLY"]},"rest_day_hourly_multiplier":{"help":"Every hour worked on a rest day pays this multiple of the hour rate. Leave empty to pay what the law pays. It changes the rest-day work lines of a payslip.","kind":"number","label":"Rest-day hour multiple","min":1,"optional":true}},"help":"The employer''s own pay methods. Each applies only where it pays at least the law; otherwise the law stands.","kind":"object","optional":true},"reason":{"kind":"text","optional":true},"registered_address":{"kind":"text","optional":true},"representative_name":{"help":"The responsible person the law names for filing and registration duties.","kind":"text","optional":true},"settings_code":{"kind":"text"},"status":{"initial":"DRAFT","kind":"state","states":{"DRAFT":{"edit":"all","to":["SEALED"]},"SEALED":{"edit":["effective_range","reason"],"to":["VOID"]},"VOID":{"edit":"none","to":[]}}},"time_zone":{"help":"The zone this entity''s payroll windows and rostered days are counted in.","kind":"text","optional":true}},"nativeRules":2,"noOverlap":[{"key":["entity_id"],"period":"effective_range","where":{"status":{"eq":"SEALED"}}}],"recordLabel":"record.name"}'::jsonb);

-- step replace:history:schema:loan_catalog (additive)
select bolt_history_register('loan_catalog','{"audit":true,"fields":{"code":{"kind":"text"},"description":{"kind":"text","optional":true},"eligibility":{"kind":"text","max":65536,"optional":true},"lookup":{"default":{},"kind":"json","shape":{"kind":"record","of":{"kind":"json"}}},"references":{"kind":"custom","of":"references","optional":true},"settings_id":{"inverse":"loan_catalog","kind":"ref","owned":true,"to":"jurisdiction_settings"},"subtotal_id":{"inverse":"loan_catalog","kind":"ref","onDelete":"restrict","optional":true,"to":"subtotal"}},"nativeRules":2,"recordLabel":"record.code","unique":[{"fields":["settings_id","code"]}]}'::jsonb);

-- step replace:history:schema:work_event_catalog (additive)
select bolt_history_register('work_event_catalog','{"audit":true,"fields":{"code":{"kind":"text"},"description":{"kind":"text","optional":true},"lookup":{"default":{},"kind":"json","shape":{"kind":"record","of":{"kind":"json"}}},"references":{"kind":"custom","of":"references","optional":true},"settings_id":{"inverse":"work_event_catalog","kind":"ref","owned":true,"to":"jurisdiction_settings"},"subtotal_id":{"kind":"ref","onDelete":"restrict","optional":true,"to":"subtotal"}},"nativeRules":2,"recordLabel":"record.code","unique":[{"fields":["settings_id","code"]}]}'::jsonb);

-- step replace:history:schema:registered_effect (additive)
select bolt_history_register('registered_effect','{"audit":true,"fields":{"code":{"kind":"text"},"condition":{"kind":"text","max":65536},"description":{"kind":"text","optional":true},"effects":{"kind":"text","max":65536},"events":{"kind":"enum","many":true,"values":["create","update","delete","seal","exit"]},"lookup":{"default":{},"kind":"json","shape":{"kind":"record","of":{"kind":"json"}}},"name":{"kind":"text"},"reads":{"kind":"custom","of":"reads","optional":true},"references":{"kind":"custom","of":"references","optional":true},"settings_id":{"inverse":"registered_effect","kind":"ref","owned":true,"to":"jurisdiction_settings"},"source_collection":{"kind":"text"},"target_action":{"kind":"enum","values":["create","update","delete"]},"target_collection":{"kind":"text"}},"nativeRules":2,"recordLabel":"record.code","unique":[{"fields":["settings_id","code"]}]}'::jsonb);

-- step replace:history:schema:registered_rule (additive)
select bolt_history_register('registered_rule','{"audit":true,"fields":{"code":{"kind":"text"},"condition":{"kind":"text","max":65536,"optional":true},"description":{"kind":"text","optional":true},"events":{"kind":"enum","many":true,"values":["create","update","delete"]},"lookup":{"default":{},"kind":"json","shape":{"kind":"record","of":{"kind":"json"}}},"order":{"default":0,"kind":"int"},"reads":{"kind":"custom","of":"reads","optional":true},"references":{"kind":"custom","of":"references","optional":true},"settings_id":{"inverse":"registered_rule","kind":"ref","owned":true,"to":"jurisdiction_settings"},"target_collection":{"kind":"text"},"validate":{"kind":"text","max":65536}},"nativeRules":2,"recordLabel":"record.code","unique":[{"fields":["settings_id","code"]}]}'::jsonb);

-- step replace:history:schema:obligation (additive)
select bolt_history_register('obligation','{"audit":true,"fields":{"due_on":{"kind":"date","optional":true},"employee_id":{"kind":"ref","optional":true,"to":"employee_profile"},"employment_id":{"kind":"ref","optional":true,"to":"employee_contract"},"entity_id":{"inverse":"obligations","kind":"ref","to":"entity"},"evidence":{"accept":["application/pdf","image/*"],"kind":"file","max":"20MiB","optional":true},"fulfilled_on":{"kind":"date","optional":true},"occurrence_key":{"kind":"text"},"state":{"initial":"OPEN","kind":"state","states":{"FULFILLED":{"edit":"none","to":[]},"OPEN":{"edit":["title","due_on","fulfilled_on","evidence","waiver_reason","state"],"to":["FULFILLED","WAIVED"]},"WAIVED":{"edit":["waiver_reason","state"],"to":["OPEN"]}}},"title":{"kind":"text"},"waiver_reason":{"kind":"text","optional":true}},"nativeRules":2,"recordLabel":"record.title","unique":[{"fields":["occurrence_key"]}]}'::jsonb);

-- step replace:history:schema:payslip (additive)
select bolt_history_register('payslip','{"audit":true,"fields":{"basic_earnings":{"kind":"decimal","optional":true,"scale":12},"breakdown":{"default":{},"kind":"json","shape":{"kind":"record","of":{"kind":"json"}}},"employee_id":{"inverse":"payslips","kind":"ref","to":"employee_profile"},"employee_statutory":{"default":0,"kind":"decimal","min":0,"scale":12},"employer_cost":{"default":0,"kind":"decimal","min":0,"scale":12},"employment_id":{"inverse":"payslips","kind":"ref","to":"employee_contract"},"entity_id":{"kind":"ref","to":"entity"},"gross_earnings":{"kind":"decimal","optional":true,"scale":12},"net_pay":{"kind":"decimal","scale":12},"ordinary_wages":{"default":0,"kind":"decimal","min":0,"scale":12},"payroll_run_id":{"inverse":"payslips","kind":"ref","onDelete":"cascade","to":"payroll_run"},"period":{"kind":"text","optional":true},"settings_id":{"kind":"ref","onDelete":"restrict","to":"jurisdiction_settings"},"tax_withheld":{"default":0,"kind":"decimal","min":0,"scale":12},"total_deductions":{"kind":"decimal","min":0,"scale":12}},"nativeRules":2,"recordLabel":"string(record.net_pay)","unique":[{"fields":["payroll_run_id","employee_id","entity_id"]}]}'::jsonb);

-- step data:entity_profile_version.pay_methods (data)
-- hazard: the shape of entity_profile_version.pay_methods changed; rows written under the old shape may not decode under the new one.
-- Transform them here (an UPDATE over entity_profile_version); the check below counts the rows the new shape still refuses.
-- step check:entity_profile_version.pay_methods (validating)
do $store$ declare n bigint; begin
	execute 'select count(*) from "entity_profile_version" where "pay_methods" is not null and store_json_valid("pay_methods", ''{"fields":{"benefit_exclusion":{"default":"POOLED","help":"How a benefit paid past its own tax-free limit is taxed. Pooled: the excess joins the yearly exclusion for bonuses and benefits. Excess taxed: it is taxed on the payslip of the month it is paid. The year’s last payslip settles either way, so only the month the tax is withheld changes. Only the Philippines’ rows read it; it changes nothing in other countries.","kind":"enum","label":"Benefits over their tax-free limit","values":["POOLED","EXCESS_TAXED"]},"contribution_split":{"default":"EVEN","help":"How a month’s contributions fall on the two payslips of a twice-monthly group. Even: half on each. First run: the whole month on the first payslip, on an estimate, and the second settles the month’s actual wages. Only the Philippines’ rows read it; it changes nothing in other countries.","kind":"enum","label":"Contributions over two runs a month","values":["EVEN","FIRST_RUN"]},"night_differential_basis":{"default":"WORKED","help":"Which hours earn the night premium. Worked: the hours worked inside the night window. Clock span: every clocked hour in the window, unpaid breaks and overtime included, at the ordinary hour rate. Whole night: a worked night shift earns eight full hours of premium at the day’s rate. It changes the night premium line of a payslip. Only the Philippines’ rows read it; it changes nothing in other countries.","kind":"enum","label":"Night premium hours","values":["WORKED","CLOCK_SPAN","WHOLE_NIGHT"]},"overtime_hour_basis":{"default":"STATUTORY","help":"What one overtime hour is priced on. Statutory: the hour rate the law works out. Contract weekly: the monthly wage × 12 ÷ (52 × the contract''''s weekly hours). It changes the overtime lines of a payslip.","kind":"enum","label":"Overtime hour rate","values":["STATUTORY","CONTRACT_WEEKLY"]},"rest_day_hourly_multiplier":{"help":"Every hour worked on a rest day pays this multiple of the hour rate. Leave empty to pay what the law pays. It changes the rest-day work lines of a payslip.","kind":"number","label":"Rest-day hour multiple","min":1,"optional":true}},"help":"The employer''''s own pay methods. Each applies only where it pays at least the law; otherwise the law stands.","kind":"object","optional":true}''::jsonb) is not true' into n;
	if n > 0 then raise exception 'the shape of entity_profile_version.pay_methods refuses % existing row(s)', n; end if;
end $store$;

-- step create:constraint:approval_request.approval_request__ck__74b8639f (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "approval_request" where ("status" in (''ONGOING'', ''CHANGES_REQUESTED'', ''APPROVED'', ''REJECTED'', ''SUPERSEDED'', ''WITHDRAWN'')) is false' into n;
	if n > 0 then raise exception 'approval_request__ck__74b8639f refuses % existing row(s)', n; end if;
end $store$;
alter table "approval_request" add constraint "approval_request__ck__74b8639f" check ("status" in ('ONGOING', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED', 'SUPERSEDED', 'WITHDRAWN'));

-- step create:constraint:entity_profile_version.entity_profile_version__ck__c5525eaf (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "entity_profile_version" where (("pay_methods" is null or store_json_valid("pay_methods", ''{"fields":{"benefit_exclusion":{"default":"POOLED","help":"How a benefit paid past its own tax-free limit is taxed. Pooled: the excess joins the yearly exclusion for bonuses and benefits. Excess taxed: it is taxed on the payslip of the month it is paid. The year’s last payslip settles either way, so only the month the tax is withheld changes. Only the Philippines’ rows read it; it changes nothing in other countries.","kind":"enum","label":"Benefits over their tax-free limit","values":["POOLED","EXCESS_TAXED"]},"contribution_split":{"default":"EVEN","help":"How a month’s contributions fall on the two payslips of a twice-monthly group. Even: half on each. First run: the whole month on the first payslip, on an estimate, and the second settles the month’s actual wages. Only the Philippines’ rows read it; it changes nothing in other countries.","kind":"enum","label":"Contributions over two runs a month","values":["EVEN","FIRST_RUN"]},"night_differential_basis":{"default":"WORKED","help":"Which hours earn the night premium. Worked: the hours worked inside the night window. Clock span: every clocked hour in the window, unpaid breaks and overtime included, at the ordinary hour rate. Whole night: a worked night shift earns eight full hours of premium at the day’s rate. It changes the night premium line of a payslip. Only the Philippines’ rows read it; it changes nothing in other countries.","kind":"enum","label":"Night premium hours","values":["WORKED","CLOCK_SPAN","WHOLE_NIGHT"]},"overtime_hour_basis":{"default":"STATUTORY","help":"What one overtime hour is priced on. Statutory: the hour rate the law works out. Contract weekly: the monthly wage × 12 ÷ (52 × the contract''''s weekly hours). It changes the overtime lines of a payslip.","kind":"enum","label":"Overtime hour rate","values":["STATUTORY","CONTRACT_WEEKLY"]},"rest_day_hourly_multiplier":{"help":"Every hour worked on a rest day pays this multiple of the hour rate. Leave empty to pay what the law pays. It changes the rest-day work lines of a payslip.","kind":"number","label":"Rest-day hour multiple","min":1,"optional":true}},"help":"The employer''''s own pay methods. Each applies only where it pays at least the law; otherwise the law stands.","kind":"object","optional":true}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'entity_profile_version__ck__c5525eaf refuses % existing row(s)', n; end if;
end $store$;
alter table "entity_profile_version" add constraint "entity_profile_version__ck__c5525eaf" check (("pay_methods" is null or store_json_valid("pay_methods", '{"fields":{"benefit_exclusion":{"default":"POOLED","help":"How a benefit paid past its own tax-free limit is taxed. Pooled: the excess joins the yearly exclusion for bonuses and benefits. Excess taxed: it is taxed on the payslip of the month it is paid. The year’s last payslip settles either way, so only the month the tax is withheld changes. Only the Philippines’ rows read it; it changes nothing in other countries.","kind":"enum","label":"Benefits over their tax-free limit","values":["POOLED","EXCESS_TAXED"]},"contribution_split":{"default":"EVEN","help":"How a month’s contributions fall on the two payslips of a twice-monthly group. Even: half on each. First run: the whole month on the first payslip, on an estimate, and the second settles the month’s actual wages. Only the Philippines’ rows read it; it changes nothing in other countries.","kind":"enum","label":"Contributions over two runs a month","values":["EVEN","FIRST_RUN"]},"night_differential_basis":{"default":"WORKED","help":"Which hours earn the night premium. Worked: the hours worked inside the night window. Clock span: every clocked hour in the window, unpaid breaks and overtime included, at the ordinary hour rate. Whole night: a worked night shift earns eight full hours of premium at the day’s rate. It changes the night premium line of a payslip. Only the Philippines’ rows read it; it changes nothing in other countries.","kind":"enum","label":"Night premium hours","values":["WORKED","CLOCK_SPAN","WHOLE_NIGHT"]},"overtime_hour_basis":{"default":"STATUTORY","help":"What one overtime hour is priced on. Statutory: the hour rate the law works out. Contract weekly: the monthly wage × 12 ÷ (52 × the contract''s weekly hours). It changes the overtime lines of a payslip.","kind":"enum","label":"Overtime hour rate","values":["STATUTORY","CONTRACT_WEEKLY"]},"rest_day_hourly_multiplier":{"help":"Every hour worked on a rest day pays this multiple of the hour rate. Leave empty to pay what the law pays. It changes the rest-day work lines of a payslip.","kind":"number","label":"Rest-day hour multiple","min":1,"optional":true}},"help":"The employer''s own pay methods. Each applies only where it pays at least the law; otherwise the law stands.","kind":"object","optional":true}'::jsonb) is true));

-- step create:constraint:registered_effect.registered_effect__ck__a5d539d9 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "registered_effect" where (not jsonb_path_exists(to_jsonb("events"), ''strict $[*] ? (@.type() != "string")'') and "events" <@ array[''create'', ''update'', ''delete'', ''seal'', ''exit'']::text[]) is false' into n;
	if n > 0 then raise exception 'registered_effect__ck__a5d539d9 refuses % existing row(s)', n; end if;
end $store$;
alter table "registered_effect" add constraint "registered_effect__ck__a5d539d9" check (not jsonb_path_exists(to_jsonb("events"), 'strict $[*] ? (@.type() != "string")') and "events" <@ array['create', 'update', 'delete', 'seal', 'exit']::text[]);

-- step create:constraint:registered_rule.registered_rule__ck__8da0789d (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "registered_rule" where (not jsonb_path_exists(to_jsonb("events"), ''strict $[*] ? (@.type() != "string")'') and "events" <@ array[''create'', ''update'', ''delete'']::text[]) is false' into n;
	if n > 0 then raise exception 'registered_rule__ck__8da0789d refuses % existing row(s)', n; end if;
end $store$;
alter table "registered_rule" add constraint "registered_rule__ck__8da0789d" check (not jsonb_path_exists(to_jsonb("events"), 'strict $[*] ? (@.type() != "string")') and "events" <@ array['create', 'update', 'delete']::text[]);

-- step replace:trigger:employee_profile.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "employee_profile" for each row execute function store_row_rules('{"audit":true,"fields":{"address":["address"],"cumulative_service":["cumulative_service"],"documents":["documents"],"email":["email"],"face_consent_at":["face_consent_at"],"face_embedding":["face_embedding"],"face_enrolled_at":["face_enrolled_at"],"face_enrollment_status":["face_enrollment_status"],"face_photo":["face_photo"],"invitation_id":["invitation_id"],"location":["location"],"name":["name"],"phone":["phone"],"source_reference":["source_reference"],"user_id":["user_id"]},"key":["id"],"parents":[],"states":{}}');

-- step replace:trigger:employee_contract.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "employee_contract" for each row execute function store_row_rules('{"audit":true,"fields":{"bank":["bank"],"effective_range":["effective_range"],"employee_extension_data":["employee_extension_data"],"employee_id":["employee_id"],"employee_number":["employee_number"],"engagement":["engagement"],"entity_id":["entity_id"],"events":["events"],"exit_ground":["exit_ground"],"family":["family"],"final_pay_due_on":["final_pay_due_on"],"pay_group_id":["pay_group_id"],"payroll":["payroll"],"reason":["reason"],"service_started_on":["service_started_on"],"signed_contract_period":["signed_contract_period"],"status":["status"],"terms":["terms"]},"key":["id"],"parents":[],"states":{"status":{"initial":"DRAFT","states":{"DRAFT":{"edit":"all","to":["SEALED"]},"SEALED":{"edit":["effective_range","final_pay_due_on","reason","exit_ground","employee_extension_data"],"to":["VOID"]},"VOID":{"edit":"none","to":[]}}}}}');

-- step replace:trigger:loan_catalog.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "loan_catalog" for each row execute function store_row_rules('{"audit":true,"fields":{"code":["code"],"description":["description"],"eligibility":["eligibility"],"lookup":["lookup"],"references":["references"],"settings_id":["settings_id"],"subtotal_id":["subtotal_id"]},"key":["id"],"parents":[{"column":"settings_id","key":"id","relation":"loan_catalog","states":{"status":{"initial":"DRAFT","states":{"DRAFT":{"edit":"all","to":["SEALED","VOID"]},"SEALED":{"edit":["effective_range","reason"],"to":["VOID"]},"VOID":{"edit":"none","to":[]}}}},"table":"jurisdiction_settings","type":"uuid"}],"states":{}}');

-- step replace:trigger:work_event_catalog.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "work_event_catalog" for each row execute function store_row_rules('{"audit":true,"fields":{"code":["code"],"description":["description"],"lookup":["lookup"],"references":["references"],"settings_id":["settings_id"],"subtotal_id":["subtotal_id"]},"key":["id"],"parents":[{"column":"settings_id","key":"id","relation":"work_event_catalog","states":{"status":{"initial":"DRAFT","states":{"DRAFT":{"edit":"all","to":["SEALED","VOID"]},"SEALED":{"edit":["effective_range","reason"],"to":["VOID"]},"VOID":{"edit":"none","to":[]}}}},"table":"jurisdiction_settings","type":"uuid"}],"states":{}}');

-- step replace:trigger:obligation.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "obligation" for each row execute function store_row_rules('{"audit":true,"fields":{"due_on":["due_on"],"employee_id":["employee_id"],"employment_id":["employment_id"],"entity_id":["entity_id"],"evidence":["evidence"],"fulfilled_on":["fulfilled_on"],"occurrence_key":["occurrence_key"],"state":["state"],"title":["title"],"waiver_reason":["waiver_reason"]},"key":["id"],"parents":[],"states":{"state":{"initial":"OPEN","states":{"FULFILLED":{"edit":"none","to":[]},"OPEN":{"edit":["title","due_on","fulfilled_on","evidence","waiver_reason","state"],"to":["FULFILLED","WAIVED"]},"WAIVED":{"edit":["waiver_reason","state"],"to":["OPEN"]}}}}}');

-- step replace:trigger:payslip.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "payslip" for each row execute function store_row_rules('{"audit":true,"fields":{"basic_earnings":["basic_earnings"],"breakdown":["breakdown"],"employee_id":["employee_id"],"employee_statutory":["employee_statutory"],"employer_cost":["employer_cost"],"employment_id":["employment_id"],"entity_id":["entity_id"],"gross_earnings":["gross_earnings"],"net_pay":["net_pay"],"ordinary_wages":["ordinary_wages"],"payroll_run_id":["payroll_run_id"],"period":["period"],"settings_id":["settings_id"],"tax_withheld":["tax_withheld"],"total_deductions":["total_deductions"]},"key":["id"],"parents":[],"states":{}}');
