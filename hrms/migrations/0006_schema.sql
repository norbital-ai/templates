-- 0006_schema.sql: 603 step(s), from 05c31189618b6cca886663970445b5162676ee64827aaafcf5f142e20bba55b0 to fbe45e4fbd3294d024b1a5ed2292f211328f8e44c609f5f36f3f973acaf095a5.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- hazard: DESTRUCTIVE: drops data (a table or a stored column) or rebuilds it; runs only under its accept line.
-- hazard: validating: refuses, naming the constraint and the row count, if existing rows break it.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.

-- step create:column:adhoc_catalog_entry.catalog_code (additive)
-- operational risk: access-exclusive-lock
alter table "adhoc_catalog_entry" add column "catalog_code" text;

-- an entry names its catalogue row by code: carried over from the row it pointed at, before that table goes
update "adhoc_catalog_entry" e set "catalog_code" = c."code" from "adhoc_catalog" c where c."id" = e."catalog_id" and e."catalog_code" is null;

-- step create:column:claim_catalog_entry.catalog_code (additive)
-- operational risk: access-exclusive-lock
alter table "claim_catalog_entry" add column "catalog_code" text;

-- an entry names its catalogue row by code: carried over from the row it pointed at, before that table goes
update "claim_catalog_entry" e set "catalog_code" = c."code" from "claim_catalog" c where c."id" = e."catalog_id" and e."catalog_code" is null;

-- step create:column:leave_catalog_entry.catalog_code (additive)
-- operational risk: access-exclusive-lock
alter table "leave_catalog_entry" add column "catalog_code" text;

-- an entry names its catalogue row by code: carried over from the row it pointed at, before that table goes
update "leave_catalog_entry" e set "catalog_code" = c."code" from "leave_catalog" c where c."id" = e."catalog_id" and e."catalog_code" is null;

-- step create:column:loan_catalog_entry.catalog_code (additive)
-- operational risk: access-exclusive-lock
alter table "loan_catalog_entry" add column "catalog_code" text;

-- an entry names its catalogue row by code: carried over from the row it pointed at, before that table goes
update "loan_catalog_entry" e set "catalog_code" = c."code" from "loan_catalog" c where c."id" = e."catalog_id" and e."catalog_code" is null;

-- step create:column:workplace_case_catalog_entry.catalog_code (additive)
-- operational risk: access-exclusive-lock
alter table "workplace_case_catalog_entry" add column "catalog_code" text;

-- an entry names its catalogue row by code: carried over from the row it pointed at, before that table goes
update "workplace_case_catalog_entry" e set "catalog_code" = c."code" from "workplace_case_catalog" c where c."id" = e."catalog_id" and e."catalog_code" is null;

-- step create:column:work_event.catalog_code (additive)
-- operational risk: access-exclusive-lock
alter table "work_event" add column "catalog_code" text;

-- an entry names its catalogue row by code: carried over from the row it pointed at, before that table goes
update "work_event" e set "catalog_code" = c."code" from "work_event_catalog" c where c."id" = e."catalog_id" and e."catalog_code" is null;

-- step drop:trigger:adhoc_catalog.store_row_rules (additive)
drop trigger if exists store_row_rules on "adhoc_catalog";

-- step drop:trigger:adhoc_catalog.store_statement_rules_insert (additive)
drop trigger if exists store_statement_rules_insert on "adhoc_catalog";

-- step drop:trigger:adhoc_catalog.store_statement_rules_update (additive)
drop trigger if exists store_statement_rules_update on "adhoc_catalog";

-- step drop:trigger:adhoc_catalog.store_statement_rules_delete (additive)
drop trigger if exists store_statement_rules_delete on "adhoc_catalog";

-- step drop:index:adhoc_catalog.adhoc_catalog__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "adhoc_catalog__gin__73732636";

-- step drop:trigger:allowance_catalog.store_row_rules (additive)
drop trigger if exists store_row_rules on "allowance_catalog";

-- step drop:trigger:allowance_catalog.store_statement_rules_insert (additive)
drop trigger if exists store_statement_rules_insert on "allowance_catalog";

-- step drop:trigger:allowance_catalog.store_statement_rules_update (additive)
drop trigger if exists store_statement_rules_update on "allowance_catalog";

-- step drop:trigger:allowance_catalog.store_statement_rules_delete (additive)
drop trigger if exists store_statement_rules_delete on "allowance_catalog";

-- step drop:index:allowance_catalog.allowance_catalog__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "allowance_catalog__gin__73732636";

-- step drop:trigger:claim_catalog.store_row_rules (additive)
drop trigger if exists store_row_rules on "claim_catalog";

-- step drop:trigger:claim_catalog.store_statement_rules_insert (additive)
drop trigger if exists store_statement_rules_insert on "claim_catalog";

-- step drop:trigger:claim_catalog.store_statement_rules_update (additive)
drop trigger if exists store_statement_rules_update on "claim_catalog";

-- step drop:trigger:claim_catalog.store_statement_rules_delete (additive)
drop trigger if exists store_statement_rules_delete on "claim_catalog";

-- step drop:index:claim_catalog.claim_catalog__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "claim_catalog__gin__73732636";

-- step drop:trigger:jurisdiction_settings.store_row_rules (additive)
drop trigger if exists store_row_rules on "jurisdiction_settings";

-- step drop:trigger:jurisdiction_settings.store_statement_rules_update (additive)
drop trigger if exists store_statement_rules_update on "jurisdiction_settings";

-- step drop:trigger:jurisdiction_settings.store_statement_rules_delete (additive)
drop trigger if exists store_statement_rules_delete on "jurisdiction_settings";

-- step drop:index:jurisdiction_settings.jurisdiction_settings__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "jurisdiction_settings__gin__73732636";

-- step drop:trigger:leave_catalog.store_row_rules (additive)
drop trigger if exists store_row_rules on "leave_catalog";

-- step drop:trigger:leave_catalog.store_statement_rules_insert (additive)
drop trigger if exists store_statement_rules_insert on "leave_catalog";

-- step drop:trigger:leave_catalog.store_statement_rules_update (additive)
drop trigger if exists store_statement_rules_update on "leave_catalog";

-- step drop:trigger:leave_catalog.store_statement_rules_delete (additive)
drop trigger if exists store_statement_rules_delete on "leave_catalog";

-- step drop:index:leave_catalog.leave_catalog__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "leave_catalog__gin__73732636";

-- step drop:trigger:loan_catalog.store_row_rules (additive)
drop trigger if exists store_row_rules on "loan_catalog";

-- step drop:trigger:loan_catalog.store_statement_rules_insert (additive)
drop trigger if exists store_statement_rules_insert on "loan_catalog";

-- step drop:trigger:loan_catalog.store_statement_rules_update (additive)
drop trigger if exists store_statement_rules_update on "loan_catalog";

-- step drop:trigger:loan_catalog.store_statement_rules_delete (additive)
drop trigger if exists store_statement_rules_delete on "loan_catalog";

-- step drop:index:loan_catalog.loan_catalog__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "loan_catalog__gin__73732636";

-- step drop:trigger:overtime_catalog.store_row_rules (additive)
drop trigger if exists store_row_rules on "overtime_catalog";

-- step drop:trigger:overtime_catalog.store_statement_rules_insert (additive)
drop trigger if exists store_statement_rules_insert on "overtime_catalog";

-- step drop:trigger:overtime_catalog.store_statement_rules_update (additive)
drop trigger if exists store_statement_rules_update on "overtime_catalog";

-- step drop:trigger:overtime_catalog.store_statement_rules_delete (additive)
drop trigger if exists store_statement_rules_delete on "overtime_catalog";

-- step drop:index:overtime_catalog.overtime_catalog__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "overtime_catalog__gin__73732636";

-- step drop:trigger:registered_effect.store_row_rules (additive)
drop trigger if exists store_row_rules on "registered_effect";

-- step drop:trigger:registered_effect.store_statement_rules_insert (additive)
drop trigger if exists store_statement_rules_insert on "registered_effect";

-- step drop:trigger:registered_effect.store_statement_rules_update (additive)
drop trigger if exists store_statement_rules_update on "registered_effect";

-- step drop:trigger:registered_effect.store_statement_rules_delete (additive)
drop trigger if exists store_statement_rules_delete on "registered_effect";

-- step drop:index:registered_effect.registered_effect__gin__8b9f870b (additive)
-- operational risk: access-exclusive-lock
drop index if exists "registered_effect__gin__8b9f870b";

-- step drop:index:registered_effect.registered_effect__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "registered_effect__gin__73732636";

-- step drop:trigger:registered_rule.store_row_rules (additive)
drop trigger if exists store_row_rules on "registered_rule";

-- step drop:trigger:registered_rule.store_statement_rules_insert (additive)
drop trigger if exists store_statement_rules_insert on "registered_rule";

-- step drop:trigger:registered_rule.store_statement_rules_update (additive)
drop trigger if exists store_statement_rules_update on "registered_rule";

-- step drop:trigger:registered_rule.store_statement_rules_delete (additive)
drop trigger if exists store_statement_rules_delete on "registered_rule";

-- step drop:index:registered_rule.registered_rule__gin__8b9f870b (additive)
-- operational risk: access-exclusive-lock
drop index if exists "registered_rule__gin__8b9f870b";

-- step drop:index:registered_rule.registered_rule__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "registered_rule__gin__73732636";

-- step drop:trigger:statutory_change.store_row_rules (additive)
drop trigger if exists store_row_rules on "statutory_change";

-- step drop:trigger:statutory_change.store_statement_rules_update (additive)
drop trigger if exists store_statement_rules_update on "statutory_change";

-- step drop:trigger:statutory_change.store_statement_rules_delete (additive)
drop trigger if exists store_statement_rules_delete on "statutory_change";

-- step drop:index:statutory_change.statutory_change__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "statutory_change__gin__73732636";

-- step drop:trigger:statutory_contribution_catalog.store_row_rules (additive)
drop trigger if exists store_row_rules on "statutory_contribution_catalog";

-- step drop:trigger:statutory_contribution_catalog.store_statement_rules_insert (additive)
drop trigger if exists store_statement_rules_insert on "statutory_contribution_catalog";

-- step drop:trigger:statutory_contribution_catalog.store_statement_rules_update (additive)
drop trigger if exists store_statement_rules_update on "statutory_contribution_catalog";

-- step drop:trigger:statutory_contribution_catalog.store_statement_rules_delete (additive)
drop trigger if exists store_statement_rules_delete on "statutory_contribution_catalog";

-- step drop:index:statutory_contribution_catalog.statutory_contribution_catalog__gin__9943fafe (additive)
-- operational risk: access-exclusive-lock
drop index if exists "statutory_contribution_catalog__gin__9943fafe";

-- step drop:index:statutory_contribution_catalog.statutory_contribution_catalog__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "statutory_contribution_catalog__gin__73732636";

-- step drop:trigger:subtotal.store_row_rules (additive)
drop trigger if exists store_row_rules on "subtotal";

-- step drop:trigger:subtotal.store_statement_rules_insert (additive)
drop trigger if exists store_statement_rules_insert on "subtotal";

-- step drop:trigger:subtotal.store_statement_rules_update (additive)
drop trigger if exists store_statement_rules_update on "subtotal";

-- step drop:trigger:subtotal.store_statement_rules_delete (additive)
drop trigger if exists store_statement_rules_delete on "subtotal";

-- step drop:index:subtotal.subtotal__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "subtotal__gin__73732636";

-- step drop:trigger:work_event_catalog.store_row_rules (additive)
drop trigger if exists store_row_rules on "work_event_catalog";

-- step drop:trigger:work_event_catalog.store_statement_rules_insert (additive)
drop trigger if exists store_statement_rules_insert on "work_event_catalog";

-- step drop:trigger:work_event_catalog.store_statement_rules_update (additive)
drop trigger if exists store_statement_rules_update on "work_event_catalog";

-- step drop:trigger:work_event_catalog.store_statement_rules_delete (additive)
drop trigger if exists store_statement_rules_delete on "work_event_catalog";

-- step drop:index:work_event_catalog.work_event_catalog__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "work_event_catalog__gin__73732636";

-- step drop:trigger:workplace_case_catalog.store_row_rules (additive)
drop trigger if exists store_row_rules on "workplace_case_catalog";

-- step drop:trigger:workplace_case_catalog.store_statement_rules_insert (additive)
drop trigger if exists store_statement_rules_insert on "workplace_case_catalog";

-- step drop:trigger:workplace_case_catalog.store_statement_rules_update (additive)
drop trigger if exists store_statement_rules_update on "workplace_case_catalog";

-- step drop:trigger:workplace_case_catalog.store_statement_rules_delete (additive)
drop trigger if exists store_statement_rules_delete on "workplace_case_catalog";

-- step drop:index:workplace_case_catalog.workplace_case_catalog__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "workplace_case_catalog__gin__73732636";

-- step drop:index:adhoc_catalog.adhoc_catalog__ix__81c3962d (additive)
-- operational risk: access-exclusive-lock
drop index if exists "adhoc_catalog__ix__81c3962d";

-- step drop:index:adhoc_catalog.adhoc_catalog__ix__f94acacc (additive)
-- operational risk: access-exclusive-lock
drop index if exists "adhoc_catalog__ix__f94acacc";

-- step drop:index:adhoc_catalog_entry.adhoc_catalog_entry__ix__d5c002db (additive)
-- operational risk: access-exclusive-lock
drop index if exists "adhoc_catalog_entry__ix__d5c002db";

-- step drop:index:allowance_catalog.allowance_catalog__ix__81c3962d (additive)
-- operational risk: access-exclusive-lock
drop index if exists "allowance_catalog__ix__81c3962d";

-- step drop:index:allowance_catalog.allowance_catalog__ix__f94acacc (additive)
-- operational risk: access-exclusive-lock
drop index if exists "allowance_catalog__ix__f94acacc";

-- step drop:index:claim_catalog.claim_catalog__ix__81c3962d (additive)
-- operational risk: access-exclusive-lock
drop index if exists "claim_catalog__ix__81c3962d";

-- step drop:index:claim_catalog.claim_catalog__ix__f94acacc (additive)
-- operational risk: access-exclusive-lock
drop index if exists "claim_catalog__ix__f94acacc";

-- step drop:index:claim_catalog_entry.claim_catalog_entry__ix__d5c002db (additive)
-- operational risk: access-exclusive-lock
drop index if exists "claim_catalog_entry__ix__d5c002db";

-- step drop:index:entity_profile_version.entity_profile_version__ix__3d2fc93d (additive)
-- operational risk: access-exclusive-lock
drop index if exists "entity_profile_version__ix__3d2fc93d";

-- step drop:index:leave_catalog.leave_catalog__ix__81c3962d (additive)
-- operational risk: access-exclusive-lock
drop index if exists "leave_catalog__ix__81c3962d";

-- step drop:index:leave_catalog.leave_catalog__ix__f94acacc (additive)
-- operational risk: access-exclusive-lock
drop index if exists "leave_catalog__ix__f94acacc";

-- step drop:index:leave_catalog_entry.leave_catalog_entry__ix__d5c002db (additive)
-- operational risk: access-exclusive-lock
drop index if exists "leave_catalog_entry__ix__d5c002db";

-- step drop:index:loan_catalog.loan_catalog__ix__81c3962d (additive)
-- operational risk: access-exclusive-lock
drop index if exists "loan_catalog__ix__81c3962d";

-- step drop:index:loan_catalog.loan_catalog__ix__f94acacc (additive)
-- operational risk: access-exclusive-lock
drop index if exists "loan_catalog__ix__f94acacc";

-- step drop:index:loan_catalog_entry.loan_catalog_entry__ix__d5c002db (additive)
-- operational risk: access-exclusive-lock
drop index if exists "loan_catalog_entry__ix__d5c002db";

-- step drop:index:overtime_catalog.overtime_catalog__ix__81c3962d (additive)
-- operational risk: access-exclusive-lock
drop index if exists "overtime_catalog__ix__81c3962d";

-- step drop:index:overtime_catalog.overtime_catalog__ix__f94acacc (additive)
-- operational risk: access-exclusive-lock
drop index if exists "overtime_catalog__ix__f94acacc";

-- step drop:index:payroll_run.payroll_run__ix__81c3962d (additive)
-- operational risk: access-exclusive-lock
drop index if exists "payroll_run__ix__81c3962d";

-- step drop:index:payslip.payslip__ix__81c3962d (additive)
-- operational risk: access-exclusive-lock
drop index if exists "payslip__ix__81c3962d";

-- step drop:index:registered_effect.registered_effect__ix__81c3962d (additive)
-- operational risk: access-exclusive-lock
drop index if exists "registered_effect__ix__81c3962d";

-- step drop:index:registered_rule.registered_rule__ix__81c3962d (additive)
-- operational risk: access-exclusive-lock
drop index if exists "registered_rule__ix__81c3962d";

-- step drop:index:statutory_change.statutory_change__ix__9803300f (additive)
-- operational risk: access-exclusive-lock
drop index if exists "statutory_change__ix__9803300f";

-- step drop:index:statutory_change.statutory_change__ix__4a32eade (additive)
-- operational risk: access-exclusive-lock
drop index if exists "statutory_change__ix__4a32eade";

-- step drop:index:statutory_change.statutory_change__ix__db9feb63 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "statutory_change__ix__db9feb63";

-- step drop:index:statutory_contribution_catalog.statutory_contribution_catalog__ix__db7494ce (additive)
-- operational risk: access-exclusive-lock
drop index if exists "statutory_contribution_catalog__ix__db7494ce";

-- step drop:index:statutory_contribution_catalog.statutory_contribution_catalog__ix__81c3962d (additive)
-- operational risk: access-exclusive-lock
drop index if exists "statutory_contribution_catalog__ix__81c3962d";

-- step drop:index:statutory_contribution_catalog.statutory_contribution_catalog__ix__f94acacc (additive)
-- operational risk: access-exclusive-lock
drop index if exists "statutory_contribution_catalog__ix__f94acacc";

-- step drop:index:subtotal.subtotal__ix__91428126 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "subtotal__ix__91428126";

-- step drop:index:subtotal.subtotal__ix__81c3962d (additive)
-- operational risk: access-exclusive-lock
drop index if exists "subtotal__ix__81c3962d";

-- step drop:index:work_event.work_event__ix__d5c002db (additive)
-- operational risk: access-exclusive-lock
drop index if exists "work_event__ix__d5c002db";

-- step drop:index:work_event_catalog.work_event_catalog__ix__81c3962d (additive)
-- operational risk: access-exclusive-lock
drop index if exists "work_event_catalog__ix__81c3962d";

-- step drop:index:work_event_catalog.work_event_catalog__ix__f94acacc (additive)
-- operational risk: access-exclusive-lock
drop index if exists "work_event_catalog__ix__f94acacc";

-- step drop:index:workplace_case_catalog.workplace_case_catalog__ix__81c3962d (additive)
-- operational risk: access-exclusive-lock
drop index if exists "workplace_case_catalog__ix__81c3962d";

-- step drop:index:workplace_case_catalog.workplace_case_catalog__ix__f94acacc (additive)
-- operational risk: access-exclusive-lock
drop index if exists "workplace_case_catalog__ix__f94acacc";

-- step drop:index:workplace_case_catalog_entry.workplace_case_catalog_entry__ix__d5c002db (additive)
-- operational risk: access-exclusive-lock
drop index if exists "workplace_case_catalog_entry__ix__d5c002db";

-- step replace:trigger:entity_profile_version.store_statement_rules_update (additive)
drop trigger if exists store_statement_rules_update on "entity_profile_version";

-- step replace:trigger:entity_profile_version.store_statement_rules_delete (additive)
drop trigger if exists store_statement_rules_delete on "entity_profile_version";

-- step replace:trigger:workplace_case_catalog_entry.store_statement_rules_update (additive)
drop trigger if exists store_statement_rules_update on "workplace_case_catalog_entry";

-- step replace:trigger:workplace_case_catalog_entry.store_statement_rules_delete (additive)
drop trigger if exists store_statement_rules_delete on "workplace_case_catalog_entry";

-- step replace:trigger:payroll_run.store_statement_rules_update (additive)
drop trigger if exists store_statement_rules_update on "payroll_run";

-- step replace:trigger:payroll_run.store_statement_rules_delete (additive)
drop trigger if exists store_statement_rules_delete on "payroll_run";

-- step replace:trigger:statutory_finding.store_row_rules (additive)
drop trigger if exists store_row_rules on "statutory_finding";

-- step replace:trigger:statutory_finding.store_statement_rules_update (additive)
drop trigger if exists store_statement_rules_update on "statutory_finding";

-- step replace:trigger:statutory_finding.store_statement_rules_delete (additive)
drop trigger if exists store_statement_rules_delete on "statutory_finding";

-- step drop:fk:adhoc_catalog.adhoc_catalog__fk__482ed27a (additive)
-- operational risk: access-exclusive-lock
alter table "adhoc_catalog" drop constraint if exists "adhoc_catalog__fk__482ed27a";

-- step drop:fk:adhoc_catalog.adhoc_catalog__fk__4250ce3e (additive)
-- operational risk: access-exclusive-lock
alter table "adhoc_catalog" drop constraint if exists "adhoc_catalog__fk__4250ce3e";

-- step drop:fk:adhoc_catalog_entry.adhoc_catalog_entry__fk__08d70c6e (additive)
-- operational risk: access-exclusive-lock
alter table "adhoc_catalog_entry" drop constraint if exists "adhoc_catalog_entry__fk__08d70c6e";

-- step drop:fk:allowance_catalog.allowance_catalog__fk__482ed27a (additive)
-- operational risk: access-exclusive-lock
alter table "allowance_catalog" drop constraint if exists "allowance_catalog__fk__482ed27a";

-- step drop:fk:allowance_catalog.allowance_catalog__fk__4250ce3e (additive)
-- operational risk: access-exclusive-lock
alter table "allowance_catalog" drop constraint if exists "allowance_catalog__fk__4250ce3e";

-- step drop:fk:claim_catalog.claim_catalog__fk__482ed27a (additive)
-- operational risk: access-exclusive-lock
alter table "claim_catalog" drop constraint if exists "claim_catalog__fk__482ed27a";

-- step drop:fk:claim_catalog.claim_catalog__fk__4250ce3e (additive)
-- operational risk: access-exclusive-lock
alter table "claim_catalog" drop constraint if exists "claim_catalog__fk__4250ce3e";

-- step drop:fk:claim_catalog_entry.claim_catalog_entry__fk__5e7f9e41 (additive)
-- operational risk: access-exclusive-lock
alter table "claim_catalog_entry" drop constraint if exists "claim_catalog_entry__fk__5e7f9e41";

-- step drop:fk:entity_profile_version.entity_profile_version__fk__b616d7f6 (additive)
-- operational risk: access-exclusive-lock
alter table "entity_profile_version" drop constraint if exists "entity_profile_version__fk__b616d7f6";

-- step drop:fk:leave_catalog.leave_catalog__fk__482ed27a (additive)
-- operational risk: access-exclusive-lock
alter table "leave_catalog" drop constraint if exists "leave_catalog__fk__482ed27a";

-- step drop:fk:leave_catalog.leave_catalog__fk__4250ce3e (additive)
-- operational risk: access-exclusive-lock
alter table "leave_catalog" drop constraint if exists "leave_catalog__fk__4250ce3e";

-- step drop:fk:leave_catalog_entry.leave_catalog_entry__fk__e5cf7fa8 (additive)
-- operational risk: access-exclusive-lock
alter table "leave_catalog_entry" drop constraint if exists "leave_catalog_entry__fk__e5cf7fa8";

-- step drop:fk:loan_catalog.loan_catalog__fk__482ed27a (additive)
-- operational risk: access-exclusive-lock
alter table "loan_catalog" drop constraint if exists "loan_catalog__fk__482ed27a";

-- step drop:fk:loan_catalog.loan_catalog__fk__4250ce3e (additive)
-- operational risk: access-exclusive-lock
alter table "loan_catalog" drop constraint if exists "loan_catalog__fk__4250ce3e";

-- step drop:fk:loan_catalog_entry.loan_catalog_entry__fk__fa554c50 (additive)
-- operational risk: access-exclusive-lock
alter table "loan_catalog_entry" drop constraint if exists "loan_catalog_entry__fk__fa554c50";

-- step drop:fk:overtime_catalog.overtime_catalog__fk__482ed27a (additive)
-- operational risk: access-exclusive-lock
alter table "overtime_catalog" drop constraint if exists "overtime_catalog__fk__482ed27a";

-- step drop:fk:overtime_catalog.overtime_catalog__fk__4250ce3e (additive)
-- operational risk: access-exclusive-lock
alter table "overtime_catalog" drop constraint if exists "overtime_catalog__fk__4250ce3e";

-- step drop:fk:payroll_run.payroll_run__fk__904a13bb (additive)
-- operational risk: access-exclusive-lock
alter table "payroll_run" drop constraint if exists "payroll_run__fk__904a13bb";

-- step drop:fk:payslip.payslip__fk__904a13bb (additive)
-- operational risk: access-exclusive-lock
alter table "payslip" drop constraint if exists "payslip__fk__904a13bb";

-- step drop:fk:registered_effect.registered_effect__fk__482ed27a (additive)
-- operational risk: access-exclusive-lock
alter table "registered_effect" drop constraint if exists "registered_effect__fk__482ed27a";

-- step drop:fk:registered_rule.registered_rule__fk__482ed27a (additive)
-- operational risk: access-exclusive-lock
alter table "registered_rule" drop constraint if exists "registered_rule__fk__482ed27a";

-- step drop:fk:statutory_change.statutory_change__fk__bc3a80d5 (additive)
-- operational risk: access-exclusive-lock
alter table "statutory_change" drop constraint if exists "statutory_change__fk__bc3a80d5";

-- step drop:fk:statutory_change.statutory_change__fk__038739e1 (additive)
-- operational risk: access-exclusive-lock
alter table "statutory_change" drop constraint if exists "statutory_change__fk__038739e1";

-- step drop:fk:statutory_change.statutory_change__fk__8b56e43d (additive)
-- operational risk: access-exclusive-lock
alter table "statutory_change" drop constraint if exists "statutory_change__fk__8b56e43d";

-- step drop:fk:statutory_contribution_catalog.statutory_contribution_catalog__fk__bff4f566 (additive)
-- operational risk: access-exclusive-lock
alter table "statutory_contribution_catalog" drop constraint if exists "statutory_contribution_catalog__fk__bff4f566";

-- step drop:fk:statutory_contribution_catalog.statutory_contribution_catalog__fk__482ed27a (additive)
-- operational risk: access-exclusive-lock
alter table "statutory_contribution_catalog" drop constraint if exists "statutory_contribution_catalog__fk__482ed27a";

-- step drop:fk:statutory_contribution_catalog.statutory_contribution_catalog__fk__4250ce3e (additive)
-- operational risk: access-exclusive-lock
alter table "statutory_contribution_catalog" drop constraint if exists "statutory_contribution_catalog__fk__4250ce3e";

-- step drop:fk:subtotal.subtotal__fk__4bbe7755 (additive)
-- operational risk: access-exclusive-lock
alter table "subtotal" drop constraint if exists "subtotal__fk__4bbe7755";

-- step drop:fk:subtotal.subtotal__fk__482ed27a (additive)
-- operational risk: access-exclusive-lock
alter table "subtotal" drop constraint if exists "subtotal__fk__482ed27a";

-- step drop:fk:work_event.work_event__fk__a5b91c6f (additive)
-- operational risk: access-exclusive-lock
alter table "work_event" drop constraint if exists "work_event__fk__a5b91c6f";

-- step drop:fk:work_event_catalog.work_event_catalog__fk__482ed27a (additive)
-- operational risk: access-exclusive-lock
alter table "work_event_catalog" drop constraint if exists "work_event_catalog__fk__482ed27a";

-- step drop:fk:work_event_catalog.work_event_catalog__fk__4250ce3e (additive)
-- operational risk: access-exclusive-lock
alter table "work_event_catalog" drop constraint if exists "work_event_catalog__fk__4250ce3e";

-- step drop:fk:workplace_case_catalog.workplace_case_catalog__fk__482ed27a (additive)
-- operational risk: access-exclusive-lock
alter table "workplace_case_catalog" drop constraint if exists "workplace_case_catalog__fk__482ed27a";

-- step drop:fk:workplace_case_catalog.workplace_case_catalog__fk__4250ce3e (additive)
-- operational risk: access-exclusive-lock
alter table "workplace_case_catalog" drop constraint if exists "workplace_case_catalog__fk__4250ce3e";

-- step drop:fk:workplace_case_catalog_entry.workplace_case_catalog_entry__fk__28ed5dd1 (additive)
-- operational risk: access-exclusive-lock
alter table "workplace_case_catalog_entry" drop constraint if exists "workplace_case_catalog_entry__fk__28ed5dd1";

-- step drop:constraint:adhoc_catalog.adhoc_catalog__ck__b517fae2 (additive)
-- operational risk: access-exclusive-lock
alter table "adhoc_catalog" drop constraint if exists "adhoc_catalog__ck__b517fae2";

-- step drop:constraint:adhoc_catalog.adhoc_catalog__ck__6d503d68 (additive)
-- operational risk: access-exclusive-lock
alter table "adhoc_catalog" drop constraint if exists "adhoc_catalog__ck__6d503d68";

-- step drop:constraint:adhoc_catalog.adhoc_catalog__ck__34bc72af (additive)
-- operational risk: access-exclusive-lock
alter table "adhoc_catalog" drop constraint if exists "adhoc_catalog__ck__34bc72af";

-- step drop:constraint:adhoc_catalog.adhoc_catalog__ck__6531737b (additive)
-- operational risk: access-exclusive-lock
alter table "adhoc_catalog" drop constraint if exists "adhoc_catalog__ck__6531737b";

-- step drop:constraint:adhoc_catalog.adhoc_catalog__ck__856ea7dc (additive)
-- operational risk: access-exclusive-lock
alter table "adhoc_catalog" drop constraint if exists "adhoc_catalog__ck__856ea7dc";

-- step drop:constraint:adhoc_catalog.adhoc_catalog__ck__8450a3da (additive)
-- operational risk: access-exclusive-lock
alter table "adhoc_catalog" drop constraint if exists "adhoc_catalog__ck__8450a3da";

-- step drop:constraint:adhoc_catalog.adhoc_catalog__uq__257c93dc (additive)
-- operational risk: access-exclusive-lock
alter table "adhoc_catalog" drop constraint if exists "adhoc_catalog__uq__257c93dc";

-- step drop:constraint:allowance_catalog.allowance_catalog__ck__b517fae2 (additive)
-- operational risk: access-exclusive-lock
alter table "allowance_catalog" drop constraint if exists "allowance_catalog__ck__b517fae2";

-- step drop:constraint:allowance_catalog.allowance_catalog__ck__34bc72af (additive)
-- operational risk: access-exclusive-lock
alter table "allowance_catalog" drop constraint if exists "allowance_catalog__ck__34bc72af";

-- step drop:constraint:allowance_catalog.allowance_catalog__ck__6531737b (additive)
-- operational risk: access-exclusive-lock
alter table "allowance_catalog" drop constraint if exists "allowance_catalog__ck__6531737b";

-- step drop:constraint:allowance_catalog.allowance_catalog__ck__8450a3da (additive)
-- operational risk: access-exclusive-lock
alter table "allowance_catalog" drop constraint if exists "allowance_catalog__ck__8450a3da";

-- step drop:constraint:allowance_catalog.allowance_catalog__uq__257c93dc (additive)
-- operational risk: access-exclusive-lock
alter table "allowance_catalog" drop constraint if exists "allowance_catalog__uq__257c93dc";

-- step drop:constraint:claim_catalog.claim_catalog__ck__b517fae2 (additive)
-- operational risk: access-exclusive-lock
alter table "claim_catalog" drop constraint if exists "claim_catalog__ck__b517fae2";

-- step drop:constraint:claim_catalog.claim_catalog__ck__34bc72af (additive)
-- operational risk: access-exclusive-lock
alter table "claim_catalog" drop constraint if exists "claim_catalog__ck__34bc72af";

-- step drop:constraint:claim_catalog.claim_catalog__ck__6531737b (additive)
-- operational risk: access-exclusive-lock
alter table "claim_catalog" drop constraint if exists "claim_catalog__ck__6531737b";

-- step drop:constraint:claim_catalog.claim_catalog__ck__8450a3da (additive)
-- operational risk: access-exclusive-lock
alter table "claim_catalog" drop constraint if exists "claim_catalog__ck__8450a3da";

-- step drop:constraint:claim_catalog.claim_catalog__uq__257c93dc (additive)
-- operational risk: access-exclusive-lock
alter table "claim_catalog" drop constraint if exists "claim_catalog__uq__257c93dc";

-- step drop:constraint:jurisdiction_settings.jurisdiction_settings__ck__23b7bd00 (additive)
-- operational risk: access-exclusive-lock
alter table "jurisdiction_settings" drop constraint if exists "jurisdiction_settings__ck__23b7bd00";

-- step drop:constraint:jurisdiction_settings.jurisdiction_settings__ck__7414a4a0 (additive)
-- operational risk: access-exclusive-lock
alter table "jurisdiction_settings" drop constraint if exists "jurisdiction_settings__ck__7414a4a0";

-- step drop:constraint:jurisdiction_settings.jurisdiction_settings__ck__b16c6b5e (additive)
-- operational risk: access-exclusive-lock
alter table "jurisdiction_settings" drop constraint if exists "jurisdiction_settings__ck__b16c6b5e";

-- step drop:constraint:jurisdiction_settings.jurisdiction_settings__ck__edc0e89f (additive)
-- operational risk: access-exclusive-lock
alter table "jurisdiction_settings" drop constraint if exists "jurisdiction_settings__ck__edc0e89f";

-- step drop:constraint:jurisdiction_settings.jurisdiction_settings__ck__e1023647 (additive)
-- operational risk: access-exclusive-lock
alter table "jurisdiction_settings" drop constraint if exists "jurisdiction_settings__ck__e1023647";

-- step drop:constraint:jurisdiction_settings.jurisdiction_settings__ck__d56866f5 (additive)
-- operational risk: access-exclusive-lock
alter table "jurisdiction_settings" drop constraint if exists "jurisdiction_settings__ck__d56866f5";

-- step drop:constraint:jurisdiction_settings.jurisdiction_settings__ck__6531737b (additive)
-- operational risk: access-exclusive-lock
alter table "jurisdiction_settings" drop constraint if exists "jurisdiction_settings__ck__6531737b";

-- step drop:constraint:jurisdiction_settings.jurisdiction_settings__ck__a3a63477 (additive)
-- operational risk: access-exclusive-lock
alter table "jurisdiction_settings" drop constraint if exists "jurisdiction_settings__ck__a3a63477";

-- step drop:constraint:jurisdiction_settings.jurisdiction_settings__ck__07363679 (additive)
-- operational risk: access-exclusive-lock
alter table "jurisdiction_settings" drop constraint if exists "jurisdiction_settings__ck__07363679";

-- step drop:constraint:jurisdiction_settings.jurisdiction_settings__ck__195dbb6e (additive)
-- operational risk: access-exclusive-lock
alter table "jurisdiction_settings" drop constraint if exists "jurisdiction_settings__ck__195dbb6e";

-- step drop:constraint:jurisdiction_settings.jurisdiction_settings__ck__34db5fbb (additive)
-- operational risk: access-exclusive-lock
alter table "jurisdiction_settings" drop constraint if exists "jurisdiction_settings__ck__34db5fbb";

-- step drop:constraint:jurisdiction_settings.jurisdiction_settings__ex__d3ff5867 (additive)
-- operational risk: access-exclusive-lock
alter table "jurisdiction_settings" drop constraint if exists "jurisdiction_settings__ex__d3ff5867";

-- step drop:constraint:leave_catalog.leave_catalog__ck__34bc72af (additive)
-- operational risk: access-exclusive-lock
alter table "leave_catalog" drop constraint if exists "leave_catalog__ck__34bc72af";

-- step drop:constraint:leave_catalog.leave_catalog__ck__6531737b (additive)
-- operational risk: access-exclusive-lock
alter table "leave_catalog" drop constraint if exists "leave_catalog__ck__6531737b";

-- step drop:constraint:leave_catalog.leave_catalog__ck__8821d273 (additive)
-- operational risk: access-exclusive-lock
alter table "leave_catalog" drop constraint if exists "leave_catalog__ck__8821d273";

-- step drop:constraint:leave_catalog.leave_catalog__ck__f8d4002b (additive)
-- operational risk: access-exclusive-lock
alter table "leave_catalog" drop constraint if exists "leave_catalog__ck__f8d4002b";

-- step drop:constraint:leave_catalog.leave_catalog__ck__8450a3da (additive)
-- operational risk: access-exclusive-lock
alter table "leave_catalog" drop constraint if exists "leave_catalog__ck__8450a3da";

-- step drop:constraint:leave_catalog.leave_catalog__uq__257c93dc (additive)
-- operational risk: access-exclusive-lock
alter table "leave_catalog" drop constraint if exists "leave_catalog__uq__257c93dc";

-- step drop:constraint:loan_catalog.loan_catalog__ck__34bc72af (additive)
-- operational risk: access-exclusive-lock
alter table "loan_catalog" drop constraint if exists "loan_catalog__ck__34bc72af";

-- step drop:constraint:loan_catalog.loan_catalog__ck__6531737b (additive)
-- operational risk: access-exclusive-lock
alter table "loan_catalog" drop constraint if exists "loan_catalog__ck__6531737b";

-- step drop:constraint:loan_catalog.loan_catalog__ck__8450a3da (additive)
-- operational risk: access-exclusive-lock
alter table "loan_catalog" drop constraint if exists "loan_catalog__ck__8450a3da";

-- step drop:constraint:loan_catalog.loan_catalog__uq__257c93dc (additive)
-- operational risk: access-exclusive-lock
alter table "loan_catalog" drop constraint if exists "loan_catalog__uq__257c93dc";

-- step drop:constraint:overtime_catalog.overtime_catalog__ck__b517fae2 (additive)
-- operational risk: access-exclusive-lock
alter table "overtime_catalog" drop constraint if exists "overtime_catalog__ck__b517fae2";

-- step drop:constraint:overtime_catalog.overtime_catalog__ck__6d503d68 (additive)
-- operational risk: access-exclusive-lock
alter table "overtime_catalog" drop constraint if exists "overtime_catalog__ck__6d503d68";

-- step drop:constraint:overtime_catalog.overtime_catalog__ck__34bc72af (additive)
-- operational risk: access-exclusive-lock
alter table "overtime_catalog" drop constraint if exists "overtime_catalog__ck__34bc72af";

-- step drop:constraint:overtime_catalog.overtime_catalog__ck__6531737b (additive)
-- operational risk: access-exclusive-lock
alter table "overtime_catalog" drop constraint if exists "overtime_catalog__ck__6531737b";

-- step drop:constraint:overtime_catalog.overtime_catalog__ck__8450a3da (additive)
-- operational risk: access-exclusive-lock
alter table "overtime_catalog" drop constraint if exists "overtime_catalog__ck__8450a3da";

-- step drop:constraint:overtime_catalog.overtime_catalog__uq__257c93dc (additive)
-- operational risk: access-exclusive-lock
alter table "overtime_catalog" drop constraint if exists "overtime_catalog__uq__257c93dc";

-- step drop:constraint:registered_effect.registered_effect__ck__e2e52b1d (additive)
-- operational risk: access-exclusive-lock
alter table "registered_effect" drop constraint if exists "registered_effect__ck__e2e52b1d";

-- step drop:constraint:registered_effect.registered_effect__ck__39856cc7 (additive)
-- operational risk: access-exclusive-lock
alter table "registered_effect" drop constraint if exists "registered_effect__ck__39856cc7";

-- step drop:constraint:registered_effect.registered_effect__ck__a5d539d9 (additive)
-- operational risk: access-exclusive-lock
alter table "registered_effect" drop constraint if exists "registered_effect__ck__a5d539d9";

-- step drop:constraint:registered_effect.registered_effect__ck__6531737b (additive)
-- operational risk: access-exclusive-lock
alter table "registered_effect" drop constraint if exists "registered_effect__ck__6531737b";

-- step drop:constraint:registered_effect.registered_effect__ck__214b27e5 (additive)
-- operational risk: access-exclusive-lock
alter table "registered_effect" drop constraint if exists "registered_effect__ck__214b27e5";

-- step drop:constraint:registered_effect.registered_effect__ck__8450a3da (additive)
-- operational risk: access-exclusive-lock
alter table "registered_effect" drop constraint if exists "registered_effect__ck__8450a3da";

-- step drop:constraint:registered_effect.registered_effect__ck__fcea4370 (additive)
-- operational risk: access-exclusive-lock
alter table "registered_effect" drop constraint if exists "registered_effect__ck__fcea4370";

-- step drop:constraint:registered_effect.registered_effect__uq__257c93dc (additive)
-- operational risk: access-exclusive-lock
alter table "registered_effect" drop constraint if exists "registered_effect__uq__257c93dc";

-- step drop:constraint:registered_rule.registered_rule__ck__e2e52b1d (additive)
-- operational risk: access-exclusive-lock
alter table "registered_rule" drop constraint if exists "registered_rule__ck__e2e52b1d";

-- step drop:constraint:registered_rule.registered_rule__ck__8da0789d (additive)
-- operational risk: access-exclusive-lock
alter table "registered_rule" drop constraint if exists "registered_rule__ck__8da0789d";

-- step drop:constraint:registered_rule.registered_rule__ck__6531737b (additive)
-- operational risk: access-exclusive-lock
alter table "registered_rule" drop constraint if exists "registered_rule__ck__6531737b";

-- step drop:constraint:registered_rule.registered_rule__ck__214b27e5 (additive)
-- operational risk: access-exclusive-lock
alter table "registered_rule" drop constraint if exists "registered_rule__ck__214b27e5";

-- step drop:constraint:registered_rule.registered_rule__ck__8450a3da (additive)
-- operational risk: access-exclusive-lock
alter table "registered_rule" drop constraint if exists "registered_rule__ck__8450a3da";

-- step drop:constraint:registered_rule.registered_rule__ck__dba88d11 (additive)
-- operational risk: access-exclusive-lock
alter table "registered_rule" drop constraint if exists "registered_rule__ck__dba88d11";

-- step drop:constraint:registered_rule.registered_rule__uq__257c93dc (additive)
-- operational risk: access-exclusive-lock
alter table "registered_rule" drop constraint if exists "registered_rule__uq__257c93dc";

-- step drop:constraint:statutory_change.statutory_change__ck__30e69ba6 (additive)
-- operational risk: access-exclusive-lock
alter table "statutory_change" drop constraint if exists "statutory_change__ck__30e69ba6";

-- step drop:constraint:statutory_change.statutory_change__ck__73129686 (additive)
-- operational risk: access-exclusive-lock
alter table "statutory_change" drop constraint if exists "statutory_change__ck__73129686";

-- step drop:constraint:statutory_change.statutory_change__ck__ae52c15d (additive)
-- operational risk: access-exclusive-lock
alter table "statutory_change" drop constraint if exists "statutory_change__ck__ae52c15d";

-- step drop:constraint:statutory_change.statutory_change__uq__4b6ab814 (additive)
-- operational risk: access-exclusive-lock
alter table "statutory_change" drop constraint if exists "statutory_change__uq__4b6ab814";

-- step drop:constraint:statutory_contribution_catalog.statutory_contribution_catalog__ck__f3b3e425 (additive)
-- operational risk: access-exclusive-lock
alter table "statutory_contribution_catalog" drop constraint if exists "statutory_contribution_catalog__ck__f3b3e425";

-- step drop:constraint:statutory_contribution_catalog.statutory_contribution_catalog__ck__f7025387 (additive)
-- operational risk: access-exclusive-lock
alter table "statutory_contribution_catalog" drop constraint if exists "statutory_contribution_catalog__ck__f7025387";

-- step drop:constraint:statutory_contribution_catalog.statutory_contribution_catalog__ck__b6317af1 (additive)
-- operational risk: access-exclusive-lock
alter table "statutory_contribution_catalog" drop constraint if exists "statutory_contribution_catalog__ck__b6317af1";

-- step drop:constraint:statutory_contribution_catalog.statutory_contribution_catalog__ck__34bc72af (additive)
-- operational risk: access-exclusive-lock
alter table "statutory_contribution_catalog" drop constraint if exists "statutory_contribution_catalog__ck__34bc72af";

-- step drop:constraint:statutory_contribution_catalog.statutory_contribution_catalog__ck__032fe5c3 (additive)
-- operational risk: access-exclusive-lock
alter table "statutory_contribution_catalog" drop constraint if exists "statutory_contribution_catalog__ck__032fe5c3";

-- step drop:constraint:statutory_contribution_catalog.statutory_contribution_catalog__ck__6f537d84 (additive)
-- operational risk: access-exclusive-lock
alter table "statutory_contribution_catalog" drop constraint if exists "statutory_contribution_catalog__ck__6f537d84";

-- step drop:constraint:statutory_contribution_catalog.statutory_contribution_catalog__ck__e1149f53 (additive)
-- operational risk: access-exclusive-lock
alter table "statutory_contribution_catalog" drop constraint if exists "statutory_contribution_catalog__ck__e1149f53";

-- step drop:constraint:statutory_contribution_catalog.statutory_contribution_catalog__ck__6531737b (additive)
-- operational risk: access-exclusive-lock
alter table "statutory_contribution_catalog" drop constraint if exists "statutory_contribution_catalog__ck__6531737b";

-- step drop:constraint:statutory_contribution_catalog.statutory_contribution_catalog__ck__8450a3da (additive)
-- operational risk: access-exclusive-lock
alter table "statutory_contribution_catalog" drop constraint if exists "statutory_contribution_catalog__ck__8450a3da";

-- step drop:constraint:statutory_contribution_catalog.statutory_contribution_catalog__uq__257c93dc (additive)
-- operational risk: access-exclusive-lock
alter table "statutory_contribution_catalog" drop constraint if exists "statutory_contribution_catalog__uq__257c93dc";

-- step drop:constraint:statutory_finding.statutory_finding__ck__928cafd6 (additive)
-- operational risk: access-exclusive-lock
alter table "statutory_finding" drop constraint if exists "statutory_finding__ck__928cafd6";

-- step drop:constraint:subtotal.subtotal__ck__f7025387 (additive)
-- operational risk: access-exclusive-lock
alter table "subtotal" drop constraint if exists "subtotal__ck__f7025387";

-- step drop:constraint:subtotal.subtotal__ck__070cbe53 (additive)
-- operational risk: access-exclusive-lock
alter table "subtotal" drop constraint if exists "subtotal__ck__070cbe53";

-- step drop:constraint:subtotal.subtotal__uq__257c93dc (additive)
-- operational risk: access-exclusive-lock
alter table "subtotal" drop constraint if exists "subtotal__uq__257c93dc";

-- step drop:constraint:work_event_catalog.work_event_catalog__ck__6531737b (additive)
-- operational risk: access-exclusive-lock
alter table "work_event_catalog" drop constraint if exists "work_event_catalog__ck__6531737b";

-- step drop:constraint:work_event_catalog.work_event_catalog__ck__8450a3da (additive)
-- operational risk: access-exclusive-lock
alter table "work_event_catalog" drop constraint if exists "work_event_catalog__ck__8450a3da";

-- step drop:constraint:work_event_catalog.work_event_catalog__uq__257c93dc (additive)
-- operational risk: access-exclusive-lock
alter table "work_event_catalog" drop constraint if exists "work_event_catalog__uq__257c93dc";

-- step drop:constraint:workplace_case_catalog.workplace_case_catalog__ck__38965ec0 (additive)
-- operational risk: access-exclusive-lock
alter table "workplace_case_catalog" drop constraint if exists "workplace_case_catalog__ck__38965ec0";

-- step drop:constraint:workplace_case_catalog.workplace_case_catalog__ck__6531737b (additive)
-- operational risk: access-exclusive-lock
alter table "workplace_case_catalog" drop constraint if exists "workplace_case_catalog__ck__6531737b";

-- step drop:constraint:workplace_case_catalog.workplace_case_catalog__ck__8450a3da (additive)
-- operational risk: access-exclusive-lock
alter table "workplace_case_catalog" drop constraint if exists "workplace_case_catalog__ck__8450a3da";

-- step drop:constraint:workplace_case_catalog.workplace_case_catalog__uq__257c93dc (additive)
-- operational risk: access-exclusive-lock
alter table "workplace_case_catalog" drop constraint if exists "workplace_case_catalog__uq__257c93dc";

-- step drop:notNull:adhoc_catalog.code (additive)
-- operational risk: access-exclusive-lock
alter table "adhoc_catalog" alter column "code" drop not null;

-- step drop:notNull:adhoc_catalog.direction (additive)
-- operational risk: access-exclusive-lock
alter table "adhoc_catalog" alter column "direction" drop not null;

-- step drop:notNull:adhoc_catalog.lookup (additive)
-- operational risk: access-exclusive-lock
alter table "adhoc_catalog" alter column "lookup" drop not null;

-- step drop:notNull:adhoc_catalog.off_cycle_eligible (additive)
-- operational risk: access-exclusive-lock
alter table "adhoc_catalog" alter column "off_cycle_eligible" drop not null;

-- step drop:notNull:adhoc_catalog.party (additive)
-- operational risk: access-exclusive-lock
alter table "adhoc_catalog" alter column "party" drop not null;

-- step drop:notNull:allowance_catalog.code (additive)
-- operational risk: access-exclusive-lock
alter table "allowance_catalog" alter column "code" drop not null;

-- step drop:notNull:allowance_catalog.conversion (additive)
-- operational risk: access-exclusive-lock
alter table "allowance_catalog" alter column "conversion" drop not null;

-- step drop:notNull:allowance_catalog.eligibility (additive)
-- operational risk: access-exclusive-lock
alter table "allowance_catalog" alter column "eligibility" drop not null;

-- step drop:notNull:allowance_catalog.include_in_rate (additive)
-- operational risk: access-exclusive-lock
alter table "allowance_catalog" alter column "include_in_rate" drop not null;

-- step drop:notNull:allowance_catalog.lookup (additive)
-- operational risk: access-exclusive-lock
alter table "allowance_catalog" alter column "lookup" drop not null;

-- step drop:notNull:claim_catalog.code (additive)
-- operational risk: access-exclusive-lock
alter table "claim_catalog" alter column "code" drop not null;

-- step drop:notNull:claim_catalog.lookup (additive)
-- operational risk: access-exclusive-lock
alter table "claim_catalog" alter column "lookup" drop not null;

-- step drop:notNull:jurisdiction_settings.code (additive)
-- operational risk: access-exclusive-lock
alter table "jurisdiction_settings" alter column "code" drop not null;

-- step drop:notNull:jurisdiction_settings.conversions (additive)
-- operational risk: access-exclusive-lock
alter table "jurisdiction_settings" alter column "conversions" drop not null;

-- step drop:notNull:jurisdiction_settings.currency (additive)
-- operational risk: access-exclusive-lock
alter table "jurisdiction_settings" alter column "currency" drop not null;

-- step drop:notNull:jurisdiction_settings.effective_range (additive)
-- operational risk: access-exclusive-lock
alter table "jurisdiction_settings" alter column "effective_range" drop not null;

-- step drop:notNull:jurisdiction_settings.ledger (additive)
-- operational risk: access-exclusive-lock
alter table "jurisdiction_settings" alter column "ledger" drop not null;

-- step drop:notNull:jurisdiction_settings.lookup (additive)
-- operational risk: access-exclusive-lock
alter table "jurisdiction_settings" alter column "lookup" drop not null;

-- step drop:notNull:jurisdiction_settings.name (additive)
-- operational risk: access-exclusive-lock
alter table "jurisdiction_settings" alter column "name" drop not null;

-- step drop:notNull:jurisdiction_settings.status (additive)
-- operational risk: access-exclusive-lock
alter table "jurisdiction_settings" alter column "status" drop not null;

-- step drop:notNull:jurisdiction_settings.tax_year_start_month (additive)
-- operational risk: access-exclusive-lock
alter table "jurisdiction_settings" alter column "tax_year_start_month" drop not null;

-- step drop:notNull:jurisdiction_settings.timezone (additive)
-- operational risk: access-exclusive-lock
alter table "jurisdiction_settings" alter column "timezone" drop not null;

-- step drop:notNull:jurisdiction_settings.work_regions (additive)
-- operational risk: access-exclusive-lock
alter table "jurisdiction_settings" alter column "work_regions" drop not null;

-- step drop:notNull:leave_catalog.code (additive)
-- operational risk: access-exclusive-lock
alter table "leave_catalog" alter column "code" drop not null;

-- step drop:notNull:leave_catalog.lookup (additive)
-- operational risk: access-exclusive-lock
alter table "leave_catalog" alter column "lookup" drop not null;

-- step drop:notNull:loan_catalog.code (additive)
-- operational risk: access-exclusive-lock
alter table "loan_catalog" alter column "code" drop not null;

-- step drop:notNull:loan_catalog.lookup (additive)
-- operational risk: access-exclusive-lock
alter table "loan_catalog" alter column "lookup" drop not null;

-- step drop:notNull:overtime_catalog.code (additive)
-- operational risk: access-exclusive-lock
alter table "overtime_catalog" alter column "code" drop not null;

-- step drop:notNull:overtime_catalog.conversion (additive)
-- operational risk: access-exclusive-lock
alter table "overtime_catalog" alter column "conversion" drop not null;

-- step drop:notNull:overtime_catalog.direction (additive)
-- operational risk: access-exclusive-lock
alter table "overtime_catalog" alter column "direction" drop not null;

-- step drop:notNull:overtime_catalog.eligibility (additive)
-- operational risk: access-exclusive-lock
alter table "overtime_catalog" alter column "eligibility" drop not null;

-- step drop:notNull:overtime_catalog.lookup (additive)
-- operational risk: access-exclusive-lock
alter table "overtime_catalog" alter column "lookup" drop not null;

-- step drop:notNull:registered_effect.code (additive)
-- operational risk: access-exclusive-lock
alter table "registered_effect" alter column "code" drop not null;

-- step drop:notNull:registered_effect.condition (additive)
-- operational risk: access-exclusive-lock
alter table "registered_effect" alter column "condition" drop not null;

-- step drop:notNull:registered_effect.effects (additive)
-- operational risk: access-exclusive-lock
alter table "registered_effect" alter column "effects" drop not null;

-- step drop:notNull:registered_effect.events (additive)
-- operational risk: access-exclusive-lock
alter table "registered_effect" alter column "events" drop not null;

-- step drop:notNull:registered_effect.lookup (additive)
-- operational risk: access-exclusive-lock
alter table "registered_effect" alter column "lookup" drop not null;

-- step drop:notNull:registered_effect.name (additive)
-- operational risk: access-exclusive-lock
alter table "registered_effect" alter column "name" drop not null;

-- step drop:notNull:registered_effect.source_collection (additive)
-- operational risk: access-exclusive-lock
alter table "registered_effect" alter column "source_collection" drop not null;

-- step drop:notNull:registered_effect.target_action (additive)
-- operational risk: access-exclusive-lock
alter table "registered_effect" alter column "target_action" drop not null;

-- step drop:notNull:registered_effect.target_collection (additive)
-- operational risk: access-exclusive-lock
alter table "registered_effect" alter column "target_collection" drop not null;

-- step drop:notNull:registered_rule.code (additive)
-- operational risk: access-exclusive-lock
alter table "registered_rule" alter column "code" drop not null;

-- step drop:notNull:registered_rule.events (additive)
-- operational risk: access-exclusive-lock
alter table "registered_rule" alter column "events" drop not null;

-- step drop:notNull:registered_rule.lookup (additive)
-- operational risk: access-exclusive-lock
alter table "registered_rule" alter column "lookup" drop not null;

-- step drop:notNull:registered_rule.order (additive)
-- operational risk: access-exclusive-lock
alter table "registered_rule" alter column "order" drop not null;

-- step drop:notNull:registered_rule.target_collection (additive)
-- operational risk: access-exclusive-lock
alter table "registered_rule" alter column "target_collection" drop not null;

-- step drop:notNull:registered_rule.validate (additive)
-- operational risk: access-exclusive-lock
alter table "registered_rule" alter column "validate" drop not null;

-- step drop:notNull:statutory_change.family (additive)
-- operational risk: access-exclusive-lock
alter table "statutory_change" alter column "family" drop not null;

-- step drop:notNull:statutory_change.field_path (additive)
-- operational risk: access-exclusive-lock
alter table "statutory_change" alter column "field_path" drop not null;

-- step drop:notNull:statutory_change.jurisdiction_code (additive)
-- operational risk: access-exclusive-lock
alter table "statutory_change" alter column "jurisdiction_code" drop not null;

-- step drop:notNull:statutory_contribution_catalog.assessed (additive)
-- operational risk: access-exclusive-lock
alter table "statutory_contribution_catalog" alter column "assessed" drop not null;

-- step drop:notNull:statutory_contribution_catalog.balance_window (additive)
-- operational risk: access-exclusive-lock
alter table "statutory_contribution_catalog" alter column "balance_window" drop not null;

-- step drop:notNull:statutory_contribution_catalog.code (additive)
-- operational risk: access-exclusive-lock
alter table "statutory_contribution_catalog" alter column "code" drop not null;

-- step drop:notNull:statutory_contribution_catalog.eligibility (additive)
-- operational risk: access-exclusive-lock
alter table "statutory_contribution_catalog" alter column "eligibility" drop not null;

-- step drop:notNull:statutory_contribution_catalog.employee_amount (additive)
-- operational risk: access-exclusive-lock
alter table "statutory_contribution_catalog" alter column "employee_amount" drop not null;

-- step drop:notNull:statutory_contribution_catalog.kind (additive)
-- operational risk: access-exclusive-lock
alter table "statutory_contribution_catalog" alter column "kind" drop not null;

-- step drop:notNull:statutory_contribution_catalog.lookup (additive)
-- operational risk: access-exclusive-lock
alter table "statutory_contribution_catalog" alter column "lookup" drop not null;

-- step drop:notNull:subtotal.balance_window (additive)
-- operational risk: access-exclusive-lock
alter table "subtotal" alter column "balance_window" drop not null;

-- step drop:notNull:subtotal.code (additive)
-- operational risk: access-exclusive-lock
alter table "subtotal" alter column "code" drop not null;

-- step drop:notNull:subtotal.name (additive)
-- operational risk: access-exclusive-lock
alter table "subtotal" alter column "name" drop not null;

-- step drop:notNull:work_event_catalog.code (additive)
-- operational risk: access-exclusive-lock
alter table "work_event_catalog" alter column "code" drop not null;

-- step drop:notNull:work_event_catalog.lookup (additive)
-- operational risk: access-exclusive-lock
alter table "work_event_catalog" alter column "lookup" drop not null;

-- step drop:notNull:workplace_case_catalog.code (additive)
-- operational risk: access-exclusive-lock
alter table "workplace_case_catalog" alter column "code" drop not null;

-- step drop:notNull:workplace_case_catalog.events (additive)
-- operational risk: access-exclusive-lock
alter table "workplace_case_catalog" alter column "events" drop not null;

-- step drop:notNull:workplace_case_catalog.lookup (additive)
-- operational risk: access-exclusive-lock
alter table "workplace_case_catalog" alter column "lookup" drop not null;

-- step drop:notNull:adhoc_catalog.settings_id (additive)
-- operational risk: access-exclusive-lock
alter table "adhoc_catalog" alter column "settings_id" drop not null;

-- step drop:notNull:adhoc_catalog_entry.catalog_id (additive)
-- operational risk: access-exclusive-lock
alter table "adhoc_catalog_entry" alter column "catalog_id" drop not null;

-- step drop:notNull:allowance_catalog.settings_id (additive)
-- operational risk: access-exclusive-lock
alter table "allowance_catalog" alter column "settings_id" drop not null;

-- step drop:notNull:claim_catalog.settings_id (additive)
-- operational risk: access-exclusive-lock
alter table "claim_catalog" alter column "settings_id" drop not null;

-- step drop:notNull:claim_catalog_entry.catalog_id (additive)
-- operational risk: access-exclusive-lock
alter table "claim_catalog_entry" alter column "catalog_id" drop not null;

-- step drop:notNull:entity_profile_version.input_schema_version_id (additive)
-- operational risk: access-exclusive-lock
alter table "entity_profile_version" alter column "input_schema_version_id" drop not null;

-- step drop:notNull:leave_catalog.settings_id (additive)
-- operational risk: access-exclusive-lock
alter table "leave_catalog" alter column "settings_id" drop not null;

-- step drop:notNull:leave_catalog_entry.catalog_id (additive)
-- operational risk: access-exclusive-lock
alter table "leave_catalog_entry" alter column "catalog_id" drop not null;

-- step drop:notNull:loan_catalog.settings_id (additive)
-- operational risk: access-exclusive-lock
alter table "loan_catalog" alter column "settings_id" drop not null;

-- step drop:notNull:loan_catalog_entry.catalog_id (additive)
-- operational risk: access-exclusive-lock
alter table "loan_catalog_entry" alter column "catalog_id" drop not null;

-- step drop:notNull:overtime_catalog.settings_id (additive)
-- operational risk: access-exclusive-lock
alter table "overtime_catalog" alter column "settings_id" drop not null;

-- step drop:notNull:overtime_catalog.subtotal_id (additive)
-- operational risk: access-exclusive-lock
alter table "overtime_catalog" alter column "subtotal_id" drop not null;

-- step drop:notNull:payroll_run.settings_id (additive)
-- operational risk: access-exclusive-lock
alter table "payroll_run" alter column "settings_id" drop not null;

-- step drop:notNull:payslip.settings_id (additive)
-- operational risk: access-exclusive-lock
alter table "payslip" alter column "settings_id" drop not null;

-- step drop:notNull:registered_effect.settings_id (additive)
-- operational risk: access-exclusive-lock
alter table "registered_effect" alter column "settings_id" drop not null;

-- step drop:notNull:registered_rule.settings_id (additive)
-- operational risk: access-exclusive-lock
alter table "registered_rule" alter column "settings_id" drop not null;

-- step drop:notNull:statutory_change.baseline_version_id (additive)
-- operational risk: access-exclusive-lock
alter table "statutory_change" alter column "baseline_version_id" drop not null;

-- step drop:notNull:statutory_change.finding_id (additive)
-- operational risk: access-exclusive-lock
alter table "statutory_change" alter column "finding_id" drop not null;

-- step drop:notNull:statutory_contribution_catalog.settings_id (additive)
-- operational risk: access-exclusive-lock
alter table "statutory_contribution_catalog" alter column "settings_id" drop not null;

-- step drop:notNull:statutory_contribution_catalog.subtotal_id (additive)
-- operational risk: access-exclusive-lock
alter table "statutory_contribution_catalog" alter column "subtotal_id" drop not null;

-- step drop:notNull:subtotal.settings_id (additive)
-- operational risk: access-exclusive-lock
alter table "subtotal" alter column "settings_id" drop not null;

-- step drop:notNull:work_event.catalog_id (additive)
-- operational risk: access-exclusive-lock
alter table "work_event" alter column "catalog_id" drop not null;

-- step drop:notNull:work_event_catalog.settings_id (additive)
-- operational risk: access-exclusive-lock
alter table "work_event_catalog" alter column "settings_id" drop not null;

-- step drop:notNull:workplace_case_catalog.settings_id (additive)
-- operational risk: access-exclusive-lock
alter table "workplace_case_catalog" alter column "settings_id" drop not null;

-- step drop:notNull:workplace_case_catalog_entry.catalog_id (additive)
-- operational risk: access-exclusive-lock
alter table "workplace_case_catalog_entry" alter column "catalog_id" drop not null;

-- step drop:default:adhoc_catalog.direction (additive)
-- operational risk: access-exclusive-lock
alter table "adhoc_catalog" alter column "direction" drop default;

-- step drop:default:adhoc_catalog.lookup (additive)
-- operational risk: access-exclusive-lock
alter table "adhoc_catalog" alter column "lookup" drop default;

-- step drop:default:adhoc_catalog.party (additive)
-- operational risk: access-exclusive-lock
alter table "adhoc_catalog" alter column "party" drop default;

-- step drop:default:allowance_catalog.include_in_rate (additive)
-- operational risk: access-exclusive-lock
alter table "allowance_catalog" alter column "include_in_rate" drop default;

-- step drop:default:allowance_catalog.lookup (additive)
-- operational risk: access-exclusive-lock
alter table "allowance_catalog" alter column "lookup" drop default;

-- step drop:default:claim_catalog.lookup (additive)
-- operational risk: access-exclusive-lock
alter table "claim_catalog" alter column "lookup" drop default;

-- step drop:default:jurisdiction_settings.lookup (additive)
-- operational risk: access-exclusive-lock
alter table "jurisdiction_settings" alter column "lookup" drop default;

-- step drop:default:jurisdiction_settings.status (additive)
-- operational risk: access-exclusive-lock
alter table "jurisdiction_settings" alter column "status" drop default;

-- step drop:default:jurisdiction_settings.work_regions (additive)
-- operational risk: access-exclusive-lock
alter table "jurisdiction_settings" alter column "work_regions" drop default;

-- step drop:default:leave_catalog.lookup (additive)
-- operational risk: access-exclusive-lock
alter table "leave_catalog" alter column "lookup" drop default;

-- step drop:default:loan_catalog.lookup (additive)
-- operational risk: access-exclusive-lock
alter table "loan_catalog" alter column "lookup" drop default;

-- step drop:default:overtime_catalog.lookup (additive)
-- operational risk: access-exclusive-lock
alter table "overtime_catalog" alter column "lookup" drop default;

-- step drop:default:registered_effect.lookup (additive)
-- operational risk: access-exclusive-lock
alter table "registered_effect" alter column "lookup" drop default;

-- step drop:default:registered_rule.lookup (additive)
-- operational risk: access-exclusive-lock
alter table "registered_rule" alter column "lookup" drop default;

-- step drop:default:registered_rule.order (additive)
-- operational risk: access-exclusive-lock
alter table "registered_rule" alter column "order" drop default;

-- step drop:default:statutory_contribution_catalog.assessed (additive)
-- operational risk: access-exclusive-lock
alter table "statutory_contribution_catalog" alter column "assessed" drop default;

-- step drop:default:statutory_contribution_catalog.balance_window (additive)
-- operational risk: access-exclusive-lock
alter table "statutory_contribution_catalog" alter column "balance_window" drop default;

-- step drop:default:statutory_contribution_catalog.lookup (additive)
-- operational risk: access-exclusive-lock
alter table "statutory_contribution_catalog" alter column "lookup" drop default;

-- step drop:default:subtotal.balance_window (additive)
-- operational risk: access-exclusive-lock
alter table "subtotal" alter column "balance_window" drop default;

-- step drop:default:work_event_catalog.lookup (additive)
-- operational risk: access-exclusive-lock
alter table "work_event_catalog" alter column "lookup" drop default;

-- step drop:default:workplace_case_catalog.events (additive)
-- operational risk: access-exclusive-lock
alter table "workplace_case_catalog" alter column "events" drop default;

-- step drop:default:workplace_case_catalog.lookup (additive)
-- operational risk: access-exclusive-lock
alter table "workplace_case_catalog" alter column "lookup" drop default;

-- step drop:column:adhoc_catalog.code (destructive)
-- accept: drop:column:adhoc_catalog.code
-- operational risk: access-exclusive-lock
alter table "adhoc_catalog" drop column if exists "code" cascade;

-- step drop:column:adhoc_catalog.conversion (destructive)
-- accept: drop:column:adhoc_catalog.conversion
-- operational risk: access-exclusive-lock
alter table "adhoc_catalog" drop column if exists "conversion" cascade;

-- step drop:column:adhoc_catalog.description (destructive)
-- accept: drop:column:adhoc_catalog.description
-- operational risk: access-exclusive-lock
alter table "adhoc_catalog" drop column if exists "description" cascade;

-- step drop:column:adhoc_catalog.direction (destructive)
-- accept: drop:column:adhoc_catalog.direction
-- operational risk: access-exclusive-lock
alter table "adhoc_catalog" drop column if exists "direction" cascade;

-- step drop:column:adhoc_catalog.eligibility (destructive)
-- accept: drop:column:adhoc_catalog.eligibility
-- operational risk: access-exclusive-lock
alter table "adhoc_catalog" drop column if exists "eligibility" cascade;

-- step drop:column:adhoc_catalog.lookup (destructive)
-- accept: drop:column:adhoc_catalog.lookup
-- operational risk: access-exclusive-lock
alter table "adhoc_catalog" drop column if exists "lookup" cascade;

-- step drop:column:adhoc_catalog.off_cycle_eligible (destructive)
-- accept: drop:column:adhoc_catalog.off_cycle_eligible
-- operational risk: access-exclusive-lock
alter table "adhoc_catalog" drop column if exists "off_cycle_eligible" cascade;

-- step drop:column:adhoc_catalog.party (destructive)
-- accept: drop:column:adhoc_catalog.party
-- operational risk: access-exclusive-lock
alter table "adhoc_catalog" drop column if exists "party" cascade;

-- step drop:column:adhoc_catalog.references (destructive)
-- accept: drop:column:adhoc_catalog.references
-- operational risk: access-exclusive-lock
alter table "adhoc_catalog" drop column if exists "references" cascade;

-- step drop:column:adhoc_catalog.bolt_record_label (additive)
-- operational risk: access-exclusive-lock
alter table "adhoc_catalog" drop column if exists "bolt_record_label" cascade;

-- step drop:column:adhoc_catalog.bolt_search (additive)
-- operational risk: access-exclusive-lock
alter table "adhoc_catalog" drop column if exists bolt_search cascade;

-- step drop:column:allowance_catalog.code (destructive)
-- accept: drop:column:allowance_catalog.code
-- operational risk: access-exclusive-lock
alter table "allowance_catalog" drop column if exists "code" cascade;

-- step drop:column:allowance_catalog.conversion (destructive)
-- accept: drop:column:allowance_catalog.conversion
-- operational risk: access-exclusive-lock
alter table "allowance_catalog" drop column if exists "conversion" cascade;

-- step drop:column:allowance_catalog.description (destructive)
-- accept: drop:column:allowance_catalog.description
-- operational risk: access-exclusive-lock
alter table "allowance_catalog" drop column if exists "description" cascade;

-- step drop:column:allowance_catalog.eligibility (destructive)
-- accept: drop:column:allowance_catalog.eligibility
-- operational risk: access-exclusive-lock
alter table "allowance_catalog" drop column if exists "eligibility" cascade;

-- step drop:column:allowance_catalog.include_in_rate (destructive)
-- accept: drop:column:allowance_catalog.include_in_rate
-- operational risk: access-exclusive-lock
alter table "allowance_catalog" drop column if exists "include_in_rate" cascade;

-- step drop:column:allowance_catalog.lookup (destructive)
-- accept: drop:column:allowance_catalog.lookup
-- operational risk: access-exclusive-lock
alter table "allowance_catalog" drop column if exists "lookup" cascade;

-- step drop:column:allowance_catalog.references (destructive)
-- accept: drop:column:allowance_catalog.references
-- operational risk: access-exclusive-lock
alter table "allowance_catalog" drop column if exists "references" cascade;

-- step drop:column:allowance_catalog.bolt_record_label (additive)
-- operational risk: access-exclusive-lock
alter table "allowance_catalog" drop column if exists "bolt_record_label" cascade;

-- step drop:column:allowance_catalog.bolt_search (additive)
-- operational risk: access-exclusive-lock
alter table "allowance_catalog" drop column if exists bolt_search cascade;

-- step drop:column:claim_catalog.code (destructive)
-- accept: drop:column:claim_catalog.code
-- operational risk: access-exclusive-lock
alter table "claim_catalog" drop column if exists "code" cascade;

-- step drop:column:claim_catalog.conversion (destructive)
-- accept: drop:column:claim_catalog.conversion
-- operational risk: access-exclusive-lock
alter table "claim_catalog" drop column if exists "conversion" cascade;

-- step drop:column:claim_catalog.description (destructive)
-- accept: drop:column:claim_catalog.description
-- operational risk: access-exclusive-lock
alter table "claim_catalog" drop column if exists "description" cascade;

-- step drop:column:claim_catalog.eligibility (destructive)
-- accept: drop:column:claim_catalog.eligibility
-- operational risk: access-exclusive-lock
alter table "claim_catalog" drop column if exists "eligibility" cascade;

-- step drop:column:claim_catalog.lookup (destructive)
-- accept: drop:column:claim_catalog.lookup
-- operational risk: access-exclusive-lock
alter table "claim_catalog" drop column if exists "lookup" cascade;

-- step drop:column:claim_catalog.references (destructive)
-- accept: drop:column:claim_catalog.references
-- operational risk: access-exclusive-lock
alter table "claim_catalog" drop column if exists "references" cascade;

-- step drop:column:claim_catalog.bolt_record_label (additive)
-- operational risk: access-exclusive-lock
alter table "claim_catalog" drop column if exists "bolt_record_label" cascade;

-- step drop:column:claim_catalog.bolt_search (additive)
-- operational risk: access-exclusive-lock
alter table "claim_catalog" drop column if exists bolt_search cascade;

-- step drop:column:jurisdiction_settings.code (destructive)
-- accept: drop:column:jurisdiction_settings.code
-- operational risk: access-exclusive-lock
alter table "jurisdiction_settings" drop column if exists "code" cascade;

-- step drop:column:jurisdiction_settings.conversions (destructive)
-- accept: drop:column:jurisdiction_settings.conversions
-- operational risk: access-exclusive-lock
alter table "jurisdiction_settings" drop column if exists "conversions" cascade;

-- step drop:column:jurisdiction_settings.currency (destructive)
-- accept: drop:column:jurisdiction_settings.currency
-- operational risk: access-exclusive-lock
alter table "jurisdiction_settings" drop column if exists "currency" cascade;

-- step drop:column:jurisdiction_settings.effective_range (destructive)
-- accept: drop:column:jurisdiction_settings.effective_range
-- operational risk: access-exclusive-lock
alter table "jurisdiction_settings" drop column if exists "effective_range" cascade;

-- step drop:column:jurisdiction_settings.employee_extension_schema (destructive)
-- accept: drop:column:jurisdiction_settings.employee_extension_schema
-- operational risk: access-exclusive-lock
alter table "jurisdiction_settings" drop column if exists "employee_extension_schema" cascade;

-- step drop:column:jurisdiction_settings.entity_extension_schema (destructive)
-- accept: drop:column:jurisdiction_settings.entity_extension_schema
-- operational risk: access-exclusive-lock
alter table "jurisdiction_settings" drop column if exists "entity_extension_schema" cascade;

-- step drop:column:jurisdiction_settings.ledger (destructive)
-- accept: drop:column:jurisdiction_settings.ledger
-- operational risk: access-exclusive-lock
alter table "jurisdiction_settings" drop column if exists "ledger" cascade;

-- step drop:column:jurisdiction_settings.lookup (destructive)
-- accept: drop:column:jurisdiction_settings.lookup
-- operational risk: access-exclusive-lock
alter table "jurisdiction_settings" drop column if exists "lookup" cascade;

-- step drop:column:jurisdiction_settings.name (destructive)
-- accept: drop:column:jurisdiction_settings.name
-- operational risk: access-exclusive-lock
alter table "jurisdiction_settings" drop column if exists "name" cascade;

-- step drop:column:jurisdiction_settings.reason (destructive)
-- accept: drop:column:jurisdiction_settings.reason
-- operational risk: access-exclusive-lock
alter table "jurisdiction_settings" drop column if exists "reason" cascade;

-- step drop:column:jurisdiction_settings.status (destructive)
-- accept: drop:column:jurisdiction_settings.status
-- operational risk: access-exclusive-lock
alter table "jurisdiction_settings" drop column if exists "status" cascade;

-- step drop:column:jurisdiction_settings.tax_year_start_month (destructive)
-- accept: drop:column:jurisdiction_settings.tax_year_start_month
-- operational risk: access-exclusive-lock
alter table "jurisdiction_settings" drop column if exists "tax_year_start_month" cascade;

-- step drop:column:jurisdiction_settings.timezone (destructive)
-- accept: drop:column:jurisdiction_settings.timezone
-- operational risk: access-exclusive-lock
alter table "jurisdiction_settings" drop column if exists "timezone" cascade;

-- step drop:column:jurisdiction_settings.work_regions (destructive)
-- accept: drop:column:jurisdiction_settings.work_regions
-- operational risk: access-exclusive-lock
alter table "jurisdiction_settings" drop column if exists "work_regions" cascade;

-- step drop:column:jurisdiction_settings.bolt_record_label (additive)
-- operational risk: access-exclusive-lock
alter table "jurisdiction_settings" drop column if exists "bolt_record_label" cascade;

-- step drop:column:jurisdiction_settings.bolt_search (additive)
-- operational risk: access-exclusive-lock
alter table "jurisdiction_settings" drop column if exists bolt_search cascade;

-- step drop:column:leave_catalog.code (destructive)
-- accept: drop:column:leave_catalog.code
-- operational risk: access-exclusive-lock
alter table "leave_catalog" drop column if exists "code" cascade;

-- step drop:column:leave_catalog.description (destructive)
-- accept: drop:column:leave_catalog.description
-- operational risk: access-exclusive-lock
alter table "leave_catalog" drop column if exists "description" cascade;

-- step drop:column:leave_catalog.eligibility (destructive)
-- accept: drop:column:leave_catalog.eligibility
-- operational risk: access-exclusive-lock
alter table "leave_catalog" drop column if exists "eligibility" cascade;

-- step drop:column:leave_catalog.lookup (destructive)
-- accept: drop:column:leave_catalog.lookup
-- operational risk: access-exclusive-lock
alter table "leave_catalog" drop column if exists "lookup" cascade;

-- step drop:column:leave_catalog.paid_share (destructive)
-- accept: drop:column:leave_catalog.paid_share
-- operational risk: access-exclusive-lock
alter table "leave_catalog" drop column if exists "paid_share" cascade;

-- step drop:column:leave_catalog.payout (destructive)
-- accept: drop:column:leave_catalog.payout
-- operational risk: access-exclusive-lock
alter table "leave_catalog" drop column if exists "payout" cascade;

-- step drop:column:leave_catalog.references (destructive)
-- accept: drop:column:leave_catalog.references
-- operational risk: access-exclusive-lock
alter table "leave_catalog" drop column if exists "references" cascade;

-- step drop:column:leave_catalog.bolt_record_label (additive)
-- operational risk: access-exclusive-lock
alter table "leave_catalog" drop column if exists "bolt_record_label" cascade;

-- step drop:column:leave_catalog.bolt_search (additive)
-- operational risk: access-exclusive-lock
alter table "leave_catalog" drop column if exists bolt_search cascade;

-- step drop:column:loan_catalog.code (destructive)
-- accept: drop:column:loan_catalog.code
-- operational risk: access-exclusive-lock
alter table "loan_catalog" drop column if exists "code" cascade;

-- step drop:column:loan_catalog.description (destructive)
-- accept: drop:column:loan_catalog.description
-- operational risk: access-exclusive-lock
alter table "loan_catalog" drop column if exists "description" cascade;

-- step drop:column:loan_catalog.eligibility (destructive)
-- accept: drop:column:loan_catalog.eligibility
-- operational risk: access-exclusive-lock
alter table "loan_catalog" drop column if exists "eligibility" cascade;

-- step drop:column:loan_catalog.lookup (destructive)
-- accept: drop:column:loan_catalog.lookup
-- operational risk: access-exclusive-lock
alter table "loan_catalog" drop column if exists "lookup" cascade;

-- step drop:column:loan_catalog.references (destructive)
-- accept: drop:column:loan_catalog.references
-- operational risk: access-exclusive-lock
alter table "loan_catalog" drop column if exists "references" cascade;

-- step drop:column:loan_catalog.bolt_record_label (additive)
-- operational risk: access-exclusive-lock
alter table "loan_catalog" drop column if exists "bolt_record_label" cascade;

-- step drop:column:loan_catalog.bolt_search (additive)
-- operational risk: access-exclusive-lock
alter table "loan_catalog" drop column if exists bolt_search cascade;

-- step drop:column:overtime_catalog.code (destructive)
-- accept: drop:column:overtime_catalog.code
-- operational risk: access-exclusive-lock
alter table "overtime_catalog" drop column if exists "code" cascade;

-- step drop:column:overtime_catalog.conversion (destructive)
-- accept: drop:column:overtime_catalog.conversion
-- operational risk: access-exclusive-lock
alter table "overtime_catalog" drop column if exists "conversion" cascade;

-- step drop:column:overtime_catalog.description (destructive)
-- accept: drop:column:overtime_catalog.description
-- operational risk: access-exclusive-lock
alter table "overtime_catalog" drop column if exists "description" cascade;

-- step drop:column:overtime_catalog.direction (destructive)
-- accept: drop:column:overtime_catalog.direction
-- operational risk: access-exclusive-lock
alter table "overtime_catalog" drop column if exists "direction" cascade;

-- step drop:column:overtime_catalog.eligibility (destructive)
-- accept: drop:column:overtime_catalog.eligibility
-- operational risk: access-exclusive-lock
alter table "overtime_catalog" drop column if exists "eligibility" cascade;

-- step drop:column:overtime_catalog.lookup (destructive)
-- accept: drop:column:overtime_catalog.lookup
-- operational risk: access-exclusive-lock
alter table "overtime_catalog" drop column if exists "lookup" cascade;

-- step drop:column:overtime_catalog.references (destructive)
-- accept: drop:column:overtime_catalog.references
-- operational risk: access-exclusive-lock
alter table "overtime_catalog" drop column if exists "references" cascade;

-- step drop:column:overtime_catalog.bolt_record_label (additive)
-- operational risk: access-exclusive-lock
alter table "overtime_catalog" drop column if exists "bolt_record_label" cascade;

-- step drop:column:overtime_catalog.bolt_search (additive)
-- operational risk: access-exclusive-lock
alter table "overtime_catalog" drop column if exists bolt_search cascade;

-- step drop:column:registered_effect.code (destructive)
-- accept: drop:column:registered_effect.code
-- operational risk: access-exclusive-lock
alter table "registered_effect" drop column if exists "code" cascade;

-- step drop:column:registered_effect.condition (destructive)
-- accept: drop:column:registered_effect.condition
-- operational risk: access-exclusive-lock
alter table "registered_effect" drop column if exists "condition" cascade;

-- step drop:column:registered_effect.description (destructive)
-- accept: drop:column:registered_effect.description
-- operational risk: access-exclusive-lock
alter table "registered_effect" drop column if exists "description" cascade;

-- step drop:column:registered_effect.effects (destructive)
-- accept: drop:column:registered_effect.effects
-- operational risk: access-exclusive-lock
alter table "registered_effect" drop column if exists "effects" cascade;

-- step drop:column:registered_effect.events (destructive)
-- accept: drop:column:registered_effect.events
-- operational risk: access-exclusive-lock
alter table "registered_effect" drop column if exists "events" cascade;

-- step drop:column:registered_effect.lookup (destructive)
-- accept: drop:column:registered_effect.lookup
-- operational risk: access-exclusive-lock
alter table "registered_effect" drop column if exists "lookup" cascade;

-- step drop:column:registered_effect.name (destructive)
-- accept: drop:column:registered_effect.name
-- operational risk: access-exclusive-lock
alter table "registered_effect" drop column if exists "name" cascade;

-- step drop:column:registered_effect.reads (destructive)
-- accept: drop:column:registered_effect.reads
-- operational risk: access-exclusive-lock
alter table "registered_effect" drop column if exists "reads" cascade;

-- step drop:column:registered_effect.references (destructive)
-- accept: drop:column:registered_effect.references
-- operational risk: access-exclusive-lock
alter table "registered_effect" drop column if exists "references" cascade;

-- step drop:column:registered_effect.source_collection (destructive)
-- accept: drop:column:registered_effect.source_collection
-- operational risk: access-exclusive-lock
alter table "registered_effect" drop column if exists "source_collection" cascade;

-- step drop:column:registered_effect.target_action (destructive)
-- accept: drop:column:registered_effect.target_action
-- operational risk: access-exclusive-lock
alter table "registered_effect" drop column if exists "target_action" cascade;

-- step drop:column:registered_effect.target_collection (destructive)
-- accept: drop:column:registered_effect.target_collection
-- operational risk: access-exclusive-lock
alter table "registered_effect" drop column if exists "target_collection" cascade;

-- step drop:column:registered_effect.bolt_record_label (additive)
-- operational risk: access-exclusive-lock
alter table "registered_effect" drop column if exists "bolt_record_label" cascade;

-- step drop:column:registered_effect.bolt_search (additive)
-- operational risk: access-exclusive-lock
alter table "registered_effect" drop column if exists bolt_search cascade;

-- step drop:column:registered_rule.code (destructive)
-- accept: drop:column:registered_rule.code
-- operational risk: access-exclusive-lock
alter table "registered_rule" drop column if exists "code" cascade;

-- step drop:column:registered_rule.condition (destructive)
-- accept: drop:column:registered_rule.condition
-- operational risk: access-exclusive-lock
alter table "registered_rule" drop column if exists "condition" cascade;

-- step drop:column:registered_rule.description (destructive)
-- accept: drop:column:registered_rule.description
-- operational risk: access-exclusive-lock
alter table "registered_rule" drop column if exists "description" cascade;

-- step drop:column:registered_rule.events (destructive)
-- accept: drop:column:registered_rule.events
-- operational risk: access-exclusive-lock
alter table "registered_rule" drop column if exists "events" cascade;

-- step drop:column:registered_rule.lookup (destructive)
-- accept: drop:column:registered_rule.lookup
-- operational risk: access-exclusive-lock
alter table "registered_rule" drop column if exists "lookup" cascade;

-- step drop:column:registered_rule.order (destructive)
-- accept: drop:column:registered_rule.order
-- operational risk: access-exclusive-lock
alter table "registered_rule" drop column if exists "order" cascade;

-- step drop:column:registered_rule.reads (destructive)
-- accept: drop:column:registered_rule.reads
-- operational risk: access-exclusive-lock
alter table "registered_rule" drop column if exists "reads" cascade;

-- step drop:column:registered_rule.references (destructive)
-- accept: drop:column:registered_rule.references
-- operational risk: access-exclusive-lock
alter table "registered_rule" drop column if exists "references" cascade;

-- step drop:column:registered_rule.target_collection (destructive)
-- accept: drop:column:registered_rule.target_collection
-- operational risk: access-exclusive-lock
alter table "registered_rule" drop column if exists "target_collection" cascade;

-- step drop:column:registered_rule.validate (destructive)
-- accept: drop:column:registered_rule.validate
-- operational risk: access-exclusive-lock
alter table "registered_rule" drop column if exists "validate" cascade;

-- step drop:column:registered_rule.bolt_record_label (additive)
-- operational risk: access-exclusive-lock
alter table "registered_rule" drop column if exists "bolt_record_label" cascade;

-- step drop:column:registered_rule.bolt_search (additive)
-- operational risk: access-exclusive-lock
alter table "registered_rule" drop column if exists bolt_search cascade;

-- step drop:column:statutory_change.effective_from (destructive)
-- accept: drop:column:statutory_change.effective_from
-- operational risk: access-exclusive-lock
alter table "statutory_change" drop column if exists "effective_from" cascade;

-- step drop:column:statutory_change.family (destructive)
-- accept: drop:column:statutory_change.family
-- operational risk: access-exclusive-lock
alter table "statutory_change" drop column if exists "family" cascade;

-- step drop:column:statutory_change.field_path (destructive)
-- accept: drop:column:statutory_change.field_path
-- operational risk: access-exclusive-lock
alter table "statutory_change" drop column if exists "field_path" cascade;

-- step drop:column:statutory_change.jurisdiction_code (destructive)
-- accept: drop:column:statutory_change.jurisdiction_code
-- operational risk: access-exclusive-lock
alter table "statutory_change" drop column if exists "jurisdiction_code" cascade;

-- step drop:column:statutory_change.new_value (destructive)
-- accept: drop:column:statutory_change.new_value
-- operational risk: access-exclusive-lock
alter table "statutory_change" drop column if exists "new_value" cascade;

-- step drop:column:statutory_change.notes (destructive)
-- accept: drop:column:statutory_change.notes
-- operational risk: access-exclusive-lock
alter table "statutory_change" drop column if exists "notes" cascade;

-- step drop:column:statutory_change.old_value (destructive)
-- accept: drop:column:statutory_change.old_value
-- operational risk: access-exclusive-lock
alter table "statutory_change" drop column if exists "old_value" cascade;

-- step drop:column:statutory_change.row_code (destructive)
-- accept: drop:column:statutory_change.row_code
-- operational risk: access-exclusive-lock
alter table "statutory_change" drop column if exists "row_code" cascade;

-- step drop:column:statutory_change.bolt_record_label (additive)
-- operational risk: access-exclusive-lock
alter table "statutory_change" drop column if exists "bolt_record_label" cascade;

-- step drop:column:statutory_change.bolt_search (additive)
-- operational risk: access-exclusive-lock
alter table "statutory_change" drop column if exists bolt_search cascade;

-- step drop:column:statutory_contribution_catalog.assessed (destructive)
-- accept: drop:column:statutory_contribution_catalog.assessed
-- operational risk: access-exclusive-lock
alter table "statutory_contribution_catalog" drop column if exists "assessed" cascade;

-- step drop:column:statutory_contribution_catalog.balance_window (destructive)
-- accept: drop:column:statutory_contribution_catalog.balance_window
-- operational risk: access-exclusive-lock
alter table "statutory_contribution_catalog" drop column if exists "balance_window" cascade;

-- step drop:column:statutory_contribution_catalog.code (destructive)
-- accept: drop:column:statutory_contribution_catalog.code
-- operational risk: access-exclusive-lock
alter table "statutory_contribution_catalog" drop column if exists "code" cascade;

-- step drop:column:statutory_contribution_catalog.depends_on (destructive)
-- accept: drop:column:statutory_contribution_catalog.depends_on
-- operational risk: access-exclusive-lock
alter table "statutory_contribution_catalog" drop column if exists "depends_on" cascade;

-- step drop:column:statutory_contribution_catalog.description (destructive)
-- accept: drop:column:statutory_contribution_catalog.description
-- operational risk: access-exclusive-lock
alter table "statutory_contribution_catalog" drop column if exists "description" cascade;

-- step drop:column:statutory_contribution_catalog.eligibility (destructive)
-- accept: drop:column:statutory_contribution_catalog.eligibility
-- operational risk: access-exclusive-lock
alter table "statutory_contribution_catalog" drop column if exists "eligibility" cascade;

-- step drop:column:statutory_contribution_catalog.employee_amount (destructive)
-- accept: drop:column:statutory_contribution_catalog.employee_amount
-- operational risk: access-exclusive-lock
alter table "statutory_contribution_catalog" drop column if exists "employee_amount" cascade;

-- step drop:column:statutory_contribution_catalog.employer_amount (destructive)
-- accept: drop:column:statutory_contribution_catalog.employer_amount
-- operational risk: access-exclusive-lock
alter table "statutory_contribution_catalog" drop column if exists "employer_amount" cascade;

-- step drop:column:statutory_contribution_catalog.kind (destructive)
-- accept: drop:column:statutory_contribution_catalog.kind
-- operational risk: access-exclusive-lock
alter table "statutory_contribution_catalog" drop column if exists "kind" cascade;

-- step drop:column:statutory_contribution_catalog.lookup (destructive)
-- accept: drop:column:statutory_contribution_catalog.lookup
-- operational risk: access-exclusive-lock
alter table "statutory_contribution_catalog" drop column if exists "lookup" cascade;

-- step drop:column:statutory_contribution_catalog.references (destructive)
-- accept: drop:column:statutory_contribution_catalog.references
-- operational risk: access-exclusive-lock
alter table "statutory_contribution_catalog" drop column if exists "references" cascade;

-- step drop:column:statutory_contribution_catalog.bolt_record_label (additive)
-- operational risk: access-exclusive-lock
alter table "statutory_contribution_catalog" drop column if exists "bolt_record_label" cascade;

-- step drop:column:statutory_contribution_catalog.bolt_search (additive)
-- operational risk: access-exclusive-lock
alter table "statutory_contribution_catalog" drop column if exists bolt_search cascade;

-- step drop:column:subtotal.balance_window (destructive)
-- accept: drop:column:subtotal.balance_window
-- operational risk: access-exclusive-lock
alter table "subtotal" drop column if exists "balance_window" cascade;

-- step drop:column:subtotal.calculation (destructive)
-- accept: drop:column:subtotal.calculation
-- operational risk: access-exclusive-lock
alter table "subtotal" drop column if exists "calculation" cascade;

-- step drop:column:subtotal.code (destructive)
-- accept: drop:column:subtotal.code
-- operational risk: access-exclusive-lock
alter table "subtotal" drop column if exists "code" cascade;

-- step drop:column:subtotal.name (destructive)
-- accept: drop:column:subtotal.name
-- operational risk: access-exclusive-lock
alter table "subtotal" drop column if exists "name" cascade;

-- step drop:column:subtotal.bolt_record_label (additive)
-- operational risk: access-exclusive-lock
alter table "subtotal" drop column if exists "bolt_record_label" cascade;

-- step drop:column:subtotal.bolt_search (additive)
-- operational risk: access-exclusive-lock
alter table "subtotal" drop column if exists bolt_search cascade;

-- step drop:column:work_event_catalog.code (destructive)
-- accept: drop:column:work_event_catalog.code
-- operational risk: access-exclusive-lock
alter table "work_event_catalog" drop column if exists "code" cascade;

-- step drop:column:work_event_catalog.description (destructive)
-- accept: drop:column:work_event_catalog.description
-- operational risk: access-exclusive-lock
alter table "work_event_catalog" drop column if exists "description" cascade;

-- step drop:column:work_event_catalog.lookup (destructive)
-- accept: drop:column:work_event_catalog.lookup
-- operational risk: access-exclusive-lock
alter table "work_event_catalog" drop column if exists "lookup" cascade;

-- step drop:column:work_event_catalog.references (destructive)
-- accept: drop:column:work_event_catalog.references
-- operational risk: access-exclusive-lock
alter table "work_event_catalog" drop column if exists "references" cascade;

-- step drop:column:work_event_catalog.bolt_record_label (additive)
-- operational risk: access-exclusive-lock
alter table "work_event_catalog" drop column if exists "bolt_record_label" cascade;

-- step drop:column:work_event_catalog.bolt_search (additive)
-- operational risk: access-exclusive-lock
alter table "work_event_catalog" drop column if exists bolt_search cascade;

-- step drop:column:workplace_case_catalog.code (destructive)
-- accept: drop:column:workplace_case_catalog.code
-- operational risk: access-exclusive-lock
alter table "workplace_case_catalog" drop column if exists "code" cascade;

-- step drop:column:workplace_case_catalog.description (destructive)
-- accept: drop:column:workplace_case_catalog.description
-- operational risk: access-exclusive-lock
alter table "workplace_case_catalog" drop column if exists "description" cascade;

-- step drop:column:workplace_case_catalog.events (destructive)
-- accept: drop:column:workplace_case_catalog.events
-- operational risk: access-exclusive-lock
alter table "workplace_case_catalog" drop column if exists "events" cascade;

-- step drop:column:workplace_case_catalog.lookup (destructive)
-- accept: drop:column:workplace_case_catalog.lookup
-- operational risk: access-exclusive-lock
alter table "workplace_case_catalog" drop column if exists "lookup" cascade;

-- step drop:column:workplace_case_catalog.references (destructive)
-- accept: drop:column:workplace_case_catalog.references
-- operational risk: access-exclusive-lock
alter table "workplace_case_catalog" drop column if exists "references" cascade;

-- step drop:column:workplace_case_catalog.bolt_record_label (additive)
-- operational risk: access-exclusive-lock
alter table "workplace_case_catalog" drop column if exists "bolt_record_label" cascade;

-- step drop:column:workplace_case_catalog.bolt_search (additive)
-- operational risk: access-exclusive-lock
alter table "workplace_case_catalog" drop column if exists bolt_search cascade;

-- step drop:column:adhoc_catalog.settings_id (destructive)
-- accept: drop:column:adhoc_catalog.settings_id
-- operational risk: access-exclusive-lock
alter table "adhoc_catalog" drop column if exists "settings_id" cascade;

-- step drop:column:adhoc_catalog.subtotal_id (destructive)
-- accept: drop:column:adhoc_catalog.subtotal_id
-- operational risk: access-exclusive-lock
alter table "adhoc_catalog" drop column if exists "subtotal_id" cascade;

-- step drop:column:adhoc_catalog_entry.catalog_id (destructive)
-- accept: drop:column:adhoc_catalog_entry.catalog_id
-- operational risk: access-exclusive-lock
alter table "adhoc_catalog_entry" drop column if exists "catalog_id" cascade;

-- step drop:column:allowance_catalog.settings_id (destructive)
-- accept: drop:column:allowance_catalog.settings_id
-- operational risk: access-exclusive-lock
alter table "allowance_catalog" drop column if exists "settings_id" cascade;

-- step drop:column:allowance_catalog.subtotal_id (destructive)
-- accept: drop:column:allowance_catalog.subtotal_id
-- operational risk: access-exclusive-lock
alter table "allowance_catalog" drop column if exists "subtotal_id" cascade;

-- step drop:column:claim_catalog.settings_id (destructive)
-- accept: drop:column:claim_catalog.settings_id
-- operational risk: access-exclusive-lock
alter table "claim_catalog" drop column if exists "settings_id" cascade;

-- step drop:column:claim_catalog.subtotal_id (destructive)
-- accept: drop:column:claim_catalog.subtotal_id
-- operational risk: access-exclusive-lock
alter table "claim_catalog" drop column if exists "subtotal_id" cascade;

-- step drop:column:claim_catalog_entry.catalog_id (destructive)
-- accept: drop:column:claim_catalog_entry.catalog_id
-- operational risk: access-exclusive-lock
alter table "claim_catalog_entry" drop column if exists "catalog_id" cascade;

-- step drop:column:entity_profile_version.input_schema_version_id (destructive)
-- accept: drop:column:entity_profile_version.input_schema_version_id
-- operational risk: access-exclusive-lock
alter table "entity_profile_version" drop column if exists "input_schema_version_id" cascade;

-- step drop:column:leave_catalog.settings_id (destructive)
-- accept: drop:column:leave_catalog.settings_id
-- operational risk: access-exclusive-lock
alter table "leave_catalog" drop column if exists "settings_id" cascade;

-- step drop:column:leave_catalog.subtotal_id (destructive)
-- accept: drop:column:leave_catalog.subtotal_id
-- operational risk: access-exclusive-lock
alter table "leave_catalog" drop column if exists "subtotal_id" cascade;

-- step drop:column:leave_catalog_entry.catalog_id (destructive)
-- accept: drop:column:leave_catalog_entry.catalog_id
-- operational risk: access-exclusive-lock
alter table "leave_catalog_entry" drop column if exists "catalog_id" cascade;

-- step drop:column:loan_catalog.settings_id (destructive)
-- accept: drop:column:loan_catalog.settings_id
-- operational risk: access-exclusive-lock
alter table "loan_catalog" drop column if exists "settings_id" cascade;

-- step drop:column:loan_catalog.subtotal_id (destructive)
-- accept: drop:column:loan_catalog.subtotal_id
-- operational risk: access-exclusive-lock
alter table "loan_catalog" drop column if exists "subtotal_id" cascade;

-- step drop:column:loan_catalog_entry.catalog_id (destructive)
-- accept: drop:column:loan_catalog_entry.catalog_id
-- operational risk: access-exclusive-lock
alter table "loan_catalog_entry" drop column if exists "catalog_id" cascade;

-- step drop:column:overtime_catalog.settings_id (destructive)
-- accept: drop:column:overtime_catalog.settings_id
-- operational risk: access-exclusive-lock
alter table "overtime_catalog" drop column if exists "settings_id" cascade;

-- step drop:column:overtime_catalog.subtotal_id (destructive)
-- accept: drop:column:overtime_catalog.subtotal_id
-- operational risk: access-exclusive-lock
alter table "overtime_catalog" drop column if exists "subtotal_id" cascade;

-- step drop:column:payroll_run.settings_id (destructive)
-- accept: drop:column:payroll_run.settings_id
-- operational risk: access-exclusive-lock
alter table "payroll_run" drop column if exists "settings_id" cascade;

-- step drop:column:payslip.settings_id (destructive)
-- accept: drop:column:payslip.settings_id
-- operational risk: access-exclusive-lock
alter table "payslip" drop column if exists "settings_id" cascade;

-- step drop:column:registered_effect.settings_id (destructive)
-- accept: drop:column:registered_effect.settings_id
-- operational risk: access-exclusive-lock
alter table "registered_effect" drop column if exists "settings_id" cascade;

-- step drop:column:registered_rule.settings_id (destructive)
-- accept: drop:column:registered_rule.settings_id
-- operational risk: access-exclusive-lock
alter table "registered_rule" drop column if exists "settings_id" cascade;

-- step drop:column:statutory_change.applied_version_id (destructive)
-- accept: drop:column:statutory_change.applied_version_id
-- operational risk: access-exclusive-lock
alter table "statutory_change" drop column if exists "applied_version_id" cascade;

-- step drop:column:statutory_change.baseline_version_id (destructive)
-- accept: drop:column:statutory_change.baseline_version_id
-- operational risk: access-exclusive-lock
alter table "statutory_change" drop column if exists "baseline_version_id" cascade;

-- step drop:column:statutory_change.finding_id (destructive)
-- accept: drop:column:statutory_change.finding_id
-- operational risk: access-exclusive-lock
alter table "statutory_change" drop column if exists "finding_id" cascade;

-- step drop:column:statutory_contribution_catalog.employer_cost_subtotal_id (destructive)
-- accept: drop:column:statutory_contribution_catalog.employer_cost_subtotal_id
-- operational risk: access-exclusive-lock
alter table "statutory_contribution_catalog" drop column if exists "employer_cost_subtotal_id" cascade;

-- step drop:column:statutory_contribution_catalog.settings_id (destructive)
-- accept: drop:column:statutory_contribution_catalog.settings_id
-- operational risk: access-exclusive-lock
alter table "statutory_contribution_catalog" drop column if exists "settings_id" cascade;

-- step drop:column:statutory_contribution_catalog.subtotal_id (destructive)
-- accept: drop:column:statutory_contribution_catalog.subtotal_id
-- operational risk: access-exclusive-lock
alter table "statutory_contribution_catalog" drop column if exists "subtotal_id" cascade;

-- step drop:column:subtotal.previous_id (destructive)
-- accept: drop:column:subtotal.previous_id
-- operational risk: access-exclusive-lock
alter table "subtotal" drop column if exists "previous_id" cascade;

-- step drop:column:subtotal.settings_id (destructive)
-- accept: drop:column:subtotal.settings_id
-- operational risk: access-exclusive-lock
alter table "subtotal" drop column if exists "settings_id" cascade;

-- step drop:column:work_event.catalog_id (destructive)
-- accept: drop:column:work_event.catalog_id
-- operational risk: access-exclusive-lock
alter table "work_event" drop column if exists "catalog_id" cascade;

-- step drop:column:work_event_catalog.settings_id (destructive)
-- accept: drop:column:work_event_catalog.settings_id
-- operational risk: access-exclusive-lock
alter table "work_event_catalog" drop column if exists "settings_id" cascade;

-- step drop:column:work_event_catalog.subtotal_id (destructive)
-- accept: drop:column:work_event_catalog.subtotal_id
-- operational risk: access-exclusive-lock
alter table "work_event_catalog" drop column if exists "subtotal_id" cascade;

-- step drop:column:workplace_case_catalog.settings_id (destructive)
-- accept: drop:column:workplace_case_catalog.settings_id
-- operational risk: access-exclusive-lock
alter table "workplace_case_catalog" drop column if exists "settings_id" cascade;

-- step drop:column:workplace_case_catalog.subtotal_id (destructive)
-- accept: drop:column:workplace_case_catalog.subtotal_id
-- operational risk: access-exclusive-lock
alter table "workplace_case_catalog" drop column if exists "subtotal_id" cascade;

-- step drop:column:workplace_case_catalog_entry.catalog_id (destructive)
-- accept: drop:column:workplace_case_catalog_entry.catalog_id
-- operational risk: access-exclusive-lock
alter table "workplace_case_catalog_entry" drop column if exists "catalog_id" cascade;

-- step drop:table:adhoc_catalog (destructive)
-- accept: drop:table:adhoc_catalog
-- operational risk: access-exclusive-lock
drop table if exists "adhoc_catalog" cascade;

-- step drop:table:allowance_catalog (destructive)
-- accept: drop:table:allowance_catalog
-- operational risk: access-exclusive-lock
drop table if exists "allowance_catalog" cascade;

-- step drop:table:claim_catalog (destructive)
-- accept: drop:table:claim_catalog
-- operational risk: access-exclusive-lock
drop table if exists "claim_catalog" cascade;

-- step drop:table:jurisdiction_settings (destructive)
-- accept: drop:table:jurisdiction_settings
-- operational risk: access-exclusive-lock
drop table if exists "jurisdiction_settings" cascade;

-- step drop:table:leave_catalog (destructive)
-- accept: drop:table:leave_catalog
-- operational risk: access-exclusive-lock
drop table if exists "leave_catalog" cascade;

-- step drop:table:loan_catalog (destructive)
-- accept: drop:table:loan_catalog
-- operational risk: access-exclusive-lock
drop table if exists "loan_catalog" cascade;

-- step drop:table:overtime_catalog (destructive)
-- accept: drop:table:overtime_catalog
-- operational risk: access-exclusive-lock
drop table if exists "overtime_catalog" cascade;

-- step drop:table:registered_effect (destructive)
-- accept: drop:table:registered_effect
-- operational risk: access-exclusive-lock
drop table if exists "registered_effect" cascade;

-- step drop:table:registered_rule (destructive)
-- accept: drop:table:registered_rule
-- operational risk: access-exclusive-lock
drop table if exists "registered_rule" cascade;

-- step drop:table:statutory_change (destructive)
-- accept: drop:table:statutory_change
-- operational risk: access-exclusive-lock
drop table if exists "statutory_change" cascade;

-- step drop:table:statutory_contribution_catalog (destructive)
-- accept: drop:table:statutory_contribution_catalog
-- operational risk: access-exclusive-lock
drop table if exists "statutory_contribution_catalog" cascade;

-- step drop:table:subtotal (destructive)
-- accept: drop:table:subtotal
-- operational risk: access-exclusive-lock
drop table if exists "subtotal" cascade;

-- step drop:table:work_event_catalog (destructive)
-- accept: drop:table:work_event_catalog
-- operational risk: access-exclusive-lock
drop table if exists "work_event_catalog" cascade;

-- step drop:table:workplace_case_catalog (destructive)
-- accept: drop:table:workplace_case_catalog
-- operational risk: access-exclusive-lock
drop table if exists "workplace_case_catalog" cascade;

-- step drop:function:bolt_record_label_adhoc_catalog_1d6aa255 (additive)
drop function if exists "bolt_record_label_adhoc_catalog_1d6aa255"(text) cascade;

-- step drop:function:bolt_record_label_allowance_catalog_1d6aa255 (additive)
drop function if exists "bolt_record_label_allowance_catalog_1d6aa255"(text) cascade;

-- step drop:function:bolt_record_label_claim_catalog_1d6aa255 (additive)
drop function if exists "bolt_record_label_claim_catalog_1d6aa255"(text) cascade;

-- step drop:function:bolt_record_label_jurisdiction_settings_93340fdd (additive)
drop function if exists "bolt_record_label_jurisdiction_settings_93340fdd"(text) cascade;

-- step drop:function:bolt_record_label_leave_catalog_1d6aa255 (additive)
drop function if exists "bolt_record_label_leave_catalog_1d6aa255"(text) cascade;

-- step drop:function:bolt_record_label_loan_catalog_1d6aa255 (additive)
drop function if exists "bolt_record_label_loan_catalog_1d6aa255"(text) cascade;

-- step drop:function:bolt_record_label_overtime_catalog_1d6aa255 (additive)
drop function if exists "bolt_record_label_overtime_catalog_1d6aa255"(text) cascade;

-- step drop:function:bolt_record_label_registered_effect_1d6aa255 (additive)
drop function if exists "bolt_record_label_registered_effect_1d6aa255"(text) cascade;

-- step drop:function:bolt_record_label_registered_rule_1d6aa255 (additive)
drop function if exists "bolt_record_label_registered_rule_1d6aa255"(text) cascade;

-- step drop:function:bolt_record_label_statutory_change_b26ebd75 (additive)
drop function if exists "bolt_record_label_statutory_change_b26ebd75"(text) cascade;

-- step drop:function:bolt_record_label_statutory_contribution_1d6aa255 (additive)
drop function if exists "bolt_record_label_statutory_contribution_1d6aa255"(text) cascade;

-- step drop:function:bolt_record_label_subtotal_93340fdd (additive)
drop function if exists "bolt_record_label_subtotal_93340fdd"(text) cascade;

-- step drop:function:bolt_record_label_work_event_catalog_1d6aa255 (additive)
drop function if exists "bolt_record_label_work_event_catalog_1d6aa255"(text) cascade;

-- step drop:function:bolt_record_label_workplace_case_catalog_1d6aa255 (additive)
drop function if exists "bolt_record_label_workplace_case_catalog_1d6aa255"(text) cascade;

-- step create:function:bolt_record_label_jurisdiction_93340fdd (additive)
create function "bolt_record_label_jurisdiction_93340fdd"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['name']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('name', to_jsonb("name")) AS j FROM (SELECT $1 AS "name") label_inputs) label_row) label_value$record_label$;

-- step create:function:bolt_record_label_jurisdiction_change_58d6e27a (additive)
create function "bolt_record_label_jurisdiction_change_58d6e27a"(date) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['effective_from']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('effective_from', to_jsonb("effective_from"::text)) AS j FROM (SELECT $1 AS "effective_from") label_inputs) label_row) label_value$record_label$;

-- step create:table:jurisdiction (additive)
create table "jurisdiction" ("id" uuid primary key, revision int not null default 1, created_at timestamptz not null default now(), created_by text, updated_at timestamptz not null default now(), updated_by text,
	"code" text not null,
	"name" text not null,
	"currency" text not null,
	"timezone" text not null,
	"tax_year_start_month" int not null,
	"bolt_record_label" text generated always as ("bolt_record_label_jurisdiction_93340fdd"("name")) stored,
	bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_jurisdiction_93340fdd"("name"), ''))) stored,
	constraint "jurisdiction__ck__7414a4a0" check ("currency" ~ '^[A-Z]{3}$'),
	constraint "jurisdiction__ck__195dbb6e" check ("timezone" ~ '^[A-Za-z_]+(/[A-Za-z0-9_+\-]+)*$'),
	constraint "jurisdiction__ck__07363679" check ("tax_year_start_month" >= 1 and "tax_year_start_month" <= 12),
	constraint "jurisdiction__uq__81caf70b" unique ("code") deferrable initially immediate
);

-- step create:table:jurisdiction_change (additive)
create table "jurisdiction_change" ("id" uuid primary key, revision int not null default 1, created_at timestamptz not null default now(), created_by text, updated_at timestamptz not null default now(), updated_by text,
	"jurisdiction_code" text not null,
	"effective_from" date not null,
	"law" jsonb not null,
	"bolt_record_label" text generated always as ("bolt_record_label_jurisdiction_change_58d6e27a"("effective_from")) stored,
	bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_jurisdiction_change_58d6e27a"("effective_from"), ''))) stored,
	"finding_id" uuid,
	constraint "jurisdiction_change__ck__30e69ba6" check (isfinite("effective_from")),
	constraint "jurisdiction_change__ck__4e1a22a9" check (("law" is null or store_json_valid("law", '{"kind":"json","shape":{"kind":"record","of":{"kind":"json"}}}'::jsonb) is true))
);

-- step replace:history:schema:entity_profile_version (additive)
select bolt_history_register('entity_profile_version','{"audit":true,"fields":{"bank":{"kind":"custom","of":"bank","optional":true},"effective_range":{"kind":"period","of":"date"},"entity_extension_data":{"default":{},"kind":"json","shape":{"kind":"record","of":{"kind":"json"}}},"entity_id":{"inverse":"payroll_versions","kind":"ref","on_delete":"restrict","to":"entity"},"final_pay_loan_floor_percent":{"default":10,"kind":"int","max":100,"min":0},"name":{"kind":"text"},"overtime_full_award_percent":{"default":100,"kind":"int","max":100,"min":1},"pay_methods":{"fields":{"benefit_exclusion":{"default":"POOLED","kind":"enum","values":["POOLED","EXCESS_TAXED"]},"contribution_split":{"default":"EVEN","kind":"enum","values":["EVEN","FIRST_RUN"]},"health_billing":{"default":"CURRENT","kind":"enum","values":["CURRENT","ARREARS"]},"night_differential_basis":{"default":"WORKED","kind":"enum","values":["WORKED","CLOCK_SPAN","WHOLE_NIGHT"]},"overtime_hour_basis":{"default":"STATUTORY","kind":"enum","values":["STATUTORY","CONTRACT_WEEKLY"]},"paid_leave":{"kind":"text","many":true,"optional":true},"rest_day_hourly_multiplier":{"kind":"number","min":1,"optional":true}},"kind":"object","optional":true},"reason":{"kind":"text","optional":true},"registered_address":{"kind":"text","optional":true},"representative_name":{"kind":"text","optional":true},"settings_code":{"kind":"text"},"status":{"initial":"DRAFT","kind":"state","states":{"DRAFT":{"to":["SEALED"]},"SEALED":{"to":["VOID"]},"VOID":{"to":[]}}},"time_zone":{"kind":"text","optional":true}},"locks":{"sealed_version":{"except":["effective_range","reason","status"],"where":{"status":{"eq":"SEALED"}}},"void_version":{"where":{"status":{"eq":"VOID"}}}},"no_overlap":[{"key":["entity_id"],"name":"sealed_range","period":"effective_range","where":{"status":{"eq":"SEALED"}}}],"record_label":"record.name"}'::jsonb);

-- step replace:history:schema:adhoc_catalog_entry (additive)
select bolt_history_register('adhoc_catalog_entry','{"audit":true,"fields":{"catalog_code":{"kind":"text"},"description":{"kind":"text"},"employment_id":{"inverse":"adhoc_catalog_entry","kind":"ref","to":"employee_contract"},"entity_id":{"kind":"ref","to":"entity"},"evidence_file":{"accept":["application/pdf","image/*"],"kind":"file","max":"20MiB","optional":true},"incurred_on":{"kind":"date"},"payroll_run_id":{"inverse":"adhoc","kind":"ref","on_delete":"set_null","optional":true,"to":"payroll_run"},"quantity":{"kind":"decimal","min":0,"scale":12},"unit":{"default":"MONEY","kind":"enum","values":["DAY","CALENDAR_DAY","HOUR","MONEY","COUNT"]}},"record_label":"record.employment_id.employee_number + '' · '' + record.catalog_code + '' · '' + string(record.quantity)"}'::jsonb);

-- step replace:history:schema:claim_catalog_entry (additive)
select bolt_history_register('claim_catalog_entry','{"audit":true,"fields":{"catalog_code":{"kind":"text"},"employment_id":{"inverse":"claim_catalog_entry","kind":"ref","to":"employee_contract"},"entity_id":{"kind":"ref","to":"entity"},"evidence_file":{"accept":["application/pdf","image/*"],"kind":"file","max":"20MiB","optional":true},"incurred_on":{"kind":"date"},"payroll_run_id":{"inverse":"claim","kind":"ref","on_delete":"set_null","optional":true,"to":"payroll_run"},"quantity":{"kind":"decimal","min":0,"scale":12},"unit":{"default":"MONEY","kind":"enum","values":["DAY","CALENDAR_DAY","HOUR","MONEY","COUNT"]}},"record_label":"record.employment_id.employee_number + '' · '' + record.catalog_code + '' · '' + string(record.quantity) + (record.unit == ''MONEY'' ? '''' : '' '' + record.unit)"}'::jsonb);

-- step replace:history:schema:leave_catalog_entry (additive)
select bolt_history_register('leave_catalog_entry','{"audit":true,"fields":{"catalog_code":{"kind":"text"},"employment_id":{"inverse":"leave_catalog_entry","kind":"ref","to":"employee_contract"},"encashment":{"default":false,"hidden":true,"kind":"bool"},"entity_id":{"kind":"ref","to":"entity"},"evidence_file":{"accept":["application/pdf","image/*"],"kind":"file","max":"20MiB","optional":true},"payroll_run_id":{"inverse":"leave","kind":"ref","on_delete":"set_null","optional":true,"to":"payroll_run"}},"record_label":"record.employment_id.employee_number + '' · '' + record.catalog_code"}'::jsonb);

-- step replace:history:schema:loan_catalog_entry (additive)
select bolt_history_register('loan_catalog_entry','{"audit":true,"fields":{"catalog_code":{"kind":"text"},"employment_id":{"inverse":"loan_catalog_entry","kind":"ref","to":"employee_contract"},"entity_id":{"kind":"ref","to":"entity"},"evidence_file":{"accept":["application/pdf","image/*"],"kind":"file","max":"20MiB","optional":true},"payroll_run_id":{"kind":"ref","on_delete":"set_null","optional":true,"to":"payroll_run"},"quantity":{"kind":"decimal","min":0,"scale":12},"recovered":{"hidden":true,"kind":"sum","of":"repayments.amount"},"repayment_period":{"kind":"period","of":"date"}},"record_label":"record.employment_id.employee_number + '' · '' + record.catalog_code"}'::jsonb);

-- step replace:history:schema:workplace_case_catalog_entry (additive)
select bolt_history_register('workplace_case_catalog_entry','{"audit":true,"fields":{"catalog_code":{"kind":"text"},"closed_on":{"kind":"date","optional":true},"description":{"kind":"text","optional":true},"employment_id":{"inverse":"workplace_case_catalog_entry","kind":"ref","on_delete":"restrict","to":"employee_contract"},"entity_id":{"inverse":"workplace_case_catalog_entries","kind":"ref","to":"entity"},"evidence_file":{"accept":["*/*"],"kind":"file","max":"20MiB","optional":true},"inputs":{"default":{},"kind":"json","shape":{"kind":"record","of":{"kind":"json"}}},"kind":{"kind":"text"},"location":{"kind":"text","optional":true},"occurred_on":{"kind":"date","optional":true},"opened_on":{"kind":"date"},"payroll_run_id":{"inverse":"case","kind":"ref","on_delete":"set_null","optional":true,"to":"payroll_run"},"reference":{"kind":"text","optional":true},"scheduled_on":{"kind":"date","optional":true},"severity":{"default":"N/A","kind":"enum","values":["DEATH","PERMANENT_TOTAL_DISABILITY","SERIOUS_INJURY","MINOR_INJURY","NEAR_MISS","PROPERTY_DAMAGE","N/A"]}},"locks":{"captured":{"where":{"payroll_run_id":{"is_null":false}}}},"record_label":"record.kind + '' · '' + string(record.opened_on)"}'::jsonb);

-- step replace:history:schema:payroll_run (additive)
select bolt_history_register('payroll_run','{"audit":true,"fields":{"entity_id":{"inverse":"payroll_runs","kind":"ref","to":"entity"},"kind":{"default":"ON_CYCLE","kind":"enum","values":["ON_CYCLE","OFF_CYCLE"]},"pay_date":{"kind":"date"},"pay_group_id":{"inverse":"payroll_runs","kind":"ref","on_delete":"restrict","to":"pay_group"},"period":{"kind":"text"},"run_number":{"kind":"seq"},"salary_coverage":{"kind":"period","of":"date"},"state":{"initial":"UNPAID","kind":"state","states":{"PAID":{"to":[]},"UNPAID":{"to":["PAID"]}}}},"locks":{"paid_run":{"where":{"state":{"eq":"PAID"}}}},"record_label":"''Run '' + string(record.run_number) + '' · '' + record.period","unique":[{"fields":["pay_group_id","period"],"name":"one_cycle_run","where":{"kind":{"eq":"ON_CYCLE"}}}]}'::jsonb);

-- step replace:history:schema:payslip (additive)
select bolt_history_register('payslip','{"audit":true,"fields":{"basic_earnings":{"kind":"decimal","optional":true,"scale":12},"breakdown":{"default":{},"kind":"json","shape":{"kind":"record","of":{"kind":"json"}}},"employee_id":{"inverse":"payslips","kind":"ref","to":"employee_profile"},"employee_statutory":{"default":0,"kind":"decimal","min":0,"scale":12},"employer_cost":{"default":0,"kind":"decimal","min":0,"scale":12},"employment_id":{"inverse":"payslips","kind":"ref","to":"employee_contract"},"entity_id":{"kind":"ref","to":"entity"},"gross_earnings":{"kind":"decimal","optional":true,"scale":12},"net_pay":{"kind":"decimal","scale":12},"ordinary_wages":{"default":0,"kind":"decimal","min":0,"scale":12},"payroll_run_id":{"inverse":"payslips","kind":"ref","on_delete":"cascade","to":"payroll_run"},"period":{"kind":"text","optional":true},"tax_withheld":{"default":0,"kind":"decimal","min":0,"scale":12},"total_deductions":{"kind":"decimal","min":0,"scale":12}},"record_label":"(has(record.employee_id.name) ? record.employee_id.name + '' · '' : '''') + (record.period != null ? record.period : '''')","unique":[{"fields":["payroll_run_id","employee_id","entity_id"],"name":"run_person"}]}'::jsonb);

-- step replace:history:schema:statutory_finding (additive)
select bolt_history_register('statutory_finding','{"audit":true,"fields":{"announced_on":{"kind":"date","optional":true},"families":{"kind":"text","many":true},"fit":{"kind":"enum","values":["VALUE","ROW","STRUCTURAL"]},"instrument_key":{"kind":"text"},"jurisdiction_code":{"kind":"text"},"notes":{"kind":"text","optional":true},"research_run_id":{"kind":"text","optional":true},"source_quote":{"kind":"text","optional":true},"source_urls":{"kind":"text","many":true},"status":{"initial":"PROPOSED","kind":"state","states":{"CONFIRMED":{"to":["REJECTED"]},"PROPOSED":{"to":["CONFIRMED","REJECTED"]},"REJECTED":{"to":[]}}},"summary":{"kind":"text","optional":true},"title":{"kind":"text"},"verified_by":{"kind":"ref","on_delete":"restrict","optional":true,"to":"sys_user"},"verified_on":{"kind":"date","optional":true}},"locks":{"confirmed_finding":{"except":["status","notes"],"where":{"status":{"eq":"CONFIRMED"}}},"decided_finding":{"where":{"status":{"eq":"REJECTED"}}}},"record_label":"record.title","unique":[{"fields":["jurisdiction_code","instrument_key"],"name":"one_instrument"}]}'::jsonb);

-- step replace:history:schema:work_event (additive)
select bolt_history_register('work_event','{"audit":true,"fields":{"catalog_code":{"kind":"text"},"description":{"kind":"text","optional":true},"employment_id":{"kind":"ref","optional":true,"to":"employee_contract"},"entity_id":{"kind":"ref","to":"entity"},"evidence_file":{"accept":["application/pdf","image/*"],"kind":"file","max":"20MiB","optional":true},"from":{"kind":"date"},"location":{"kind":"text","optional":true},"to":{"kind":"date","optional":true}},"record_label":"record.description"}'::jsonb);

-- step create:history:schema:jurisdiction (additive)
select bolt_history_register('jurisdiction','{"audit":true,"fields":{"code":{"kind":"text"},"currency":{"kind":"currency"},"name":{"kind":"text"},"tax_year_start_month":{"kind":"int","max":12,"min":1},"timezone":{"format":"zone","kind":"text"}},"record_label":"record.name","unique":[{"fields":["code"],"name":"code"}]}'::jsonb);

-- step create:history:schema:jurisdiction_change (additive)
select bolt_history_register('jurisdiction_change','{"audit":true,"fields":{"effective_from":{"kind":"date"},"finding_id":{"inverse":"law_changes","kind":"ref","on_delete":"cascade","optional":true,"to":"statutory_finding"},"jurisdiction_code":{"kind":"text"},"law":{"kind":"json","shape":{"kind":"record","of":{"kind":"json"}}}},"record_label":"record.effective_from"}'::jsonb);

-- step create:notNull:adhoc_catalog_entry.catalog_code (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "adhoc_catalog_entry" where "catalog_code" is null' into n;
	if n > 0 then raise exception 'notNull:adhoc_catalog_entry.catalog_code refuses % existing row(s)', n; end if;
end $store$;
alter table "adhoc_catalog_entry" alter column "catalog_code" set not null;

-- step create:notNull:claim_catalog_entry.catalog_code (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "claim_catalog_entry" where "catalog_code" is null' into n;
	if n > 0 then raise exception 'notNull:claim_catalog_entry.catalog_code refuses % existing row(s)', n; end if;
end $store$;
alter table "claim_catalog_entry" alter column "catalog_code" set not null;

-- step create:notNull:leave_catalog_entry.catalog_code (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "leave_catalog_entry" where "catalog_code" is null' into n;
	if n > 0 then raise exception 'notNull:leave_catalog_entry.catalog_code refuses % existing row(s)', n; end if;
end $store$;
alter table "leave_catalog_entry" alter column "catalog_code" set not null;

-- step create:notNull:loan_catalog_entry.catalog_code (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "loan_catalog_entry" where "catalog_code" is null' into n;
	if n > 0 then raise exception 'notNull:loan_catalog_entry.catalog_code refuses % existing row(s)', n; end if;
end $store$;
alter table "loan_catalog_entry" alter column "catalog_code" set not null;

-- step create:notNull:workplace_case_catalog_entry.catalog_code (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "workplace_case_catalog_entry" where "catalog_code" is null' into n;
	if n > 0 then raise exception 'notNull:workplace_case_catalog_entry.catalog_code refuses % existing row(s)', n; end if;
end $store$;
alter table "workplace_case_catalog_entry" alter column "catalog_code" set not null;

-- step create:notNull:work_event.catalog_code (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "work_event" where "catalog_code" is null' into n;
	if n > 0 then raise exception 'notNull:work_event.catalog_code refuses % existing row(s)', n; end if;
end $store$;
alter table "work_event" alter column "catalog_code" set not null;

-- step create:constraint:statutory_finding.statutory_finding__ck__f95d14e0 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "statutory_finding" where ("status" in (''CONFIRMED'', ''PROPOSED'', ''REJECTED'')) is false' into n;
	if n > 0 then raise exception 'statutory_finding__ck__f95d14e0 refuses % existing row(s)', n; end if;
end $store$;
alter table "statutory_finding" add constraint "statutory_finding__ck__f95d14e0" check ("status" in ('CONFIRMED', 'PROPOSED', 'REJECTED'));

-- step create:fk:jurisdiction_change.jurisdiction_change__fk__8b56e43d (additive)
alter table "jurisdiction_change" add constraint "jurisdiction_change__fk__8b56e43d" foreign key ("finding_id") references "statutory_finding" ("id") on delete cascade on update restrict;

-- step replace:trigger:entity_profile_version.store_statement_rules_update (additive)
create trigger store_statement_rules_update after update on "entity_profile_version" referencing old table as store_old new table as store_new for each statement execute function store_statement_rules('{"fields":{"bank":["bank"],"effective_range":["effective_range"],"entity_extension_data":["entity_extension_data"],"entity_id":["entity_id"],"final_pay_loan_floor_percent":["final_pay_loan_floor_percent"],"name":["name"],"overtime_full_award_percent":["overtime_full_award_percent"],"pay_methods":["pay_methods"],"reason":["reason"],"registered_address":["registered_address"],"representative_name":["representative_name"],"settings_code":["settings_code"],"status":["status"],"time_zone":["time_zone"]},"key":["id"],"locks":[{"constraint":"entity_profile_version__lock__f51311df","except":["effective_range","reason","status"],"name":"sealed_version","sql":"(coalesce(t.\"status\" = ''SEALED''::text, false))"},{"constraint":"entity_profile_version__lock__f8268056","except":[],"name":"void_version","sql":"(coalesce(t.\"status\" = ''VOID''::text, false))"}],"parents":[],"states":{"status":{"initial":"DRAFT","states":{"DRAFT":{"to":["SEALED"]},"SEALED":{"to":["VOID"]},"VOID":{"to":[]}}}}}');

-- step replace:trigger:entity_profile_version.store_statement_rules_delete (additive)
create trigger store_statement_rules_delete after delete on "entity_profile_version" referencing old table as store_old for each statement execute function store_statement_rules('{"fields":{"bank":["bank"],"effective_range":["effective_range"],"entity_extension_data":["entity_extension_data"],"entity_id":["entity_id"],"final_pay_loan_floor_percent":["final_pay_loan_floor_percent"],"name":["name"],"overtime_full_award_percent":["overtime_full_award_percent"],"pay_methods":["pay_methods"],"reason":["reason"],"registered_address":["registered_address"],"representative_name":["representative_name"],"settings_code":["settings_code"],"status":["status"],"time_zone":["time_zone"]},"key":["id"],"locks":[{"constraint":"entity_profile_version__lock__f51311df","except":["effective_range","reason","status"],"name":"sealed_version","sql":"(coalesce(t.\"status\" = ''SEALED''::text, false))"},{"constraint":"entity_profile_version__lock__f8268056","except":[],"name":"void_version","sql":"(coalesce(t.\"status\" = ''VOID''::text, false))"}],"parents":[],"states":{"status":{"initial":"DRAFT","states":{"DRAFT":{"to":["SEALED"]},"SEALED":{"to":["VOID"]},"VOID":{"to":[]}}}}}');

-- step replace:trigger:workplace_case_catalog_entry.store_statement_rules_update (additive)
create trigger store_statement_rules_update after update on "workplace_case_catalog_entry" referencing old table as store_old new table as store_new for each statement execute function store_statement_rules('{"fields":{"catalog_code":["catalog_code"],"closed_on":["closed_on"],"description":["description"],"employment_id":["employment_id"],"entity_id":["entity_id"],"evidence_file":["evidence_file"],"inputs":["inputs"],"kind":["kind"],"location":["location"],"occurred_on":["occurred_on"],"opened_on":["opened_on"],"payroll_run_id":["payroll_run_id"],"reference":["reference"],"scheduled_on":["scheduled_on"],"severity":["severity"]},"key":["id"],"locks":[{"constraint":"workplace_case_catalog_entry__lock__b737815f","except":[],"name":"captured","sql":"(t.\"payroll_run_id\" is not null)"}],"parents":[],"states":{}}');

-- step replace:trigger:workplace_case_catalog_entry.store_statement_rules_delete (additive)
create trigger store_statement_rules_delete after delete on "workplace_case_catalog_entry" referencing old table as store_old for each statement execute function store_statement_rules('{"fields":{"catalog_code":["catalog_code"],"closed_on":["closed_on"],"description":["description"],"employment_id":["employment_id"],"entity_id":["entity_id"],"evidence_file":["evidence_file"],"inputs":["inputs"],"kind":["kind"],"location":["location"],"occurred_on":["occurred_on"],"opened_on":["opened_on"],"payroll_run_id":["payroll_run_id"],"reference":["reference"],"scheduled_on":["scheduled_on"],"severity":["severity"]},"key":["id"],"locks":[{"constraint":"workplace_case_catalog_entry__lock__b737815f","except":[],"name":"captured","sql":"(t.\"payroll_run_id\" is not null)"}],"parents":[],"states":{}}');

-- step replace:trigger:payroll_run.store_statement_rules_update (additive)
create trigger store_statement_rules_update after update on "payroll_run" referencing old table as store_old new table as store_new for each statement execute function store_statement_rules('{"fields":{"entity_id":["entity_id"],"kind":["kind"],"pay_date":["pay_date"],"pay_group_id":["pay_group_id"],"period":["period"],"salary_coverage":["salary_coverage"],"state":["state"]},"key":["id"],"locks":[{"constraint":"payroll_run__lock__753125e2","except":[],"name":"paid_run","sql":"(coalesce(t.\"state\" = ''PAID''::text, false))"}],"parents":[],"states":{"state":{"initial":"UNPAID","states":{"PAID":{"to":[]},"UNPAID":{"to":["PAID"]}}}}}');

-- step replace:trigger:payroll_run.store_statement_rules_delete (additive)
create trigger store_statement_rules_delete after delete on "payroll_run" referencing old table as store_old for each statement execute function store_statement_rules('{"fields":{"entity_id":["entity_id"],"kind":["kind"],"pay_date":["pay_date"],"pay_group_id":["pay_group_id"],"period":["period"],"salary_coverage":["salary_coverage"],"state":["state"]},"key":["id"],"locks":[{"constraint":"payroll_run__lock__753125e2","except":[],"name":"paid_run","sql":"(coalesce(t.\"state\" = ''PAID''::text, false))"}],"parents":[],"states":{"state":{"initial":"UNPAID","states":{"PAID":{"to":[]},"UNPAID":{"to":["PAID"]}}}}}');

-- step replace:trigger:statutory_finding.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "statutory_finding" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{"status":{"initial":"PROPOSED","states":{"CONFIRMED":{"to":["REJECTED"]},"PROPOSED":{"to":["CONFIRMED","REJECTED"]},"REJECTED":{"to":[]}}}}}');

-- step replace:trigger:statutory_finding.store_statement_rules_update (additive)
create trigger store_statement_rules_update after update on "statutory_finding" referencing old table as store_old new table as store_new for each statement execute function store_statement_rules('{"fields":{"announced_on":["announced_on"],"families":["families"],"fit":["fit"],"instrument_key":["instrument_key"],"jurisdiction_code":["jurisdiction_code"],"notes":["notes"],"research_run_id":["research_run_id"],"source_quote":["source_quote"],"source_urls":["source_urls"],"status":["status"],"summary":["summary"],"title":["title"],"verified_by":["verified_by"],"verified_on":["verified_on"]},"key":["id"],"locks":[{"constraint":"statutory_finding__lock__e58aad66","except":["status","notes"],"name":"confirmed_finding","sql":"(coalesce(t.\"status\" = ''CONFIRMED''::text, false))"},{"constraint":"statutory_finding__lock__943c1d92","except":[],"name":"decided_finding","sql":"(coalesce(t.\"status\" = ''REJECTED''::text, false))"}],"parents":[],"states":{"status":{"initial":"PROPOSED","states":{"CONFIRMED":{"to":["REJECTED"]},"PROPOSED":{"to":["CONFIRMED","REJECTED"]},"REJECTED":{"to":[]}}}}}');

-- step replace:trigger:statutory_finding.store_statement_rules_delete (additive)
create trigger store_statement_rules_delete after delete on "statutory_finding" referencing old table as store_old for each statement execute function store_statement_rules('{"fields":{"announced_on":["announced_on"],"families":["families"],"fit":["fit"],"instrument_key":["instrument_key"],"jurisdiction_code":["jurisdiction_code"],"notes":["notes"],"research_run_id":["research_run_id"],"source_quote":["source_quote"],"source_urls":["source_urls"],"status":["status"],"summary":["summary"],"title":["title"],"verified_by":["verified_by"],"verified_on":["verified_on"]},"key":["id"],"locks":[{"constraint":"statutory_finding__lock__e58aad66","except":["status","notes"],"name":"confirmed_finding","sql":"(coalesce(t.\"status\" = ''CONFIRMED''::text, false))"},{"constraint":"statutory_finding__lock__943c1d92","except":[],"name":"decided_finding","sql":"(coalesce(t.\"status\" = ''REJECTED''::text, false))"}],"parents":[],"states":{"status":{"initial":"PROPOSED","states":{"CONFIRMED":{"to":["REJECTED"]},"PROPOSED":{"to":["CONFIRMED","REJECTED"]},"REJECTED":{"to":[]}}}}}');

-- step replace:history:current (additive)
-- operational risk: writes-blocked, table-scan
update bolt_history_current set active=false where active and not (model=any(array['adhoc_catalog_entry','approval_request','claim_catalog_entry','contract_change','employee_balance','employee_contract','employee_profile','entity','entity_change','entity_profile_version','holiday','jurisdiction','jurisdiction_change','leave_catalog_entry','leave_catalog_entry_day','ledger_entry','loan_catalog_entry','loan_catalog_entry_repayment','obligation','pay_amendment','pay_group','payroll_run','payslip','roster_entry','shift_definition','shift_pattern','statutory_finding','statutory_source','sys_api_key','sys_conversation','sys_envoy','sys_file','sys_integration','sys_invitation','sys_user','work_event','workplace_case_catalog_entry']::text[]));

-- step replace:engine:audit:entity_profile_version (additive)
drop trigger if exists bolt_audit_mark on "entity_profile_version";
drop trigger if exists bolt_audit on "entity_profile_version";
create trigger bolt_audit after insert or update or delete on "entity_profile_version" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[]','[["entity_id","entity"]]');

-- step replace:engine:audit:adhoc_catalog_entry (additive)
drop trigger if exists bolt_audit_mark on "adhoc_catalog_entry";
drop trigger if exists bolt_audit on "adhoc_catalog_entry";
create trigger bolt_audit after insert or update or delete on "adhoc_catalog_entry" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[]','[["employment_id","employee_contract"],["entity_id","entity"],["payroll_run_id","payroll_run"]]');

-- step replace:engine:audit:claim_catalog_entry (additive)
drop trigger if exists bolt_audit_mark on "claim_catalog_entry";
drop trigger if exists bolt_audit on "claim_catalog_entry";
create trigger bolt_audit after insert or update or delete on "claim_catalog_entry" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[]','[["employment_id","employee_contract"],["entity_id","entity"],["payroll_run_id","payroll_run"]]');

-- step replace:engine:audit:leave_catalog_entry (additive)
drop trigger if exists bolt_audit_mark on "leave_catalog_entry";
drop trigger if exists bolt_audit on "leave_catalog_entry";
create trigger bolt_audit after insert or update or delete on "leave_catalog_entry" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[]','[["employment_id","employee_contract"],["entity_id","entity"],["payroll_run_id","payroll_run"]]');

-- step replace:engine:audit:loan_catalog_entry (additive)
drop trigger if exists bolt_audit_mark on "loan_catalog_entry";
drop trigger if exists bolt_audit on "loan_catalog_entry";
create trigger bolt_audit after insert or update or delete on "loan_catalog_entry" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[]','[["employment_id","employee_contract"],["entity_id","entity"],["payroll_run_id","payroll_run"]]');

-- step replace:engine:audit:workplace_case_catalog_entry (additive)
drop trigger if exists bolt_audit_mark on "workplace_case_catalog_entry";
drop trigger if exists bolt_audit on "workplace_case_catalog_entry";
create trigger bolt_audit after insert or update or delete on "workplace_case_catalog_entry" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[]','[["employment_id","employee_contract"],["entity_id","entity"],["payroll_run_id","payroll_run"]]');

-- step replace:engine:audit:payroll_run (additive)
drop trigger if exists bolt_audit_mark on "payroll_run";
drop trigger if exists bolt_audit on "payroll_run";
create trigger bolt_audit after insert or update or delete on "payroll_run" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[]','[["entity_id","entity"],["pay_group_id","pay_group"]]');

-- step replace:engine:audit:payslip (additive)
drop trigger if exists bolt_audit_mark on "payslip";
drop trigger if exists bolt_audit on "payslip";
create trigger bolt_audit after insert or update or delete on "payslip" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[]','[["employee_id","employee_profile"],["employment_id","employee_contract"],["entity_id","entity"],["payroll_run_id","payroll_run"]]');

-- step replace:engine:audit:work_event (additive)
drop trigger if exists bolt_audit_mark on "work_event";
drop trigger if exists bolt_audit on "work_event";
create trigger bolt_audit after insert or update or delete on "work_event" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[]','[["employment_id","employee_contract"],["entity_id","entity"]]');

-- step create:trigger:jurisdiction.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "jurisdiction" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

-- step create:index:jurisdiction.jurisdiction__gin__73732636 (additive)
create index "jurisdiction__gin__73732636" on "jurisdiction" using gin (bolt_search);

-- step create:trigger:jurisdiction_change.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "jurisdiction_change" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

-- step create:index:jurisdiction_change.jurisdiction_change__gin__73732636 (additive)
create index "jurisdiction_change__gin__73732636" on "jurisdiction_change" using gin (bolt_search);

-- step create:index:jurisdiction_change.jurisdiction_change__ix__db9feb63 (additive)
create index "jurisdiction_change__ix__db9feb63" on "jurisdiction_change" ("finding_id");

-- step create:engine:audit:jurisdiction (additive)
drop trigger if exists bolt_audit_mark on "jurisdiction";
drop trigger if exists bolt_audit on "jurisdiction";
create trigger bolt_audit after insert or update or delete on "jurisdiction" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[]','[]');

-- step create:engine:audit:jurisdiction_change (additive)
drop trigger if exists bolt_audit_mark on "jurisdiction_change";
drop trigger if exists bolt_audit on "jurisdiction_change";
create trigger bolt_audit after insert or update or delete on "jurisdiction_change" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[]','[["finding_id","statutory_finding"]]');
