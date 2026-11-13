-- 0003_runtime_functions.sql: runtime functions and triggers this Bolt release changed.

drop trigger if exists "store_row_rules" on "adhoc_catalog";

create trigger store_row_rules before insert or update or delete on "adhoc_catalog" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_statement_rules_delete" on "adhoc_catalog";

create trigger store_statement_rules_delete after delete on "adhoc_catalog" referencing old table as store_old for each statement execute function store_statement_rules('{"fields":{"code":["code"],"conversion":["conversion"],"description":["description"],"direction":["direction"],"eligibility":["eligibility"],"lookup":["lookup"],"off_cycle_eligible":["off_cycle_eligible"],"party":["party"],"references":["references"],"settings_id":["settings_id"],"subtotal_id":["subtotal_id"]},"key":["id"],"locks":[],"parents":[{"column":"settings_id","key":"id","locks":[{"constraint":"jurisdiction_settings__lock__f51311df","except":["effective_range","reason","status"],"name":"sealed_version","sql":"(coalesce(t.\"status\" = ''SEALED''::text, false))"},{"constraint":"jurisdiction_settings__lock__f8268056","except":[],"name":"void_version","sql":"(coalesce(t.\"status\" = ''VOID''::text, false))"}],"relation":"adhoc_catalog","table":"jurisdiction_settings","type":"uuid"}],"states":{}}');

drop trigger if exists "store_statement_rules_insert" on "adhoc_catalog";

create trigger store_statement_rules_insert after insert on "adhoc_catalog" referencing new table as store_new for each statement execute function store_statement_rules('{"fields":{"code":["code"],"conversion":["conversion"],"description":["description"],"direction":["direction"],"eligibility":["eligibility"],"lookup":["lookup"],"off_cycle_eligible":["off_cycle_eligible"],"party":["party"],"references":["references"],"settings_id":["settings_id"],"subtotal_id":["subtotal_id"]},"key":["id"],"locks":[],"parents":[{"column":"settings_id","key":"id","locks":[{"constraint":"jurisdiction_settings__lock__f51311df","except":["effective_range","reason","status"],"name":"sealed_version","sql":"(coalesce(t.\"status\" = ''SEALED''::text, false))"},{"constraint":"jurisdiction_settings__lock__f8268056","except":[],"name":"void_version","sql":"(coalesce(t.\"status\" = ''VOID''::text, false))"}],"relation":"adhoc_catalog","table":"jurisdiction_settings","type":"uuid"}],"states":{}}');

drop trigger if exists "store_statement_rules_update" on "adhoc_catalog";

create trigger store_statement_rules_update after update on "adhoc_catalog" referencing old table as store_old new table as store_new for each statement execute function store_statement_rules('{"fields":{"code":["code"],"conversion":["conversion"],"description":["description"],"direction":["direction"],"eligibility":["eligibility"],"lookup":["lookup"],"off_cycle_eligible":["off_cycle_eligible"],"party":["party"],"references":["references"],"settings_id":["settings_id"],"subtotal_id":["subtotal_id"]},"key":["id"],"locks":[],"parents":[{"column":"settings_id","key":"id","locks":[{"constraint":"jurisdiction_settings__lock__f51311df","except":["effective_range","reason","status"],"name":"sealed_version","sql":"(coalesce(t.\"status\" = ''SEALED''::text, false))"},{"constraint":"jurisdiction_settings__lock__f8268056","except":[],"name":"void_version","sql":"(coalesce(t.\"status\" = ''VOID''::text, false))"}],"relation":"adhoc_catalog","table":"jurisdiction_settings","type":"uuid"}],"states":{}}');

drop trigger if exists "store_row_rules" on "adhoc_catalog_entry";

create trigger store_row_rules before insert or update or delete on "adhoc_catalog_entry" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "allowance_catalog";

create trigger store_row_rules before insert or update or delete on "allowance_catalog" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_statement_rules_delete" on "allowance_catalog";

create trigger store_statement_rules_delete after delete on "allowance_catalog" referencing old table as store_old for each statement execute function store_statement_rules('{"fields":{"code":["code"],"conversion":["conversion"],"description":["description"],"eligibility":["eligibility"],"include_in_rate":["include_in_rate"],"lookup":["lookup"],"references":["references"],"settings_id":["settings_id"],"subtotal_id":["subtotal_id"]},"key":["id"],"locks":[],"parents":[{"column":"settings_id","key":"id","locks":[{"constraint":"jurisdiction_settings__lock__f51311df","except":["effective_range","reason","status"],"name":"sealed_version","sql":"(coalesce(t.\"status\" = ''SEALED''::text, false))"},{"constraint":"jurisdiction_settings__lock__f8268056","except":[],"name":"void_version","sql":"(coalesce(t.\"status\" = ''VOID''::text, false))"}],"relation":"allowance_catalog","table":"jurisdiction_settings","type":"uuid"}],"states":{}}');

drop trigger if exists "store_statement_rules_insert" on "allowance_catalog";

create trigger store_statement_rules_insert after insert on "allowance_catalog" referencing new table as store_new for each statement execute function store_statement_rules('{"fields":{"code":["code"],"conversion":["conversion"],"description":["description"],"eligibility":["eligibility"],"include_in_rate":["include_in_rate"],"lookup":["lookup"],"references":["references"],"settings_id":["settings_id"],"subtotal_id":["subtotal_id"]},"key":["id"],"locks":[],"parents":[{"column":"settings_id","key":"id","locks":[{"constraint":"jurisdiction_settings__lock__f51311df","except":["effective_range","reason","status"],"name":"sealed_version","sql":"(coalesce(t.\"status\" = ''SEALED''::text, false))"},{"constraint":"jurisdiction_settings__lock__f8268056","except":[],"name":"void_version","sql":"(coalesce(t.\"status\" = ''VOID''::text, false))"}],"relation":"allowance_catalog","table":"jurisdiction_settings","type":"uuid"}],"states":{}}');

drop trigger if exists "store_statement_rules_update" on "allowance_catalog";

create trigger store_statement_rules_update after update on "allowance_catalog" referencing old table as store_old new table as store_new for each statement execute function store_statement_rules('{"fields":{"code":["code"],"conversion":["conversion"],"description":["description"],"eligibility":["eligibility"],"include_in_rate":["include_in_rate"],"lookup":["lookup"],"references":["references"],"settings_id":["settings_id"],"subtotal_id":["subtotal_id"]},"key":["id"],"locks":[],"parents":[{"column":"settings_id","key":"id","locks":[{"constraint":"jurisdiction_settings__lock__f51311df","except":["effective_range","reason","status"],"name":"sealed_version","sql":"(coalesce(t.\"status\" = ''SEALED''::text, false))"},{"constraint":"jurisdiction_settings__lock__f8268056","except":[],"name":"void_version","sql":"(coalesce(t.\"status\" = ''VOID''::text, false))"}],"relation":"allowance_catalog","table":"jurisdiction_settings","type":"uuid"}],"states":{}}');

drop trigger if exists "store_row_rules" on "approval_request";

create trigger store_row_rules before insert or update or delete on "approval_request" for each row execute function store_row_rules('{"audit":false,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "claim_catalog";

create trigger store_row_rules before insert or update or delete on "claim_catalog" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_statement_rules_delete" on "claim_catalog";

create trigger store_statement_rules_delete after delete on "claim_catalog" referencing old table as store_old for each statement execute function store_statement_rules('{"fields":{"code":["code"],"conversion":["conversion"],"description":["description"],"eligibility":["eligibility"],"lookup":["lookup"],"references":["references"],"settings_id":["settings_id"],"subtotal_id":["subtotal_id"]},"key":["id"],"locks":[],"parents":[{"column":"settings_id","key":"id","locks":[{"constraint":"jurisdiction_settings__lock__f51311df","except":["effective_range","reason","status"],"name":"sealed_version","sql":"(coalesce(t.\"status\" = ''SEALED''::text, false))"},{"constraint":"jurisdiction_settings__lock__f8268056","except":[],"name":"void_version","sql":"(coalesce(t.\"status\" = ''VOID''::text, false))"}],"relation":"claim_catalog","table":"jurisdiction_settings","type":"uuid"}],"states":{}}');

drop trigger if exists "store_statement_rules_insert" on "claim_catalog";

create trigger store_statement_rules_insert after insert on "claim_catalog" referencing new table as store_new for each statement execute function store_statement_rules('{"fields":{"code":["code"],"conversion":["conversion"],"description":["description"],"eligibility":["eligibility"],"lookup":["lookup"],"references":["references"],"settings_id":["settings_id"],"subtotal_id":["subtotal_id"]},"key":["id"],"locks":[],"parents":[{"column":"settings_id","key":"id","locks":[{"constraint":"jurisdiction_settings__lock__f51311df","except":["effective_range","reason","status"],"name":"sealed_version","sql":"(coalesce(t.\"status\" = ''SEALED''::text, false))"},{"constraint":"jurisdiction_settings__lock__f8268056","except":[],"name":"void_version","sql":"(coalesce(t.\"status\" = ''VOID''::text, false))"}],"relation":"claim_catalog","table":"jurisdiction_settings","type":"uuid"}],"states":{}}');

drop trigger if exists "store_statement_rules_update" on "claim_catalog";

create trigger store_statement_rules_update after update on "claim_catalog" referencing old table as store_old new table as store_new for each statement execute function store_statement_rules('{"fields":{"code":["code"],"conversion":["conversion"],"description":["description"],"eligibility":["eligibility"],"lookup":["lookup"],"references":["references"],"settings_id":["settings_id"],"subtotal_id":["subtotal_id"]},"key":["id"],"locks":[],"parents":[{"column":"settings_id","key":"id","locks":[{"constraint":"jurisdiction_settings__lock__f51311df","except":["effective_range","reason","status"],"name":"sealed_version","sql":"(coalesce(t.\"status\" = ''SEALED''::text, false))"},{"constraint":"jurisdiction_settings__lock__f8268056","except":[],"name":"void_version","sql":"(coalesce(t.\"status\" = ''VOID''::text, false))"}],"relation":"claim_catalog","table":"jurisdiction_settings","type":"uuid"}],"states":{}}');

drop trigger if exists "store_row_rules" on "claim_catalog_entry";

create trigger store_row_rules before insert or update or delete on "claim_catalog_entry" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "contract_change";

create trigger store_row_rules before insert or update or delete on "contract_change" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_statement_rules_delete" on "contract_change";

create trigger store_statement_rules_delete after delete on "contract_change" referencing old table as store_old for each statement execute function store_statement_rules('{"fields":{"applied_version_id":["applied_version_id"],"effective_from":["effective_from"],"employee_id":["employee_id"],"field_path":["field_path"],"new_value":["new_value"],"notes":["notes"],"old_value":["old_value"]},"key":["id"],"locks":[{"constraint":"contract_change__lock__bc6de06d","except":[],"name":"applied_change","sql":"(t.\"applied_version_id\" is not null)"}],"parents":[],"states":{}}');

drop trigger if exists "store_statement_rules_update" on "contract_change";

create trigger store_statement_rules_update after update on "contract_change" referencing old table as store_old new table as store_new for each statement execute function store_statement_rules('{"fields":{"applied_version_id":["applied_version_id"],"effective_from":["effective_from"],"employee_id":["employee_id"],"field_path":["field_path"],"new_value":["new_value"],"notes":["notes"],"old_value":["old_value"]},"key":["id"],"locks":[{"constraint":"contract_change__lock__bc6de06d","except":[],"name":"applied_change","sql":"(t.\"applied_version_id\" is not null)"}],"parents":[],"states":{}}');

drop trigger if exists "store_row_rules" on "employee_balance";

create trigger store_row_rules before insert or update or delete on "employee_balance" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "employee_contract";

create trigger store_row_rules before insert or update or delete on "employee_contract" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{"status":{"initial":"DRAFT","states":{"DRAFT":{"to":["SEALED"]},"SEALED":{"to":["VOID"]},"VOID":{"to":[]}}}}}');

drop trigger if exists "store_statement_rules_delete" on "employee_contract";

create trigger store_statement_rules_delete after delete on "employee_contract" referencing old table as store_old for each statement execute function store_statement_rules('{"fields":{"bank":["bank"],"effective_range":["effective_range"],"employee_extension_data":["employee_extension_data"],"employee_id":["employee_id"],"employee_number":["employee_number"],"encash_leave":["encash_leave"],"engagement":["engagement"],"entity_id":["entity_id"],"events":["events"],"exit_ground":["exit_ground"],"family":["family"],"final_pay_due_on":["final_pay_due_on"],"pay_group_id":["pay_group_id"],"payroll":["payroll"],"reason":["reason"],"service_started_on":["service_started_on"],"signed_contract_period":["signed_contract_period"],"status":["status"],"terms":["terms"]},"key":["id"],"locks":[{"constraint":"employee_contract__lock__f51311df","except":["effective_range","final_pay_due_on","reason","exit_ground","encash_leave","employee_extension_data","status"],"name":"sealed_version","sql":"(coalesce(t.\"status\" = ''SEALED''::text, false))"},{"constraint":"employee_contract__lock__f8268056","except":[],"name":"void_version","sql":"(coalesce(t.\"status\" = ''VOID''::text, false))"}],"parents":[],"states":{"status":{"initial":"DRAFT","states":{"DRAFT":{"to":["SEALED"]},"SEALED":{"to":["VOID"]},"VOID":{"to":[]}}}}}');

drop trigger if exists "store_statement_rules_update" on "employee_contract";

create trigger store_statement_rules_update after update on "employee_contract" referencing old table as store_old new table as store_new for each statement execute function store_statement_rules('{"fields":{"bank":["bank"],"effective_range":["effective_range"],"employee_extension_data":["employee_extension_data"],"employee_id":["employee_id"],"employee_number":["employee_number"],"encash_leave":["encash_leave"],"engagement":["engagement"],"entity_id":["entity_id"],"events":["events"],"exit_ground":["exit_ground"],"family":["family"],"final_pay_due_on":["final_pay_due_on"],"pay_group_id":["pay_group_id"],"payroll":["payroll"],"reason":["reason"],"service_started_on":["service_started_on"],"signed_contract_period":["signed_contract_period"],"status":["status"],"terms":["terms"]},"key":["id"],"locks":[{"constraint":"employee_contract__lock__f51311df","except":["effective_range","final_pay_due_on","reason","exit_ground","encash_leave","employee_extension_data","status"],"name":"sealed_version","sql":"(coalesce(t.\"status\" = ''SEALED''::text, false))"},{"constraint":"employee_contract__lock__f8268056","except":[],"name":"void_version","sql":"(coalesce(t.\"status\" = ''VOID''::text, false))"}],"parents":[],"states":{"status":{"initial":"DRAFT","states":{"DRAFT":{"to":["SEALED"]},"SEALED":{"to":["VOID"]},"VOID":{"to":[]}}}}}');

drop trigger if exists "store_row_rules" on "employee_profile";

create trigger store_row_rules before insert or update or delete on "employee_profile" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "entity";

create trigger store_row_rules before insert or update or delete on "entity" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "entity_change";

create trigger store_row_rules before insert or update or delete on "entity_change" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_statement_rules_delete" on "entity_change";

create trigger store_statement_rules_delete after delete on "entity_change" referencing old table as store_old for each statement execute function store_statement_rules('{"fields":{"applied_version_id":["applied_version_id"],"effective_from":["effective_from"],"entity_id":["entity_id"],"field_path":["field_path"],"new_value":["new_value"],"notes":["notes"],"old_value":["old_value"]},"key":["id"],"locks":[{"constraint":"entity_change__lock__bc6de06d","except":[],"name":"applied_change","sql":"(t.\"applied_version_id\" is not null)"}],"parents":[],"states":{}}');

drop trigger if exists "store_statement_rules_update" on "entity_change";

create trigger store_statement_rules_update after update on "entity_change" referencing old table as store_old new table as store_new for each statement execute function store_statement_rules('{"fields":{"applied_version_id":["applied_version_id"],"effective_from":["effective_from"],"entity_id":["entity_id"],"field_path":["field_path"],"new_value":["new_value"],"notes":["notes"],"old_value":["old_value"]},"key":["id"],"locks":[{"constraint":"entity_change__lock__bc6de06d","except":[],"name":"applied_change","sql":"(t.\"applied_version_id\" is not null)"}],"parents":[],"states":{}}');

drop trigger if exists "store_row_rules" on "entity_profile_version";

create trigger store_row_rules before insert or update or delete on "entity_profile_version" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{"status":{"initial":"DRAFT","states":{"DRAFT":{"to":["SEALED"]},"SEALED":{"to":["VOID"]},"VOID":{"to":[]}}}}}');

drop trigger if exists "store_statement_rules_delete" on "entity_profile_version";

create trigger store_statement_rules_delete after delete on "entity_profile_version" referencing old table as store_old for each statement execute function store_statement_rules('{"fields":{"bank":["bank"],"effective_range":["effective_range"],"entity_extension_data":["entity_extension_data"],"entity_id":["entity_id"],"final_pay_loan_floor_percent":["final_pay_loan_floor_percent"],"input_schema_version_id":["input_schema_version_id"],"name":["name"],"overtime_full_award_percent":["overtime_full_award_percent"],"pay_methods":["pay_methods"],"reason":["reason"],"registered_address":["registered_address"],"representative_name":["representative_name"],"settings_code":["settings_code"],"status":["status"],"time_zone":["time_zone"]},"key":["id"],"locks":[{"constraint":"entity_profile_version__lock__f51311df","except":["effective_range","reason","status"],"name":"sealed_version","sql":"(coalesce(t.\"status\" = ''SEALED''::text, false))"},{"constraint":"entity_profile_version__lock__f8268056","except":[],"name":"void_version","sql":"(coalesce(t.\"status\" = ''VOID''::text, false))"}],"parents":[],"states":{"status":{"initial":"DRAFT","states":{"DRAFT":{"to":["SEALED"]},"SEALED":{"to":["VOID"]},"VOID":{"to":[]}}}}}');

drop trigger if exists "store_statement_rules_update" on "entity_profile_version";

create trigger store_statement_rules_update after update on "entity_profile_version" referencing old table as store_old new table as store_new for each statement execute function store_statement_rules('{"fields":{"bank":["bank"],"effective_range":["effective_range"],"entity_extension_data":["entity_extension_data"],"entity_id":["entity_id"],"final_pay_loan_floor_percent":["final_pay_loan_floor_percent"],"input_schema_version_id":["input_schema_version_id"],"name":["name"],"overtime_full_award_percent":["overtime_full_award_percent"],"pay_methods":["pay_methods"],"reason":["reason"],"registered_address":["registered_address"],"representative_name":["representative_name"],"settings_code":["settings_code"],"status":["status"],"time_zone":["time_zone"]},"key":["id"],"locks":[{"constraint":"entity_profile_version__lock__f51311df","except":["effective_range","reason","status"],"name":"sealed_version","sql":"(coalesce(t.\"status\" = ''SEALED''::text, false))"},{"constraint":"entity_profile_version__lock__f8268056","except":[],"name":"void_version","sql":"(coalesce(t.\"status\" = ''VOID''::text, false))"}],"parents":[],"states":{"status":{"initial":"DRAFT","states":{"DRAFT":{"to":["SEALED"]},"SEALED":{"to":["VOID"]},"VOID":{"to":[]}}}}}');

drop trigger if exists "store_row_rules" on "holiday";

create trigger store_row_rules before insert or update or delete on "holiday" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "jurisdiction_settings";

create trigger store_row_rules before insert or update or delete on "jurisdiction_settings" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{"status":{"initial":"DRAFT","states":{"DRAFT":{"to":["SEALED","VOID"]},"SEALED":{"to":["VOID"]},"VOID":{"to":[]}}}}}');

drop trigger if exists "store_statement_rules_delete" on "jurisdiction_settings";

create trigger store_statement_rules_delete after delete on "jurisdiction_settings" referencing old table as store_old for each statement execute function store_statement_rules('{"fields":{"code":["code"],"conversions":["conversions"],"currency":["currency"],"effective_range":["effective_range"],"employee_extension_schema":["employee_extension_schema"],"entity_extension_schema":["entity_extension_schema"],"ledger":["ledger"],"lookup":["lookup"],"name":["name"],"reason":["reason"],"status":["status"],"tax_year_start_month":["tax_year_start_month"],"timezone":["timezone"],"work_regions":["work_regions"]},"key":["id"],"locks":[{"constraint":"jurisdiction_settings__lock__f51311df","except":["effective_range","reason","status"],"name":"sealed_version","sql":"(coalesce(t.\"status\" = ''SEALED''::text, false))"},{"constraint":"jurisdiction_settings__lock__f8268056","except":[],"name":"void_version","sql":"(coalesce(t.\"status\" = ''VOID''::text, false))"}],"parents":[],"states":{"status":{"initial":"DRAFT","states":{"DRAFT":{"to":["SEALED","VOID"]},"SEALED":{"to":["VOID"]},"VOID":{"to":[]}}}}}');

drop trigger if exists "store_statement_rules_update" on "jurisdiction_settings";

create trigger store_statement_rules_update after update on "jurisdiction_settings" referencing old table as store_old new table as store_new for each statement execute function store_statement_rules('{"fields":{"code":["code"],"conversions":["conversions"],"currency":["currency"],"effective_range":["effective_range"],"employee_extension_schema":["employee_extension_schema"],"entity_extension_schema":["entity_extension_schema"],"ledger":["ledger"],"lookup":["lookup"],"name":["name"],"reason":["reason"],"status":["status"],"tax_year_start_month":["tax_year_start_month"],"timezone":["timezone"],"work_regions":["work_regions"]},"key":["id"],"locks":[{"constraint":"jurisdiction_settings__lock__f51311df","except":["effective_range","reason","status"],"name":"sealed_version","sql":"(coalesce(t.\"status\" = ''SEALED''::text, false))"},{"constraint":"jurisdiction_settings__lock__f8268056","except":[],"name":"void_version","sql":"(coalesce(t.\"status\" = ''VOID''::text, false))"}],"parents":[],"states":{"status":{"initial":"DRAFT","states":{"DRAFT":{"to":["SEALED","VOID"]},"SEALED":{"to":["VOID"]},"VOID":{"to":[]}}}}}');

drop trigger if exists "store_row_rules" on "leave_catalog";

create trigger store_row_rules before insert or update or delete on "leave_catalog" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_statement_rules_delete" on "leave_catalog";

create trigger store_statement_rules_delete after delete on "leave_catalog" referencing old table as store_old for each statement execute function store_statement_rules('{"fields":{"code":["code"],"description":["description"],"eligibility":["eligibility"],"lookup":["lookup"],"paid_share":["paid_share"],"payout":["payout"],"references":["references"],"settings_id":["settings_id"],"subtotal_id":["subtotal_id"]},"key":["id"],"locks":[],"parents":[{"column":"settings_id","key":"id","locks":[{"constraint":"jurisdiction_settings__lock__f51311df","except":["effective_range","reason","status"],"name":"sealed_version","sql":"(coalesce(t.\"status\" = ''SEALED''::text, false))"},{"constraint":"jurisdiction_settings__lock__f8268056","except":[],"name":"void_version","sql":"(coalesce(t.\"status\" = ''VOID''::text, false))"}],"relation":"leave_catalog","table":"jurisdiction_settings","type":"uuid"}],"states":{}}');

drop trigger if exists "store_statement_rules_insert" on "leave_catalog";

create trigger store_statement_rules_insert after insert on "leave_catalog" referencing new table as store_new for each statement execute function store_statement_rules('{"fields":{"code":["code"],"description":["description"],"eligibility":["eligibility"],"lookup":["lookup"],"paid_share":["paid_share"],"payout":["payout"],"references":["references"],"settings_id":["settings_id"],"subtotal_id":["subtotal_id"]},"key":["id"],"locks":[],"parents":[{"column":"settings_id","key":"id","locks":[{"constraint":"jurisdiction_settings__lock__f51311df","except":["effective_range","reason","status"],"name":"sealed_version","sql":"(coalesce(t.\"status\" = ''SEALED''::text, false))"},{"constraint":"jurisdiction_settings__lock__f8268056","except":[],"name":"void_version","sql":"(coalesce(t.\"status\" = ''VOID''::text, false))"}],"relation":"leave_catalog","table":"jurisdiction_settings","type":"uuid"}],"states":{}}');

drop trigger if exists "store_statement_rules_update" on "leave_catalog";

create trigger store_statement_rules_update after update on "leave_catalog" referencing old table as store_old new table as store_new for each statement execute function store_statement_rules('{"fields":{"code":["code"],"description":["description"],"eligibility":["eligibility"],"lookup":["lookup"],"paid_share":["paid_share"],"payout":["payout"],"references":["references"],"settings_id":["settings_id"],"subtotal_id":["subtotal_id"]},"key":["id"],"locks":[],"parents":[{"column":"settings_id","key":"id","locks":[{"constraint":"jurisdiction_settings__lock__f51311df","except":["effective_range","reason","status"],"name":"sealed_version","sql":"(coalesce(t.\"status\" = ''SEALED''::text, false))"},{"constraint":"jurisdiction_settings__lock__f8268056","except":[],"name":"void_version","sql":"(coalesce(t.\"status\" = ''VOID''::text, false))"}],"relation":"leave_catalog","table":"jurisdiction_settings","type":"uuid"}],"states":{}}');

drop trigger if exists "store_row_rules" on "leave_catalog_entry";

create trigger store_row_rules before insert or update or delete on "leave_catalog_entry" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "leave_catalog_entry_day";

create trigger store_row_rules before insert or update or delete on "leave_catalog_entry_day" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "ledger_entry";

create trigger store_row_rules before insert or update or delete on "ledger_entry" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "loan_catalog";

create trigger store_row_rules before insert or update or delete on "loan_catalog" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_statement_rules_delete" on "loan_catalog";

create trigger store_statement_rules_delete after delete on "loan_catalog" referencing old table as store_old for each statement execute function store_statement_rules('{"fields":{"code":["code"],"description":["description"],"eligibility":["eligibility"],"lookup":["lookup"],"references":["references"],"settings_id":["settings_id"],"subtotal_id":["subtotal_id"]},"key":["id"],"locks":[],"parents":[{"column":"settings_id","key":"id","locks":[{"constraint":"jurisdiction_settings__lock__f51311df","except":["effective_range","reason","status"],"name":"sealed_version","sql":"(coalesce(t.\"status\" = ''SEALED''::text, false))"},{"constraint":"jurisdiction_settings__lock__f8268056","except":[],"name":"void_version","sql":"(coalesce(t.\"status\" = ''VOID''::text, false))"}],"relation":"loan_catalog","table":"jurisdiction_settings","type":"uuid"}],"states":{}}');

drop trigger if exists "store_statement_rules_insert" on "loan_catalog";

create trigger store_statement_rules_insert after insert on "loan_catalog" referencing new table as store_new for each statement execute function store_statement_rules('{"fields":{"code":["code"],"description":["description"],"eligibility":["eligibility"],"lookup":["lookup"],"references":["references"],"settings_id":["settings_id"],"subtotal_id":["subtotal_id"]},"key":["id"],"locks":[],"parents":[{"column":"settings_id","key":"id","locks":[{"constraint":"jurisdiction_settings__lock__f51311df","except":["effective_range","reason","status"],"name":"sealed_version","sql":"(coalesce(t.\"status\" = ''SEALED''::text, false))"},{"constraint":"jurisdiction_settings__lock__f8268056","except":[],"name":"void_version","sql":"(coalesce(t.\"status\" = ''VOID''::text, false))"}],"relation":"loan_catalog","table":"jurisdiction_settings","type":"uuid"}],"states":{}}');

drop trigger if exists "store_statement_rules_update" on "loan_catalog";

create trigger store_statement_rules_update after update on "loan_catalog" referencing old table as store_old new table as store_new for each statement execute function store_statement_rules('{"fields":{"code":["code"],"description":["description"],"eligibility":["eligibility"],"lookup":["lookup"],"references":["references"],"settings_id":["settings_id"],"subtotal_id":["subtotal_id"]},"key":["id"],"locks":[],"parents":[{"column":"settings_id","key":"id","locks":[{"constraint":"jurisdiction_settings__lock__f51311df","except":["effective_range","reason","status"],"name":"sealed_version","sql":"(coalesce(t.\"status\" = ''SEALED''::text, false))"},{"constraint":"jurisdiction_settings__lock__f8268056","except":[],"name":"void_version","sql":"(coalesce(t.\"status\" = ''VOID''::text, false))"}],"relation":"loan_catalog","table":"jurisdiction_settings","type":"uuid"}],"states":{}}');

drop trigger if exists "store_row_rules" on "loan_catalog_entry";

create trigger store_row_rules before insert or update or delete on "loan_catalog_entry" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "loan_catalog_entry_repayment";

create trigger store_row_rules before insert or update or delete on "loan_catalog_entry_repayment" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "obligation";

create trigger store_row_rules before insert or update or delete on "obligation" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{"state":{"initial":"OPEN","states":{"FULFILLED":{"to":[]},"OPEN":{"to":["FULFILLED","WAIVED"]},"WAIVED":{"to":["OPEN"]}}}}}');

drop trigger if exists "store_statement_rules_delete" on "obligation";

create trigger store_statement_rules_delete after delete on "obligation" referencing old table as store_old for each statement execute function store_statement_rules('{"fields":{"due_on":["due_on"],"employee_id":["employee_id"],"employment_id":["employment_id"],"entity_id":["entity_id"],"evidence":["evidence"],"fulfilled_on":["fulfilled_on"],"occurrence_key":["occurrence_key"],"state":["state"],"title":["title"],"waiver_reason":["waiver_reason"]},"key":["id"],"locks":[{"constraint":"obligation__lock__0b5cd795","except":[],"name":"fulfilled_task","sql":"(coalesce(t.\"state\" = ''FULFILLED''::text, false))"},{"constraint":"obligation__lock__5b17b510","except":["waiver_reason","state"],"name":"waived_task","sql":"(coalesce(t.\"state\" = ''WAIVED''::text, false))"}],"parents":[],"states":{"state":{"initial":"OPEN","states":{"FULFILLED":{"to":[]},"OPEN":{"to":["FULFILLED","WAIVED"]},"WAIVED":{"to":["OPEN"]}}}}}');

drop trigger if exists "store_statement_rules_update" on "obligation";

create trigger store_statement_rules_update after update on "obligation" referencing old table as store_old new table as store_new for each statement execute function store_statement_rules('{"fields":{"due_on":["due_on"],"employee_id":["employee_id"],"employment_id":["employment_id"],"entity_id":["entity_id"],"evidence":["evidence"],"fulfilled_on":["fulfilled_on"],"occurrence_key":["occurrence_key"],"state":["state"],"title":["title"],"waiver_reason":["waiver_reason"]},"key":["id"],"locks":[{"constraint":"obligation__lock__0b5cd795","except":[],"name":"fulfilled_task","sql":"(coalesce(t.\"state\" = ''FULFILLED''::text, false))"},{"constraint":"obligation__lock__5b17b510","except":["waiver_reason","state"],"name":"waived_task","sql":"(coalesce(t.\"state\" = ''WAIVED''::text, false))"}],"parents":[],"states":{"state":{"initial":"OPEN","states":{"FULFILLED":{"to":[]},"OPEN":{"to":["FULFILLED","WAIVED"]},"WAIVED":{"to":["OPEN"]}}}}}');

drop trigger if exists "store_row_rules" on "overtime_catalog";

create trigger store_row_rules before insert or update or delete on "overtime_catalog" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_statement_rules_delete" on "overtime_catalog";

create trigger store_statement_rules_delete after delete on "overtime_catalog" referencing old table as store_old for each statement execute function store_statement_rules('{"fields":{"code":["code"],"conversion":["conversion"],"description":["description"],"direction":["direction"],"eligibility":["eligibility"],"lookup":["lookup"],"references":["references"],"settings_id":["settings_id"],"subtotal_id":["subtotal_id"]},"key":["id"],"locks":[],"parents":[{"column":"settings_id","key":"id","locks":[{"constraint":"jurisdiction_settings__lock__f51311df","except":["effective_range","reason","status"],"name":"sealed_version","sql":"(coalesce(t.\"status\" = ''SEALED''::text, false))"},{"constraint":"jurisdiction_settings__lock__f8268056","except":[],"name":"void_version","sql":"(coalesce(t.\"status\" = ''VOID''::text, false))"}],"relation":"overtime_catalog","table":"jurisdiction_settings","type":"uuid"}],"states":{}}');

drop trigger if exists "store_statement_rules_insert" on "overtime_catalog";

create trigger store_statement_rules_insert after insert on "overtime_catalog" referencing new table as store_new for each statement execute function store_statement_rules('{"fields":{"code":["code"],"conversion":["conversion"],"description":["description"],"direction":["direction"],"eligibility":["eligibility"],"lookup":["lookup"],"references":["references"],"settings_id":["settings_id"],"subtotal_id":["subtotal_id"]},"key":["id"],"locks":[],"parents":[{"column":"settings_id","key":"id","locks":[{"constraint":"jurisdiction_settings__lock__f51311df","except":["effective_range","reason","status"],"name":"sealed_version","sql":"(coalesce(t.\"status\" = ''SEALED''::text, false))"},{"constraint":"jurisdiction_settings__lock__f8268056","except":[],"name":"void_version","sql":"(coalesce(t.\"status\" = ''VOID''::text, false))"}],"relation":"overtime_catalog","table":"jurisdiction_settings","type":"uuid"}],"states":{}}');

drop trigger if exists "store_statement_rules_update" on "overtime_catalog";

create trigger store_statement_rules_update after update on "overtime_catalog" referencing old table as store_old new table as store_new for each statement execute function store_statement_rules('{"fields":{"code":["code"],"conversion":["conversion"],"description":["description"],"direction":["direction"],"eligibility":["eligibility"],"lookup":["lookup"],"references":["references"],"settings_id":["settings_id"],"subtotal_id":["subtotal_id"]},"key":["id"],"locks":[],"parents":[{"column":"settings_id","key":"id","locks":[{"constraint":"jurisdiction_settings__lock__f51311df","except":["effective_range","reason","status"],"name":"sealed_version","sql":"(coalesce(t.\"status\" = ''SEALED''::text, false))"},{"constraint":"jurisdiction_settings__lock__f8268056","except":[],"name":"void_version","sql":"(coalesce(t.\"status\" = ''VOID''::text, false))"}],"relation":"overtime_catalog","table":"jurisdiction_settings","type":"uuid"}],"states":{}}');

drop trigger if exists "store_row_rules" on "pay_amendment";

create trigger store_row_rules before insert or update or delete on "pay_amendment" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "pay_group";

create trigger store_row_rules before insert or update or delete on "pay_group" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "payroll_run";

create trigger store_row_rules before insert or update or delete on "payroll_run" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{"state":{"initial":"UNPAID","states":{"PAID":{"to":[]},"UNPAID":{"to":["PAID"]}}}}}');

drop trigger if exists "store_statement_rules_delete" on "payroll_run";

create trigger store_statement_rules_delete after delete on "payroll_run" referencing old table as store_old for each statement execute function store_statement_rules('{"fields":{"entity_id":["entity_id"],"kind":["kind"],"pay_date":["pay_date"],"pay_group_id":["pay_group_id"],"period":["period"],"salary_coverage":["salary_coverage"],"settings_id":["settings_id"],"state":["state"]},"key":["id"],"locks":[{"constraint":"payroll_run__lock__753125e2","except":[],"name":"paid_run","sql":"(coalesce(t.\"state\" = ''PAID''::text, false))"}],"parents":[],"states":{"state":{"initial":"UNPAID","states":{"PAID":{"to":[]},"UNPAID":{"to":["PAID"]}}}}}');

drop trigger if exists "store_statement_rules_update" on "payroll_run";

create trigger store_statement_rules_update after update on "payroll_run" referencing old table as store_old new table as store_new for each statement execute function store_statement_rules('{"fields":{"entity_id":["entity_id"],"kind":["kind"],"pay_date":["pay_date"],"pay_group_id":["pay_group_id"],"period":["period"],"salary_coverage":["salary_coverage"],"settings_id":["settings_id"],"state":["state"]},"key":["id"],"locks":[{"constraint":"payroll_run__lock__753125e2","except":[],"name":"paid_run","sql":"(coalesce(t.\"state\" = ''PAID''::text, false))"}],"parents":[],"states":{"state":{"initial":"UNPAID","states":{"PAID":{"to":[]},"UNPAID":{"to":["PAID"]}}}}}');

drop trigger if exists "store_row_rules" on "payslip";

create trigger store_row_rules before insert or update or delete on "payslip" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "registered_effect";

create trigger store_row_rules before insert or update or delete on "registered_effect" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_statement_rules_delete" on "registered_effect";

create trigger store_statement_rules_delete after delete on "registered_effect" referencing old table as store_old for each statement execute function store_statement_rules('{"fields":{"code":["code"],"condition":["condition"],"description":["description"],"effects":["effects"],"events":["events"],"lookup":["lookup"],"name":["name"],"reads":["reads"],"references":["references"],"settings_id":["settings_id"],"source_collection":["source_collection"],"target_action":["target_action"],"target_collection":["target_collection"]},"key":["id"],"locks":[],"parents":[{"column":"settings_id","key":"id","locks":[{"constraint":"jurisdiction_settings__lock__f51311df","except":["effective_range","reason","status"],"name":"sealed_version","sql":"(coalesce(t.\"status\" = ''SEALED''::text, false))"},{"constraint":"jurisdiction_settings__lock__f8268056","except":[],"name":"void_version","sql":"(coalesce(t.\"status\" = ''VOID''::text, false))"}],"relation":"registered_effect","table":"jurisdiction_settings","type":"uuid"}],"states":{}}');

drop trigger if exists "store_statement_rules_insert" on "registered_effect";

create trigger store_statement_rules_insert after insert on "registered_effect" referencing new table as store_new for each statement execute function store_statement_rules('{"fields":{"code":["code"],"condition":["condition"],"description":["description"],"effects":["effects"],"events":["events"],"lookup":["lookup"],"name":["name"],"reads":["reads"],"references":["references"],"settings_id":["settings_id"],"source_collection":["source_collection"],"target_action":["target_action"],"target_collection":["target_collection"]},"key":["id"],"locks":[],"parents":[{"column":"settings_id","key":"id","locks":[{"constraint":"jurisdiction_settings__lock__f51311df","except":["effective_range","reason","status"],"name":"sealed_version","sql":"(coalesce(t.\"status\" = ''SEALED''::text, false))"},{"constraint":"jurisdiction_settings__lock__f8268056","except":[],"name":"void_version","sql":"(coalesce(t.\"status\" = ''VOID''::text, false))"}],"relation":"registered_effect","table":"jurisdiction_settings","type":"uuid"}],"states":{}}');

drop trigger if exists "store_statement_rules_update" on "registered_effect";

create trigger store_statement_rules_update after update on "registered_effect" referencing old table as store_old new table as store_new for each statement execute function store_statement_rules('{"fields":{"code":["code"],"condition":["condition"],"description":["description"],"effects":["effects"],"events":["events"],"lookup":["lookup"],"name":["name"],"reads":["reads"],"references":["references"],"settings_id":["settings_id"],"source_collection":["source_collection"],"target_action":["target_action"],"target_collection":["target_collection"]},"key":["id"],"locks":[],"parents":[{"column":"settings_id","key":"id","locks":[{"constraint":"jurisdiction_settings__lock__f51311df","except":["effective_range","reason","status"],"name":"sealed_version","sql":"(coalesce(t.\"status\" = ''SEALED''::text, false))"},{"constraint":"jurisdiction_settings__lock__f8268056","except":[],"name":"void_version","sql":"(coalesce(t.\"status\" = ''VOID''::text, false))"}],"relation":"registered_effect","table":"jurisdiction_settings","type":"uuid"}],"states":{}}');

drop trigger if exists "store_row_rules" on "registered_rule";

create trigger store_row_rules before insert or update or delete on "registered_rule" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_statement_rules_delete" on "registered_rule";

create trigger store_statement_rules_delete after delete on "registered_rule" referencing old table as store_old for each statement execute function store_statement_rules('{"fields":{"code":["code"],"condition":["condition"],"description":["description"],"events":["events"],"lookup":["lookup"],"order":["order"],"reads":["reads"],"references":["references"],"settings_id":["settings_id"],"target_collection":["target_collection"],"validate":["validate"]},"key":["id"],"locks":[],"parents":[{"column":"settings_id","key":"id","locks":[{"constraint":"jurisdiction_settings__lock__f51311df","except":["effective_range","reason","status"],"name":"sealed_version","sql":"(coalesce(t.\"status\" = ''SEALED''::text, false))"},{"constraint":"jurisdiction_settings__lock__f8268056","except":[],"name":"void_version","sql":"(coalesce(t.\"status\" = ''VOID''::text, false))"}],"relation":"registered_rule","table":"jurisdiction_settings","type":"uuid"}],"states":{}}');

drop trigger if exists "store_statement_rules_insert" on "registered_rule";

create trigger store_statement_rules_insert after insert on "registered_rule" referencing new table as store_new for each statement execute function store_statement_rules('{"fields":{"code":["code"],"condition":["condition"],"description":["description"],"events":["events"],"lookup":["lookup"],"order":["order"],"reads":["reads"],"references":["references"],"settings_id":["settings_id"],"target_collection":["target_collection"],"validate":["validate"]},"key":["id"],"locks":[],"parents":[{"column":"settings_id","key":"id","locks":[{"constraint":"jurisdiction_settings__lock__f51311df","except":["effective_range","reason","status"],"name":"sealed_version","sql":"(coalesce(t.\"status\" = ''SEALED''::text, false))"},{"constraint":"jurisdiction_settings__lock__f8268056","except":[],"name":"void_version","sql":"(coalesce(t.\"status\" = ''VOID''::text, false))"}],"relation":"registered_rule","table":"jurisdiction_settings","type":"uuid"}],"states":{}}');

drop trigger if exists "store_statement_rules_update" on "registered_rule";

create trigger store_statement_rules_update after update on "registered_rule" referencing old table as store_old new table as store_new for each statement execute function store_statement_rules('{"fields":{"code":["code"],"condition":["condition"],"description":["description"],"events":["events"],"lookup":["lookup"],"order":["order"],"reads":["reads"],"references":["references"],"settings_id":["settings_id"],"target_collection":["target_collection"],"validate":["validate"]},"key":["id"],"locks":[],"parents":[{"column":"settings_id","key":"id","locks":[{"constraint":"jurisdiction_settings__lock__f51311df","except":["effective_range","reason","status"],"name":"sealed_version","sql":"(coalesce(t.\"status\" = ''SEALED''::text, false))"},{"constraint":"jurisdiction_settings__lock__f8268056","except":[],"name":"void_version","sql":"(coalesce(t.\"status\" = ''VOID''::text, false))"}],"relation":"registered_rule","table":"jurisdiction_settings","type":"uuid"}],"states":{}}');

drop trigger if exists "store_row_rules" on "requestor";

create trigger store_row_rules before insert or update or delete on "requestor" for each row execute function store_row_rules('{"audit":false,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "roster_entry";

create trigger store_row_rules before insert or update or delete on "roster_entry" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "shift_definition";

create trigger store_row_rules before insert or update or delete on "shift_definition" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "shift_pattern";

create trigger store_row_rules before insert or update or delete on "shift_pattern" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "statutory_change";

create trigger store_row_rules before insert or update or delete on "statutory_change" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_statement_rules_delete" on "statutory_change";

create trigger store_statement_rules_delete after delete on "statutory_change" referencing old table as store_old for each statement execute function store_statement_rules('{"fields":{"applied_version_id":["applied_version_id"],"baseline_version_id":["baseline_version_id"],"effective_from":["effective_from"],"family":["family"],"field_path":["field_path"],"finding_id":["finding_id"],"jurisdiction_code":["jurisdiction_code"],"new_value":["new_value"],"notes":["notes"],"old_value":["old_value"],"row_code":["row_code"]},"key":["id"],"locks":[{"constraint":"statutory_change__lock__bc6de06d","except":[],"name":"applied_change","sql":"(t.\"applied_version_id\" is not null)"}],"parents":[],"states":{}}');

drop trigger if exists "store_statement_rules_update" on "statutory_change";

create trigger store_statement_rules_update after update on "statutory_change" referencing old table as store_old new table as store_new for each statement execute function store_statement_rules('{"fields":{"applied_version_id":["applied_version_id"],"baseline_version_id":["baseline_version_id"],"effective_from":["effective_from"],"family":["family"],"field_path":["field_path"],"finding_id":["finding_id"],"jurisdiction_code":["jurisdiction_code"],"new_value":["new_value"],"notes":["notes"],"old_value":["old_value"],"row_code":["row_code"]},"key":["id"],"locks":[{"constraint":"statutory_change__lock__bc6de06d","except":[],"name":"applied_change","sql":"(t.\"applied_version_id\" is not null)"}],"parents":[],"states":{}}');

drop trigger if exists "store_row_rules" on "statutory_contribution_catalog";

create trigger store_row_rules before insert or update or delete on "statutory_contribution_catalog" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_statement_rules_delete" on "statutory_contribution_catalog";

create trigger store_statement_rules_delete after delete on "statutory_contribution_catalog" referencing old table as store_old for each statement execute function store_statement_rules('{"fields":{"assessed":["assessed"],"balance_window":["balance_window"],"code":["code"],"depends_on":["depends_on"],"description":["description"],"eligibility":["eligibility"],"employee_amount":["employee_amount"],"employer_amount":["employer_amount"],"employer_cost_subtotal_id":["employer_cost_subtotal_id"],"kind":["kind"],"lookup":["lookup"],"references":["references"],"settings_id":["settings_id"],"subtotal_id":["subtotal_id"]},"key":["id"],"locks":[],"parents":[{"column":"settings_id","key":"id","locks":[{"constraint":"jurisdiction_settings__lock__f51311df","except":["effective_range","reason","status"],"name":"sealed_version","sql":"(coalesce(t.\"status\" = ''SEALED''::text, false))"},{"constraint":"jurisdiction_settings__lock__f8268056","except":[],"name":"void_version","sql":"(coalesce(t.\"status\" = ''VOID''::text, false))"}],"relation":"statutory_contribution_catalog","table":"jurisdiction_settings","type":"uuid"}],"states":{}}');

drop trigger if exists "store_statement_rules_insert" on "statutory_contribution_catalog";

create trigger store_statement_rules_insert after insert on "statutory_contribution_catalog" referencing new table as store_new for each statement execute function store_statement_rules('{"fields":{"assessed":["assessed"],"balance_window":["balance_window"],"code":["code"],"depends_on":["depends_on"],"description":["description"],"eligibility":["eligibility"],"employee_amount":["employee_amount"],"employer_amount":["employer_amount"],"employer_cost_subtotal_id":["employer_cost_subtotal_id"],"kind":["kind"],"lookup":["lookup"],"references":["references"],"settings_id":["settings_id"],"subtotal_id":["subtotal_id"]},"key":["id"],"locks":[],"parents":[{"column":"settings_id","key":"id","locks":[{"constraint":"jurisdiction_settings__lock__f51311df","except":["effective_range","reason","status"],"name":"sealed_version","sql":"(coalesce(t.\"status\" = ''SEALED''::text, false))"},{"constraint":"jurisdiction_settings__lock__f8268056","except":[],"name":"void_version","sql":"(coalesce(t.\"status\" = ''VOID''::text, false))"}],"relation":"statutory_contribution_catalog","table":"jurisdiction_settings","type":"uuid"}],"states":{}}');

drop trigger if exists "store_statement_rules_update" on "statutory_contribution_catalog";

create trigger store_statement_rules_update after update on "statutory_contribution_catalog" referencing old table as store_old new table as store_new for each statement execute function store_statement_rules('{"fields":{"assessed":["assessed"],"balance_window":["balance_window"],"code":["code"],"depends_on":["depends_on"],"description":["description"],"eligibility":["eligibility"],"employee_amount":["employee_amount"],"employer_amount":["employer_amount"],"employer_cost_subtotal_id":["employer_cost_subtotal_id"],"kind":["kind"],"lookup":["lookup"],"references":["references"],"settings_id":["settings_id"],"subtotal_id":["subtotal_id"]},"key":["id"],"locks":[],"parents":[{"column":"settings_id","key":"id","locks":[{"constraint":"jurisdiction_settings__lock__f51311df","except":["effective_range","reason","status"],"name":"sealed_version","sql":"(coalesce(t.\"status\" = ''SEALED''::text, false))"},{"constraint":"jurisdiction_settings__lock__f8268056","except":[],"name":"void_version","sql":"(coalesce(t.\"status\" = ''VOID''::text, false))"}],"relation":"statutory_contribution_catalog","table":"jurisdiction_settings","type":"uuid"}],"states":{}}');

drop trigger if exists "store_row_rules" on "statutory_finding";

create trigger store_row_rules before insert or update or delete on "statutory_finding" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{"status":{"initial":"PROPOSED","states":{"APPLIED":{"to":[]},"CONFIRMED":{"to":["APPLIED","REJECTED"]},"PROPOSED":{"to":["CONFIRMED","REJECTED"]},"REJECTED":{"to":[]}}}}}');

drop trigger if exists "store_statement_rules_delete" on "statutory_finding";

create trigger store_statement_rules_delete after delete on "statutory_finding" referencing old table as store_old for each statement execute function store_statement_rules('{"fields":{"announced_on":["announced_on"],"families":["families"],"fit":["fit"],"instrument_key":["instrument_key"],"jurisdiction_code":["jurisdiction_code"],"notes":["notes"],"research_run_id":["research_run_id"],"source_quote":["source_quote"],"source_urls":["source_urls"],"status":["status"],"summary":["summary"],"title":["title"],"verified_by":["verified_by"],"verified_on":["verified_on"]},"key":["id"],"locks":[{"constraint":"statutory_finding__lock__e58aad66","except":["status","notes"],"name":"confirmed_finding","sql":"(coalesce(t.\"status\" = ''CONFIRMED''::text, false))"},{"constraint":"statutory_finding__lock__943c1d92","except":[],"name":"decided_finding","sql":"(coalesce(t.\"status\" = any(array[''APPLIED''::text, ''REJECTED''::text]::text[]), false))"}],"parents":[],"states":{"status":{"initial":"PROPOSED","states":{"APPLIED":{"to":[]},"CONFIRMED":{"to":["APPLIED","REJECTED"]},"PROPOSED":{"to":["CONFIRMED","REJECTED"]},"REJECTED":{"to":[]}}}}}');

drop trigger if exists "store_statement_rules_update" on "statutory_finding";

create trigger store_statement_rules_update after update on "statutory_finding" referencing old table as store_old new table as store_new for each statement execute function store_statement_rules('{"fields":{"announced_on":["announced_on"],"families":["families"],"fit":["fit"],"instrument_key":["instrument_key"],"jurisdiction_code":["jurisdiction_code"],"notes":["notes"],"research_run_id":["research_run_id"],"source_quote":["source_quote"],"source_urls":["source_urls"],"status":["status"],"summary":["summary"],"title":["title"],"verified_by":["verified_by"],"verified_on":["verified_on"]},"key":["id"],"locks":[{"constraint":"statutory_finding__lock__e58aad66","except":["status","notes"],"name":"confirmed_finding","sql":"(coalesce(t.\"status\" = ''CONFIRMED''::text, false))"},{"constraint":"statutory_finding__lock__943c1d92","except":[],"name":"decided_finding","sql":"(coalesce(t.\"status\" = any(array[''APPLIED''::text, ''REJECTED''::text]::text[]), false))"}],"parents":[],"states":{"status":{"initial":"PROPOSED","states":{"APPLIED":{"to":[]},"CONFIRMED":{"to":["APPLIED","REJECTED"]},"PROPOSED":{"to":["CONFIRMED","REJECTED"]},"REJECTED":{"to":[]}}}}}');

drop trigger if exists "store_row_rules" on "statutory_source";

create trigger store_row_rules before insert or update or delete on "statutory_source" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{"status":{"initial":"PROPOSED","states":{"ACTIVE":{"to":["RETIRED"]},"PROPOSED":{"to":["ACTIVE","RETIRED"]},"RETIRED":{"to":["ACTIVE"]}}}}}');

drop trigger if exists "store_statement_rules_delete" on "statutory_source";

create trigger store_statement_rules_delete after delete on "statutory_source" referencing old table as store_old for each statement execute function store_statement_rules('{"fields":{"family":["family"],"jurisdiction_code":["jurisdiction_code"],"last_checked_on":["last_checked_on"],"notes":["notes"],"origin":["origin"],"replaces_url":["replaces_url"],"research_run_id":["research_run_id"],"status":["status"],"title":["title"],"url":["url"]},"key":["id"],"locks":[{"constraint":"statutory_source__lock__1ead6ebb","except":["status","notes"],"name":"retired_source","sql":"(coalesce(t.\"status\" = ''RETIRED''::text, false))"}],"parents":[],"states":{"status":{"initial":"PROPOSED","states":{"ACTIVE":{"to":["RETIRED"]},"PROPOSED":{"to":["ACTIVE","RETIRED"]},"RETIRED":{"to":["ACTIVE"]}}}}}');

drop trigger if exists "store_statement_rules_update" on "statutory_source";

create trigger store_statement_rules_update after update on "statutory_source" referencing old table as store_old new table as store_new for each statement execute function store_statement_rules('{"fields":{"family":["family"],"jurisdiction_code":["jurisdiction_code"],"last_checked_on":["last_checked_on"],"notes":["notes"],"origin":["origin"],"replaces_url":["replaces_url"],"research_run_id":["research_run_id"],"status":["status"],"title":["title"],"url":["url"]},"key":["id"],"locks":[{"constraint":"statutory_source__lock__1ead6ebb","except":["status","notes"],"name":"retired_source","sql":"(coalesce(t.\"status\" = ''RETIRED''::text, false))"}],"parents":[],"states":{"status":{"initial":"PROPOSED","states":{"ACTIVE":{"to":["RETIRED"]},"PROPOSED":{"to":["ACTIVE","RETIRED"]},"RETIRED":{"to":["ACTIVE"]}}}}}');

drop trigger if exists "store_row_rules" on "subtotal";

create trigger store_row_rules before insert or update or delete on "subtotal" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_statement_rules_delete" on "subtotal";

create trigger store_statement_rules_delete after delete on "subtotal" referencing old table as store_old for each statement execute function store_statement_rules('{"fields":{"balance_window":["balance_window"],"calculation":["calculation"],"code":["code"],"name":["name"],"previous_id":["previous_id"],"settings_id":["settings_id"]},"key":["id"],"locks":[],"parents":[{"column":"settings_id","key":"id","locks":[{"constraint":"jurisdiction_settings__lock__f51311df","except":["effective_range","reason","status"],"name":"sealed_version","sql":"(coalesce(t.\"status\" = ''SEALED''::text, false))"},{"constraint":"jurisdiction_settings__lock__f8268056","except":[],"name":"void_version","sql":"(coalesce(t.\"status\" = ''VOID''::text, false))"}],"relation":"subtotals","table":"jurisdiction_settings","type":"uuid"}],"states":{}}');

drop trigger if exists "store_statement_rules_insert" on "subtotal";

create trigger store_statement_rules_insert after insert on "subtotal" referencing new table as store_new for each statement execute function store_statement_rules('{"fields":{"balance_window":["balance_window"],"calculation":["calculation"],"code":["code"],"name":["name"],"previous_id":["previous_id"],"settings_id":["settings_id"]},"key":["id"],"locks":[],"parents":[{"column":"settings_id","key":"id","locks":[{"constraint":"jurisdiction_settings__lock__f51311df","except":["effective_range","reason","status"],"name":"sealed_version","sql":"(coalesce(t.\"status\" = ''SEALED''::text, false))"},{"constraint":"jurisdiction_settings__lock__f8268056","except":[],"name":"void_version","sql":"(coalesce(t.\"status\" = ''VOID''::text, false))"}],"relation":"subtotals","table":"jurisdiction_settings","type":"uuid"}],"states":{}}');

drop trigger if exists "store_statement_rules_update" on "subtotal";

create trigger store_statement_rules_update after update on "subtotal" referencing old table as store_old new table as store_new for each statement execute function store_statement_rules('{"fields":{"balance_window":["balance_window"],"calculation":["calculation"],"code":["code"],"name":["name"],"previous_id":["previous_id"],"settings_id":["settings_id"]},"key":["id"],"locks":[],"parents":[{"column":"settings_id","key":"id","locks":[{"constraint":"jurisdiction_settings__lock__f51311df","except":["effective_range","reason","status"],"name":"sealed_version","sql":"(coalesce(t.\"status\" = ''SEALED''::text, false))"},{"constraint":"jurisdiction_settings__lock__f8268056","except":[],"name":"void_version","sql":"(coalesce(t.\"status\" = ''VOID''::text, false))"}],"relation":"subtotals","table":"jurisdiction_settings","type":"uuid"}],"states":{}}');

drop trigger if exists "store_row_rules" on "sys_api_key";

create trigger store_row_rules before insert or update or delete on "sys_api_key" for each row execute function store_row_rules('{"audit":false,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "sys_challenge";

create trigger store_row_rules before insert or update or delete on "sys_challenge" for each row execute function store_row_rules('{"audit":false,"key":["address_mac"],"states":{}}');

drop trigger if exists "store_row_rules" on "sys_config";

create trigger store_row_rules before insert or update or delete on "sys_config" for each row execute function store_row_rules('{"audit":false,"key":["key"],"states":{}}');

drop trigger if exists "store_row_rules" on "sys_conversation";

create trigger store_row_rules before insert or update or delete on "sys_conversation" for each row execute function store_row_rules('{"audit":false,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "sys_envoy";

create trigger store_row_rules before insert or update or delete on "sys_envoy" for each row execute function store_row_rules('{"audit":false,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "sys_file";

create trigger store_row_rules before insert or update or delete on "sys_file" for each row execute function store_row_rules('{"audit":false,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "sys_inbox";

create trigger store_row_rules before insert or update or delete on "sys_inbox" for each row execute function store_row_rules('{"audit":false,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "sys_integration";

create trigger store_row_rules before insert or update or delete on "sys_integration" for each row execute function store_row_rules('{"audit":false,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "sys_invitation";

create trigger store_row_rules before insert or update or delete on "sys_invitation" for each row execute function store_row_rules('{"audit":false,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "sys_message";

create trigger store_row_rules before insert or update or delete on "sys_message" for each row execute function store_row_rules('{"audit":false,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "sys_notification";

create trigger store_row_rules before insert or update or delete on "sys_notification" for each row execute function store_row_rules('{"audit":false,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "sys_outbox";

create trigger store_row_rules before insert or update or delete on "sys_outbox" for each row execute function store_row_rules('{"audit":false,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "sys_run";

create trigger store_row_rules before insert or update or delete on "sys_run" for each row execute function store_row_rules('{"audit":false,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "sys_session";

create trigger store_row_rules before insert or update or delete on "sys_session" for each row execute function store_row_rules('{"audit":false,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "sys_sync";

create trigger store_row_rules before insert or update or delete on "sys_sync" for each row execute function store_row_rules('{"audit":false,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "sys_sync_row";

create trigger store_row_rules before insert or update or delete on "sys_sync_row" for each row execute function store_row_rules('{"audit":false,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "sys_user";

create trigger store_row_rules before insert or update or delete on "sys_user" for each row execute function store_row_rules('{"audit":false,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "work_event";

create trigger store_row_rules before insert or update or delete on "work_event" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "work_event_catalog";

create trigger store_row_rules before insert or update or delete on "work_event_catalog" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_statement_rules_delete" on "work_event_catalog";

create trigger store_statement_rules_delete after delete on "work_event_catalog" referencing old table as store_old for each statement execute function store_statement_rules('{"fields":{"code":["code"],"description":["description"],"lookup":["lookup"],"references":["references"],"settings_id":["settings_id"],"subtotal_id":["subtotal_id"]},"key":["id"],"locks":[],"parents":[{"column":"settings_id","key":"id","locks":[{"constraint":"jurisdiction_settings__lock__f51311df","except":["effective_range","reason","status"],"name":"sealed_version","sql":"(coalesce(t.\"status\" = ''SEALED''::text, false))"},{"constraint":"jurisdiction_settings__lock__f8268056","except":[],"name":"void_version","sql":"(coalesce(t.\"status\" = ''VOID''::text, false))"}],"relation":"work_event_catalog","table":"jurisdiction_settings","type":"uuid"}],"states":{}}');

drop trigger if exists "store_statement_rules_insert" on "work_event_catalog";

create trigger store_statement_rules_insert after insert on "work_event_catalog" referencing new table as store_new for each statement execute function store_statement_rules('{"fields":{"code":["code"],"description":["description"],"lookup":["lookup"],"references":["references"],"settings_id":["settings_id"],"subtotal_id":["subtotal_id"]},"key":["id"],"locks":[],"parents":[{"column":"settings_id","key":"id","locks":[{"constraint":"jurisdiction_settings__lock__f51311df","except":["effective_range","reason","status"],"name":"sealed_version","sql":"(coalesce(t.\"status\" = ''SEALED''::text, false))"},{"constraint":"jurisdiction_settings__lock__f8268056","except":[],"name":"void_version","sql":"(coalesce(t.\"status\" = ''VOID''::text, false))"}],"relation":"work_event_catalog","table":"jurisdiction_settings","type":"uuid"}],"states":{}}');

drop trigger if exists "store_statement_rules_update" on "work_event_catalog";

create trigger store_statement_rules_update after update on "work_event_catalog" referencing old table as store_old new table as store_new for each statement execute function store_statement_rules('{"fields":{"code":["code"],"description":["description"],"lookup":["lookup"],"references":["references"],"settings_id":["settings_id"],"subtotal_id":["subtotal_id"]},"key":["id"],"locks":[],"parents":[{"column":"settings_id","key":"id","locks":[{"constraint":"jurisdiction_settings__lock__f51311df","except":["effective_range","reason","status"],"name":"sealed_version","sql":"(coalesce(t.\"status\" = ''SEALED''::text, false))"},{"constraint":"jurisdiction_settings__lock__f8268056","except":[],"name":"void_version","sql":"(coalesce(t.\"status\" = ''VOID''::text, false))"}],"relation":"work_event_catalog","table":"jurisdiction_settings","type":"uuid"}],"states":{}}');

drop trigger if exists "store_row_rules" on "workplace_case_catalog";

create trigger store_row_rules before insert or update or delete on "workplace_case_catalog" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_statement_rules_delete" on "workplace_case_catalog";

create trigger store_statement_rules_delete after delete on "workplace_case_catalog" referencing old table as store_old for each statement execute function store_statement_rules('{"fields":{"code":["code"],"description":["description"],"events":["events"],"lookup":["lookup"],"references":["references"],"settings_id":["settings_id"],"subtotal_id":["subtotal_id"]},"key":["id"],"locks":[],"parents":[{"column":"settings_id","key":"id","locks":[{"constraint":"jurisdiction_settings__lock__f51311df","except":["effective_range","reason","status"],"name":"sealed_version","sql":"(coalesce(t.\"status\" = ''SEALED''::text, false))"},{"constraint":"jurisdiction_settings__lock__f8268056","except":[],"name":"void_version","sql":"(coalesce(t.\"status\" = ''VOID''::text, false))"}],"relation":"workplace_case_catalog","table":"jurisdiction_settings","type":"uuid"}],"states":{}}');

drop trigger if exists "store_statement_rules_insert" on "workplace_case_catalog";

create trigger store_statement_rules_insert after insert on "workplace_case_catalog" referencing new table as store_new for each statement execute function store_statement_rules('{"fields":{"code":["code"],"description":["description"],"events":["events"],"lookup":["lookup"],"references":["references"],"settings_id":["settings_id"],"subtotal_id":["subtotal_id"]},"key":["id"],"locks":[],"parents":[{"column":"settings_id","key":"id","locks":[{"constraint":"jurisdiction_settings__lock__f51311df","except":["effective_range","reason","status"],"name":"sealed_version","sql":"(coalesce(t.\"status\" = ''SEALED''::text, false))"},{"constraint":"jurisdiction_settings__lock__f8268056","except":[],"name":"void_version","sql":"(coalesce(t.\"status\" = ''VOID''::text, false))"}],"relation":"workplace_case_catalog","table":"jurisdiction_settings","type":"uuid"}],"states":{}}');

drop trigger if exists "store_statement_rules_update" on "workplace_case_catalog";

create trigger store_statement_rules_update after update on "workplace_case_catalog" referencing old table as store_old new table as store_new for each statement execute function store_statement_rules('{"fields":{"code":["code"],"description":["description"],"events":["events"],"lookup":["lookup"],"references":["references"],"settings_id":["settings_id"],"subtotal_id":["subtotal_id"]},"key":["id"],"locks":[],"parents":[{"column":"settings_id","key":"id","locks":[{"constraint":"jurisdiction_settings__lock__f51311df","except":["effective_range","reason","status"],"name":"sealed_version","sql":"(coalesce(t.\"status\" = ''SEALED''::text, false))"},{"constraint":"jurisdiction_settings__lock__f8268056","except":[],"name":"void_version","sql":"(coalesce(t.\"status\" = ''VOID''::text, false))"}],"relation":"workplace_case_catalog","table":"jurisdiction_settings","type":"uuid"}],"states":{}}');

drop trigger if exists "store_row_rules" on "workplace_case_catalog_entry";

create trigger store_row_rules before insert or update or delete on "workplace_case_catalog_entry" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_statement_rules_delete" on "workplace_case_catalog_entry";

create trigger store_statement_rules_delete after delete on "workplace_case_catalog_entry" referencing old table as store_old for each statement execute function store_statement_rules('{"fields":{"catalog_id":["catalog_id"],"closed_on":["closed_on"],"description":["description"],"employment_id":["employment_id"],"entity_id":["entity_id"],"evidence_file":["evidence_file"],"inputs":["inputs"],"kind":["kind"],"location":["location"],"occurred_on":["occurred_on"],"opened_on":["opened_on"],"payroll_run_id":["payroll_run_id"],"reference":["reference"],"scheduled_on":["scheduled_on"],"severity":["severity"]},"key":["id"],"locks":[{"constraint":"workplace_case_catalog_entry__lock__b737815f","except":[],"name":"captured","sql":"(t.\"payroll_run_id\" is not null)"}],"parents":[],"states":{}}');

drop trigger if exists "store_statement_rules_update" on "workplace_case_catalog_entry";

create trigger store_statement_rules_update after update on "workplace_case_catalog_entry" referencing old table as store_old new table as store_new for each statement execute function store_statement_rules('{"fields":{"catalog_id":["catalog_id"],"closed_on":["closed_on"],"description":["description"],"employment_id":["employment_id"],"entity_id":["entity_id"],"evidence_file":["evidence_file"],"inputs":["inputs"],"kind":["kind"],"location":["location"],"occurred_on":["occurred_on"],"opened_on":["opened_on"],"payroll_run_id":["payroll_run_id"],"reference":["reference"],"scheduled_on":["scheduled_on"],"severity":["severity"]},"key":["id"],"locks":[{"constraint":"workplace_case_catalog_entry__lock__b737815f","except":[],"name":"captured","sql":"(t.\"payroll_run_id\" is not null)"}],"parents":[],"states":{}}');
