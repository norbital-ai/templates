-- 0002_schema.sql: 136 step(s), from 296f8f70977691fe83c3596aafeb9029d3e322f75c7eb19020157e03a8a5fa05 to 3ec023a93f473e8b24fe043642f81a862ea2574631b7f0c2d1cd845acf11721f.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- hazard: DESTRUCTIVE: drops data (a table or a stored column) or rebuilds it; runs only under its accept line.
-- hazard: backfill: a derived column is filled from every row (time grows with the table).
-- hazard: validating: refuses, naming the constraint and the row count, if existing rows break it.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-rewrite: may rewrite the table; disk use and work grow with existing data.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.

-- step replace:trigger:drawdown.store_statement_rules_update (additive)
drop trigger if exists store_statement_rules_update on "drawdown";

-- step replace:trigger:drawdown.store_statement_rules_delete (additive)
drop trigger if exists store_statement_rules_delete on "drawdown";

-- step replace:trigger:bank_document.store_statement_rules_update (additive)
drop trigger if exists store_statement_rules_update on "bank_document";

-- step replace:trigger:bank_document.store_statement_rules_delete (additive)
drop trigger if exists store_statement_rules_delete on "bank_document";

-- step replace:index:purchase_order.purchase_order__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "purchase_order__gin__73732636";

-- step replace:index:facility_form.facility_form__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "facility_form__gin__73732636";

-- step replace:index:facility_attachment.facility_attachment__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "facility_attachment__gin__73732636";

-- step replace:index:po_document.po_document__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "po_document__gin__73732636";

-- step drop:constraint:business_partner.business_partner__ck__2a4562b4 (additive)
-- operational risk: access-exclusive-lock
alter table "business_partner" drop constraint if exists "business_partner__ck__2a4562b4";

-- step drop:constraint:drawdown.drawdown__ck__970b1a22 (additive)
-- operational risk: access-exclusive-lock
alter table "drawdown" drop constraint if exists "drawdown__ck__970b1a22";

-- step drop:constraint:facility.facility__ck__b40f27b0 (additive)
-- operational risk: access-exclusive-lock
alter table "facility" drop constraint if exists "facility__ck__b40f27b0";

-- step drop:constraint:purchase_order.purchase_order__uq__9442534e (additive)
-- operational risk: access-exclusive-lock
alter table "purchase_order" drop constraint if exists "purchase_order__uq__9442534e";

-- step drop:notNull:bank.is_active (additive)
-- operational risk: access-exclusive-lock
alter table "bank" alter column "is_active" drop not null;

-- step drop:notNull:business_partner.is_active (additive)
-- operational risk: access-exclusive-lock
alter table "business_partner" alter column "is_active" drop not null;

-- step drop:notNull:facility_attachment.title (additive)
-- operational risk: access-exclusive-lock
alter table "facility_attachment" alter column "title" drop not null;

-- step drop:notNull:facility_form.currency (additive)
-- operational risk: access-exclusive-lock
alter table "facility_form" alter column "currency" drop not null;

-- step drop:notNull:facility_form.facility_required (additive)
-- operational risk: access-exclusive-lock
alter table "facility_form" alter column "facility_required" drop not null;

-- step drop:notNull:facility_form.po_number (additive)
-- operational risk: access-exclusive-lock
alter table "facility_form" alter column "po_number" drop not null;

-- step drop:notNull:fx_rate.is_month_end (additive)
-- operational risk: access-exclusive-lock
alter table "fx_rate" alter column "is_month_end" drop not null;

-- step drop:notNull:po_document.title (additive)
-- operational risk: access-exclusive-lock
alter table "po_document" alter column "title" drop not null;

-- step drop:notNull:purchase_order.po_date (additive)
-- operational risk: access-exclusive-lock
alter table "purchase_order" alter column "po_date" drop not null;

-- step drop:notNull:purchase_order.po_number (additive)
-- operational risk: access-exclusive-lock
alter table "purchase_order" alter column "po_number" drop not null;

-- step drop:notNull:purchase_order.supplier (additive)
-- operational risk: access-exclusive-lock
alter table "purchase_order" alter column "supplier" drop not null;

-- step drop:default:bank.is_active (additive)
-- operational risk: access-exclusive-lock
alter table "bank" alter column "is_active" drop default;

-- step drop:default:business_partner.is_active (additive)
-- operational risk: access-exclusive-lock
alter table "business_partner" alter column "is_active" drop default;

-- step drop:default:facility_form.currency (additive)
-- operational risk: access-exclusive-lock
alter table "facility_form" alter column "currency" drop default;

-- step drop:default:facility_form.facility_required (additive)
-- operational risk: access-exclusive-lock
alter table "facility_form" alter column "facility_required" drop default;

-- step drop:default:fx_rate.is_month_end (additive)
-- operational risk: access-exclusive-lock
alter table "fx_rate" alter column "is_month_end" drop default;

-- step drop:column:bank.is_active (destructive)
-- accept: drop:column:bank.is_active
-- operational risk: access-exclusive-lock
alter table "bank" drop column if exists "is_active" cascade;

-- step drop:column:bank.settlement_instructions (destructive)
-- accept: drop:column:bank.settlement_instructions
-- operational risk: access-exclusive-lock
alter table "bank" drop column if exists "settlement_instructions" cascade;

-- step drop:column:bank.terms_notes (destructive)
-- accept: drop:column:bank.terms_notes
-- operational risk: access-exclusive-lock
alter table "bank" drop column if exists "terms_notes" cascade;

-- step drop:column:bank_document.notes (destructive)
-- accept: drop:column:bank_document.notes
-- operational risk: access-exclusive-lock
alter table "bank_document" drop column if exists "notes" cascade;

-- step drop:column:business_partner.is_active (destructive)
-- accept: drop:column:business_partner.is_active
-- operational risk: access-exclusive-lock
alter table "business_partner" drop column if exists "is_active" cascade;

-- step drop:column:business_partner.relationship_since (destructive)
-- accept: drop:column:business_partner.relationship_since
-- operational risk: access-exclusive-lock
alter table "business_partner" drop column if exists "relationship_since" cascade;

-- step drop:column:drawdown.requested_by (destructive)
-- accept: drop:column:drawdown.requested_by
-- operational risk: access-exclusive-lock
alter table "drawdown" drop column if exists "requested_by" cascade;

-- step drop:column:drawdown.settled_principal (destructive)
-- accept: drop:column:drawdown.settled_principal
-- operational risk: access-exclusive-lock
alter table "drawdown" drop column if exists "settled_principal" cascade;

-- step drop:column:facility.entity (destructive)
-- accept: drop:column:facility.entity
-- operational risk: access-exclusive-lock
alter table "facility" drop column if exists "entity" cascade;

-- step drop:column:facility.notes (destructive)
-- accept: drop:column:facility.notes
-- operational risk: access-exclusive-lock
alter table "facility" drop column if exists "notes" cascade;

-- step drop:column:facility.pledged_deposit (destructive)
-- accept: drop:column:facility.pledged_deposit
-- operational risk: access-exclusive-lock
alter table "facility" drop column if exists "pledged_deposit" cascade;

-- step drop:column:facility.pricing_notes (destructive)
-- accept: drop:column:facility.pricing_notes
-- operational risk: access-exclusive-lock
alter table "facility" drop column if exists "pricing_notes" cascade;

-- step drop:column:fx_rate.is_month_end (destructive)
-- accept: drop:column:fx_rate.is_month_end
-- operational risk: access-exclusive-lock
alter table "fx_rate" drop column if exists "is_month_end" cascade;

-- step drop:column:fx_rate.source (destructive)
-- accept: drop:column:fx_rate.source
-- operational risk: access-exclusive-lock
alter table "fx_rate" drop column if exists "source" cascade;

-- step drop:column:po_document.notes (destructive)
-- accept: drop:column:po_document.notes
-- operational risk: access-exclusive-lock
alter table "po_document" drop column if exists "notes" cascade;

-- step drop:column:po_document.title (destructive)
-- accept: drop:column:po_document.title
-- operational risk: access-exclusive-lock
alter table "po_document" drop column if exists "title" cascade;

-- step drop:column:purchase_order.purchaser (destructive)
-- accept: drop:column:purchase_order.purchaser
-- operational risk: access-exclusive-lock
alter table "purchase_order" drop column if exists "purchaser" cascade;

-- step drop:column:sub_limit.notes (destructive)
-- accept: drop:column:sub_limit.notes
-- operational risk: access-exclusive-lock
alter table "sub_limit" drop column if exists "notes" cascade;

-- step replace:column:purchase_order.bolt_record_label (backfill)
-- operational risk: access-exclusive-lock
alter table "purchase_order" drop column if exists "bolt_record_label" cascade;

-- step replace:column:purchase_order.bolt_search (backfill)
-- operational risk: access-exclusive-lock
alter table "purchase_order" drop column if exists bolt_search cascade;

-- step replace:column:facility_form.bolt_record_label (backfill)
-- operational risk: access-exclusive-lock
alter table "facility_form" drop column if exists "bolt_record_label" cascade;

-- step replace:column:facility_form.bolt_search (backfill)
-- operational risk: access-exclusive-lock
alter table "facility_form" drop column if exists bolt_search cascade;

-- step replace:column:facility_attachment.bolt_record_label (backfill)
-- operational risk: access-exclusive-lock
alter table "facility_attachment" drop column if exists "bolt_record_label" cascade;

-- step replace:column:facility_attachment.bolt_search (backfill)
-- operational risk: access-exclusive-lock
alter table "facility_attachment" drop column if exists bolt_search cascade;

-- step replace:column:po_document.bolt_record_label (backfill)
-- operational risk: access-exclusive-lock
alter table "po_document" drop column if exists "bolt_record_label" cascade;

-- step replace:column:po_document.bolt_search (backfill)
-- operational risk: access-exclusive-lock
alter table "po_document" drop column if exists bolt_search cascade;

-- step drop:function:bolt_record_label_facility_attachment_06f5fc13 (additive)
drop function if exists "bolt_record_label_facility_attachment_06f5fc13"(text) cascade;

-- step drop:function:bolt_record_label_facility_form_27022eb9 (additive)
drop function if exists "bolt_record_label_facility_form_27022eb9"(text) cascade;

-- step drop:function:bolt_record_label_po_document_06f5fc13 (additive)
drop function if exists "bolt_record_label_po_document_06f5fc13"(text) cascade;

-- step drop:function:bolt_record_label_purchase_order_27022eb9 (additive)
drop function if exists "bolt_record_label_purchase_order_27022eb9"(text) cascade;

-- step create:function:bolt_record_label_fx_deal_4ebfc6e9 (additive)
create or replace function "bolt_record_label_fx_deal_4ebfc6e9"(text, text, text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT ((SELECT CASE WHEN jsonb_typeof(label_1.left_value) = 'string' AND jsonb_typeof(label_1.right_value) = 'string' THEN to_jsonb((label_1.left_value #>> '{}') || (label_1.right_value #>> '{}')) WHEN jsonb_typeof(label_1.left_value) = 'array' AND jsonb_typeof(label_1.right_value) = 'array' THEN label_1.left_value || label_1.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_1.left_value) = 'number' THEN (label_1.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_1.right_value) = 'number' THEN (label_1.right_value #>> '{}') END)::numeric) END FROM (SELECT (SELECT CASE WHEN jsonb_typeof(label_0.left_value) = 'string' AND jsonb_typeof(label_0.right_value) = 'string' THEN to_jsonb((label_0.left_value #>> '{}') || (label_0.right_value #>> '{}')) WHEN jsonb_typeof(label_0.left_value) = 'array' AND jsonb_typeof(label_0.right_value) = 'array' THEN label_0.left_value || label_0.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_0.left_value) = 'number' THEN (label_0.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_0.right_value) = 'number' THEN (label_0.right_value #>> '{}') END)::numeric) END FROM (SELECT (CASE WHEN (CASE WHEN jsonb_typeof(to_jsonb((coalesce((label_row.j #> ARRAY['bank_reference']), 'null'::jsonb) <> 'null'::jsonb))) = 'boolean' THEN (to_jsonb((coalesce((label_row.j #> ARRAY['bank_reference']), 'null'::jsonb) <> 'null'::jsonb)) #>> '{}') END)::boolean IS TRUE THEN coalesce((label_row.j #> ARRAY['bank_reference']), 'null'::jsonb) WHEN (CASE WHEN jsonb_typeof(to_jsonb((coalesce((label_row.j #> ARRAY['bank_reference']), 'null'::jsonb) <> 'null'::jsonb))) = 'boolean' THEN (to_jsonb((coalesce((label_row.j #> ARRAY['bank_reference']), 'null'::jsonb) <> 'null'::jsonb)) #>> '{}') END)::boolean IS FALSE THEN coalesce((label_row.j #> ARRAY['pair']), 'null'::jsonb) ELSE 'null'::jsonb END) AS left_value, to_jsonb(' · '::text) AS right_value OFFSET 0) label_0) AS left_value, to_jsonb((coalesce((label_row.j #> ARRAY['structure']), 'null'::jsonb) #>> '{}')) AS right_value OFFSET 0) label_1) #>> '{}') AS value FROM (SELECT jsonb_build_object('bank_reference', to_jsonb("bank_reference"), 'pair', to_jsonb("pair"), 'structure', to_jsonb("structure")) AS j FROM (SELECT $1 AS "bank_reference", $2 AS "pair", $3 AS "structure") label_inputs) label_row OFFSET 0) label_value$record_label$;

-- step create:function:bolt_record_label_fx_document_581be6d4 (additive)
create or replace function "bolt_record_label_fx_document_581be6d4"(text, text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT ((CASE WHEN (CASE WHEN jsonb_typeof(to_jsonb((coalesce((label_row.j #> ARRAY['bank_reference']), 'null'::jsonb) <> 'null'::jsonb))) = 'boolean' THEN (to_jsonb((coalesce((label_row.j #> ARRAY['bank_reference']), 'null'::jsonb) <> 'null'::jsonb)) #>> '{}') END)::boolean IS TRUE THEN coalesce((label_row.j #> ARRAY['bank_reference']), 'null'::jsonb) WHEN (CASE WHEN jsonb_typeof(to_jsonb((coalesce((label_row.j #> ARRAY['bank_reference']), 'null'::jsonb) <> 'null'::jsonb))) = 'boolean' THEN (to_jsonb((coalesce((label_row.j #> ARRAY['bank_reference']), 'null'::jsonb) <> 'null'::jsonb)) #>> '{}') END)::boolean IS FALSE THEN to_jsonb((coalesce((label_row.j #> ARRAY['kind']), 'null'::jsonb) #>> '{}')) ELSE 'null'::jsonb END) #>> '{}') AS value FROM (SELECT jsonb_build_object('bank_reference', to_jsonb("bank_reference"), 'kind', to_jsonb("kind")) AS j FROM (SELECT $1 AS "bank_reference", $2 AS "kind") label_inputs) label_row OFFSET 0) label_value$record_label$;

-- step create:function:bolt_record_label_fx_fixing_52ab8a8d (additive)
create or replace function "bolt_record_label_fx_fixing_52ab8a8d"(date) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (to_jsonb((coalesce((label_row.j #> ARRAY['fixing_date']), 'null'::jsonb) #>> '{}')) #>> '{}') AS value FROM (SELECT jsonb_build_object('fixing_date', to_jsonb("fixing_date"::text)) AS j FROM (SELECT $1 AS "fixing_date") label_inputs) label_row OFFSET 0) label_value$record_label$;

-- step create:function:bolt_record_label_fx_proposal_b4f193df (additive)
create or replace function "bolt_record_label_fx_proposal_b4f193df"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT ((CASE WHEN (CASE WHEN jsonb_typeof(to_jsonb((coalesce((label_row.j #> ARRAY['title']), 'null'::jsonb) <> 'null'::jsonb))) = 'boolean' THEN (to_jsonb((coalesce((label_row.j #> ARRAY['title']), 'null'::jsonb) <> 'null'::jsonb)) #>> '{}') END)::boolean IS TRUE THEN coalesce((label_row.j #> ARRAY['title']), 'null'::jsonb) WHEN (CASE WHEN jsonb_typeof(to_jsonb((coalesce((label_row.j #> ARRAY['title']), 'null'::jsonb) <> 'null'::jsonb))) = 'boolean' THEN (to_jsonb((coalesce((label_row.j #> ARRAY['title']), 'null'::jsonb) <> 'null'::jsonb)) #>> '{}') END)::boolean IS FALSE THEN to_jsonb('Proposal'::text) ELSE 'null'::jsonb END) #>> '{}') AS value FROM (SELECT jsonb_build_object('title', to_jsonb("title")) AS j FROM (SELECT $1 AS "title") label_inputs) label_row OFFSET 0) label_value$record_label$;

-- step create:function:bolt_record_label_purchase_order_71b0fa92 (additive)
create or replace function "bolt_record_label_purchase_order_71b0fa92"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT ((CASE WHEN (CASE WHEN jsonb_typeof(to_jsonb((coalesce((label_row.j #> ARRAY['po_number']), 'null'::jsonb) <> 'null'::jsonb))) = 'boolean' THEN (to_jsonb((coalesce((label_row.j #> ARRAY['po_number']), 'null'::jsonb) <> 'null'::jsonb)) #>> '{}') END)::boolean IS TRUE THEN coalesce((label_row.j #> ARRAY['po_number']), 'null'::jsonb) WHEN (CASE WHEN jsonb_typeof(to_jsonb((coalesce((label_row.j #> ARRAY['po_number']), 'null'::jsonb) <> 'null'::jsonb))) = 'boolean' THEN (to_jsonb((coalesce((label_row.j #> ARRAY['po_number']), 'null'::jsonb) <> 'null'::jsonb)) #>> '{}') END)::boolean IS FALSE THEN to_jsonb('Purchase order'::text) ELSE 'null'::jsonb END) #>> '{}') AS value FROM (SELECT jsonb_build_object('po_number', to_jsonb("po_number")) AS j FROM (SELECT $1 AS "po_number") label_inputs) label_row OFFSET 0) label_value$record_label$;

-- step create:function:bolt_record_label_facility_form_ba8c79dc (additive)
create or replace function "bolt_record_label_facility_form_ba8c79dc"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT ((CASE WHEN (CASE WHEN jsonb_typeof(to_jsonb((coalesce((label_row.j #> ARRAY['po_number']), 'null'::jsonb) <> 'null'::jsonb))) = 'boolean' THEN (to_jsonb((coalesce((label_row.j #> ARRAY['po_number']), 'null'::jsonb) <> 'null'::jsonb)) #>> '{}') END)::boolean IS TRUE THEN coalesce((label_row.j #> ARRAY['po_number']), 'null'::jsonb) WHEN (CASE WHEN jsonb_typeof(to_jsonb((coalesce((label_row.j #> ARRAY['po_number']), 'null'::jsonb) <> 'null'::jsonb))) = 'boolean' THEN (to_jsonb((coalesce((label_row.j #> ARRAY['po_number']), 'null'::jsonb) <> 'null'::jsonb)) #>> '{}') END)::boolean IS FALSE THEN to_jsonb('Facility form'::text) ELSE 'null'::jsonb END) #>> '{}') AS value FROM (SELECT jsonb_build_object('po_number', to_jsonb("po_number")) AS j FROM (SELECT $1 AS "po_number") label_inputs) label_row OFFSET 0) label_value$record_label$;

-- step create:function:bolt_record_label_facility_attachment_93e9bc3b (additive)
create or replace function "bolt_record_label_facility_attachment_93e9bc3b"(text, text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT ((CASE WHEN (CASE WHEN jsonb_typeof(to_jsonb((coalesce((label_row.j #> ARRAY['title']), 'null'::jsonb) <> 'null'::jsonb))) = 'boolean' THEN (to_jsonb((coalesce((label_row.j #> ARRAY['title']), 'null'::jsonb) <> 'null'::jsonb)) #>> '{}') END)::boolean IS TRUE THEN coalesce((label_row.j #> ARRAY['title']), 'null'::jsonb) WHEN (CASE WHEN jsonb_typeof(to_jsonb((coalesce((label_row.j #> ARRAY['title']), 'null'::jsonb) <> 'null'::jsonb))) = 'boolean' THEN (to_jsonb((coalesce((label_row.j #> ARRAY['title']), 'null'::jsonb) <> 'null'::jsonb)) #>> '{}') END)::boolean IS FALSE THEN to_jsonb((coalesce((label_row.j #> ARRAY['kind']), 'null'::jsonb) #>> '{}')) ELSE 'null'::jsonb END) #>> '{}') AS value FROM (SELECT jsonb_build_object('title', to_jsonb("title"), 'kind', to_jsonb("kind")) AS j FROM (SELECT $1 AS "kind", $2 AS "title") label_inputs) label_row OFFSET 0) label_value$record_label$;

-- step create:function:bolt_record_label_po_document_2b9edad3 (additive)
create or replace function "bolt_record_label_po_document_2b9edad3"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (to_jsonb((coalesce((label_row.j #> ARRAY['kind']), 'null'::jsonb) #>> '{}')) #>> '{}') AS value FROM (SELECT jsonb_build_object('kind', to_jsonb("kind")) AS j FROM (SELECT $1 AS "kind") label_inputs) label_row OFFSET 0) label_value$record_label$;

-- step create:table:fx_deal (additive)
create table "fx_deal" ("id" uuid primary key, revision int not null default 1, created_at timestamptz not null default now(), created_by text, updated_at timestamptz not null default now(), updated_by text,
	"bank_reference" text,
	"structure" text default 'fwd'::text not null,
	"structure_as_written" text,
	"pair" text not null,
	"side" text,
	"trade_date" date,
	"notional_currency" text,
	"notional" numeric,
	"leveraged_notional" numeric,
	"strike" numeric,
	"knock_out" numeric,
	"knock_out_type" text,
	"knock_in" numeric,
	"spot_reference" numeric,
	"forward_reference" numeric,
	"forward_reference_date" date,
	"target" numeric,
	"target_rule" text default 'prorata'::text not null,
	"dci_deposit_currency" text,
	"dci_deposit_amount" numeric,
	"dci_yield_pct" numeric,
	"terms" text,
	"status" text default 'draft'::text not null,
	"ended_on" date,
	"view_direction" text,
	"view_rate" numeric,
	"view_date" date,
	"notes" text,
	"bolt_record_label" text generated always as ("bolt_record_label_fx_deal_4ebfc6e9"("bank_reference", "pair", "structure")) stored,
	bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_fx_deal_4ebfc6e9"("bank_reference", "pair", "structure"), '') || ' ' || coalesce("bank_reference"::text, '') || ' ' || coalesce("pair"::text, '') || ' ' || coalesce("structure_as_written"::text, ''))) stored,
	"bank" uuid,
	"proposal" uuid,
	constraint "fx_deal__ck__6643ce4e" check (char_length("bank_reference") <= 100),
	constraint "fx_deal__ck__8c7f9f83" check ("structure" in ('fwd', 'trf', 'dci', 'exko', 'eko', 'eko_eki', 'enh', 'enh_spot', 'pivot', 'acc', 'other')),
	constraint "fx_deal__ck__457dc1e0" check (char_length("pair") <= 6),
	constraint "fx_deal__ck__18b9f956" check ("side" in ('sell', 'buy')),
	constraint "fx_deal__ck__a9bee19e" check (isfinite("trade_date")),
	constraint "fx_deal__ck__2e0740de" check ("notional_currency" ~ '^[A-Z]{3}$'),
	constraint "fx_deal__ck__a6f702c1" check ("notional" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("notional", 2) = "notional"),
	constraint "fx_deal__ck__60fc3198" check ("leveraged_notional" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("leveraged_notional", 2) = "leveraged_notional"),
	constraint "fx_deal__ck__a2c98c38" check ("strike" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("strike", 8) = "strike"),
	constraint "fx_deal__ck__cfb394d5" check ("knock_out" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("knock_out", 8) = "knock_out"),
	constraint "fx_deal__ck__b78e0dbf" check ("knock_out_type" in ('at_expiry', 'continuous')),
	constraint "fx_deal__ck__8bf126a4" check ("knock_in" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("knock_in", 8) = "knock_in"),
	constraint "fx_deal__ck__97807d3f" check ("spot_reference" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("spot_reference", 8) = "spot_reference"),
	constraint "fx_deal__ck__eff73405" check ("forward_reference" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("forward_reference", 8) = "forward_reference"),
	constraint "fx_deal__ck__8927a174" check (isfinite("forward_reference_date")),
	constraint "fx_deal__ck__b85e44f5" check ("target" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("target", 8) = "target"),
	constraint "fx_deal__ck__d808b927" check ("target_rule" in ('prorata', 'full', 'none')),
	constraint "fx_deal__ck__373fd98a" check ("dci_deposit_currency" ~ '^[A-Z]{3}$'),
	constraint "fx_deal__ck__e7040cbb" check ("dci_deposit_amount" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("dci_deposit_amount", 2) = "dci_deposit_amount"),
	constraint "fx_deal__ck__d21a9dc0" check ("dci_yield_pct" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("dci_yield_pct", 4) = "dci_yield_pct"),
	constraint "fx_deal__ck__88cf4018" check ("status" in ('proposal', 'draft', 'live')),
	constraint "fx_deal__ck__70e9eb51" check (isfinite("ended_on")),
	constraint "fx_deal__ck__f9036122" check ("view_direction" in ('up', 'down', 'flat')),
	constraint "fx_deal__ck__352b733e" check ("view_rate" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("view_rate", 8) = "view_rate"),
	constraint "fx_deal__ck__f005e98b" check (isfinite("view_date"))
);

-- step create:table:fx_document (additive)
create table "fx_document" ("id" uuid primary key, revision int not null default 1, created_at timestamptz not null default now(), created_by text, updated_at timestamptz not null default now(), updated_by text,
	"kind" text default 'other'::text not null,
	"file" jsonb not null,
	"bank_reference" text,
	"trade_date" date,
	"signed" boolean,
	"extracted" jsonb,
	"read_status" text default 'uploaded'::text not null,
	"read_note" text,
	"bolt_record_label" text generated always as ("bolt_record_label_fx_document_581be6d4"("bank_reference", "kind")) stored,
	bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_fx_document_581be6d4"("bank_reference", "kind"), ''))) stored,
	"bank" uuid,
	"deal" uuid,
	constraint "fx_document__ck__3b3f7bf6" check ("kind" in ('term_sheet', 'confirmation', 'notice', 'letter', 'other')),
	constraint "fx_document__ck__c2203a9a" check (("file" is null or store_json_valid("file", '{"accept":["application/pdf","image/jpeg","image/png"],"kind":"file","max":"10MiB"}'::jsonb) is true)),
	constraint "fx_document__ck__6643ce4e" check (char_length("bank_reference") <= 100),
	constraint "fx_document__ck__a9bee19e" check (isfinite("trade_date")),
	constraint "fx_document__ck__7aa933d1" check (("extracted" is null or store_json_valid("extracted", '{"kind":"json","optional":true,"shape":{"fields":{"bank_code":{"kind":"text","optional":true},"bank_reference":{"kind":"text","optional":true},"dci_deposit_amount":{"kind":"decimal","optional":true,"scale":2},"dci_deposit_currency":{"kind":"currency","optional":true},"dci_yield_pct":{"kind":"decimal","optional":true,"scale":4},"fixings":{"fields":{"condition":{"kind":"text","optional":true},"condition_level":{"kind":"decimal","optional":true,"scale":8},"condition_side":{"kind":"enum","optional":true,"values":["above","below"]},"firm":{"kind":"bool","optional":true},"fixing_date":{"kind":"date"},"leveraged_notional":{"kind":"decimal","optional":true,"scale":2},"notional":{"kind":"decimal","optional":true,"scale":2},"settlement_date":{"kind":"date","optional":true},"strike":{"kind":"decimal","optional":true,"scale":8}},"kind":"object","many":true,"optional":true},"forward_reference":{"kind":"decimal","optional":true,"scale":8},"forward_reference_date":{"kind":"date","optional":true},"kind":{"kind":"enum","optional":true,"values":["term_sheet","confirmation","notice","letter","other"]},"knock_in":{"kind":"decimal","optional":true,"scale":8},"knock_out":{"kind":"decimal","optional":true,"scale":8},"knock_out_type":{"kind":"enum","optional":true,"values":["at_expiry","continuous"]},"leveraged_notional":{"kind":"decimal","optional":true,"scale":2},"notional":{"kind":"decimal","optional":true,"scale":2},"notional_currency":{"kind":"currency","optional":true},"other_references":{"kind":"text","many":true,"optional":true},"pair":{"kind":"text","optional":true},"side":{"kind":"enum","optional":true,"values":["sell","buy"]},"signed":{"kind":"bool","optional":true},"spot_reference":{"kind":"decimal","optional":true,"scale":8},"strike":{"kind":"decimal","optional":true,"scale":8},"structure":{"kind":"enum","optional":true,"values":["fwd","trf","dci","exko","eko","eko_eki","enh","enh_spot","pivot","acc","other"]},"structure_as_written":{"kind":"text","optional":true},"target":{"kind":"decimal","optional":true,"scale":8},"target_rule":{"kind":"enum","optional":true,"values":["prorata","full","none"]},"termination_date":{"kind":"date","optional":true},"terms":{"kind":"text","optional":true},"trade_date":{"kind":"date","optional":true},"uncertain":{"kind":"text","many":true,"optional":true}},"kind":"object"}}'::jsonb) is true)),
	constraint "fx_document__ck__cc8235ca" check ("read_status" in ('uploaded', 'checked', 'filed', 'failed'))
);

-- step create:table:fx_fixing (additive)
create table "fx_fixing" ("id" uuid primary key, revision int not null default 1, created_at timestamptz not null default now(), created_by text, updated_at timestamptz not null default now(), updated_by text,
	"fixing_date" date not null,
	"settlement_date" date,
	"notional" numeric,
	"leveraged_notional" numeric,
	"strike" numeric,
	"firm" boolean default true not null,
	"condition" text,
	"condition_side" text,
	"condition_level" numeric,
	"fixing_rate" numeric,
	"outcome" text,
	"settled_amount" numeric,
	"note" text,
	"bolt_record_label" text generated always as ("bolt_record_label_fx_fixing_52ab8a8d"("fixing_date")) stored,
	bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_fx_fixing_52ab8a8d"("fixing_date"), ''))) stored,
	"deal" uuid not null,
	constraint "fx_fixing__ck__c5e9717d" check (isfinite("fixing_date")),
	constraint "fx_fixing__ck__26dd7bce" check (isfinite("settlement_date")),
	constraint "fx_fixing__ck__a6f702c1" check ("notional" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("notional", 2) = "notional"),
	constraint "fx_fixing__ck__60fc3198" check ("leveraged_notional" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("leveraged_notional", 2) = "leveraged_notional"),
	constraint "fx_fixing__ck__a2c98c38" check ("strike" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("strike", 8) = "strike"),
	constraint "fx_fixing__ck__40a3f0a0" check ("condition_side" in ('above', 'below')),
	constraint "fx_fixing__ck__19fffcad" check ("condition_level" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("condition_level", 8) = "condition_level"),
	constraint "fx_fixing__ck__2b222ace" check ("fixing_rate" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("fixing_rate", 8) = "fixing_rate"),
	constraint "fx_fixing__ck__c518d398" check ("outcome" in ('exercised', 'leveraged', 'not_exercised', 'knocked_out', 'converted', 'not_converted', 'ended', 'target_not_paid')),
	constraint "fx_fixing__ck__2c6f9eca" check ("settled_amount" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("settled_amount", 2) = "settled_amount")
);

-- step create:table:fx_proposal (additive)
create table "fx_proposal" ("id" uuid primary key, revision int not null default 1, created_at timestamptz not null default now(), created_by text, updated_at timestamptz not null default now(), updated_by text,
	"title" text,
	"text" text,
	"file" jsonb,
	"read_status" text default 'uploaded'::text not null,
	"read_note" text,
	"bolt_record_label" text generated always as ("bolt_record_label_fx_proposal_b4f193df"("title")) stored,
	bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_fx_proposal_b4f193df"("title"), ''))) stored,
	"bank" uuid,
	constraint "fx_proposal__ck__cce842bd" check (("file" is null or store_json_valid("file", '{"accept":["application/pdf","image/jpeg","image/png"],"kind":"file","max":"10MiB","optional":true}'::jsonb) is true)),
	constraint "fx_proposal__ck__2fe8ce6e" check ("read_status" in ('uploaded', 'checked', 'failed'))
);

-- step replace:column:purchase_order.bolt_record_label (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "purchase_order" add column "bolt_record_label" text generated always as ("bolt_record_label_purchase_order_71b0fa92"("po_number")) stored;

-- step replace:column:purchase_order.bolt_search (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "purchase_order" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_purchase_order_71b0fa92"("po_number"), ''))) stored;

-- step replace:column:facility_form.bolt_record_label (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "facility_form" add column "bolt_record_label" text generated always as ("bolt_record_label_facility_form_ba8c79dc"("po_number")) stored;

-- step replace:column:facility_form.bolt_search (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "facility_form" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_facility_form_ba8c79dc"("po_number"), '') || ' ' || coalesce("po_number"::text, '') || ' ' || coalesce("vendor"::text, '') || ' ' || coalesce("customer_po_number"::text, ''))) stored;

-- step replace:column:facility_attachment.bolt_record_label (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "facility_attachment" add column "bolt_record_label" text generated always as ("bolt_record_label_facility_attachment_93e9bc3b"("kind", "title")) stored;

-- step replace:column:facility_attachment.bolt_search (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "facility_attachment" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_facility_attachment_93e9bc3b"("kind", "title"), ''))) stored;

-- step replace:column:po_document.bolt_record_label (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "po_document" add column "bolt_record_label" text generated always as ("bolt_record_label_po_document_2b9edad3"("kind")) stored;

-- step replace:column:po_document.bolt_search (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "po_document" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_po_document_2b9edad3"("kind"), ''))) stored;

-- step replace:history:schema:bank (additive)
select bolt_history_register('bank','{"audit":true,"fields":{"code":{"kind":"text","max":20},"contacts":{"kind":"json","optional":true,"shape":{"fields":{"email":{"format":"email","kind":"text","optional":true},"name":{"kind":"text"},"notes":{"kind":"text","optional":true},"phone":{"kind":"text","optional":true},"role":{"kind":"enum","values":["relationship_manager","client_service","trade_operations","other"]}},"kind":"object","many":true}},"cut_off_time":{"kind":"text","optional":true},"name":{"kind":"text"},"offered_products":{"kind":"enum","many":true,"optional":true,"values":["lc","import_bill","da","dp","tb","ba","bad","if","if_after_lc_or_da","pif","twc","oaf","apf","psil","psbl","ofcl","mctf","tradepay","packing","fbep","dbep","ecr","badd","stl","term","efs","lis","tbl","ma","property","bg","sg","awb","sblc","fx","card","cash"]}},"record_label":"record.code","unique":[{"fields":["code"],"import_key":true,"name":"bank_code"}]}'::jsonb);

-- step replace:history:schema:business_partner (additive)
select bolt_history_register('business_partner','{"audit":true,"fields":{"aliases":{"kind":"text","many":true,"optional":true},"country":{"kind":"text","optional":true},"name":{"kind":"text"},"notes":{"kind":"text","optional":true},"payment_terms":{"kind":"text","optional":true},"products":{"kind":"text","optional":true},"role":{"default":"supplier","kind":"enum","values":["supplier","customer","both"]}},"record_label":"record.name","search":{"text":["name","aliases"]},"unique":[{"fields":["name"],"import_key":true,"name":"partner_name"}],"was":"supplier"}'::jsonb);

-- step replace:history:schema:drawdown (additive)
select bolt_history_register('drawdown','{"audit":true,"check":{"due_after_start":{"or":[{"start_date":{"is_null":true}},{"due_date":{"is_null":true}},{"due_date":{"gt":{"field":"start_date"}}}]}},"computed":{"amount_usd":{"expr":{"round":[{"times":[{"field":"amount"},{"field":"fx_rate_to_usd"}]},2]},"kind":"decimal","scale":2}},"fields":{"amount":{"kind":"decimal","min":0,"scale":2},"application_date":{"kind":"date","optional":true},"bank_reference":{"kind":"text","optional":true},"bill_number":{"kind":"text","optional":true},"charge_rate_pct":{"kind":"decimal","optional":true,"scale":6},"converted_from":{"inverse":"converted_into","kind":"ref","on_delete":"set_null","optional":true,"to":"drawdown"},"currency":{"default":"USD","kind":"currency"},"day_count_basis":{"default":"actual_360","kind":"enum","values":["actual_360","actual_365"]},"discrepancy_note":{"kind":"text","optional":true,"was":"review_note"},"due_date":{"kind":"date","optional":true},"earliest_invoice_date":{"kind":"date","optional":true},"expected_draw_date":{"kind":"date","optional":true},"facility":{"inverse":"drawdowns","kind":"ref","on_delete":"restrict","optional":true,"to":"facility"},"fx_rate_to_usd":{"default":1,"kind":"decimal","scale":12},"interest_rate_pct":{"kind":"decimal","optional":true,"scale":6},"invoiced_amount":{"kind":"sum","of":"invoices.amount"},"is_archived":{"default":false,"kind":"bool"},"lc_expiry_date":{"kind":"date","optional":true},"lc_number":{"kind":"text","optional":true},"notes":{"kind":"text","optional":true},"product":{"default":"if","kind":"enum","values":["lc","import_bill","da","dp","tb","ba","bad","if","if_after_lc_or_da","pif","twc","oaf","apf","psil","psbl","ofcl","mctf","tradepay","packing","fbep","dbep","ecr","badd","stl","term","efs","lis","tbl","ma","property","bg","sg","awb","sblc","fx","card","cash"]},"purpose":{"kind":"text","optional":true},"rate_source":{"kind":"enum","optional":true,"values":["manual","bank_advice"]},"released_date":{"kind":"date","optional":true},"settled_by":{"kind":"enum","optional":true,"values":["repaid","cash","converted"]},"settled_interest":{"kind":"decimal","optional":true,"scale":2},"settlement_date":{"kind":"date","optional":true},"start_date":{"kind":"date","optional":true},"status":{"default":"active","kind":"enum","values":["earmarked","applied","active","settled","cancelled","unclear"]},"supplier":{"inverse":"drawdowns","kind":"ref","on_delete":"restrict","optional":true,"to":"business_partner"},"terms_days":{"kind":"int","min":0,"optional":true}},"indexes":[{"on":["status","due_date"]}],"locks":{"sealed_line":{"except":["is_archived","discrepancy_note","notes"],"where":{"status":{"in":["settled","cancelled"]}}}},"record_label":"(record.bank_reference != null ? record.bank_reference : string(record.product)) + '' · '' + record.currency + '' '' + string(record.amount)","search":{"text":["bank_reference","lc_number","bill_number"]}}'::jsonb);

-- step replace:history:schema:bank_document (additive)
select bolt_history_register('bank_document','{"audit":true,"fields":{"advice_date":{"kind":"date","optional":true},"advice_reference":{"kind":"text","optional":true},"bank":{"inverse":"documents","kind":"ref","on_delete":"set_null","optional":true,"to":"bank"},"doc_type":{"default":"other","kind":"enum","values":["drawdown_advice","settlement_advice","other"]},"drawdown":{"inverse":"documents","kind":"ref","on_delete":"set_null","optional":true,"to":"drawdown"},"extracted":{"kind":"json","optional":true,"shape":{"fields":{"bank_reference":{"kind":"text","optional":true},"bill_number":{"kind":"text","optional":true},"charges":{"fields":{"amount_usd":{"kind":"decimal","scale":2},"charge_type":{"kind":"enum","values":["commission","cable","swift","cost_of_funds_transfer","processing","tr_extension","penalty","other"]},"description":{"kind":"text","optional":true}},"kind":"object","many":true,"optional":true},"currency":{"kind":"currency","optional":true},"due_date":{"kind":"date","optional":true},"interest_amount":{"kind":"decimal","optional":true,"scale":2},"interest_days":{"kind":"int","optional":true},"interest_rate_pct":{"kind":"decimal","optional":true,"scale":6},"lc_number":{"kind":"text","optional":true},"principal":{"kind":"decimal","optional":true,"scale":2},"product":{"kind":"enum","optional":true,"values":["lc","import_bill","da","dp","tb","ba","bad","if","if_after_lc_or_da","pif","twc","oaf","apf","psil","psbl","ofcl","mctf","tradepay","packing","fbep","dbep","ecr","badd","stl","term","efs","lis","tbl","ma","property","bg","sg","awb","sblc","fx","card","cash"]},"start_date":{"kind":"date","optional":true},"supplier_name":{"kind":"text","optional":true},"total_debited":{"kind":"decimal","optional":true,"scale":2},"uncertain":{"kind":"text","many":true,"optional":true}},"kind":"object"}},"file":{"accept":["application/pdf"],"kind":"file","max":"10MiB"},"read_note":{"kind":"text","optional":true},"read_status":{"default":"uploaded","kind":"enum","values":["uploaded","checked","applied","failed"]}},"locks":{"submitted_advice":{"where":{"read_status":{"eq":"applied"}}}},"record_label":"record.advice_reference != null ? record.advice_reference : ''Advice''"}'::jsonb);

-- step replace:history:schema:facility (additive)
select bolt_history_register('facility','{"audit":true,"fields":{"bank":{"inverse":"facilities","kind":"ref","to":"bank"},"currency":{"default":"USD","kind":"currency"},"day_count_basis":{"default":"actual_360","kind":"enum","values":["actual_360","actual_365"]},"early_settlement_penalty":{"kind":"text","optional":true},"expiry_date":{"kind":"date","optional":true},"interest_rounding":{"default":"nearest_cent","kind":"enum","values":["nearest_cent","down_to_cent"]},"limit":{"default":0,"kind":"decimal","scale":2},"margin_pct":{"kind":"decimal","optional":true,"scale":6},"max_tenor_days":{"kind":"int","min":0,"optional":true},"name":{"kind":"text"},"pricing_basis":{"kind":"text","optional":true},"review_date":{"kind":"date","optional":true},"security":{"kind":"text","optional":true},"status":{"default":"active","kind":"enum","values":["active","expired"]},"tenor_start_rule":{"kind":"enum","optional":true,"values":["invoice_date","disbursement_date","bill_of_lading_date"]}},"record_label":"record.name","unique":[{"fields":["bank","name"],"name":"facility_name_per_bank"}]}'::jsonb);

-- step replace:history:schema:sub_limit (additive)
select bolt_history_register('sub_limit','{"audit":true,"fields":{"facility":{"inverse":"sub_limits","kind":"ref","on_delete":"cascade","to":"facility"},"limit":{"kind":"decimal","scale":2},"name":{"kind":"text"},"product":{"kind":"enum","optional":true,"values":["lc","import_bill","da","dp","tb","ba","bad","if","if_after_lc_or_da","pif","twc","oaf","apf","psil","psbl","ofcl","mctf","tradepay","packing","fbep","dbep","ecr","badd","stl","term","efs","lis","tbl","ma","property","bg","sg","awb","sblc","fx","card","cash"]},"supplier":{"inverse":"sub_limits","kind":"ref","on_delete":"set_null","optional":true,"to":"business_partner"}},"record_label":"record.name"}'::jsonb);

-- step replace:history:schema:fx_rate (additive)
select bolt_history_register('fx_rate','{"audit":true,"fields":{"currency":{"kind":"currency"},"preliminary":{"default":false,"kind":"bool"},"rate_date":{"kind":"date"},"usd_per_unit":{"kind":"decimal","scale":12}},"record_label":"record.currency","unique":[{"fields":["currency","rate_date"],"name":"fx_per_day"}]}'::jsonb);

-- step replace:history:schema:purchase_order (additive)
select bolt_history_register('purchase_order','{"audit":true,"fields":{"amount":{"kind":"sum","of":"lines.amount"},"currency":{"default":"USD","kind":"currency"},"invoice_count":{"kind":"count","of":"invoices"},"invoiced_amount":{"kind":"sum","of":"invoices.amount"},"is_cancelled":{"default":false,"kind":"bool"},"lc_requested":{"default":false,"kind":"bool"},"no_financing":{"default":false,"kind":"bool"},"notes":{"kind":"text","optional":true},"payment_date":{"kind":"date","optional":true},"po_date":{"kind":"date","optional":true},"po_number":{"kind":"text","max":60,"optional":true},"quantity":{"kind":"sum","of":"lines.quantity"},"salesperson":{"kind":"text","optional":true},"ship_to_country":{"kind":"text","optional":true},"supplier":{"inverse":"purchase_orders","kind":"ref","optional":true,"to":"business_partner"}},"record_label":"record.po_number != null ? record.po_number : ''Purchase order''","unique":[{"fields":["po_number"],"name":"po_number"}]}'::jsonb);

-- step replace:history:schema:facility_form (additive)
select bolt_history_register('facility_form','{"audit":true,"fields":{"amount":{"kind":"decimal","optional":true,"scale":2},"buyer":{"kind":"text","optional":true},"currency":{"kind":"currency","optional":true},"customer_po_number":{"kind":"text","optional":true},"documents_presentation_days":{"kind":"int","min":0,"optional":true},"expected_arrival":{"kind":"text","optional":true},"facility_required":{"kind":"enum","optional":true,"values":["tt","lc"]},"freight":{"kind":"text","optional":true},"intended_period_of_sales":{"kind":"text","optional":true},"latest_shipment_date":{"kind":"date","optional":true},"lc_expiry_date":{"kind":"date","optional":true},"partial_shipment":{"default":false,"kind":"bool"},"pay_by_date":{"kind":"date","optional":true},"payment_terms":{"kind":"text","optional":true},"po_date":{"kind":"date","optional":true},"po_number":{"kind":"text","max":60,"optional":true},"product_description":{"kind":"text","optional":true},"projected_sales":{"kind":"text","optional":true},"purchase_order":{"inverse":"facility_forms","kind":"ref","on_delete":"set_null","optional":true,"to":"purchase_order"},"purpose":{"kind":"text","optional":true},"read_note":{"kind":"text","optional":true},"remarks":{"kind":"text","optional":true},"requested_by":{"kind":"text","optional":true},"ship_date":{"kind":"date","optional":true},"shipment_from":{"kind":"text","optional":true},"shipment_to":{"kind":"text","optional":true},"shipping_terms":{"kind":"text","optional":true},"transhipment":{"default":false,"kind":"bool"},"vendor":{"kind":"text","optional":true}},"record_label":"record.po_number != null ? record.po_number : ''Facility form''","search":{"text":["po_number","vendor","customer_po_number"]}}'::jsonb);

-- step replace:history:schema:facility_attachment (additive)
select bolt_history_register('facility_attachment','{"audit":true,"fields":{"file":{"accept":["application/pdf","image/jpeg","image/png"],"kind":"file","max":"10MiB"},"form":{"inverse":"attachments","kind":"ref","on_delete":"cascade","to":"facility_form"},"kind":{"default":"other","kind":"enum","values":["proforma","purchase_order","customer_po","planning_detail","other"]},"title":{"kind":"text","optional":true}},"record_label":"record.title != null ? record.title : string(record.kind)"}'::jsonb);

-- step replace:history:schema:po_document (additive)
select bolt_history_register('po_document','{"audit":true,"fields":{"file":{"accept":["application/pdf","image/jpeg","image/png"],"kind":"file","max":"10MiB"},"kind":{"default":"supporting","kind":"enum","values":["purchase_order","supporting","issued_lc","commercial_invoice","other"]},"po":{"inverse":"documents","kind":"ref","on_delete":"cascade","to":"purchase_order"}},"record_label":"string(record.kind)"}'::jsonb);

-- step replace:history:schema:po_financing (additive)
select bolt_history_register('po_financing','{"audit":true,"fields":{"drawdown":{"inverse":"financings","kind":"ref","on_delete":"cascade","to":"drawdown"},"purchase_order":{"inverse":"financings","kind":"ref","on_delete":"cascade","to":"purchase_order"}},"record_label":"(record.purchase_order.po_number != null ? record.purchase_order.po_number : ''PO'') + '' · '' + (record.drawdown.bank_reference != null ? record.drawdown.bank_reference : string(record.drawdown.product))","unique":[{"fields":["purchase_order","drawdown"],"name":"one_link"}]}'::jsonb);

-- step create:column:fx_rate.preliminary (additive)
-- operational risk: access-exclusive-lock
alter table "fx_rate" add column "preliminary" boolean default false;

-- step create:column:purchase_order.payment_date (additive)
-- operational risk: access-exclusive-lock
alter table "purchase_order" add column "payment_date" date;

-- step create:column:purchase_order.no_financing (additive)
-- operational risk: access-exclusive-lock
alter table "purchase_order" add column "no_financing" boolean default false;

-- step create:history:schema:fx_deal (additive)
select bolt_history_register('fx_deal','{"audit":true,"fields":{"bank":{"inverse":"fx_deals","kind":"ref","on_delete":"set_null","optional":true,"to":"bank"},"bank_reference":{"kind":"text","max":100,"optional":true},"dci_deposit_amount":{"kind":"decimal","optional":true,"scale":2},"dci_deposit_currency":{"kind":"currency","optional":true},"dci_yield_pct":{"kind":"decimal","optional":true,"scale":4},"ended_on":{"kind":"date","optional":true},"forward_reference":{"kind":"decimal","optional":true,"scale":8},"forward_reference_date":{"kind":"date","optional":true},"knock_in":{"kind":"decimal","optional":true,"scale":8},"knock_out":{"kind":"decimal","optional":true,"scale":8},"knock_out_type":{"kind":"enum","optional":true,"values":["at_expiry","continuous"]},"leveraged_notional":{"kind":"decimal","optional":true,"scale":2},"notes":{"kind":"text","optional":true},"notional":{"kind":"decimal","optional":true,"scale":2},"notional_currency":{"kind":"currency","optional":true},"pair":{"kind":"text","max":6},"proposal":{"inverse":"alternatives","kind":"ref","on_delete":"set_null","optional":true,"to":"fx_proposal"},"side":{"kind":"enum","optional":true,"values":["sell","buy"]},"spot_reference":{"kind":"decimal","optional":true,"scale":8},"status":{"default":"draft","kind":"enum","values":["proposal","draft","live"]},"strike":{"kind":"decimal","optional":true,"scale":8},"structure":{"default":"fwd","kind":"enum","values":["fwd","trf","dci","exko","eko","eko_eki","enh","enh_spot","pivot","acc","other"]},"structure_as_written":{"kind":"text","optional":true},"target":{"kind":"decimal","optional":true,"scale":8},"target_rule":{"default":"prorata","kind":"enum","values":["prorata","full","none"]},"terms":{"kind":"text","optional":true},"trade_date":{"kind":"date","optional":true},"view_date":{"kind":"date","optional":true},"view_direction":{"kind":"enum","optional":true,"values":["up","down","flat"]},"view_rate":{"kind":"decimal","optional":true,"scale":8}},"record_label":"(record.bank_reference != null ? record.bank_reference : record.pair) + '' · '' + string(record.structure)","search":{"text":["bank_reference","pair","structure_as_written"]}}'::jsonb);

-- step create:history:schema:fx_document (additive)
select bolt_history_register('fx_document','{"audit":true,"fields":{"bank":{"inverse":"fx_documents","kind":"ref","on_delete":"set_null","optional":true,"to":"bank"},"bank_reference":{"kind":"text","max":100,"optional":true},"deal":{"inverse":"documents","kind":"ref","on_delete":"set_null","optional":true,"to":"fx_deal"},"extracted":{"kind":"json","optional":true,"shape":{"fields":{"bank_code":{"kind":"text","optional":true},"bank_reference":{"kind":"text","optional":true},"dci_deposit_amount":{"kind":"decimal","optional":true,"scale":2},"dci_deposit_currency":{"kind":"currency","optional":true},"dci_yield_pct":{"kind":"decimal","optional":true,"scale":4},"fixings":{"fields":{"condition":{"kind":"text","optional":true},"condition_level":{"kind":"decimal","optional":true,"scale":8},"condition_side":{"kind":"enum","optional":true,"values":["above","below"]},"firm":{"kind":"bool","optional":true},"fixing_date":{"kind":"date"},"leveraged_notional":{"kind":"decimal","optional":true,"scale":2},"notional":{"kind":"decimal","optional":true,"scale":2},"settlement_date":{"kind":"date","optional":true},"strike":{"kind":"decimal","optional":true,"scale":8}},"kind":"object","many":true,"optional":true},"forward_reference":{"kind":"decimal","optional":true,"scale":8},"forward_reference_date":{"kind":"date","optional":true},"kind":{"kind":"enum","optional":true,"values":["term_sheet","confirmation","notice","letter","other"]},"knock_in":{"kind":"decimal","optional":true,"scale":8},"knock_out":{"kind":"decimal","optional":true,"scale":8},"knock_out_type":{"kind":"enum","optional":true,"values":["at_expiry","continuous"]},"leveraged_notional":{"kind":"decimal","optional":true,"scale":2},"notional":{"kind":"decimal","optional":true,"scale":2},"notional_currency":{"kind":"currency","optional":true},"other_references":{"kind":"text","many":true,"optional":true},"pair":{"kind":"text","optional":true},"side":{"kind":"enum","optional":true,"values":["sell","buy"]},"signed":{"kind":"bool","optional":true},"spot_reference":{"kind":"decimal","optional":true,"scale":8},"strike":{"kind":"decimal","optional":true,"scale":8},"structure":{"kind":"enum","optional":true,"values":["fwd","trf","dci","exko","eko","eko_eki","enh","enh_spot","pivot","acc","other"]},"structure_as_written":{"kind":"text","optional":true},"target":{"kind":"decimal","optional":true,"scale":8},"target_rule":{"kind":"enum","optional":true,"values":["prorata","full","none"]},"termination_date":{"kind":"date","optional":true},"terms":{"kind":"text","optional":true},"trade_date":{"kind":"date","optional":true},"uncertain":{"kind":"text","many":true,"optional":true}},"kind":"object"}},"file":{"accept":["application/pdf","image/jpeg","image/png"],"kind":"file","max":"10MiB"},"kind":{"default":"other","kind":"enum","values":["term_sheet","confirmation","notice","letter","other"]},"read_note":{"kind":"text","optional":true},"read_status":{"default":"uploaded","kind":"enum","values":["uploaded","checked","filed","failed"]},"signed":{"kind":"bool","optional":true},"trade_date":{"kind":"date","optional":true}},"record_label":"record.bank_reference != null ? record.bank_reference : string(record.kind)"}'::jsonb);

-- step create:history:schema:fx_fixing (additive)
select bolt_history_register('fx_fixing','{"audit":true,"fields":{"condition":{"kind":"text","optional":true},"condition_level":{"kind":"decimal","optional":true,"scale":8},"condition_side":{"kind":"enum","optional":true,"values":["above","below"]},"deal":{"inverse":"fixings","kind":"ref","on_delete":"cascade","to":"fx_deal"},"firm":{"default":true,"kind":"bool"},"fixing_date":{"kind":"date"},"fixing_rate":{"kind":"decimal","optional":true,"scale":8},"leveraged_notional":{"kind":"decimal","optional":true,"scale":2},"note":{"kind":"text","optional":true},"notional":{"kind":"decimal","optional":true,"scale":2},"outcome":{"kind":"enum","optional":true,"values":["exercised","leveraged","not_exercised","knocked_out","converted","not_converted","ended","target_not_paid"]},"settled_amount":{"kind":"decimal","optional":true,"scale":2},"settlement_date":{"kind":"date","optional":true},"strike":{"kind":"decimal","optional":true,"scale":8}},"indexes":[{"on":["fixing_date"]}],"record_label":"string(record.fixing_date)"}'::jsonb);

-- step create:history:schema:fx_proposal (additive)
select bolt_history_register('fx_proposal','{"audit":true,"fields":{"bank":{"inverse":"fx_proposals","kind":"ref","on_delete":"set_null","optional":true,"to":"bank"},"file":{"accept":["application/pdf","image/jpeg","image/png"],"kind":"file","max":"10MiB","optional":true},"read_note":{"kind":"text","optional":true},"read_status":{"default":"uploaded","kind":"enum","values":["uploaded","checked","failed"]},"text":{"kind":"text","optional":true},"title":{"kind":"text","optional":true}},"record_label":"record.title != null ? record.title : ''Proposal''"}'::jsonb);

-- step create:notNull:fx_rate.preliminary (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "fx_rate" where "preliminary" is null' into n;
	if n > 0 then raise exception 'notNull:fx_rate.preliminary refuses % existing row(s)', n; end if;
end $store$;
alter table "fx_rate" alter column "preliminary" set not null;

-- step create:notNull:purchase_order.no_financing (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "purchase_order" where "no_financing" is null' into n;
	if n > 0 then raise exception 'notNull:purchase_order.no_financing refuses % existing row(s)', n; end if;
end $store$;
alter table "purchase_order" alter column "no_financing" set not null;

-- step create:constraint:drawdown.drawdown__ck__f9667e19 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "drawdown" where (("start_date" is null or "due_date" is null or coalesce("due_date" > "start_date", false))) is false' into n;
	if n > 0 then raise exception 'drawdown__ck__f9667e19 refuses % existing row(s)', n; end if;
end $store$;
alter table "drawdown" add constraint "drawdown__ck__f9667e19" check (("start_date" is null or "due_date" is null or coalesce("due_date" > "start_date", false)));

-- step create:constraint:purchase_order.purchase_order__ck__84e008e6 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "purchase_order" where (isfinite("payment_date")) is false' into n;
	if n > 0 then raise exception 'purchase_order__ck__84e008e6 refuses % existing row(s)', n; end if;
end $store$;
alter table "purchase_order" add constraint "purchase_order__ck__84e008e6" check (isfinite("payment_date"));

-- step create:constraint:purchase_order.purchase_order__uq__63b7d87e (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select coalesce(sum(n - 1), 0)::int as n from (select count(*) as n from "purchase_order" where "po_number" is not null group by "po_number" having count(*) > 1) d' into n;
	if n > 0 then raise exception 'purchase_order__uq__63b7d87e refuses % existing row(s)', n; end if;
end $store$;
alter table "purchase_order" add constraint "purchase_order__uq__63b7d87e" unique ("po_number") deferrable initially immediate;

-- step create:fk:fx_deal.fx_deal__fk__75c13407 (additive)
alter table "fx_deal" add constraint "fx_deal__fk__75c13407" foreign key ("bank") references "bank" ("id") on delete set null on update restrict;

-- step create:fk:fx_deal.fx_deal__fk__8173c259 (additive)
alter table "fx_deal" add constraint "fx_deal__fk__8173c259" foreign key ("proposal") references "fx_proposal" ("id") on delete set null on update restrict;

-- step create:fk:fx_document.fx_document__fk__75c13407 (additive)
alter table "fx_document" add constraint "fx_document__fk__75c13407" foreign key ("bank") references "bank" ("id") on delete set null on update restrict;

-- step create:fk:fx_document.fx_document__fk__052a57e4 (additive)
alter table "fx_document" add constraint "fx_document__fk__052a57e4" foreign key ("deal") references "fx_deal" ("id") on delete set null on update restrict;

-- step create:fk:fx_fixing.fx_fixing__fk__53f2d0c8 (additive)
alter table "fx_fixing" add constraint "fx_fixing__fk__53f2d0c8" foreign key ("deal") references "fx_deal" ("id") on delete cascade on update restrict;

-- step create:fk:fx_proposal.fx_proposal__fk__75c13407 (additive)
alter table "fx_proposal" add constraint "fx_proposal__fk__75c13407" foreign key ("bank") references "bank" ("id") on delete set null on update restrict;

-- step replace:trigger:drawdown.store_statement_rules_update (additive)
create trigger store_statement_rules_update after update on "drawdown" referencing old table as store_old new table as store_new for each statement execute function store_statement_rules('{"fields":{"amount":["amount"],"application_date":["application_date"],"bank_reference":["bank_reference"],"bill_number":["bill_number"],"charge_rate_pct":["charge_rate_pct"],"converted_from":["converted_from"],"currency":["currency"],"day_count_basis":["day_count_basis"],"discrepancy_note":["discrepancy_note"],"due_date":["due_date"],"earliest_invoice_date":["earliest_invoice_date"],"expected_draw_date":["expected_draw_date"],"facility":["facility"],"fx_rate_to_usd":["fx_rate_to_usd"],"interest_rate_pct":["interest_rate_pct"],"is_archived":["is_archived"],"lc_expiry_date":["lc_expiry_date"],"lc_number":["lc_number"],"notes":["notes"],"product":["product"],"purpose":["purpose"],"rate_source":["rate_source"],"released_date":["released_date"],"settled_by":["settled_by"],"settled_interest":["settled_interest"],"settlement_date":["settlement_date"],"start_date":["start_date"],"status":["status"],"supplier":["supplier"],"terms_days":["terms_days"]},"key":["id"],"locks":[{"constraint":"drawdown__lock__e8982d0f","except":["is_archived","discrepancy_note","notes"],"name":"sealed_line","sql":"(coalesce(t.\"status\" = any(array[''settled''::text, ''cancelled''::text]::text[]), false))"}],"parents":[],"states":{}}');

-- step replace:trigger:drawdown.store_statement_rules_delete (additive)
create trigger store_statement_rules_delete after delete on "drawdown" referencing old table as store_old for each statement execute function store_statement_rules('{"fields":{"amount":["amount"],"application_date":["application_date"],"bank_reference":["bank_reference"],"bill_number":["bill_number"],"charge_rate_pct":["charge_rate_pct"],"converted_from":["converted_from"],"currency":["currency"],"day_count_basis":["day_count_basis"],"discrepancy_note":["discrepancy_note"],"due_date":["due_date"],"earliest_invoice_date":["earliest_invoice_date"],"expected_draw_date":["expected_draw_date"],"facility":["facility"],"fx_rate_to_usd":["fx_rate_to_usd"],"interest_rate_pct":["interest_rate_pct"],"is_archived":["is_archived"],"lc_expiry_date":["lc_expiry_date"],"lc_number":["lc_number"],"notes":["notes"],"product":["product"],"purpose":["purpose"],"rate_source":["rate_source"],"released_date":["released_date"],"settled_by":["settled_by"],"settled_interest":["settled_interest"],"settlement_date":["settlement_date"],"start_date":["start_date"],"status":["status"],"supplier":["supplier"],"terms_days":["terms_days"]},"key":["id"],"locks":[{"constraint":"drawdown__lock__e8982d0f","except":["is_archived","discrepancy_note","notes"],"name":"sealed_line","sql":"(coalesce(t.\"status\" = any(array[''settled''::text, ''cancelled''::text]::text[]), false))"}],"parents":[],"states":{}}');

-- step replace:trigger:bank_document.store_statement_rules_update (additive)
create trigger store_statement_rules_update after update on "bank_document" referencing old table as store_old new table as store_new for each statement execute function store_statement_rules('{"fields":{"advice_date":["advice_date"],"advice_reference":["advice_reference"],"bank":["bank"],"doc_type":["doc_type"],"drawdown":["drawdown"],"extracted":["extracted"],"file":["file"],"read_note":["read_note"],"read_status":["read_status"]},"key":["id"],"locks":[{"constraint":"bank_document__lock__ead0a4db","except":[],"name":"submitted_advice","sql":"(coalesce(t.\"read_status\" = ''applied''::text, false))"}],"parents":[],"states":{}}');

-- step replace:trigger:bank_document.store_statement_rules_delete (additive)
create trigger store_statement_rules_delete after delete on "bank_document" referencing old table as store_old for each statement execute function store_statement_rules('{"fields":{"advice_date":["advice_date"],"advice_reference":["advice_reference"],"bank":["bank"],"doc_type":["doc_type"],"drawdown":["drawdown"],"extracted":["extracted"],"file":["file"],"read_note":["read_note"],"read_status":["read_status"]},"key":["id"],"locks":[{"constraint":"bank_document__lock__ead0a4db","except":[],"name":"submitted_advice","sql":"(coalesce(t.\"read_status\" = ''applied''::text, false))"}],"parents":[],"states":{}}');

-- step replace:index:purchase_order.purchase_order__gin__73732636 (additive)
-- operational risk: writes-blocked, table-scan
create index "purchase_order__gin__73732636" on "purchase_order" using gin (bolt_search);

-- step replace:index:facility_form.facility_form__gin__73732636 (additive)
-- operational risk: writes-blocked, table-scan
create index "facility_form__gin__73732636" on "facility_form" using gin (bolt_search);

-- step replace:index:facility_attachment.facility_attachment__gin__73732636 (additive)
-- operational risk: writes-blocked, table-scan
create index "facility_attachment__gin__73732636" on "facility_attachment" using gin (bolt_search);

-- step replace:index:po_document.po_document__gin__73732636 (additive)
-- operational risk: writes-blocked, table-scan
create index "po_document__gin__73732636" on "po_document" using gin (bolt_search);

-- step replace:history:current (additive)
-- operational risk: writes-blocked, table-scan
update bolt_history_current set active=false where active and not (model=any(array['approval_request','bank','bank_document','business_partner','drawdown','drawdown_charge','facility','facility_attachment','facility_fee','facility_form','fx_deal','fx_document','fx_fixing','fx_proposal','fx_rate','invoice','invoice_line','letter_of_offer','month_end','month_end_line','po_document','po_financing','po_line','purchase_order','sub_limit','supplier_bank','sys_api_key','sys_conversation','sys_envoy','sys_file','sys_integration','sys_invitation','sys_user','sys_workspace','watch_point']::text[]));

-- step create:trigger:fx_deal.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "fx_deal" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

-- step create:index:fx_deal.fx_deal__gin__73732636 (additive)
create index "fx_deal__gin__73732636" on "fx_deal" using gin (bolt_search);

-- step create:trigger:fx_document.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "fx_document" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

-- step create:index:fx_document.fx_document__gin__73732636 (additive)
create index "fx_document__gin__73732636" on "fx_document" using gin (bolt_search);

-- step create:trigger:fx_fixing.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "fx_fixing" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

-- step create:index:fx_fixing.fx_fixing__gin__73732636 (additive)
create index "fx_fixing__gin__73732636" on "fx_fixing" using gin (bolt_search);

-- step create:index:fx_fixing.fx_fixing__ix__4b87c59a (additive)
create index "fx_fixing__ix__4b87c59a" on "fx_fixing" ("fixing_date");

-- step create:trigger:fx_proposal.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "fx_proposal" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

-- step create:index:fx_proposal.fx_proposal__gin__73732636 (additive)
create index "fx_proposal__gin__73732636" on "fx_proposal" using gin (bolt_search);

-- step create:index:fx_deal.fx_deal__ix__1d24c71e (additive)
create index "fx_deal__ix__1d24c71e" on "fx_deal" ("bank");

-- step create:index:fx_deal.fx_deal__ix__6a564297 (additive)
create index "fx_deal__ix__6a564297" on "fx_deal" ("proposal");

-- step create:index:fx_document.fx_document__ix__1d24c71e (additive)
create index "fx_document__ix__1d24c71e" on "fx_document" ("bank");

-- step create:index:fx_document.fx_document__ix__8bb249a5 (additive)
create index "fx_document__ix__8bb249a5" on "fx_document" ("deal");

-- step create:index:fx_fixing.fx_fixing__ix__8bb249a5 (additive)
create index "fx_fixing__ix__8bb249a5" on "fx_fixing" ("deal");

-- step create:index:fx_proposal.fx_proposal__ix__1d24c71e (additive)
create index "fx_proposal__ix__1d24c71e" on "fx_proposal" ("bank");

-- step create:engine:audit:fx_deal (additive)
drop trigger if exists bolt_audit_mark on "fx_deal";
drop trigger if exists bolt_audit on "fx_deal";
create trigger bolt_audit after insert or update or delete on "fx_deal" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[]','[["bank","bank"],["proposal","fx_proposal"]]');

-- step create:engine:audit:fx_document (additive)
drop trigger if exists bolt_audit_mark on "fx_document";
drop trigger if exists bolt_audit on "fx_document";
create trigger bolt_audit after insert or update or delete on "fx_document" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[]','[["bank","bank"],["deal","fx_deal"]]');

-- step create:engine:audit:fx_fixing (additive)
drop trigger if exists bolt_audit_mark on "fx_fixing";
drop trigger if exists bolt_audit on "fx_fixing";
create trigger bolt_audit after insert or update or delete on "fx_fixing" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[]','[["deal","fx_deal"]]');

-- step create:engine:audit:fx_proposal (additive)
drop trigger if exists bolt_audit_mark on "fx_proposal";
drop trigger if exists bolt_audit on "fx_proposal";
create trigger bolt_audit after insert or update or delete on "fx_proposal" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[]','[["bank","bank"]]');
