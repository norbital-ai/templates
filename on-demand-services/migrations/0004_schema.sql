-- 0004_schema.sql: 308 step(s), from 6e23f121e04293f01ea61b1e6c63713ec41fe6d2f6a2cfd6f1423a3f3dab8e8b to fd38a378b6aaf5c8e527cc7df0221eba2bb3065d041da424262cde7d7e53c965.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- hazard: DESTRUCTIVE: drops data (a table or a stored column) or rebuilds it; runs only under its accept line.
-- hazard: backfill: a derived column is filled from every row (time grows with the table).
-- hazard: rename: readers of the old name break; the data stays.
-- hazard: validating: refuses, naming the constraint and the row count, if existing rows break it.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-rewrite: may rewrite the table; disk use and work grow with existing data.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.

-- step drop:index:scheduling_settings.dispatch_settings__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "dispatch_settings__gin__73732636";

-- step drop:trigger:helper_warnings.store_row_rules (additive)
drop trigger if exists store_row_rules on "helper_warnings";

-- step drop:index:helper_warnings.helper_warnings__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "helper_warnings__gin__73732636";

-- step drop:index:helper_warnings.helper_warnings__ix__6090f241 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "helper_warnings__ix__6090f241";

-- step drop:trigger:helpers.store_row_rules (additive)
drop trigger if exists store_row_rules on "helpers";

-- step drop:index:helpers.helpers__gist__d0519d21 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "helpers__gist__d0519d21";

-- step drop:index:helpers.helpers__gist__22635a76 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "helpers__gist__22635a76";

-- step drop:index:helpers.helpers__gin__95aa4a34 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "helpers__gin__95aa4a34";

-- step drop:index:helpers.helpers__gin__8924af97 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "helpers__gin__8924af97";

-- step drop:index:helpers.helpers__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "helpers__gin__73732636";

-- step drop:trigger:appointments.store_statement_rules_insert (additive)
drop trigger if exists store_statement_rules_insert on "visits";

-- step drop:index:appointments.visits__gist__bb1c4cd7 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "visits__gist__bb1c4cd7";

-- step drop:index:appointments.visits__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "visits__gin__73732636";

-- step drop:index:appointments.visits__ix__bf9f9696 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "visits__ix__bf9f9696";

-- step drop:index:availability_requests.availability_requests__ix__b1ca77f6 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "availability_requests__ix__b1ca77f6";

-- step drop:index:booking_providers.booking_helpers__ix__e4149908 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "booking_helpers__ix__e4149908";

-- step drop:index:booking_providers.booking_helpers__ix__b1ca77f6 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "booking_helpers__ix__b1ca77f6";

-- step drop:index:customer_notices.customer_notices__ix__5c37fbe2 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "customer_notices__ix__5c37fbe2";

-- step drop:index:provider_time_off.helper_time_off__ix__b1ca77f6 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "helper_time_off__ix__b1ca77f6";

-- step drop:index:helper_warnings.helper_warnings__ix__b1ca77f6 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "helper_warnings__ix__b1ca77f6";

-- step drop:index:helper_warnings.helper_warnings__ix__5c37fbe2 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "helper_warnings__ix__5c37fbe2";

-- step drop:index:helpers.helpers__ix__fccf4300 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "helpers__ix__fccf4300";

-- step drop:index:appointments.visits__ix__e4149908 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "visits__ix__e4149908";

-- step drop:index:appointments.visits__ix__b1ca77f6 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "visits__ix__b1ca77f6";

-- step drop:index:appointments.visits__ix__d0523071 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "visits__ix__d0523071";

-- step drop:index:appointments.visits__ix__b867ad56 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "visits__ix__b867ad56";

-- step replace:trigger:availability_requests.store_statement_rules_update (additive)
drop trigger if exists store_statement_rules_update on "availability_requests";

-- step replace:trigger:availability_requests.store_statement_rules_delete (additive)
drop trigger if exists store_statement_rules_delete on "availability_requests";

-- step replace:trigger:booking_requests.store_statement_rules_update (additive)
drop trigger if exists store_statement_rules_update on "booking_requests";

-- step replace:trigger:booking_requests.store_statement_rules_delete (additive)
drop trigger if exists store_statement_rules_delete on "booking_requests";

-- step replace:trigger:bookings.store_statement_rules_update (additive)
drop trigger if exists store_statement_rules_update on "bookings";

-- step replace:trigger:bookings.store_statement_rules_delete (additive)
drop trigger if exists store_statement_rules_delete on "bookings";

-- step replace:trigger:appointments.store_row_rules (additive)
drop trigger if exists store_row_rules on "visits";

-- step replace:trigger:appointments.store_statement_rules_update (additive)
drop trigger if exists store_statement_rules_update on "visits";

-- step replace:trigger:appointments.store_statement_rules_delete (additive)
drop trigger if exists store_statement_rules_delete on "visits";

-- step replace:trigger:booking_providers.store_statement_rules_insert (additive)
drop trigger if exists store_statement_rules_insert on "booking_helpers";

-- step replace:trigger:booking_providers.store_statement_rules_update (additive)
drop trigger if exists store_statement_rules_update on "booking_helpers";

-- step replace:trigger:booking_providers.store_statement_rules_delete (additive)
drop trigger if exists store_statement_rules_delete on "booking_helpers";

-- step replace:index:services.services__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "services__gin__73732636";

-- step drop:fk:availability_requests.availability_requests__fk__7c1e006b (additive)
-- operational risk: access-exclusive-lock
alter table "availability_requests" drop constraint if exists "availability_requests__fk__7c1e006b";

-- step drop:fk:booking_providers.booking_helpers__fk__fa057e1a (additive)
-- operational risk: access-exclusive-lock
alter table "booking_helpers" drop constraint if exists "booking_helpers__fk__fa057e1a";

-- step drop:fk:booking_providers.booking_helpers__fk__7c1e006b (additive)
-- operational risk: access-exclusive-lock
alter table "booking_helpers" drop constraint if exists "booking_helpers__fk__7c1e006b";

-- step drop:fk:customer_notices.customer_notices__fk__9bad1692 (additive)
-- operational risk: access-exclusive-lock
alter table "customer_notices" drop constraint if exists "customer_notices__fk__9bad1692";

-- step drop:fk:customer_notices.customer_notices__fk__755f7828 (additive)
-- operational risk: access-exclusive-lock
alter table "customer_notices" drop constraint if exists "customer_notices__fk__755f7828";

-- step drop:fk:provider_time_off.helper_time_off__fk__522d082d (additive)
-- operational risk: access-exclusive-lock
alter table "helper_time_off" drop constraint if exists "helper_time_off__fk__522d082d";

-- step drop:fk:helper_warnings.helper_warnings__fk__7c1e006b (additive)
-- operational risk: access-exclusive-lock
alter table "helper_warnings" drop constraint if exists "helper_warnings__fk__7c1e006b";

-- step drop:fk:helper_warnings.helper_warnings__fk__755f7828 (additive)
-- operational risk: access-exclusive-lock
alter table "helper_warnings" drop constraint if exists "helper_warnings__fk__755f7828";

-- step drop:fk:helpers.helpers__fk__5ab0092a (additive)
-- operational risk: access-exclusive-lock
alter table "helpers" drop constraint if exists "helpers__fk__5ab0092a";

-- step drop:fk:appointments.visits__fk__fa057e1a (additive)
-- operational risk: access-exclusive-lock
alter table "visits" drop constraint if exists "visits__fk__fa057e1a";

-- step drop:fk:appointments.visits__fk__0835022c (additive)
-- operational risk: access-exclusive-lock
alter table "visits" drop constraint if exists "visits__fk__0835022c";

-- step drop:fk:appointments.visits__fk__904d5b2f (additive)
-- operational risk: access-exclusive-lock
alter table "visits" drop constraint if exists "visits__fk__904d5b2f";

-- step drop:fk:appointments.visits__fk__722ec25d (additive)
-- operational risk: access-exclusive-lock
alter table "visits" drop constraint if exists "visits__fk__722ec25d";

-- step drop:constraint:availability_requests.availability_requests__ck__651ad380 (additive)
-- operational risk: access-exclusive-lock
alter table "availability_requests" drop constraint if exists "availability_requests__ck__651ad380";

-- step drop:constraint:booking_providers.booking_helpers__ck__8e164ef7 (additive)
-- operational risk: access-exclusive-lock
alter table "booking_helpers" drop constraint if exists "booking_helpers__ck__8e164ef7";

-- step drop:constraint:booking_providers.booking_helpers__uq__ab4503ea (additive)
-- operational risk: access-exclusive-lock
alter table "booking_helpers" drop constraint if exists "booking_helpers__uq__ab4503ea";

-- step drop:constraint:booking_requests.booking_requests__ck__651ad380 (additive)
-- operational risk: access-exclusive-lock
alter table "booking_requests" drop constraint if exists "booking_requests__ck__651ad380";

-- step drop:constraint:bookings.bookings__ck__651ad380 (additive)
-- operational risk: access-exclusive-lock
alter table "bookings" drop constraint if exists "bookings__ck__651ad380";

-- step drop:constraint:customers.customers__ck__651ad380 (additive)
-- operational risk: access-exclusive-lock
alter table "customers" drop constraint if exists "customers__ck__651ad380";

-- step drop:constraint:scheduling_settings.dispatch_settings__ck__4446483f (additive)
-- operational risk: access-exclusive-lock
alter table "dispatch_settings" drop constraint if exists "dispatch_settings__ck__4446483f";

-- step drop:constraint:scheduling_settings.dispatch_settings__ck__786c73b3 (additive)
-- operational risk: access-exclusive-lock
alter table "dispatch_settings" drop constraint if exists "dispatch_settings__ck__786c73b3";

-- step drop:constraint:scheduling_settings.dispatch_settings__ck__8d366436 (additive)
-- operational risk: access-exclusive-lock
alter table "dispatch_settings" drop constraint if exists "dispatch_settings__ck__8d366436";

-- step drop:constraint:scheduling_settings.dispatch_settings__ck__f142e450 (additive)
-- operational risk: access-exclusive-lock
alter table "dispatch_settings" drop constraint if exists "dispatch_settings__ck__f142e450";

-- step drop:constraint:scheduling_settings.dispatch_settings__ck__9f371d94 (additive)
-- operational risk: access-exclusive-lock
alter table "dispatch_settings" drop constraint if exists "dispatch_settings__ck__9f371d94";

-- step drop:constraint:scheduling_settings.dispatch_settings__uq__27f44ac5 (additive)
-- operational risk: access-exclusive-lock
alter table "dispatch_settings" drop constraint if exists "dispatch_settings__uq__27f44ac5";

-- step drop:constraint:scheduling_settings.dispatch_settings__ck__df42c5c1 (additive)
-- operational risk: access-exclusive-lock
alter table "dispatch_settings" drop constraint if exists "dispatch_settings__ck__df42c5c1";

-- step drop:constraint:provider_time_off.helper_time_off__ck__ebc65b98 (additive)
-- operational risk: access-exclusive-lock
alter table "helper_time_off" drop constraint if exists "helper_time_off__ck__ebc65b98";

-- step drop:constraint:provider_time_off.helper_time_off__ck__520dadab (additive)
-- operational risk: access-exclusive-lock
alter table "helper_time_off" drop constraint if exists "helper_time_off__ck__520dadab";

-- step drop:constraint:provider_time_off.helper_time_off__ex__556aa6fc (additive)
-- operational risk: access-exclusive-lock
alter table "helper_time_off" drop constraint if exists "helper_time_off__ex__556aa6fc";

-- step drop:constraint:helper_warnings.helper_warnings__ck__b60b1511 (additive)
-- operational risk: access-exclusive-lock
alter table "helper_warnings" drop constraint if exists "helper_warnings__ck__b60b1511";

-- step drop:constraint:helper_warnings.helper_warnings__ck__1b0d4151 (additive)
-- operational risk: access-exclusive-lock
alter table "helper_warnings" drop constraint if exists "helper_warnings__ck__1b0d4151";

-- step drop:constraint:helper_warnings.helper_warnings__ck__039a80a0 (additive)
-- operational risk: access-exclusive-lock
alter table "helper_warnings" drop constraint if exists "helper_warnings__ck__039a80a0";

-- step drop:constraint:helpers.helpers__ck__fce01fd6 (additive)
-- operational risk: access-exclusive-lock
alter table "helpers" drop constraint if exists "helpers__ck__fce01fd6";

-- step drop:constraint:helpers.helpers__ck__fe4d8edc (additive)
-- operational risk: access-exclusive-lock
alter table "helpers" drop constraint if exists "helpers__ck__fe4d8edc";

-- step drop:constraint:helpers.helpers__ck__e3909153 (additive)
-- operational risk: access-exclusive-lock
alter table "helpers" drop constraint if exists "helpers__ck__e3909153";

-- step drop:constraint:helpers.helpers__ck__ead2bfc9 (additive)
-- operational risk: access-exclusive-lock
alter table "helpers" drop constraint if exists "helpers__ck__ead2bfc9";

-- step drop:constraint:helpers.helpers__ck__07118c9b (additive)
-- operational risk: access-exclusive-lock
alter table "helpers" drop constraint if exists "helpers__ck__07118c9b";

-- step drop:constraint:helpers.helpers__ck__1c862404 (additive)
-- operational risk: access-exclusive-lock
alter table "helpers" drop constraint if exists "helpers__ck__1c862404";

-- step drop:constraint:helpers.helpers__ck__6c69e4b2 (additive)
-- operational risk: access-exclusive-lock
alter table "helpers" drop constraint if exists "helpers__ck__6c69e4b2";

-- step drop:constraint:helpers.helpers__ck__43907b08 (additive)
-- operational risk: access-exclusive-lock
alter table "helpers" drop constraint if exists "helpers__ck__43907b08";

-- step drop:constraint:helpers.helpers__ck__cdd3cd5d (additive)
-- operational risk: access-exclusive-lock
alter table "helpers" drop constraint if exists "helpers__ck__cdd3cd5d";

-- step drop:constraint:helpers.helpers__ck__2cb18c1e (additive)
-- operational risk: access-exclusive-lock
alter table "helpers" drop constraint if exists "helpers__ck__2cb18c1e";

-- step drop:constraint:helpers.helpers__ck__7592fc4c (additive)
-- operational risk: access-exclusive-lock
alter table "helpers" drop constraint if exists "helpers__ck__7592fc4c";

-- step drop:constraint:helpers.helpers__uq__f7773e92 (additive)
-- operational risk: access-exclusive-lock
alter table "helpers" drop constraint if exists "helpers__uq__f7773e92";

-- step drop:constraint:helpers.helpers__ck__7300625c (additive)
-- operational risk: access-exclusive-lock
alter table "helpers" drop constraint if exists "helpers__ck__7300625c";

-- step drop:constraint:services.services__ck__e56acf6a (additive)
-- operational risk: access-exclusive-lock
alter table "services" drop constraint if exists "services__ck__e56acf6a";

-- step drop:constraint:services.services__ck__13927f40 (additive)
-- operational risk: access-exclusive-lock
alter table "services" drop constraint if exists "services__ck__13927f40";

-- step drop:constraint:appointments.visits__ck__651ad380 (additive)
-- operational risk: access-exclusive-lock
alter table "visits" drop constraint if exists "visits__ck__651ad380";

-- step drop:constraint:appointments.visits__ck__69cf7be7 (additive)
-- operational risk: access-exclusive-lock
alter table "visits" drop constraint if exists "visits__ck__69cf7be7";

-- step drop:constraint:appointments.visits__ck__24d370ee (additive)
-- operational risk: access-exclusive-lock
alter table "visits" drop constraint if exists "visits__ck__24d370ee";

-- step drop:constraint:appointments.visits__ck__4c1a0f3a (additive)
-- operational risk: access-exclusive-lock
alter table "visits" drop constraint if exists "visits__ck__4c1a0f3a";

-- step drop:constraint:appointments.visits__ck__a764b151 (additive)
-- operational risk: access-exclusive-lock
alter table "visits" drop constraint if exists "visits__ck__a764b151";

-- step drop:constraint:appointments.visits__ck__59d37111 (additive)
-- operational risk: access-exclusive-lock
alter table "visits" drop constraint if exists "visits__ck__59d37111";

-- step drop:constraint:appointments.visits__uq__268a00e8 (additive)
-- operational risk: access-exclusive-lock
alter table "visits" drop constraint if exists "visits__uq__268a00e8";

-- step drop:constraint:appointments.visits__ck__f9e58aa9 (additive)
-- operational risk: access-exclusive-lock
alter table "visits" drop constraint if exists "visits__ck__f9e58aa9";

-- step drop:constraint:appointments.visits__ck__81a94226 (additive)
-- operational risk: access-exclusive-lock
alter table "visits" drop constraint if exists "visits__ck__81a94226";

-- step drop:constraint:appointments.visits__ck__bfc3eaf2 (additive)
-- operational risk: access-exclusive-lock
alter table "visits" drop constraint if exists "visits__ck__bfc3eaf2";

-- step drop:constraint:appointments.visits__ck__13927f40 (additive)
-- operational risk: access-exclusive-lock
alter table "visits" drop constraint if exists "visits__ck__13927f40";

-- step drop:constraint:appointments.visits__ck__26dc33e3 (additive)
-- operational risk: access-exclusive-lock
alter table "visits" drop constraint if exists "visits__ck__26dc33e3";

-- step drop:constraint:appointments.visits__ck__df253602 (additive)
-- operational risk: access-exclusive-lock
alter table "visits" drop constraint if exists "visits__ck__df253602";

-- step drop:constraint:appointments.visits__ck__97cf9ff3 (additive)
-- operational risk: access-exclusive-lock
alter table "visits" drop constraint if exists "visits__ck__97cf9ff3";

-- step drop:constraint:appointments.visits__ex__12f1c5d6 (additive)
-- operational risk: access-exclusive-lock
alter table "visits" drop constraint if exists "visits__ex__12f1c5d6";

-- step drop:notNull:bookings.visit_count (additive)
-- operational risk: access-exclusive-lock
alter table "bookings" alter column "visit_count" drop not null;

-- step drop:notNull:helper_warnings.issued_at (additive)
-- operational risk: access-exclusive-lock
alter table "helper_warnings" alter column "issued_at" drop not null;

-- step drop:notNull:helper_warnings.reason (additive)
-- operational risk: access-exclusive-lock
alter table "helper_warnings" alter column "reason" drop not null;

-- step drop:notNull:helpers.day_end (additive)
-- operational risk: access-exclusive-lock
alter table "helpers" alter column "day_end" drop not null;

-- step drop:notNull:helpers.day_start (additive)
-- operational risk: access-exclusive-lock
alter table "helpers" alter column "day_start" drop not null;

-- step drop:notNull:helpers.name (additive)
-- operational risk: access-exclusive-lock
alter table "helpers" alter column "name" drop not null;

-- step drop:notNull:helpers.phone (additive)
-- operational risk: access-exclusive-lock
alter table "helpers" alter column "phone" drop not null;

-- step drop:notNull:helpers.skills (additive)
-- operational risk: access-exclusive-lock
alter table "helpers" alter column "skills" drop not null;

-- step drop:notNull:helpers.status (additive)
-- operational risk: access-exclusive-lock
alter table "helpers" alter column "status" drop not null;

-- step drop:notNull:helpers.warning_count (additive)
-- operational risk: access-exclusive-lock
alter table "helpers" alter column "warning_count" drop not null;

-- step drop:notNull:helpers.work_days (additive)
-- operational risk: access-exclusive-lock
alter table "helpers" alter column "work_days" drop not null;

-- step drop:notNull:appointments.mc (additive)
-- operational risk: access-exclusive-lock
alter table "visits" alter column "mc" drop not null;

-- step drop:notNull:booking_providers.helper (additive)
-- operational risk: access-exclusive-lock
alter table "booking_helpers" alter column "helper" drop not null;

-- step drop:notNull:provider_time_off.helper (additive)
-- operational risk: access-exclusive-lock
alter table "helper_time_off" alter column "helper" drop not null;

-- step drop:notNull:helper_warnings.helper (additive)
-- operational risk: access-exclusive-lock
alter table "helper_warnings" alter column "helper" drop not null;

-- step drop:default:helpers.status (additive)
-- operational risk: access-exclusive-lock
alter table "helpers" alter column "status" drop default;

-- step drop:default:appointments.mc (additive)
-- operational risk: access-exclusive-lock
alter table "visits" alter column "mc" drop default;

-- step replace:default:scheduling_settings.name (additive)
-- operational risk: access-exclusive-lock
alter table "dispatch_settings" alter column "name" drop default;

-- step drop:column:availability_requests.area (destructive)
-- accept: drop:column:availability_requests.area
-- operational risk: access-exclusive-lock
alter table "availability_requests" drop column if exists "area" cascade;

-- step drop:column:booking_requests.area (destructive)
-- accept: drop:column:booking_requests.area
-- operational risk: access-exclusive-lock
alter table "booking_requests" drop column if exists "area" cascade;

-- step drop:column:bookings.area (destructive)
-- accept: drop:column:bookings.area
-- operational risk: access-exclusive-lock
alter table "bookings" drop column if exists "area" cascade;

-- step drop:column:bookings.visit_count (additive)
-- operational risk: access-exclusive-lock
alter table "bookings" drop column if exists "visit_count" cascade;

-- step drop:column:customers.area (destructive)
-- accept: drop:column:customers.area
-- operational risk: access-exclusive-lock
alter table "customers" drop column if exists "area" cascade;

-- step drop:column:helper_warnings.issued_at (destructive)
-- accept: drop:column:helper_warnings.issued_at
-- operational risk: access-exclusive-lock
alter table "helper_warnings" drop column if exists "issued_at" cascade;

-- step drop:column:helper_warnings.letter (destructive)
-- accept: drop:column:helper_warnings.letter
-- operational risk: access-exclusive-lock
alter table "helper_warnings" drop column if exists "letter" cascade;

-- step drop:column:helper_warnings.notes (destructive)
-- accept: drop:column:helper_warnings.notes
-- operational risk: access-exclusive-lock
alter table "helper_warnings" drop column if exists "notes" cascade;

-- step drop:column:helper_warnings.reason (destructive)
-- accept: drop:column:helper_warnings.reason
-- operational risk: access-exclusive-lock
alter table "helper_warnings" drop column if exists "reason" cascade;

-- step drop:column:helper_warnings.bolt_search (additive)
-- operational risk: access-exclusive-lock
alter table "helper_warnings" drop column if exists bolt_search cascade;

-- step drop:column:helpers.day_end (destructive)
-- accept: drop:column:helpers.day_end
-- operational risk: access-exclusive-lock
alter table "helpers" drop column if exists "day_end" cascade;

-- step drop:column:helpers.day_start (destructive)
-- accept: drop:column:helpers.day_start
-- operational risk: access-exclusive-lock
alter table "helpers" drop column if exists "day_start" cascade;

-- step drop:column:helpers.home_area (destructive)
-- accept: drop:column:helpers.home_area
-- operational risk: access-exclusive-lock
alter table "helpers" drop column if exists "home_area" cascade;

-- step drop:column:helpers.home_location (destructive)
-- accept: drop:column:helpers.home_location
-- operational risk: access-exclusive-lock
alter table "helpers" drop column if exists "home_location" cascade;

-- step drop:column:helpers.last_location (destructive)
-- accept: drop:column:helpers.last_location
-- operational risk: access-exclusive-lock
alter table "helpers" drop column if exists "last_location" cascade;

-- step drop:column:helpers.last_location_at (destructive)
-- accept: drop:column:helpers.last_location_at
-- operational risk: access-exclusive-lock
alter table "helpers" drop column if exists "last_location_at" cascade;

-- step drop:column:helpers.left_on (destructive)
-- accept: drop:column:helpers.left_on
-- operational risk: access-exclusive-lock
alter table "helpers" drop column if exists "left_on" cascade;

-- step drop:column:helpers.name (destructive)
-- accept: drop:column:helpers.name
-- operational risk: access-exclusive-lock
alter table "helpers" drop column if exists "name" cascade;

-- step drop:column:helpers.phone (destructive)
-- accept: drop:column:helpers.phone
-- operational risk: access-exclusive-lock
alter table "helpers" drop column if exists "phone" cascade;

-- step drop:column:helpers.skills (destructive)
-- accept: drop:column:helpers.skills
-- operational risk: access-exclusive-lock
alter table "helpers" drop column if exists "skills" cascade;

-- step drop:column:helpers.status (destructive)
-- accept: drop:column:helpers.status
-- operational risk: access-exclusive-lock
alter table "helpers" drop column if exists "status" cascade;

-- step drop:column:helpers.warning_count (additive)
-- operational risk: access-exclusive-lock
alter table "helpers" drop column if exists "warning_count" cascade;

-- step drop:column:helpers.work_days (destructive)
-- accept: drop:column:helpers.work_days
-- operational risk: access-exclusive-lock
alter table "helpers" drop column if exists "work_days" cascade;

-- step drop:column:helpers.bolt_record_label (additive)
-- operational risk: access-exclusive-lock
alter table "helpers" drop column if exists "bolt_record_label" cascade;

-- step drop:column:helpers.bolt_search (additive)
-- operational risk: access-exclusive-lock
alter table "helpers" drop column if exists bolt_search cascade;

-- step drop:column:appointments.area (destructive)
-- accept: drop:column:appointments.area
-- operational risk: access-exclusive-lock
alter table "visits" drop column if exists "area" cascade;

-- step drop:column:appointments.mc (destructive)
-- accept: drop:column:appointments.mc
-- operational risk: access-exclusive-lock
alter table "visits" drop column if exists "mc" cascade;

-- step drop:column:availability_requests.helper (destructive)
-- accept: drop:column:availability_requests.helper
-- operational risk: access-exclusive-lock
alter table "availability_requests" drop column if exists "helper" cascade;

-- step drop:column:booking_providers.helper (destructive)
-- accept: drop:column:booking_providers.helper
-- operational risk: access-exclusive-lock
alter table "booking_helpers" drop column if exists "helper" cascade;

-- step drop:column:customer_notices.visit (destructive)
-- accept: drop:column:customer_notices.visit
-- operational risk: access-exclusive-lock
alter table "customer_notices" drop column if exists "visit" cascade;

-- step drop:column:provider_time_off.helper (destructive)
-- accept: drop:column:provider_time_off.helper
-- operational risk: access-exclusive-lock
alter table "helper_time_off" drop column if exists "helper" cascade;

-- step drop:column:helper_warnings.helper (destructive)
-- accept: drop:column:helper_warnings.helper
-- operational risk: access-exclusive-lock
alter table "helper_warnings" drop column if exists "helper" cascade;

-- step drop:column:helper_warnings.visit (destructive)
-- accept: drop:column:helper_warnings.visit
-- operational risk: access-exclusive-lock
alter table "helper_warnings" drop column if exists "visit" cascade;

-- step drop:column:helpers.user (destructive)
-- accept: drop:column:helpers.user
-- operational risk: access-exclusive-lock
alter table "helpers" drop column if exists "user" cascade;

-- step drop:column:appointments.helper (destructive)
-- accept: drop:column:appointments.helper
-- operational risk: access-exclusive-lock
alter table "visits" drop column if exists "helper" cascade;

-- step drop:column:appointments.proposed_helper (destructive)
-- accept: drop:column:appointments.proposed_helper
-- operational risk: access-exclusive-lock
alter table "visits" drop column if exists "proposed_helper" cascade;

-- step drop:column:appointments.unavailable_helper (destructive)
-- accept: drop:column:appointments.unavailable_helper
-- operational risk: access-exclusive-lock
alter table "visits" drop column if exists "unavailable_helper" cascade;

-- step replace:column:appointments.bolt_record_label (backfill)
-- operational risk: access-exclusive-lock
alter table "visits" drop column if exists "bolt_record_label" cascade;

-- step replace:column:appointments.bolt_search (backfill)
-- operational risk: access-exclusive-lock
alter table "visits" drop column if exists bolt_search cascade;

-- step replace:column:scheduling_settings.bolt_record_label (backfill)
-- operational risk: access-exclusive-lock
alter table "dispatch_settings" drop column if exists "bolt_record_label" cascade;

-- step replace:column:scheduling_settings.bolt_search (backfill)
-- operational risk: access-exclusive-lock
alter table "dispatch_settings" drop column if exists bolt_search cascade;

-- step replace:column:services.bolt_search (backfill)
-- operational risk: access-exclusive-lock
alter table "services" drop column if exists bolt_search cascade;

-- step drop:table:helper_warnings (destructive)
-- accept: drop:table:helper_warnings
-- operational risk: access-exclusive-lock
drop table if exists "helper_warnings" cascade;

-- step drop:table:helpers (destructive)
-- accept: drop:table:helpers
-- operational risk: access-exclusive-lock
drop table if exists "helpers" cascade;

-- step drop:function:bolt_record_label_dispatch_settings_93340fdd (additive)
drop function if exists "bolt_record_label_dispatch_settings_93340fdd"(text) cascade;

-- step drop:function:bolt_record_label_helpers_93340fdd (additive)
drop function if exists "bolt_record_label_helpers_93340fdd"(text) cascade;

-- step drop:function:bolt_record_label_visits_bde560e1 (additive)
drop function if exists "bolt_record_label_visits_bde560e1"(text) cascade;

-- step rename:visits->appointments (rename)
-- operational risk: access-exclusive-lock
alter table "visits" rename to "appointments";

-- step rename:appointments.visits_pkey->appointments_pkey (rename)
-- operational risk: access-exclusive-lock
alter table "appointments" rename constraint "visits_pkey" to "appointments_pkey";

-- step rename:booking_helpers->booking_providers (rename)
-- operational risk: access-exclusive-lock
alter table "booking_helpers" rename to "booking_providers";

-- step rename:booking_providers.booking_helpers_pkey->booking_providers_pkey (rename)
-- operational risk: access-exclusive-lock
alter table "booking_providers" rename constraint "booking_helpers_pkey" to "booking_providers_pkey";

-- step rename:helper_time_off->provider_time_off (rename)
-- operational risk: access-exclusive-lock
alter table "helper_time_off" rename to "provider_time_off";

-- step rename:provider_time_off.helper_time_off_pkey->provider_time_off_pkey (rename)
-- operational risk: access-exclusive-lock
alter table "provider_time_off" rename constraint "helper_time_off_pkey" to "provider_time_off_pkey";

-- step rename:dispatch_settings->scheduling_settings (rename)
-- operational risk: access-exclusive-lock
alter table "dispatch_settings" rename to "scheduling_settings";

-- step rename:scheduling_settings.dispatch_settings_pkey->scheduling_settings_pkey (rename)
-- operational risk: access-exclusive-lock
alter table "scheduling_settings" rename constraint "dispatch_settings_pkey" to "scheduling_settings_pkey";

-- step create:function:bolt_record_label_appointments_bde560e1 (additive)
create or replace function "bolt_record_label_appointments_bde560e1"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['number']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('number', to_jsonb("number")) AS j FROM (SELECT $1 AS "number") label_inputs) label_row OFFSET 0) label_value$record_label$;

-- step create:function:bolt_record_label_providers_93340fdd (additive)
create or replace function "bolt_record_label_providers_93340fdd"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['name']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('name', to_jsonb("name")) AS j FROM (SELECT $1 AS "name") label_inputs) label_row OFFSET 0) label_value$record_label$;

-- step create:function:bolt_record_label_scheduling_settings_93340fdd (additive)
create or replace function "bolt_record_label_scheduling_settings_93340fdd"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['name']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('name', to_jsonb("name")) AS j FROM (SELECT $1 AS "name") label_inputs) label_row OFFSET 0) label_value$record_label$;

-- step create:table:providers (additive)
create table "providers" ("id" uuid primary key, revision int not null default 1, created_at timestamptz not null default now(), created_by text, updated_at timestamptz not null default now(), updated_by text,
	"name" text not null,
	"phone" text not null,
	"email" text,
	"skills" text[] not null,
	"home_location" point,
	"work_days" text[] not null,
	"day_start" time not null,
	"day_end" time not null,
	"status" text default 'active' not null,
	"inactive_since" date,
	"last_location" point,
	"last_location_at" timestamptz,
	"bolt_record_label" text generated always as ("bolt_record_label_providers_93340fdd"("name")) stored,
	bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_providers_93340fdd"("name"), '') || ' ' || coalesce("name"::text, '') || ' ' || coalesce("phone"::text, '') || ' ' || coalesce("email"::text, ''))) stored,
	"user" text,
	constraint "providers__ck__7cce5ac9" check (char_length("name") <= 160),
	constraint "providers__ck__43907b08" check ("phone" ~ '^\+?[0-9][0-9 ()\-.]{2,}$'),
	constraint "providers__ck__88131100" check ("email" ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
	constraint "providers__ck__b69a2eaf" check (not jsonb_path_exists(to_jsonb("skills"), 'strict $[*] ? (@.type() != "string" || @ like_regex "^.{81}" flag "s")')),
	constraint "providers__ck__ead2bfc9" check ("home_location"[1] between -90 and 90 and "home_location"[0] between -180 and 180),
	constraint "providers__ck__7592fc4c" check (not jsonb_path_exists(to_jsonb("work_days"), 'strict $[*] ? (@.type() != "string")') and "work_days" <@ array['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']::text[]),
	constraint "providers__ck__fe4d8edc" check ("day_start" < time '24:00'),
	constraint "providers__ck__fce01fd6" check ("day_end" < time '24:00'),
	constraint "providers__ck__26d83180" check ("status" in ('active', 'inactive')),
	constraint "providers__ck__faccb9c6" check (isfinite("inactive_since")),
	constraint "providers__ck__07118c9b" check ("last_location"[1] between -90 and 90 and "last_location"[0] between -180 and 180),
	constraint "providers__ck__1c862404" check (isfinite("last_location_at")),
	constraint "providers__uq__f7773e92" unique ("user") deferrable initially immediate,
	constraint "providers__ck__7300625c" check ((coalesce("day_end" > "day_start", false)))
);

-- step replace:column:appointments.bolt_record_label (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "appointments" add column "bolt_record_label" text generated always as ("bolt_record_label_appointments_bde560e1"("number")) stored;

-- step replace:column:appointments.bolt_search (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "appointments" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_appointments_bde560e1"("number"), '') || ' ' || coalesce("number"::text, '') || ' ' || coalesce("address"::text, ''))) stored;

-- step replace:column:scheduling_settings.bolt_record_label (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "scheduling_settings" add column "bolt_record_label" text generated always as ("bolt_record_label_scheduling_settings_93340fdd"("name")) stored;

-- step replace:column:scheduling_settings.bolt_search (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "scheduling_settings" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_scheduling_settings_93340fdd"("name"), ''))) stored;

-- step create:column:services.category (additive)
-- operational risk: access-exclusive-lock
alter table "services" add column "category" text;

-- step replace:column:services.bolt_search (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "services" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_services_93340fdd"("name"), '') || ' ' || coalesce("name"::text, '') || ' ' || coalesce("category"::text, '') || ' ' || coalesce("skill"::text, ''))) stored;

-- step replace:history:schema:availability_requests (additive)
select bolt_history_register('availability_requests','{"audit":true,"fields":{"address":{"kind":"text","max":500},"checked_at":{"kind":"instant","optional":true},"estimated":{"default":true,"kind":"bool"},"location":{"kind":"point","optional":true},"phone":{"format":"phone","kind":"text"},"preference":{"default":"any","kind":"enum","values":["any","preferred"]},"problem":{"kind":"text","optional":true},"provider":{"kind":"ref","optional":true,"to":"providers"},"repeat":{"default":"once","kind":"enum","values":["once","weekly","fortnightly","monthly"]},"service":{"kind":"ref","to":"services"},"starts":{"default":[],"hidden":true,"kind":"text","many":true},"status":{"initial":"pending","kind":"state","states":{"failed":{},"pending":{"to":["ready","failed"]},"ready":{}}}},"locks":{"settled":{"where":{"status":{"in":["ready","failed"]}}}},"record_label":"record.address"}'::jsonb);

-- step replace:history:schema:booking_requests (additive)
select bolt_history_register('booking_requests','{"audit":true,"fields":{"address":{"kind":"text","max":500},"availability":{"kind":"ref","optional":true,"to":"availability_requests"},"booking":{"kind":"ref","on_delete":"set_null","optional":true,"to":"bookings"},"email":{"format":"email","kind":"text","optional":true},"name":{"kind":"text","max":200},"notes":{"kind":"text","max":2000,"optional":true},"number":{"kind":"seq","pattern":"RQ-{yyyy}-{0000}"},"outcome":{"kind":"text","optional":true},"phone":{"format":"phone","kind":"text"},"repeat":{"default":"once","kind":"enum","values":["once","weekly","fortnightly","monthly"]},"service":{"kind":"ref","to":"services","where":{"active":{"eq":true}}},"start":{"kind":"instant"},"status":{"initial":"received","kind":"state","states":{"booked":{},"closed":{},"follow_up":{"to":["booked","closed"]},"received":{"to":["booked","follow_up"]}}}},"indexes":[{"on":["status"]}],"locks":{"settled":{"where":{"status":{"in":["booked","closed"]}}}},"record_label":"record.number","search":{"text":["phone","address"]}}'::jsonb);

-- step replace:history:schema:bookings (additive)
select bolt_history_register('bookings','{"audit":true,"fields":{"address":{"kind":"text","max":500},"appointment_count":{"kind":"count","of":"appointments"},"customer":{"inverse":"bookings","kind":"ref","to":"customers"},"location":{"kind":"point","optional":true},"notes":{"kind":"text","max":2000,"optional":true},"number":{"kind":"seq","pattern":"BK-{yyyy}-{0000}"},"preference":{"kind":"enum","values":["any","preferred"]},"repeat":{"kind":"enum","values":["once","weekly","fortnightly","monthly"]},"service":{"inverse":"bookings","kind":"ref","to":"services"},"status":{"initial":"active","kind":"state","states":{"active":{"to":["cancelled"]},"cancelled":{}}}},"indexes":[{"on":["status"]}],"locks":{"cancelled":{"except":["appointments"],"where":{"status":{"eq":"cancelled"}}}},"record_label":"record.number","search":{"text":["number","customer","service"]}}'::jsonb);

-- step replace:history:schema:customers (additive)
select bolt_history_register('customers','{"audit":true,"fields":{"address":{"kind":"text","max":500},"email":{"format":"email","kind":"text","optional":true},"location":{"kind":"point","optional":true},"name":{"kind":"text","max":160},"notes":{"kind":"text","max":2000,"optional":true},"phone":{"format":"phone","kind":"text"}},"record_label":"record.name","search":{"text":["name","phone","email","address"]},"unique":[{"fields":["phone"],"name":"phone"}]}'::jsonb);

-- step replace:history:schema:customer_notices (additive)
select bolt_history_register('customer_notices','{"audit":true,"fields":{"appointment":{"kind":"ref","on_delete":"set_null","optional":true,"to":"appointments"},"auto_replied_at":{"kind":"instant","optional":true},"body":{"kind":"text","max":4000},"customer":{"inverse":"notices","kind":"ref","owned":true,"to":"customers"},"delivered_at":{"kind":"instant","optional":true},"delivery":{"kind":"enum","optional":true,"values":["queued","sent","deferred","delivered","opened","replied","bounced","failed"]},"delivery_presumed":{"kind":"bool","optional":true},"delivery_reason":{"kind":"text","optional":true},"opened_at":{"kind":"instant","optional":true},"replied_at":{"kind":"instant","optional":true},"reply_excerpt":{"kind":"text","optional":true},"sent_at":{"kind":"instant","optional":true},"subject":{"kind":"text","max":300},"to_address":{"kind":"text","optional":true},"whatsapp":{"kind":"text","optional":true}},"record_label":"record.subject","search":{"text":["subject","appointment"]}}'::jsonb);

-- step replace:history:schema:services (additive)
select bolt_history_register('services','{"audit":true,"fields":{"active":{"default":true,"kind":"bool"},"category":{"kind":"text","max":80,"optional":true},"description":{"kind":"text","max":1000,"optional":true},"duration_minutes":{"kind":"int","max":720,"min":15},"name":{"kind":"text","max":160},"price":{"currency":"USD","kind":"money"},"skill":{"kind":"text","max":80}},"record_label":"record.name","search":{"text":["name","category","skill"]},"unique":[{"fields":["name"],"name":"name"}]}'::jsonb);

-- step create:column:bookings.appointment_count (backfill)
-- operational risk: access-exclusive-lock
alter table "bookings" add column "appointment_count" int default 0;

-- step create:column:scheduling_settings.slot_interval_minutes (additive)
-- operational risk: access-exclusive-lock
alter table "scheduling_settings" add column "slot_interval_minutes" int default '30'::int;

-- step create:column:scheduling_settings.buffer_minutes (additive)
-- operational risk: access-exclusive-lock
alter table "scheduling_settings" add column "buffer_minutes" int default '15'::int;

-- step create:column:scheduling_settings.booking_horizon_days (additive)
-- operational risk: access-exclusive-lock
alter table "scheduling_settings" add column "booking_horizon_days" int default '14'::int;

-- step create:column:availability_requests.provider (additive)
-- operational risk: access-exclusive-lock
alter table "availability_requests" add column "provider" uuid;

-- step create:column:appointments.provider (additive)
-- operational risk: access-exclusive-lock
alter table "appointments" add column "provider" uuid;

-- step create:column:appointments.unavailable_provider (additive)
-- operational risk: access-exclusive-lock
alter table "appointments" add column "unavailable_provider" uuid;

-- step create:column:appointments.proposed_provider (additive)
-- operational risk: access-exclusive-lock
alter table "appointments" add column "proposed_provider" uuid;

-- step create:column:booking_providers.provider (additive)
-- operational risk: access-exclusive-lock
alter table "booking_providers" add column "provider" uuid;

-- step create:column:customer_notices.appointment (additive)
-- operational risk: access-exclusive-lock
alter table "customer_notices" add column "appointment" uuid;

-- step create:column:provider_time_off.provider (additive)
-- operational risk: access-exclusive-lock
alter table "provider_time_off" add column "provider" uuid;

-- step create:history:schema:appointments (additive)
select bolt_history_register('appointments','{"audit":true,"fields":{"address":{"kind":"text","max":500},"attention":{"default":"none","kind":"enum","values":["none","unassigned","eta_risk","provider_inactive","awaiting_approval"]},"booking":{"inverse":"appointments","kind":"ref","owned":true,"to":"bookings"},"completed_at":{"kind":"instant","optional":true},"completion_notes":{"kind":"text","max":2000,"optional":true},"eta_checked_at":{"kind":"instant","optional":true},"eta_minutes":{"kind":"int","optional":true},"late_cancellation":{"default":false,"kind":"bool"},"location":{"kind":"point","optional":true},"number":{"kind":"seq","pattern":"AP-{yyyy}-{00000}"},"proposed_provider":{"kind":"ref","on_delete":"set_null","optional":true,"to":"providers"},"proposed_slot":{"kind":"period","of":"instant","optional":true},"provider":{"inverse":"appointments","kind":"ref","on_delete":"set_null","optional":true,"to":"providers"},"shift_asked_at":{"kind":"instant","optional":true},"shift_check":{"default":"not_due","kind":"enum","values":["not_due","asked","confirmed","no_response","declined"]},"skill":{"kind":"text","max":80},"slot":{"kind":"period","of":"instant"},"started_at":{"kind":"instant","optional":true},"status":{"initial":"scheduled","kind":"state","states":{"cancelled":{},"completed":{"stamp":"completed_at"},"in_progress":{"stamp":"started_at","to":["completed"]},"scheduled":{"to":["in_progress","cancelled"]}}},"unavailable_provider":{"kind":"ref","on_delete":"set_null","optional":true,"to":"providers"}},"indexes":[{"on":["attention","shift_check"]}],"locks":{"finished":{"where":{"status":{"in":["completed","cancelled"]}}},"under_way":{"except":["status","completion_notes","completed_at","attention"],"where":{"status":{"eq":"in_progress"}}}},"no_overlap":[{"key":["provider"],"name":"one_appointment_at_a_time","period":"slot","where":{"provider":{"is_null":false},"status":{"ne":"cancelled"}}}],"record_label":"record.number","search":{"text":["number","address","provider","booking"]},"was":"visits"}'::jsonb);

-- step create:history:schema:booking_providers (additive)
select bolt_history_register('booking_providers','{"audit":true,"fields":{"booking":{"inverse":"preferred_providers","kind":"ref","owned":true,"to":"bookings"},"provider":{"inverse":"preferred_by","kind":"ref","to":"providers"},"rank":{"kind":"int","max":5,"min":1}},"record_label":"record.booking.number + '' · '' + record.provider.name","unique":[{"fields":["booking","provider"],"name":"one_rank_per_provider"}],"was":"booking_helpers"}'::jsonb);

-- step create:history:schema:providers (additive)
select bolt_history_register('providers','{"audit":true,"check":{"hours":{"day_end":{"gt":{"field":"day_start"}}}},"fields":{"day_end":{"kind":"time"},"day_start":{"kind":"time"},"email":{"format":"email","kind":"text","optional":true},"home_location":{"kind":"point","optional":true},"inactive_since":{"kind":"date","optional":true},"last_location":{"kind":"point","optional":true},"last_location_at":{"kind":"instant","optional":true},"name":{"kind":"text","max":160},"phone":{"format":"phone","kind":"text"},"skills":{"kind":"text","many":true,"max":80},"status":{"initial":"active","kind":"state","states":{"active":{"to":["inactive"]},"inactive":{"to":["active"]}}},"user":{"kind":"ref","on_delete":"set_null","optional":true,"to":"sys_user"},"work_days":{"kind":"enum","many":true,"values":["sun","mon","tue","wed","thu","fri","sat"]}},"record_label":"record.name","search":{"text":["name","phone","email"]},"unique":[{"fields":["user"],"name":"one_user"}]}'::jsonb);

-- step create:history:schema:provider_time_off (additive)
select bolt_history_register('provider_time_off','{"audit":true,"fields":{"period":{"kind":"period","of":"date"},"provider":{"inverse":"time_off","kind":"ref","owned":true,"to":"providers"},"reason":{"kind":"enum","values":["leave","sick","unavailable"]}},"no_overlap":[{"key":["provider"],"name":"one_absence","period":"period"}],"record_label":"record.provider.name + '' · '' + string(record.period.from)","was":"helper_time_off"}'::jsonb);

-- step create:history:schema:scheduling_settings (additive)
select bolt_history_register('scheduling_settings','{"audit":true,"check":{"reply_inside_lead":{"shift_reply_minutes":{"lt":{"field":"shift_check_lead_minutes"}}}},"fields":{"booking_horizon_days":{"default":14,"kind":"int","max":60,"min":7},"buffer_minutes":{"default":15,"kind":"int","max":120,"min":0},"eta_check_lead_minutes":{"default":60,"kind":"int","max":240,"min":15},"eta_limit_minutes":{"default":30,"kind":"int","max":240,"min":5},"free_change_hours":{"default":24,"kind":"int","max":168,"min":0},"name":{"default":"Scheduling","kind":"text"},"shift_check_lead_minutes":{"default":120,"kind":"int","max":720,"min":30},"shift_reply_minutes":{"default":60,"kind":"int","max":240,"min":10},"slot_interval_minutes":{"default":30,"kind":"int","max":60,"min":15}},"record_label":"record.name","unique":[{"fields":["name"],"name":"name"}],"was":"dispatch_settings"}'::jsonb);

-- step create:backfill:bookings.appointment_count (backfill)
-- operational risk: writes-blocked, table-scan
update "bookings" p set "appointment_count" = (select count(*)::int from "appointments" c where c."booking" = p.id);

-- step replace:default:scheduling_settings.name (additive)
-- operational risk: access-exclusive-lock
alter table "scheduling_settings" alter column "name" set default 'Scheduling'::text;

-- step create:notNull:bookings.appointment_count (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "bookings" where "appointment_count" is null' into n;
	if n > 0 then raise exception 'notNull:bookings.appointment_count refuses % existing row(s)', n; end if;
end $store$;
alter table "bookings" alter column "appointment_count" set not null;

-- step create:notNull:scheduling_settings.slot_interval_minutes (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "scheduling_settings" where "slot_interval_minutes" is null' into n;
	if n > 0 then raise exception 'notNull:scheduling_settings.slot_interval_minutes refuses % existing row(s)', n; end if;
end $store$;
alter table "scheduling_settings" alter column "slot_interval_minutes" set not null;

-- step create:notNull:scheduling_settings.buffer_minutes (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "scheduling_settings" where "buffer_minutes" is null' into n;
	if n > 0 then raise exception 'notNull:scheduling_settings.buffer_minutes refuses % existing row(s)', n; end if;
end $store$;
alter table "scheduling_settings" alter column "buffer_minutes" set not null;

-- step create:notNull:scheduling_settings.booking_horizon_days (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "scheduling_settings" where "booking_horizon_days" is null' into n;
	if n > 0 then raise exception 'notNull:scheduling_settings.booking_horizon_days refuses % existing row(s)', n; end if;
end $store$;
alter table "scheduling_settings" alter column "booking_horizon_days" set not null;

-- step create:notNull:booking_providers.provider (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "booking_providers" where "provider" is null' into n;
	if n > 0 then raise exception 'notNull:booking_providers.provider refuses % existing row(s)', n; end if;
end $store$;
alter table "booking_providers" alter column "provider" set not null;

-- step create:notNull:provider_time_off.provider (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "provider_time_off" where "provider" is null' into n;
	if n > 0 then raise exception 'notNull:provider_time_off.provider refuses % existing row(s)', n; end if;
end $store$;
alter table "provider_time_off" alter column "provider" set not null;

-- step create:constraint:bookings.bookings__ck__eff19e9d (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "bookings" where (char_length("address") <= 500) is false' into n;
	if n > 0 then raise exception 'bookings__ck__eff19e9d refuses % existing row(s)', n; end if;
end $store$;
alter table "bookings" add constraint "bookings__ck__eff19e9d" check (char_length("address") <= 500);

-- step create:constraint:bookings.bookings__ck__df51243d (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "bookings" where (char_length("notes") <= 2000) is false' into n;
	if n > 0 then raise exception 'bookings__ck__df51243d refuses % existing row(s)', n; end if;
end $store$;
alter table "bookings" add constraint "bookings__ck__df51243d" check (char_length("notes") <= 2000);

-- step create:constraint:appointments.appointments__uq__268a00e8 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select coalesce(sum(n - 1), 0)::int as n from (select count(*) as n from "appointments" group by "number" having count(*) > 1) d' into n;
	if n > 0 then raise exception 'appointments__uq__268a00e8 refuses % existing row(s)', n; end if;
end $store$;
alter table "appointments" add constraint "appointments__uq__268a00e8" unique nulls not distinct ("number") deferrable initially immediate;

-- step create:constraint:appointments.appointments__ck__26dc33e3 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "appointments" where (not isempty("slot") and not lower_inf("slot")) is false' into n;
	if n > 0 then raise exception 'appointments__ck__26dc33e3 refuses % existing row(s)', n; end if;
end $store$;
alter table "appointments" add constraint "appointments__ck__26dc33e3" check (not isempty("slot") and not lower_inf("slot"));

-- step create:constraint:appointments.appointments__ck__eff19e9d (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "appointments" where (char_length("address") <= 500) is false' into n;
	if n > 0 then raise exception 'appointments__ck__eff19e9d refuses % existing row(s)', n; end if;
end $store$;
alter table "appointments" add constraint "appointments__ck__eff19e9d" check (char_length("address") <= 500);

-- step create:constraint:appointments.appointments__ck__59d37111 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "appointments" where ("location"[1] between -90 and 90 and "location"[0] between -180 and 180) is false' into n;
	if n > 0 then raise exception 'appointments__ck__59d37111 refuses % existing row(s)', n; end if;
end $store$;
alter table "appointments" add constraint "appointments__ck__59d37111" check ("location"[1] between -90 and 90 and "location"[0] between -180 and 180);

-- step create:constraint:appointments.appointments__ck__b0f95cdf (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "appointments" where (char_length("skill") <= 80) is false' into n;
	if n > 0 then raise exception 'appointments__ck__b0f95cdf refuses % existing row(s)', n; end if;
end $store$;
alter table "appointments" add constraint "appointments__ck__b0f95cdf" check (char_length("skill") <= 80);

-- step create:constraint:appointments.appointments__ck__a71a9c6c (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "appointments" where ("status" in (''cancelled'', ''completed'', ''in_progress'', ''scheduled'')) is false' into n;
	if n > 0 then raise exception 'appointments__ck__a71a9c6c refuses % existing row(s)', n; end if;
end $store$;
alter table "appointments" add constraint "appointments__ck__a71a9c6c" check ("status" in ('cancelled', 'completed', 'in_progress', 'scheduled'));

-- step create:constraint:appointments.appointments__ck__bfc3eaf2 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "appointments" where ("shift_check" in (''not_due'', ''asked'', ''confirmed'', ''no_response'', ''declined'')) is false' into n;
	if n > 0 then raise exception 'appointments__ck__bfc3eaf2 refuses % existing row(s)', n; end if;
end $store$;
alter table "appointments" add constraint "appointments__ck__bfc3eaf2" check ("shift_check" in ('not_due', 'asked', 'confirmed', 'no_response', 'declined'));

-- step create:constraint:appointments.appointments__ck__81a94226 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "appointments" where (isfinite("shift_asked_at")) is false' into n;
	if n > 0 then raise exception 'appointments__ck__81a94226 refuses % existing row(s)', n; end if;
end $store$;
alter table "appointments" add constraint "appointments__ck__81a94226" check (isfinite("shift_asked_at"));

-- step create:constraint:appointments.appointments__ck__a764b151 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "appointments" where (isfinite("eta_checked_at")) is false' into n;
	if n > 0 then raise exception 'appointments__ck__a764b151 refuses % existing row(s)', n; end if;
end $store$;
alter table "appointments" add constraint "appointments__ck__a764b151" check (isfinite("eta_checked_at"));

-- step create:constraint:appointments.appointments__ck__22b61e00 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "appointments" where ("attention" in (''none'', ''unassigned'', ''eta_risk'', ''provider_inactive'', ''awaiting_approval'')) is false' into n;
	if n > 0 then raise exception 'appointments__ck__22b61e00 refuses % existing row(s)', n; end if;
end $store$;
alter table "appointments" add constraint "appointments__ck__22b61e00" check ("attention" in ('none', 'unassigned', 'eta_risk', 'provider_inactive', 'awaiting_approval'));

-- step create:constraint:appointments.appointments__ck__f9e58aa9 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "appointments" where (not isempty("proposed_slot") and not lower_inf("proposed_slot")) is false' into n;
	if n > 0 then raise exception 'appointments__ck__f9e58aa9 refuses % existing row(s)', n; end if;
end $store$;
alter table "appointments" add constraint "appointments__ck__f9e58aa9" check (not isempty("proposed_slot") and not lower_inf("proposed_slot"));

-- step create:constraint:appointments.appointments__ck__df253602 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "appointments" where (isfinite("started_at")) is false' into n;
	if n > 0 then raise exception 'appointments__ck__df253602 refuses % existing row(s)', n; end if;
end $store$;
alter table "appointments" add constraint "appointments__ck__df253602" check (isfinite("started_at"));

-- step create:constraint:appointments.appointments__ck__24d370ee (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "appointments" where (isfinite("completed_at")) is false' into n;
	if n > 0 then raise exception 'appointments__ck__24d370ee refuses % existing row(s)', n; end if;
end $store$;
alter table "appointments" add constraint "appointments__ck__24d370ee" check (isfinite("completed_at"));

-- step create:constraint:appointments.appointments__ck__4c1a0f3a (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "appointments" where (char_length("completion_notes") <= 2000) is false' into n;
	if n > 0 then raise exception 'appointments__ck__4c1a0f3a refuses % existing row(s)', n; end if;
end $store$;
alter table "appointments" add constraint "appointments__ck__4c1a0f3a" check (char_length("completion_notes") <= 2000);

-- step create:constraint:appointments.appointments__ex__2bf510af (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "appointments" a join "appointments" b on (a."id") < (b."id") and a."provider" is not distinct from b."provider" and a."slot" && b."slot" and (a."provider" is not null and a."status" is distinct from ''cancelled''::text) and (b."provider" is not null and b."status" is distinct from ''cancelled''::text)' into n;
	if n > 0 then raise exception 'appointments__ex__2bf510af refuses % existing row(s)', n; end if;
end $store$;
alter table "appointments" add constraint "appointments__ex__2bf510af" exclude using gist ((coalesce("provider", '00000000-0000-0000-0000-000000000000'::uuid)) with =, ("provider" is null) with =, "slot" with &&) where ("provider" is not null and "status" is distinct from 'cancelled'::text) deferrable initially immediate;

-- step create:constraint:booking_providers.booking_providers__ck__8e164ef7 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "booking_providers" where ("rank" >= 1 and "rank" <= 5) is false' into n;
	if n > 0 then raise exception 'booking_providers__ck__8e164ef7 refuses % existing row(s)', n; end if;
end $store$;
alter table "booking_providers" add constraint "booking_providers__ck__8e164ef7" check ("rank" >= 1 and "rank" <= 5);

-- step create:constraint:booking_providers.booking_providers__uq__ca85605c (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select coalesce(sum(n - 1), 0)::int as n from (select count(*) as n from "booking_providers" group by "booking", "provider" having count(*) > 1) d' into n;
	if n > 0 then raise exception 'booking_providers__uq__ca85605c refuses % existing row(s)', n; end if;
end $store$;
alter table "booking_providers" add constraint "booking_providers__uq__ca85605c" unique nulls not distinct ("booking", "provider") deferrable initially immediate;

-- step create:constraint:customers.customers__ck__7cce5ac9 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "customers" where (char_length("name") <= 160) is false' into n;
	if n > 0 then raise exception 'customers__ck__7cce5ac9 refuses % existing row(s)', n; end if;
end $store$;
alter table "customers" add constraint "customers__ck__7cce5ac9" check (char_length("name") <= 160);

-- step create:constraint:customers.customers__ck__eff19e9d (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "customers" where (char_length("address") <= 500) is false' into n;
	if n > 0 then raise exception 'customers__ck__eff19e9d refuses % existing row(s)', n; end if;
end $store$;
alter table "customers" add constraint "customers__ck__eff19e9d" check (char_length("address") <= 500);

-- step create:constraint:customers.customers__ck__df51243d (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "customers" where (char_length("notes") <= 2000) is false' into n;
	if n > 0 then raise exception 'customers__ck__df51243d refuses % existing row(s)', n; end if;
end $store$;
alter table "customers" add constraint "customers__ck__df51243d" check (char_length("notes") <= 2000);

-- step create:constraint:customer_notices.customer_notices__ck__537e4158 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "customer_notices" where (char_length("subject") <= 300) is false' into n;
	if n > 0 then raise exception 'customer_notices__ck__537e4158 refuses % existing row(s)', n; end if;
end $store$;
alter table "customer_notices" add constraint "customer_notices__ck__537e4158" check (char_length("subject") <= 300);

-- step create:constraint:customer_notices.customer_notices__ck__f1cdc0e4 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "customer_notices" where (char_length("body") <= 4000) is false' into n;
	if n > 0 then raise exception 'customer_notices__ck__f1cdc0e4 refuses % existing row(s)', n; end if;
end $store$;
alter table "customer_notices" add constraint "customer_notices__ck__f1cdc0e4" check (char_length("body") <= 4000);

-- step create:constraint:provider_time_off.provider_time_off__ck__ebc65b98 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "provider_time_off" where (not isempty("period") and not lower_inf("period")) is false' into n;
	if n > 0 then raise exception 'provider_time_off__ck__ebc65b98 refuses % existing row(s)', n; end if;
end $store$;
alter table "provider_time_off" add constraint "provider_time_off__ck__ebc65b98" check (not isempty("period") and not lower_inf("period"));

-- step create:constraint:provider_time_off.provider_time_off__ck__7a9dba54 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "provider_time_off" where ("reason" in (''leave'', ''sick'', ''unavailable'')) is false' into n;
	if n > 0 then raise exception 'provider_time_off__ck__7a9dba54 refuses % existing row(s)', n; end if;
end $store$;
alter table "provider_time_off" add constraint "provider_time_off__ck__7a9dba54" check ("reason" in ('leave', 'sick', 'unavailable'));

-- step create:constraint:provider_time_off.provider_time_off__ex__88295b0a (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "provider_time_off" a join "provider_time_off" b on (a."id") < (b."id") and a."provider" is not distinct from b."provider" and a."period" && b."period"' into n;
	if n > 0 then raise exception 'provider_time_off__ex__88295b0a refuses % existing row(s)', n; end if;
end $store$;
alter table "provider_time_off" add constraint "provider_time_off__ex__88295b0a" exclude using gist ("provider" with =, "period" with &&) deferrable initially immediate;

-- step create:constraint:scheduling_settings.scheduling_settings__ck__b8b5122d (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "scheduling_settings" where ("slot_interval_minutes" >= 15 and "slot_interval_minutes" <= 60) is false' into n;
	if n > 0 then raise exception 'scheduling_settings__ck__b8b5122d refuses % existing row(s)', n; end if;
end $store$;
alter table "scheduling_settings" add constraint "scheduling_settings__ck__b8b5122d" check ("slot_interval_minutes" >= 15 and "slot_interval_minutes" <= 60);

-- step create:constraint:scheduling_settings.scheduling_settings__ck__011136aa (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "scheduling_settings" where ("buffer_minutes" >= 0 and "buffer_minutes" <= 120) is false' into n;
	if n > 0 then raise exception 'scheduling_settings__ck__011136aa refuses % existing row(s)', n; end if;
end $store$;
alter table "scheduling_settings" add constraint "scheduling_settings__ck__011136aa" check ("buffer_minutes" >= 0 and "buffer_minutes" <= 120);

-- step create:constraint:scheduling_settings.scheduling_settings__ck__6f573dc5 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "scheduling_settings" where ("booking_horizon_days" >= 7 and "booking_horizon_days" <= 60) is false' into n;
	if n > 0 then raise exception 'scheduling_settings__ck__6f573dc5 refuses % existing row(s)', n; end if;
end $store$;
alter table "scheduling_settings" add constraint "scheduling_settings__ck__6f573dc5" check ("booking_horizon_days" >= 7 and "booking_horizon_days" <= 60);

-- step create:constraint:scheduling_settings.scheduling_settings__ck__786c73b3 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "scheduling_settings" where ("eta_limit_minutes" >= 5 and "eta_limit_minutes" <= 240) is false' into n;
	if n > 0 then raise exception 'scheduling_settings__ck__786c73b3 refuses % existing row(s)', n; end if;
end $store$;
alter table "scheduling_settings" add constraint "scheduling_settings__ck__786c73b3" check ("eta_limit_minutes" >= 5 and "eta_limit_minutes" <= 240);

-- step create:constraint:scheduling_settings.scheduling_settings__ck__4446483f (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "scheduling_settings" where ("eta_check_lead_minutes" >= 15 and "eta_check_lead_minutes" <= 240) is false' into n;
	if n > 0 then raise exception 'scheduling_settings__ck__4446483f refuses % existing row(s)', n; end if;
end $store$;
alter table "scheduling_settings" add constraint "scheduling_settings__ck__4446483f" check ("eta_check_lead_minutes" >= 15 and "eta_check_lead_minutes" <= 240);

-- step create:constraint:scheduling_settings.scheduling_settings__ck__f142e450 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "scheduling_settings" where ("shift_check_lead_minutes" >= 30 and "shift_check_lead_minutes" <= 720) is false' into n;
	if n > 0 then raise exception 'scheduling_settings__ck__f142e450 refuses % existing row(s)', n; end if;
end $store$;
alter table "scheduling_settings" add constraint "scheduling_settings__ck__f142e450" check ("shift_check_lead_minutes" >= 30 and "shift_check_lead_minutes" <= 720);

-- step create:constraint:scheduling_settings.scheduling_settings__ck__9f371d94 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "scheduling_settings" where ("shift_reply_minutes" >= 10 and "shift_reply_minutes" <= 240) is false' into n;
	if n > 0 then raise exception 'scheduling_settings__ck__9f371d94 refuses % existing row(s)', n; end if;
end $store$;
alter table "scheduling_settings" add constraint "scheduling_settings__ck__9f371d94" check ("shift_reply_minutes" >= 10 and "shift_reply_minutes" <= 240);

-- step create:constraint:scheduling_settings.scheduling_settings__ck__8d366436 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "scheduling_settings" where ("free_change_hours" >= 0 and "free_change_hours" <= 168) is false' into n;
	if n > 0 then raise exception 'scheduling_settings__ck__8d366436 refuses % existing row(s)', n; end if;
end $store$;
alter table "scheduling_settings" add constraint "scheduling_settings__ck__8d366436" check ("free_change_hours" >= 0 and "free_change_hours" <= 168);

-- step create:constraint:scheduling_settings.scheduling_settings__uq__27f44ac5 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select coalesce(sum(n - 1), 0)::int as n from (select count(*) as n from "scheduling_settings" where "name" is not null group by "name" having count(*) > 1) d' into n;
	if n > 0 then raise exception 'scheduling_settings__uq__27f44ac5 refuses % existing row(s)', n; end if;
end $store$;
alter table "scheduling_settings" add constraint "scheduling_settings__uq__27f44ac5" unique ("name") deferrable initially immediate;

-- step create:constraint:scheduling_settings.scheduling_settings__ck__df42c5c1 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "scheduling_settings" where ((coalesce("shift_reply_minutes" < "shift_check_lead_minutes", false))) is false' into n;
	if n > 0 then raise exception 'scheduling_settings__ck__df42c5c1 refuses % existing row(s)', n; end if;
end $store$;
alter table "scheduling_settings" add constraint "scheduling_settings__ck__df42c5c1" check ((coalesce("shift_reply_minutes" < "shift_check_lead_minutes", false)));

-- step create:constraint:services.services__ck__7cce5ac9 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "services" where (char_length("name") <= 160) is false' into n;
	if n > 0 then raise exception 'services__ck__7cce5ac9 refuses % existing row(s)', n; end if;
end $store$;
alter table "services" add constraint "services__ck__7cce5ac9" check (char_length("name") <= 160);

-- step create:constraint:services.services__ck__7f99e855 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "services" where (char_length("category") <= 80) is false' into n;
	if n > 0 then raise exception 'services__ck__7f99e855 refuses % existing row(s)', n; end if;
end $store$;
alter table "services" add constraint "services__ck__7f99e855" check (char_length("category") <= 80);

-- step create:constraint:services.services__ck__b0f95cdf (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "services" where (char_length("skill") <= 80) is false' into n;
	if n > 0 then raise exception 'services__ck__b0f95cdf refuses % existing row(s)', n; end if;
end $store$;
alter table "services" add constraint "services__ck__b0f95cdf" check (char_length("skill") <= 80);

-- step create:constraint:services.services__ck__ac403428 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "services" where ("duration_minutes" >= 15 and "duration_minutes" <= 720) is false' into n;
	if n > 0 then raise exception 'services__ck__ac403428 refuses % existing row(s)', n; end if;
end $store$;
alter table "services" add constraint "services__ck__ac403428" check ("duration_minutes" >= 15 and "duration_minutes" <= 720);

-- step create:constraint:services.services__ck__a1b3bac0 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "services" where (char_length("description") <= 1000) is false' into n;
	if n > 0 then raise exception 'services__ck__a1b3bac0 refuses % existing row(s)', n; end if;
end $store$;
alter table "services" add constraint "services__ck__a1b3bac0" check (char_length("description") <= 1000);

-- step create:fk:availability_requests.availability_requests__fk__f07909c6 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "availability_requests" c where c."provider" is not null and not exists (select 1 from "providers" p where p."id" = c."provider")' into n;
	if n > 0 then raise exception 'availability_requests__fk__f07909c6 refuses % existing row(s)', n; end if;
end $store$;
alter table "availability_requests" add constraint "availability_requests__fk__f07909c6" foreign key ("provider") references "providers" ("id") on delete restrict on update restrict;

-- step create:fk:appointments.appointments__fk__fa057e1a (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "appointments" c where c."booking" is not null and not exists (select 1 from "bookings" p where p."id" = c."booking")' into n;
	if n > 0 then raise exception 'appointments__fk__fa057e1a refuses % existing row(s)', n; end if;
end $store$;
alter table "appointments" add constraint "appointments__fk__fa057e1a" foreign key ("booking") references "bookings" ("id") on delete cascade on update restrict;

-- step create:fk:appointments.appointments__fk__e600bbb5 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "appointments" c where c."provider" is not null and not exists (select 1 from "providers" p where p."id" = c."provider")' into n;
	if n > 0 then raise exception 'appointments__fk__e600bbb5 refuses % existing row(s)', n; end if;
end $store$;
alter table "appointments" add constraint "appointments__fk__e600bbb5" foreign key ("provider") references "providers" ("id") on delete set null on update restrict;

-- step create:fk:appointments.appointments__fk__4d8634b3 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "appointments" c where c."unavailable_provider" is not null and not exists (select 1 from "providers" p where p."id" = c."unavailable_provider")' into n;
	if n > 0 then raise exception 'appointments__fk__4d8634b3 refuses % existing row(s)', n; end if;
end $store$;
alter table "appointments" add constraint "appointments__fk__4d8634b3" foreign key ("unavailable_provider") references "providers" ("id") on delete set null on update restrict;

-- step create:fk:appointments.appointments__fk__08bf7f1d (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "appointments" c where c."proposed_provider" is not null and not exists (select 1 from "providers" p where p."id" = c."proposed_provider")' into n;
	if n > 0 then raise exception 'appointments__fk__08bf7f1d refuses % existing row(s)', n; end if;
end $store$;
alter table "appointments" add constraint "appointments__fk__08bf7f1d" foreign key ("proposed_provider") references "providers" ("id") on delete set null on update restrict;

-- step create:fk:booking_providers.booking_providers__fk__fa057e1a (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "booking_providers" c where c."booking" is not null and not exists (select 1 from "bookings" p where p."id" = c."booking")' into n;
	if n > 0 then raise exception 'booking_providers__fk__fa057e1a refuses % existing row(s)', n; end if;
end $store$;
alter table "booking_providers" add constraint "booking_providers__fk__fa057e1a" foreign key ("booking") references "bookings" ("id") on delete cascade on update restrict;

-- step create:fk:booking_providers.booking_providers__fk__f07909c6 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "booking_providers" c where c."provider" is not null and not exists (select 1 from "providers" p where p."id" = c."provider")' into n;
	if n > 0 then raise exception 'booking_providers__fk__f07909c6 refuses % existing row(s)', n; end if;
end $store$;
alter table "booking_providers" add constraint "booking_providers__fk__f07909c6" foreign key ("provider") references "providers" ("id") on delete restrict on update restrict;

-- step create:fk:customer_notices.customer_notices__fk__dadcbaed (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "customer_notices" c where c."customer" is not null and not exists (select 1 from "customers" p where p."id" = c."customer")' into n;
	if n > 0 then raise exception 'customer_notices__fk__dadcbaed refuses % existing row(s)', n; end if;
end $store$;
alter table "customer_notices" add constraint "customer_notices__fk__dadcbaed" foreign key ("customer") references "customers" ("id") on delete cascade on update restrict;

-- step create:fk:customer_notices.customer_notices__fk__c8504687 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "customer_notices" c where c."appointment" is not null and not exists (select 1 from "appointments" p where p."id" = c."appointment")' into n;
	if n > 0 then raise exception 'customer_notices__fk__c8504687 refuses % existing row(s)', n; end if;
end $store$;
alter table "customer_notices" add constraint "customer_notices__fk__c8504687" foreign key ("appointment") references "appointments" ("id") on delete set null on update restrict;

-- step create:fk:providers.providers__fk__5ab0092a (additive)
alter table "providers" add constraint "providers__fk__5ab0092a" foreign key ("user") references "sys_user" ("id") on delete set null on update restrict;

-- step create:fk:provider_time_off.provider_time_off__fk__f2dc42d4 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "provider_time_off" c where c."provider" is not null and not exists (select 1 from "providers" p where p."id" = c."provider")' into n;
	if n > 0 then raise exception 'provider_time_off__fk__f2dc42d4 refuses % existing row(s)', n; end if;
end $store$;
alter table "provider_time_off" add constraint "provider_time_off__fk__f2dc42d4" foreign key ("provider") references "providers" ("id") on delete cascade on update restrict;

-- step replace:trigger:availability_requests.store_statement_rules_update (additive)
create trigger store_statement_rules_update after update on "availability_requests" referencing old table as store_old new table as store_new for each statement execute function store_statement_rules('{"fields":{"address":["address"],"checked_at":["checked_at"],"estimated":["estimated"],"location":["location"],"phone":["phone"],"preference":["preference"],"problem":["problem"],"provider":["provider"],"repeat":["repeat"],"service":["service"],"starts":["starts"],"status":["status"]},"key":["id"],"locks":[{"constraint":"availability_requests__lock__d31e0148","except":[],"name":"settled","sql":"(coalesce(t.\"status\" = any(array[''ready''::text, ''failed''::text]::text[]), false))"}],"parents":[],"states":{"status":{"initial":"pending","states":{"failed":{},"pending":{"to":["ready","failed"]},"ready":{}}}}}');

-- step replace:trigger:availability_requests.store_statement_rules_delete (additive)
create trigger store_statement_rules_delete after delete on "availability_requests" referencing old table as store_old for each statement execute function store_statement_rules('{"fields":{"address":["address"],"checked_at":["checked_at"],"estimated":["estimated"],"location":["location"],"phone":["phone"],"preference":["preference"],"problem":["problem"],"provider":["provider"],"repeat":["repeat"],"service":["service"],"starts":["starts"],"status":["status"]},"key":["id"],"locks":[{"constraint":"availability_requests__lock__d31e0148","except":[],"name":"settled","sql":"(coalesce(t.\"status\" = any(array[''ready''::text, ''failed''::text]::text[]), false))"}],"parents":[],"states":{"status":{"initial":"pending","states":{"failed":{},"pending":{"to":["ready","failed"]},"ready":{}}}}}');

-- step replace:trigger:booking_requests.store_statement_rules_update (additive)
create trigger store_statement_rules_update after update on "booking_requests" referencing old table as store_old new table as store_new for each statement execute function store_statement_rules('{"fields":{"address":["address"],"availability":["availability"],"booking":["booking"],"email":["email"],"name":["name"],"notes":["notes"],"outcome":["outcome"],"phone":["phone"],"repeat":["repeat"],"service":["service"],"start":["start"],"status":["status"]},"key":["id"],"locks":[{"constraint":"booking_requests__lock__d31e0148","except":[],"name":"settled","sql":"(coalesce(t.\"status\" = any(array[''booked''::text, ''closed''::text]::text[]), false))"}],"parents":[],"states":{"status":{"initial":"received","states":{"booked":{},"closed":{},"follow_up":{"to":["booked","closed"]},"received":{"to":["booked","follow_up"]}}}}}');

-- step replace:trigger:booking_requests.store_statement_rules_delete (additive)
create trigger store_statement_rules_delete after delete on "booking_requests" referencing old table as store_old for each statement execute function store_statement_rules('{"fields":{"address":["address"],"availability":["availability"],"booking":["booking"],"email":["email"],"name":["name"],"notes":["notes"],"outcome":["outcome"],"phone":["phone"],"repeat":["repeat"],"service":["service"],"start":["start"],"status":["status"]},"key":["id"],"locks":[{"constraint":"booking_requests__lock__d31e0148","except":[],"name":"settled","sql":"(coalesce(t.\"status\" = any(array[''booked''::text, ''closed''::text]::text[]), false))"}],"parents":[],"states":{"status":{"initial":"received","states":{"booked":{},"closed":{},"follow_up":{"to":["booked","closed"]},"received":{"to":["booked","follow_up"]}}}}}');

-- step replace:trigger:bookings.store_statement_rules_update (additive)
create trigger store_statement_rules_update after update on "bookings" referencing old table as store_old new table as store_new for each statement execute function store_statement_rules('{"fields":{"address":["address"],"customer":["customer"],"location":["location"],"notes":["notes"],"preference":["preference"],"repeat":["repeat"],"service":["service"],"status":["status"]},"key":["id"],"locks":[{"constraint":"bookings__lock__8b47045e","except":["appointments"],"name":"cancelled","sql":"(coalesce(t.\"status\" = ''cancelled''::text, false))"}],"parents":[],"states":{"status":{"initial":"active","states":{"active":{"to":["cancelled"]},"cancelled":{}}}}}');

-- step replace:trigger:bookings.store_statement_rules_delete (additive)
create trigger store_statement_rules_delete after delete on "bookings" referencing old table as store_old for each statement execute function store_statement_rules('{"fields":{"address":["address"],"customer":["customer"],"location":["location"],"notes":["notes"],"preference":["preference"],"repeat":["repeat"],"service":["service"],"status":["status"]},"key":["id"],"locks":[{"constraint":"bookings__lock__8b47045e","except":["appointments"],"name":"cancelled","sql":"(coalesce(t.\"status\" = ''cancelled''::text, false))"}],"parents":[],"states":{"status":{"initial":"active","states":{"active":{"to":["cancelled"]},"cancelled":{}}}}}');

-- step replace:trigger:appointments.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "appointments" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{"status":{"initial":"scheduled","states":{"cancelled":{},"completed":{"stamp":"completed_at"},"in_progress":{"stamp":"started_at","to":["completed"]},"scheduled":{"to":["in_progress","cancelled"]}}}}}');

-- step replace:trigger:appointments.store_statement_rules_update (additive)
create trigger store_statement_rules_update after update on "appointments" referencing old table as store_old new table as store_new for each statement execute function store_statement_rules('{"fields":{"address":["address"],"attention":["attention"],"booking":["booking"],"completed_at":["completed_at"],"completion_notes":["completion_notes"],"eta_checked_at":["eta_checked_at"],"eta_minutes":["eta_minutes"],"late_cancellation":["late_cancellation"],"location":["location"],"proposed_provider":["proposed_provider"],"proposed_slot":["proposed_slot"],"provider":["provider"],"shift_asked_at":["shift_asked_at"],"shift_check":["shift_check"],"skill":["skill"],"slot":["slot"],"started_at":["started_at"],"status":["status"],"unavailable_provider":["unavailable_provider"]},"key":["id"],"locks":[{"constraint":"appointments__lock__05343e98","except":[],"name":"finished","sql":"(coalesce(t.\"status\" = any(array[''completed''::text, ''cancelled''::text]::text[]), false))"},{"constraint":"appointments__lock__14b6f299","except":["status","completion_notes","completed_at","attention"],"name":"under_way","sql":"(coalesce(t.\"status\" = ''in_progress''::text, false))"}],"parents":[],"states":{"status":{"initial":"scheduled","states":{"cancelled":{},"completed":{"stamp":"completed_at"},"in_progress":{"stamp":"started_at","to":["completed"]},"scheduled":{"to":["in_progress","cancelled"]}}}}}');

-- step replace:trigger:appointments.store_statement_rules_delete (additive)
create trigger store_statement_rules_delete after delete on "appointments" referencing old table as store_old for each statement execute function store_statement_rules('{"fields":{"address":["address"],"attention":["attention"],"booking":["booking"],"completed_at":["completed_at"],"completion_notes":["completion_notes"],"eta_checked_at":["eta_checked_at"],"eta_minutes":["eta_minutes"],"late_cancellation":["late_cancellation"],"location":["location"],"proposed_provider":["proposed_provider"],"proposed_slot":["proposed_slot"],"provider":["provider"],"shift_asked_at":["shift_asked_at"],"shift_check":["shift_check"],"skill":["skill"],"slot":["slot"],"started_at":["started_at"],"status":["status"],"unavailable_provider":["unavailable_provider"]},"key":["id"],"locks":[{"constraint":"appointments__lock__05343e98","except":[],"name":"finished","sql":"(coalesce(t.\"status\" = any(array[''completed''::text, ''cancelled''::text]::text[]), false))"},{"constraint":"appointments__lock__14b6f299","except":["status","completion_notes","completed_at","attention"],"name":"under_way","sql":"(coalesce(t.\"status\" = ''in_progress''::text, false))"}],"parents":[],"states":{"status":{"initial":"scheduled","states":{"cancelled":{},"completed":{"stamp":"completed_at"},"in_progress":{"stamp":"started_at","to":["completed"]},"scheduled":{"to":["in_progress","cancelled"]}}}}}');

-- step replace:trigger:booking_providers.store_statement_rules_insert (additive)
create trigger store_statement_rules_insert after insert on "booking_providers" referencing new table as store_new for each statement execute function store_statement_rules('{"fields":{"booking":["booking"],"provider":["provider"],"rank":["rank"]},"key":["id"],"locks":[],"parents":[{"column":"booking","key":"id","locks":[{"constraint":"bookings__lock__8b47045e","except":["appointments"],"name":"cancelled","sql":"(coalesce(t.\"status\" = ''cancelled''::text, false))"}],"relation":"preferred_providers","table":"bookings","type":"uuid"}],"states":{}}');

-- step replace:trigger:booking_providers.store_statement_rules_update (additive)
create trigger store_statement_rules_update after update on "booking_providers" referencing old table as store_old new table as store_new for each statement execute function store_statement_rules('{"fields":{"booking":["booking"],"provider":["provider"],"rank":["rank"]},"key":["id"],"locks":[],"parents":[{"column":"booking","key":"id","locks":[{"constraint":"bookings__lock__8b47045e","except":["appointments"],"name":"cancelled","sql":"(coalesce(t.\"status\" = ''cancelled''::text, false))"}],"relation":"preferred_providers","table":"bookings","type":"uuid"}],"states":{}}');

-- step replace:trigger:booking_providers.store_statement_rules_delete (additive)
create trigger store_statement_rules_delete after delete on "booking_providers" referencing old table as store_old for each statement execute function store_statement_rules('{"fields":{"booking":["booking"],"provider":["provider"],"rank":["rank"]},"key":["id"],"locks":[],"parents":[{"column":"booking","key":"id","locks":[{"constraint":"bookings__lock__8b47045e","except":["appointments"],"name":"cancelled","sql":"(coalesce(t.\"status\" = ''cancelled''::text, false))"}],"relation":"preferred_providers","table":"bookings","type":"uuid"}],"states":{}}');

-- step replace:index:services.services__gin__73732636 (additive)
-- operational risk: writes-blocked, table-scan
create index "services__gin__73732636" on "services" using gin (bolt_search);

-- step replace:history:current (additive)
-- operational risk: writes-blocked, table-scan
update bolt_history_current set active=false where active and not (model=any(array['appointments','approval_request','availability_requests','booking_providers','booking_requests','bookings','customer_notices','customers','drive_times','openings','provider_time_off','providers','scheduling_settings','services','sys_api_key','sys_conversation','sys_envoy','sys_file','sys_integration','sys_invitation','sys_user','sys_workspace']::text[]));

-- step replace:engine:audit:availability_requests (additive)
drop trigger if exists bolt_audit_mark on "availability_requests";
drop trigger if exists bolt_audit on "availability_requests";
create trigger bolt_audit after insert or update or delete on "availability_requests" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[]','[["provider","providers"],["service","services"]]');

-- step replace:engine:audit:customer_notices (additive)
drop trigger if exists bolt_audit_mark on "customer_notices";
drop trigger if exists bolt_audit on "customer_notices";
create trigger bolt_audit after insert or update or delete on "customer_notices" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[["customer","customers"]]','[["appointment","appointments"],["customer","customers"]]');

-- step create:index:appointments.appointments__gist__bb1c4cd7 (additive)
-- operational risk: writes-blocked, table-scan
create index "appointments__gist__bb1c4cd7" on "appointments" using gist ("location");

-- step create:index:appointments.appointments__gin__73732636 (additive)
-- operational risk: writes-blocked, table-scan
create index "appointments__gin__73732636" on "appointments" using gin (bolt_search);

-- step create:index:appointments.appointments__ix__bf9f9696 (additive)
-- operational risk: writes-blocked, table-scan
create index "appointments__ix__bf9f9696" on "appointments" ("attention", "shift_check");

-- step create:trigger:providers.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "providers" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{"status":{"initial":"active","states":{"active":{"to":["inactive"]},"inactive":{"to":["active"]}}}}}');

-- step create:index:providers.providers__gin__95aa4a34 (additive)
create index "providers__gin__95aa4a34" on "providers" using gin ("skills");

-- step create:index:providers.providers__gist__d0519d21 (additive)
create index "providers__gist__d0519d21" on "providers" using gist ("home_location");

-- step create:index:providers.providers__gin__8924af97 (additive)
create index "providers__gin__8924af97" on "providers" using gin ("work_days");

-- step create:index:providers.providers__gist__22635a76 (additive)
create index "providers__gist__22635a76" on "providers" using gist ("last_location");

-- step create:index:providers.providers__gin__73732636 (additive)
create index "providers__gin__73732636" on "providers" using gin (bolt_search);

-- step create:index:scheduling_settings.scheduling_settings__gin__73732636 (additive)
-- operational risk: writes-blocked, table-scan
create index "scheduling_settings__gin__73732636" on "scheduling_settings" using gin (bolt_search);

-- step create:index:availability_requests.availability_requests__ix__dc06d8fb (additive)
-- operational risk: writes-blocked, table-scan
create index "availability_requests__ix__dc06d8fb" on "availability_requests" ("provider");

-- step create:index:appointments.appointments__ix__e4149908 (additive)
-- operational risk: writes-blocked, table-scan
create index "appointments__ix__e4149908" on "appointments" ("booking");

-- step create:index:appointments.appointments__ix__dc06d8fb (additive)
-- operational risk: writes-blocked, table-scan
create index "appointments__ix__dc06d8fb" on "appointments" ("provider");

-- step create:index:appointments.appointments__ix__743f0292 (additive)
-- operational risk: writes-blocked, table-scan
create index "appointments__ix__743f0292" on "appointments" ("unavailable_provider");

-- step create:index:appointments.appointments__ix__1a4b7e3b (additive)
-- operational risk: writes-blocked, table-scan
create index "appointments__ix__1a4b7e3b" on "appointments" ("proposed_provider");

-- step create:index:booking_providers.booking_providers__ix__e4149908 (additive)
-- operational risk: writes-blocked, table-scan
create index "booking_providers__ix__e4149908" on "booking_providers" ("booking");

-- step create:index:booking_providers.booking_providers__ix__dc06d8fb (additive)
-- operational risk: writes-blocked, table-scan
create index "booking_providers__ix__dc06d8fb" on "booking_providers" ("provider");

-- step create:index:customer_notices.customer_notices__ix__908d4cd6 (additive)
-- operational risk: writes-blocked, table-scan
create index "customer_notices__ix__908d4cd6" on "customer_notices" ("appointment");

-- step create:index:providers.providers__ix__fccf4300 (additive)
create index "providers__ix__fccf4300" on "providers" ("user");

-- step create:index:provider_time_off.provider_time_off__ix__dc06d8fb (additive)
-- operational risk: writes-blocked, table-scan
create index "provider_time_off__ix__dc06d8fb" on "provider_time_off" ("provider");

-- step create:engine:audit:appointments (additive)
drop trigger if exists bolt_audit_mark on "appointments";
drop trigger if exists bolt_audit on "appointments";
create trigger bolt_audit after insert or update or delete on "appointments" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[["booking","bookings"]]','[["booking","bookings"],["proposed_provider","providers"],["provider","providers"],["unavailable_provider","providers"]]');

-- step create:engine:audit:booking_providers (additive)
drop trigger if exists bolt_audit_mark on "booking_providers";
drop trigger if exists bolt_audit on "booking_providers";
create trigger bolt_audit after insert or update or delete on "booking_providers" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[["booking","bookings"]]','[["booking","bookings"],["provider","providers"]]');

-- step create:engine:audit:providers (additive)
drop trigger if exists bolt_audit_mark on "providers";
drop trigger if exists bolt_audit on "providers";
create trigger bolt_audit after insert or update or delete on "providers" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[]','[["user","sys_user"]]');

-- step create:engine:audit:provider_time_off (additive)
drop trigger if exists bolt_audit_mark on "provider_time_off";
drop trigger if exists bolt_audit on "provider_time_off";
create trigger bolt_audit after insert or update or delete on "provider_time_off" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[["provider","providers"]]','[["provider","providers"]]');

-- step create:engine:audit:scheduling_settings (additive)
drop trigger if exists bolt_audit_mark on "scheduling_settings";
drop trigger if exists bolt_audit on "scheduling_settings";
create trigger bolt_audit after insert or update or delete on "scheduling_settings" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[]','[]');
