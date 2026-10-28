-- 0007_schema.sql: 29 step(s), from f13307cc619ca2e0540ad42706b263d3798014e9233ff54e0856d04f82fa93ac to 9fc2fe32fbb916ddb567f7acdfe9b6086c849c758d5c8600485fb6b8837ab39b.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.

-- step replace:trigger:order_lines.store_row_rules (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
drop trigger if exists store_row_rules on "order_lines";

-- step replace:trigger:orders.store_row_rules (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
drop trigger if exists store_row_rules on "orders";

-- step drop:constraint:commission_statements.commission_statements__ck__5f388321 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "commission_statements" drop constraint if exists "commission_statements__ck__5f388321";

-- step drop:constraint:orders.orders__ck__f9ea271d (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "orders" drop constraint if exists "orders__ck__f9ea271d";

-- step create:column:activities.bolt_search (backfill)
-- hazard: backfill: a derived column is filled from every row (time grows with the table).
-- operational risk: table-rewrite: may rewrite the table; disk use and work grow with existing data.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "activities" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("title"::text, '') || ' ' || coalesce("kind"::text, ''))) stored;

-- step create:column:commission_rules.bolt_search (backfill)
-- hazard: backfill: a derived column is filled from every row (time grows with the table).
-- operational risk: table-rewrite: may rewrite the table; disk use and work grow with existing data.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "commission_rules" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("basis_unit"::text, ''))) stored;

-- step create:column:contacts.bolt_search (backfill)
-- hazard: backfill: a derived column is filled from every row (time grows with the table).
-- operational risk: table-rewrite: may rewrite the table; disk use and work grow with existing data.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "contacts" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("name"::text, '') || ' ' || coalesce("email"::text, '') || ' ' || coalesce("phone"::text, ''))) stored;

-- step create:column:credit_snapshots.bolt_search (backfill)
-- hazard: backfill: a derived column is filled from every row (time grows with the table).
-- operational risk: table-rewrite: may rewrite the table; disk use and work grow with existing data.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "credit_snapshots" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("external_code"::text, ''))) stored;

-- step create:column:document_templates.bolt_search (backfill)
-- hazard: backfill: a derived column is filled from every row (time grows with the table).
-- operational risk: table-rewrite: may rewrite the table; disk use and work grow with existing data.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "document_templates" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("title"::text, '') || ' ' || coalesce("kind"::text, ''))) stored;

-- step create:column:order_lines.bolt_search (backfill)
-- hazard: backfill: a derived column is filled from every row (time grows with the table).
-- operational risk: table-rewrite: may rewrite the table; disk use and work grow with existing data.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "order_lines" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("product_code"::text, ''))) stored;

-- step create:column:orders.agreed_total (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "orders" add column "agreed_total" numeric;

-- step create:column:pricing_floors.bolt_search (backfill)
-- hazard: backfill: a derived column is filled from every row (time grows with the table).
-- operational risk: table-rewrite: may rewrite the table; disk use and work grow with existing data.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "pricing_floors" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("group_code"::text, '') || ' ' || coalesce("unit"::text, ''))) stored;

-- step create:column:stock_snapshots.bolt_search (backfill)
-- hazard: backfill: a derived column is filled from every row (time grows with the table).
-- operational risk: table-rewrite: may rewrite the table; disk use and work grow with existing data.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "stock_snapshots" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("lot_number"::text, '') || ' ' || coalesce("external_code"::text, ''))) stored;

-- step create:column:transactions.bolt_search (backfill)
-- hazard: backfill: a derived column is filled from every row (time grows with the table).
-- operational risk: table-rewrite: may rewrite the table; disk use and work grow with existing data.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "transactions" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("reference"::text, '') || ' ' || coalesce("kind"::text, ''))) stored;

-- step create:column:warehouses.bolt_search (backfill)
-- hazard: backfill: a derived column is filled from every row (time grows with the table).
-- operational risk: table-rewrite: may rewrite the table; disk use and work grow with existing data.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "warehouses" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("name"::text, '') || ' ' || coalesce("external_code"::text, '') || ' ' || coalesce("group_code"::text, ''))) stored;

-- step create:default:document_templates.body (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "document_templates" alter column "body" set default '{agreement}'::text;

-- step data:commission_statements.snapshot (data)
-- hazard: the shape of commission_statements.snapshot changed; rows written under the old shape may not decode under the new one.
-- Transform them here (an UPDATE over commission_statements); the check below counts the rows the new shape still refuses.
-- step check:commission_statements.snapshot (validating)
do $store$ declare n bigint; begin
	execute 'select count(*) from "commission_statements" where "snapshot" is null or store_json_valid("snapshot", ''{"hidden":true,"kind":"json","shape":{"kind":"list","of":{"fields":{"amount":{"kind":"text","optional":true},"awaiting_approval":{"kind":"bool"},"calculation_hash":{"kind":"text"},"number":{"kind":"text"},"order":{"kind":"text"},"seal_hash":{"kind":"text"},"unresolved_lines":{"kind":"int"}},"kind":"object"}}}''::jsonb) is not true' into n;
	if n > 0 then raise exception 'the shape of commission_statements.snapshot refuses % existing row(s)', n; end if;
end $store$;

-- step data:orders.sealed_snapshot (data)
-- hazard: the shape of orders.sealed_snapshot changed; rows written under the old shape may not decode under the new one.
-- Transform them here (an UPDATE over orders); the check below counts the rows the new shape still refuses.
-- step check:orders.sealed_snapshot (validating)
do $store$ declare n bigint; begin
	execute 'select count(*) from "orders" where "sealed_snapshot" is not null and store_json_valid("sealed_snapshot", ''{"hidden":true,"kind":"json","optional":true,"shape":{"fields":{"contract_version":{"kind":"text"},"currency":{"kind":"text"},"delivery_terms":{"kind":"text"},"direction":{"kind":"enum","values":["sales","purchasing"]},"document_title":{"kind":"text","optional":true},"lines":{"kind":"list","of":{"fields":{"commission_basis_unit":{"kind":"text"},"commission_factor":{"kind":"text"},"discount_pct":{"kind":"text"},"floor_net":{"kind":"text"},"id":{"kind":"text"},"net":{"kind":"text"},"product":{"kind":"text","optional":true},"product_code":{"kind":"text"},"product_name":{"kind":"text"},"quantity":{"kind":"text"},"source_entry_id":{"kind":"text","optional":true},"tax":{"kind":"text"},"tax_rate":{"kind":"text"},"total":{"kind":"text"},"unit":{"kind":"text"},"unit_price":{"kind":"text"}},"kind":"object"}},"net":{"kind":"text"},"order_id":{"kind":"text"},"party_code":{"kind":"text"},"party_name":{"kind":"text"},"payment_terms":{"kind":"text"},"tax":{"kind":"text"},"tax_inclusive":{"kind":"bool"},"title":{"kind":"text","optional":true},"total":{"kind":"text"},"valid_from":{"kind":"text","optional":true},"valid_until":{"kind":"text","optional":true},"warehouse":{"kind":"text","optional":true}},"kind":"object"}}''::jsonb) is not true' into n;
	if n > 0 then raise exception 'the shape of orders.sealed_snapshot refuses % existing row(s)', n; end if;
end $store$;

-- step create:constraint:commission_statements.commission_statements__ck__e7bed89c (validating)
-- hazard: validating: refuses, naming the constraint and the row count, if existing rows break it.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "commission_statements" where (("snapshot" is null or store_json_valid("snapshot", ''{"hidden":true,"kind":"json","shape":{"kind":"list","of":{"fields":{"amount":{"kind":"text","optional":true},"awaiting_approval":{"kind":"bool"},"calculation_hash":{"kind":"text"},"number":{"kind":"text"},"order":{"kind":"text"},"seal_hash":{"kind":"text"},"unresolved_lines":{"kind":"int"}},"kind":"object"}}}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'commission_statements__ck__e7bed89c refuses % existing row(s)', n; end if;
end $store$;
alter table "commission_statements" add constraint "commission_statements__ck__e7bed89c" check (("snapshot" is null or store_json_valid("snapshot", '{"hidden":true,"kind":"json","shape":{"kind":"list","of":{"fields":{"amount":{"kind":"text","optional":true},"awaiting_approval":{"kind":"bool"},"calculation_hash":{"kind":"text"},"number":{"kind":"text"},"order":{"kind":"text"},"seal_hash":{"kind":"text"},"unresolved_lines":{"kind":"int"}},"kind":"object"}}}'::jsonb) is true));

-- step create:constraint:orders.orders__ck__0c192213 (validating)
-- hazard: validating: refuses, naming the constraint and the row count, if existing rows break it.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "orders" where (("sealed_snapshot" is null or store_json_valid("sealed_snapshot", ''{"hidden":true,"kind":"json","optional":true,"shape":{"fields":{"contract_version":{"kind":"text"},"currency":{"kind":"text"},"delivery_terms":{"kind":"text"},"direction":{"kind":"enum","values":["sales","purchasing"]},"document_title":{"kind":"text","optional":true},"lines":{"kind":"list","of":{"fields":{"commission_basis_unit":{"kind":"text"},"commission_factor":{"kind":"text"},"discount_pct":{"kind":"text"},"floor_net":{"kind":"text"},"id":{"kind":"text"},"net":{"kind":"text"},"product":{"kind":"text","optional":true},"product_code":{"kind":"text"},"product_name":{"kind":"text"},"quantity":{"kind":"text"},"source_entry_id":{"kind":"text","optional":true},"tax":{"kind":"text"},"tax_rate":{"kind":"text"},"total":{"kind":"text"},"unit":{"kind":"text"},"unit_price":{"kind":"text"}},"kind":"object"}},"net":{"kind":"text"},"order_id":{"kind":"text"},"party_code":{"kind":"text"},"party_name":{"kind":"text"},"payment_terms":{"kind":"text"},"tax":{"kind":"text"},"tax_inclusive":{"kind":"bool"},"title":{"kind":"text","optional":true},"total":{"kind":"text"},"valid_from":{"kind":"text","optional":true},"valid_until":{"kind":"text","optional":true},"warehouse":{"kind":"text","optional":true}},"kind":"object"}}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'orders__ck__0c192213 refuses % existing row(s)', n; end if;
end $store$;
alter table "orders" add constraint "orders__ck__0c192213" check (("sealed_snapshot" is null or store_json_valid("sealed_snapshot", '{"hidden":true,"kind":"json","optional":true,"shape":{"fields":{"contract_version":{"kind":"text"},"currency":{"kind":"text"},"delivery_terms":{"kind":"text"},"direction":{"kind":"enum","values":["sales","purchasing"]},"document_title":{"kind":"text","optional":true},"lines":{"kind":"list","of":{"fields":{"commission_basis_unit":{"kind":"text"},"commission_factor":{"kind":"text"},"discount_pct":{"kind":"text"},"floor_net":{"kind":"text"},"id":{"kind":"text"},"net":{"kind":"text"},"product":{"kind":"text","optional":true},"product_code":{"kind":"text"},"product_name":{"kind":"text"},"quantity":{"kind":"text"},"source_entry_id":{"kind":"text","optional":true},"tax":{"kind":"text"},"tax_rate":{"kind":"text"},"total":{"kind":"text"},"unit":{"kind":"text"},"unit_price":{"kind":"text"}},"kind":"object"}},"net":{"kind":"text"},"order_id":{"kind":"text"},"party_code":{"kind":"text"},"party_name":{"kind":"text"},"payment_terms":{"kind":"text"},"tax":{"kind":"text"},"tax_inclusive":{"kind":"bool"},"title":{"kind":"text","optional":true},"total":{"kind":"text"},"valid_from":{"kind":"text","optional":true},"valid_until":{"kind":"text","optional":true},"warehouse":{"kind":"text","optional":true}},"kind":"object"}}'::jsonb) is true));

-- step create:constraint:orders.orders__ck__f9848508 (validating)
-- hazard: validating: refuses, naming the constraint and the row count, if existing rows break it.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "orders" where ("agreed_total" not in (''NaN''::numeric, ''Infinity''::numeric, ''-Infinity''::numeric) and round("agreed_total", bolt_minor_units("currency")) = "agreed_total") is false' into n;
	if n > 0 then raise exception 'orders__ck__f9848508 refuses % existing row(s)', n; end if;
end $store$;
alter table "orders" add constraint "orders__ck__f9848508" check ("agreed_total" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("agreed_total", bolt_minor_units("currency")) = "agreed_total");

-- step replace:trigger:order_lines.store_row_rules (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
create trigger store_row_rules before insert or update or delete on "order_lines" for each row execute function store_row_rules('{"audit":true,"fields":{"commission_basis_unit":["commission_basis_unit"],"commission_factor":["commission_factor"],"currency":["currency"],"discount_pct":["discount_pct"],"floor_net":["floor_net"],"floor_on":["floor_on"],"net":["net"],"order":["order"],"product":["product"],"product_code":["product_code"],"product_name":["product_name"],"quantity":["quantity"],"source_entry_id":["source_entry_id"],"tax":["tax"],"tax_rate":["tax_rate"],"total":["total"],"unit":["unit"],"unit_price":["unit_price"]},"key":["id"],"parents":[{"column":"order","key":"id","relation":"lines","states":{"status":{"initial":"draft","states":{"confirmed":{"edit":["title","notes","archived","contract_versions","agreed_total","source_order_key","draft_setup","operational_contracts","check_hash","contract_version","sealed_at","sealed_by","sealed_snapshot","sealed_commission","sealed_contract","sealed_contract_version","seal_hash","freight_treatment","warehouse","ordered_on","currency","tax_inclusive","valid_from","valid_until","payment_terms","delivery_terms","supporting_documents","draft_document_ids"],"to":["draft"]},"draft":{"to":["confirmed"]}}}},"table":"orders","type":"uuid"}],"states":{}}');

-- step replace:trigger:orders.store_row_rules (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
create trigger store_row_rules before insert or update or delete on "orders" for each row execute function store_row_rules('{"audit":true,"fields":{"agreed_total":["agreed_total"],"archived":["archived"],"check_hash":["check_hash"],"closure_snapshot":["closure_snapshot"],"contract_version":["contract_version"],"contract_versions":["contract_versions"],"currency":["currency"],"delivery_terms":["delivery_terms"],"direction":["direction"],"draft_document_ids":["draft_document_ids"],"draft_setup":["draft_setup"],"freight_treatment":["freight_treatment"],"ledger":["ledger"],"notes":["notes"],"operational_contracts":["operational_contracts"],"ordered_on":["ordered_on"],"owner":["owner"],"party":["party"],"party_name":["party_name"],"payment_terms":["payment_terms"],"seal_hash":["seal_hash"],"sealed_at":["sealed_at"],"sealed_by":["sealed_by"],"sealed_commission":["sealed_commission"],"sealed_contract":["sealed_contract"],"sealed_contract_version":["sealed_contract_version"],"sealed_snapshot":["sealed_snapshot"],"source_order_key":["source_order_key"],"status":["status"],"supporting_documents":["supporting_documents"],"tax_inclusive":["tax_inclusive"],"title":["title"],"valid_from":["valid_from"],"valid_until":["valid_until"],"warehouse":["warehouse"]},"key":["id"],"parents":[],"states":{"status":{"initial":"draft","states":{"confirmed":{"edit":["title","notes","archived","contract_versions","agreed_total","source_order_key","draft_setup","operational_contracts","check_hash","contract_version","sealed_at","sealed_by","sealed_snapshot","sealed_commission","sealed_contract","sealed_contract_version","seal_hash","freight_treatment","warehouse","ordered_on","currency","tax_inclusive","valid_from","valid_until","payment_terms","delivery_terms","supporting_documents","draft_document_ids"],"to":["draft"]},"draft":{"to":["confirmed"]}}}}}');

-- step create:index:activities.activities__gin__73732636 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
create index "activities__gin__73732636" on "activities" using gin (bolt_search);

-- step create:index:commission_rules.commission_rules__gin__73732636 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
create index "commission_rules__gin__73732636" on "commission_rules" using gin (bolt_search);

-- step create:index:contacts.contacts__gin__73732636 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
create index "contacts__gin__73732636" on "contacts" using gin (bolt_search);

-- step create:index:credit_snapshots.credit_snapshots__gin__73732636 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
create index "credit_snapshots__gin__73732636" on "credit_snapshots" using gin (bolt_search);

-- step create:index:document_templates.document_templates__gin__73732636 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
create index "document_templates__gin__73732636" on "document_templates" using gin (bolt_search);

-- step create:index:order_lines.order_lines__gin__73732636 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
create index "order_lines__gin__73732636" on "order_lines" using gin (bolt_search);

-- step create:index:pricing_floors.pricing_floors__gin__73732636 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
create index "pricing_floors__gin__73732636" on "pricing_floors" using gin (bolt_search);

-- step create:index:stock_snapshots.stock_snapshots__gin__73732636 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
create index "stock_snapshots__gin__73732636" on "stock_snapshots" using gin (bolt_search);

-- step create:index:transactions.transactions__gin__73732636 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
create index "transactions__gin__73732636" on "transactions" using gin (bolt_search);

-- step create:index:warehouses.warehouses__gin__73732636 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
create index "warehouses__gin__73732636" on "warehouses" using gin (bolt_search);
