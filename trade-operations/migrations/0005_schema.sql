-- 0005_schema.sql: 99 step(s), from 3733db6bb238223e0ad329b73f24595ec411e028264f865c434feeb0e5034f8e to ae32ae5b177e475ca7d7cc89d0db09c68ab5f448bdd1a7718aebafd25a73036d.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- hazard: DESTRUCTIVE: drops data (a table or a stored column) or rebuilds it; runs only under its accept line.
-- hazard: rename: readers of the old name break; the data stays.
-- hazard: validating: refuses, naming the constraint and the row count, if existing rows break it.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.

-- step drop:trigger:ext_sales_orders.store_row_rules (additive)
drop trigger if exists store_row_rules on "ext_sales_orders";

-- step drop:index:ext_sales_orders.ext_sales_orders__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "ext_sales_orders__gin__73732636";

-- step drop:trigger:order_lines.store_statement_rules_insert (additive)
drop trigger if exists store_statement_rules_insert on "order_lines";

-- step drop:trigger:order_lines.store_statement_rules_update (additive)
drop trigger if exists store_statement_rules_update on "order_lines";

-- step drop:trigger:order_lines.store_statement_rules_delete (additive)
drop trigger if exists store_statement_rules_delete on "order_lines";

-- step drop:trigger:orders.store_statement_rules_update (additive)
drop trigger if exists store_statement_rules_update on "orders";

-- step drop:trigger:orders.store_statement_rules_delete (additive)
drop trigger if exists store_statement_rules_delete on "orders";

-- step drop:index:orders.orders__gin__4b80bd27 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "orders__gin__4b80bd27";

-- step drop:trigger:salesperson_signatures.store_row_rules (additive)
drop trigger if exists store_row_rules on "salesperson_signatures";

-- step drop:index:salesperson_signatures.salesperson_signatures__ix__eb10cfe3 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "salesperson_signatures__ix__eb10cfe3";

-- step drop:index:ext_sales_orders.ext_sales_orders__ix__4d0bb674 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "ext_sales_orders__ix__4d0bb674";

-- step drop:index:ext_sales_orders.ext_sales_orders__ix__7703c55b (additive)
-- operational risk: access-exclusive-lock
drop index if exists "ext_sales_orders__ix__7703c55b";

-- step drop:index:transactions.transactions__ix__0fb25699 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "transactions__ix__0fb25699";

-- step replace:trigger:orders.store_row_rules (additive)
drop trigger if exists store_row_rules on "orders";

-- step drop:fk:ext_sales_orders.ext_sales_orders__fk__b4f64f88 (additive)
-- operational risk: access-exclusive-lock
alter table "ext_sales_orders" drop constraint if exists "ext_sales_orders__fk__b4f64f88";

-- step drop:fk:ext_sales_orders.ext_sales_orders__fk__5ddafbd8 (additive)
-- operational risk: access-exclusive-lock
alter table "ext_sales_orders" drop constraint if exists "ext_sales_orders__fk__5ddafbd8";

-- step drop:fk:salesperson_signatures.salesperson_signatures__fk__6b4b5400 (additive)
-- operational risk: access-exclusive-lock
alter table "salesperson_signatures" drop constraint if exists "salesperson_signatures__fk__6b4b5400";

-- step drop:fk:transactions.transactions__fk__d39d3810 (additive)
-- operational risk: access-exclusive-lock
alter table "transactions" drop constraint if exists "transactions__fk__d39d3810";

-- step drop:constraint:commission_statements.commission_statements__ck__ea649672 (additive)
-- operational risk: access-exclusive-lock
alter table "commission_statements" drop constraint if exists "commission_statements__ck__ea649672";

-- step drop:constraint:ext_sales_orders.ext_sales_orders__ck__7414a4a0 (additive)
-- operational risk: access-exclusive-lock
alter table "ext_sales_orders" drop constraint if exists "ext_sales_orders__ck__7414a4a0";

-- step drop:constraint:ext_sales_orders.ext_sales_orders__ck__dcfa7025 (additive)
-- operational risk: access-exclusive-lock
alter table "ext_sales_orders" drop constraint if exists "ext_sales_orders__ck__dcfa7025";

-- step drop:constraint:ext_sales_orders.ext_sales_orders__ck__838d5561 (additive)
-- operational risk: access-exclusive-lock
alter table "ext_sales_orders" drop constraint if exists "ext_sales_orders__ck__838d5561";

-- step drop:constraint:ext_sales_orders.ext_sales_orders__uq__169e6809 (additive)
-- operational risk: access-exclusive-lock
alter table "ext_sales_orders" drop constraint if exists "ext_sales_orders__uq__169e6809";

-- step drop:constraint:orders.orders__ck__f9848508 (additive)
-- operational risk: access-exclusive-lock
alter table "orders" drop constraint if exists "orders__ck__f9848508";

-- step drop:constraint:orders.orders__ck__858ad0f0 (additive)
-- operational risk: access-exclusive-lock
alter table "orders" drop constraint if exists "orders__ck__858ad0f0";

-- step drop:constraint:orders.orders__ck__45510107 (additive)
-- operational risk: access-exclusive-lock
alter table "orders" drop constraint if exists "orders__ck__45510107";

-- step drop:constraint:orders.orders__ck__08b59b6b (additive)
-- operational risk: access-exclusive-lock
alter table "orders" drop constraint if exists "orders__ck__08b59b6b";

-- step drop:constraint:orders.orders__ck__8027b2e0 (additive)
-- operational risk: access-exclusive-lock
alter table "orders" drop constraint if exists "orders__ck__8027b2e0";

-- step drop:constraint:orders.orders__ck__28efbf3a (additive)
-- operational risk: access-exclusive-lock
alter table "orders" drop constraint if exists "orders__ck__28efbf3a";

-- step drop:constraint:orders.orders__ck__21d50e17 (additive)
-- operational risk: access-exclusive-lock
alter table "orders" drop constraint if exists "orders__ck__21d50e17";

-- step drop:constraint:orders.orders__ck__5949f1fc (additive)
-- operational risk: access-exclusive-lock
alter table "orders" drop constraint if exists "orders__ck__5949f1fc";

-- step drop:constraint:orders.orders__ck__485a75f1 (additive)
-- operational risk: access-exclusive-lock
alter table "orders" drop constraint if exists "orders__ck__485a75f1";

-- step drop:constraint:salesperson_signatures.salesperson_signatures__ck__deacb269 (additive)
-- operational risk: access-exclusive-lock
alter table "salesperson_signatures" drop constraint if exists "salesperson_signatures__ck__deacb269";

-- step drop:notNull:ext_purchase_orders.agreement_hash (additive)
-- operational risk: access-exclusive-lock
alter table "ext_purchase_orders" alter column "agreement_hash" drop not null;

-- step drop:notNull:ext_sales_orders.agreement_hash (additive)
-- operational risk: access-exclusive-lock
alter table "ext_sales_orders" alter column "agreement_hash" drop not null;

-- step drop:notNull:ext_sales_orders.currency (additive)
-- operational risk: access-exclusive-lock
alter table "ext_sales_orders" alter column "currency" drop not null;

-- step drop:notNull:ext_sales_orders.external_id (additive)
-- operational risk: access-exclusive-lock
alter table "ext_sales_orders" alter column "external_id" drop not null;

-- step drop:notNull:ext_sales_orders.reference (additive)
-- operational risk: access-exclusive-lock
alter table "ext_sales_orders" alter column "reference" drop not null;

-- step drop:notNull:ext_sales_orders.status (additive)
-- operational risk: access-exclusive-lock
alter table "ext_sales_orders" alter column "status" drop not null;

-- step drop:notNull:ext_sales_orders.source (additive)
-- operational risk: access-exclusive-lock
alter table "ext_sales_orders" alter column "source" drop not null;

-- step drop:notNull:order_files.seal_hash (additive)
-- operational risk: access-exclusive-lock
alter table "order_files" alter column "seal_hash" drop not null;

-- step drop:notNull:orders.contract_version (additive)
-- operational risk: access-exclusive-lock
alter table "orders" alter column "contract_version" drop not null;

-- step drop:notNull:source_payments.seal_hash (additive)
-- operational risk: access-exclusive-lock
alter table "source_payments" alter column "seal_hash" drop not null;

-- step drop:notNull:transactions.seal_hash (additive)
-- operational risk: access-exclusive-lock
alter table "transactions" alter column "seal_hash" drop not null;

-- step drop:notNull:ext_sales_orders.order (additive)
-- operational risk: access-exclusive-lock
alter table "ext_sales_orders" alter column "order" drop not null;

-- step drop:notNull:salesperson_signatures.owner (additive)
-- operational risk: access-exclusive-lock
alter table "salesperson_signatures" alter column "owner" drop not null;

-- step drop:default:orders.contract_version (additive)
-- operational risk: access-exclusive-lock
alter table "orders" alter column "contract_version" drop default;

-- step create:column:orders.write_target (additive)
-- operational risk: access-exclusive-lock
alter table "orders" add column "write_target" jsonb;

-- step create:column:orders.kingdee (additive)
-- operational risk: access-exclusive-lock
alter table "orders" add column "kingdee" jsonb;

-- step data:orders.contract_versions (data)
-- Each order with contract versions takes its current sealed version's terms and lines as its own, confirmed. The
-- first version names the SO's FUUID anchor and write target; the newest live Kingdee observation is the SO state.
create temporary table trade_current on commit drop as
select o.id as order_id, o.contract_versions as versions, current_version.v, o.contract_versions -> 0 as first_v,
	live.v as live_v
from "orders" o
cross join lateral (
	select e.v from jsonb_array_elements(o.contract_versions) with ordinality e(v, n)
	order by case when e.v ->> 'lifecycle' = 'current' then 0 when e.v ->> 'lifecycle' is null then 1 else 2 end,
		e.n desc
	limit 1
) current_version
left join lateral (
	select e.v from jsonb_array_elements(o.contract_versions) e(v)
	where jsonb_typeof(e.v -> 'kingdee') = 'object' and coalesce((e.v -> 'kingdee' ->> 'archived')::boolean, false) = false
	order by e.v -> 'kingdee' ->> 'source_version' desc
	limit 1
) live on true
where jsonb_typeof(o.contract_versions) = 'array' and jsonb_array_length(o.contract_versions) > 0;

update "orders" o set
	status = 'confirmed',
	warehouse = nullif(c.v -> 'snapshot' ->> 'warehouse', '')::uuid,
	document_template = coalesce(nullif(c.v -> 'snapshot' ->> 'document_template_id', '')::uuid, o.document_template),
	print_values = nullif(c.v -> 'snapshot' -> 'print_values', 'null'::jsonb),
	currency = c.v -> 'snapshot' ->> 'currency',
	tax_inclusive = (c.v -> 'snapshot' ->> 'tax_inclusive')::boolean,
	valid_from = nullif(c.v -> 'snapshot' ->> 'valid_from', '')::date,
	valid_until = nullif(c.v -> 'snapshot' ->> 'valid_until', '')::date,
	payment_terms = c.v -> 'snapshot' ->> 'payment_terms',
	delivery_terms = nullif(c.v -> 'snapshot' ->> 'delivery_terms', ''),
	shipping_terms = nullif(c.v -> 'snapshot' ->> 'shipping_terms', ''),
	place_of_loading = nullif(c.v -> 'snapshot' ->> 'place_of_loading', ''),
	place_of_delivery = nullif(c.v -> 'snapshot' ->> 'place_of_delivery', ''),
	packaging = nullif(c.v -> 'snapshot' ->> 'packaging', ''),
	shipping_mark = nullif(c.v -> 'snapshot' ->> 'shipping_mark', ''),
	time_of_shipment = nullif(c.v -> 'snapshot' ->> 'time_of_shipment', ''),
	other_terms = nullif(c.v -> 'snapshot' ->> 'other_terms', ''),
	payment_method = nullif(c.v -> 'snapshot' ->> 'payment_method', ''),
	buyer_contact = nullif(c.v -> 'snapshot' ->> 'buyer_contact', ''),
	buyer_mobile = nullif(c.v -> 'snapshot' ->> 'buyer_mobile', ''),
	delivery_address = nullif(c.v -> 'snapshot' ->> 'delivery_address', ''),
	delivery_date = nullif(c.v -> 'snapshot' ->> 'delivery_date', '')::date,
	party_name = c.v -> 'snapshot' ->> 'party_name',
	ordered_on = (c.v ->> 'ordered_on')::date,
	freight_treatment = c.v ->> 'freight_treatment',
	supporting_documents = coalesce(nullif(c.v -> 'supporting_documents', 'null'::jsonb), o.supporting_documents),
	source_order_key = c.first_v ->> 'seal_hash',
	write_target = nullif(c.first_v -> 'write_target', 'null'::jsonb),
	kingdee = case when c.live_v is null then null else jsonb_build_object(
		'fid', c.live_v -> 'kingdee' ->> 'live_source_id',
		'reference', o.number,
		'version', c.live_v -> 'kingdee' ->> 'source_version',
		'status', coalesce(c.live_v -> 'kingdee' ->> 'status', 'draft'),
		'closed', coalesce((c.live_v -> 'kingdee' ->> 'closed')::boolean, false),
		'exchange_rate', coalesce(c.live_v -> 'kingdee' ->> 'exchange_rate', '1')
	) end
from trade_current c
where o.id = c.order_id;

create temporary table trade_lines on commit drop as
select c.order_id, c.v -> 'snapshot' ->> 'currency' as currency, l.v as line, l.v ->> 'id' as id,
	coalesce(nullif(l.v ->> 'source_entry_id', ''), (
		select m.e ->> 'entry_id'
		from jsonb_array_elements(c.versions) w(v)
		cross join lateral jsonb_array_elements(coalesce(w.v -> 'kingdee' -> 'entries', '[]'::jsonb)) m(e)
		where m.e ->> 'local_line_id' = l.v ->> 'id'
		limit 1
	)) as entry
from trade_current c
cross join lateral jsonb_array_elements(c.v -> 'snapshot' -> 'lines') l(v);

delete from "order_lines" ol
using trade_current c
where ol."order" = c.order_id
	and not exists (select 1 from trade_lines t where t.order_id = c.order_id and t.id = ol.id::text);

update "order_lines" ol set
	product = coalesce(nullif(t.line ->> 'product', '')::uuid, ol.product),
	product_code = t.line ->> 'product_code',
	product_name = t.line ->> 'product_name',
	product_spec = nullif(t.line ->> 'product_spec', ''),
	print_values = nullif(t.line -> 'print_values', 'null'::jsonb),
	unit = t.line ->> 'unit',
	currency = t.currency,
	quantity = (t.line ->> 'quantity')::numeric,
	unit_price = (t.line ->> 'unit_price')::numeric,
	discount_pct = (t.line ->> 'discount_pct')::numeric,
	tax_rate = (t.line ->> 'tax_rate')::numeric,
	net = (t.line ->> 'net')::numeric,
	tax = (t.line ->> 'tax')::numeric,
	total = (t.line ->> 'total')::numeric,
	floor_net = nullif(t.line ->> 'floor_net', '')::numeric,
	commission_factor = nullif(t.line ->> 'commission_factor', '')::numeric,
	commission_basis_unit = nullif(t.line ->> 'commission_basis_unit', ''),
	source_entry_id = t.entry
from trade_lines t
where ol.id::text = t.id and ol."order" = t.order_id;

insert into "order_lines" (id, "order", line_key, product, product_code, product_name, product_spec, print_values,
	unit, currency, quantity, unit_price, discount_pct, tax_rate, net, tax, total, floor_net, commission_factor,
	commission_basis_unit, source_entry_id)
select t.id::uuid, t.order_id, t.id, (t.line ->> 'product')::uuid, t.line ->> 'product_code', t.line ->> 'product_name',
	nullif(t.line ->> 'product_spec', ''), nullif(t.line -> 'print_values', 'null'::jsonb), t.line ->> 'unit', t.currency,
	(t.line ->> 'quantity')::numeric, (t.line ->> 'unit_price')::numeric, (t.line ->> 'discount_pct')::numeric,
	(t.line ->> 'tax_rate')::numeric, (t.line ->> 'net')::numeric, (t.line ->> 'tax')::numeric,
	(t.line ->> 'total')::numeric, nullif(t.line ->> 'floor_net', '')::numeric,
	nullif(t.line ->> 'commission_factor', '')::numeric, nullif(t.line ->> 'commission_basis_unit', ''), t.entry
from trade_lines t
where nullif(t.line ->> 'product', '') is not null
	and not exists (select 1 from "order_lines" ol where ol.id::text = t.id);

update "orders" o set
	net = coalesce(totals.net, 0),
	tax = coalesce(totals.tax, 0),
	total = coalesce(totals.total, 0),
	line_count = coalesce(totals.lines, 0)
from trade_current c
left join lateral (
	select sum(ol.net) as net, sum(ol.tax) as tax, sum(ol.total) as total, count(*)::int as lines
	from "order_lines" ol where ol."order" = c.order_id
) totals on true
where o.id = c.order_id;

-- step drop:column:ext_purchase_orders.agreement_hash (destructive)
-- accept: drop:column:ext_purchase_orders.agreement_hash
-- operational risk: access-exclusive-lock
alter table "ext_purchase_orders" drop column if exists "agreement_hash" cascade;

-- step drop:column:ext_sales_orders.agreement_hash (destructive)
-- accept: drop:column:ext_sales_orders.agreement_hash
-- operational risk: access-exclusive-lock
alter table "ext_sales_orders" drop column if exists "agreement_hash" cascade;

-- step drop:column:ext_sales_orders.currency (destructive)
-- accept: drop:column:ext_sales_orders.currency
-- operational risk: access-exclusive-lock
alter table "ext_sales_orders" drop column if exists "currency" cascade;

-- step drop:column:ext_sales_orders.external_id (destructive)
-- accept: drop:column:ext_sales_orders.external_id
-- operational risk: access-exclusive-lock
alter table "ext_sales_orders" drop column if exists "external_id" cascade;

-- step drop:column:ext_sales_orders.reference (destructive)
-- accept: drop:column:ext_sales_orders.reference
-- operational risk: access-exclusive-lock
alter table "ext_sales_orders" drop column if exists "reference" cascade;

-- step drop:column:ext_sales_orders.source_updated_at (destructive)
-- accept: drop:column:ext_sales_orders.source_updated_at
-- operational risk: access-exclusive-lock
alter table "ext_sales_orders" drop column if exists "source_updated_at" cascade;

-- step drop:column:ext_sales_orders.status (destructive)
-- accept: drop:column:ext_sales_orders.status
-- operational risk: access-exclusive-lock
alter table "ext_sales_orders" drop column if exists "status" cascade;

-- step drop:column:ext_sales_orders.bolt_record_label (additive)
-- operational risk: access-exclusive-lock
alter table "ext_sales_orders" drop column if exists "bolt_record_label" cascade;

-- step drop:column:ext_sales_orders.bolt_search (additive)
-- operational risk: access-exclusive-lock
alter table "ext_sales_orders" drop column if exists bolt_search cascade;

-- step drop:column:order_files.seal_hash (destructive)
-- accept: drop:column:order_files.seal_hash
-- operational risk: access-exclusive-lock
alter table "order_files" drop column if exists "seal_hash" cascade;

-- step drop:column:orders.agreed_total (destructive)
-- accept: drop:column:orders.agreed_total
-- operational risk: access-exclusive-lock
alter table "orders" drop column if exists "agreed_total" cascade;

-- step drop:column:orders.closure_snapshot (destructive)
-- accept: drop:column:orders.closure_snapshot
-- operational risk: access-exclusive-lock
alter table "orders" drop column if exists "closure_snapshot" cascade;

-- step drop:column:orders.contract_version (destructive)
-- accept: drop:column:orders.contract_version
-- operational risk: access-exclusive-lock
alter table "orders" drop column if exists "contract_version" cascade;

-- step drop:column:orders.contract_versions (destructive)
-- accept: drop:column:orders.contract_versions
-- operational risk: access-exclusive-lock
alter table "orders" drop column if exists "contract_versions" cascade;

-- step drop:column:orders.draft_basis (destructive)
-- accept: drop:column:orders.draft_basis
-- operational risk: access-exclusive-lock
alter table "orders" drop column if exists "draft_basis" cascade;

-- step drop:column:orders.draft_document_ids (destructive)
-- accept: drop:column:orders.draft_document_ids
-- operational risk: access-exclusive-lock
alter table "orders" drop column if exists "draft_document_ids" cascade;

-- step drop:column:orders.draft_setup (destructive)
-- accept: drop:column:orders.draft_setup
-- operational risk: access-exclusive-lock
alter table "orders" drop column if exists "draft_setup" cascade;

-- step drop:column:orders.operational_contracts (destructive)
-- accept: drop:column:orders.operational_contracts
-- operational risk: access-exclusive-lock
alter table "orders" drop column if exists "operational_contracts" cascade;

-- step drop:column:orders.seal_hash (destructive)
-- accept: drop:column:orders.seal_hash
-- operational risk: access-exclusive-lock
alter table "orders" drop column if exists "seal_hash" cascade;

-- step drop:column:orders.sealed_at (destructive)
-- accept: drop:column:orders.sealed_at
-- operational risk: access-exclusive-lock
alter table "orders" drop column if exists "sealed_at" cascade;

-- step drop:column:orders.sealed_by (destructive)
-- accept: drop:column:orders.sealed_by
-- operational risk: access-exclusive-lock
alter table "orders" drop column if exists "sealed_by" cascade;

-- step drop:column:orders.sealed_contract (destructive)
-- accept: drop:column:orders.sealed_contract
-- operational risk: access-exclusive-lock
alter table "orders" drop column if exists "sealed_contract" cascade;

-- step drop:column:orders.sealed_contract_version (destructive)
-- accept: drop:column:orders.sealed_contract_version
-- operational risk: access-exclusive-lock
alter table "orders" drop column if exists "sealed_contract_version" cascade;

-- step drop:column:orders.sealed_snapshot (destructive)
-- accept: drop:column:orders.sealed_snapshot
-- operational risk: access-exclusive-lock
alter table "orders" drop column if exists "sealed_snapshot" cascade;

-- step drop:column:salesperson_signatures.signature (destructive)
-- accept: drop:column:salesperson_signatures.signature
-- operational risk: access-exclusive-lock
alter table "salesperson_signatures" drop column if exists "signature" cascade;

-- step drop:column:source_payments.seal_hash (destructive)
-- accept: drop:column:source_payments.seal_hash
-- operational risk: access-exclusive-lock
alter table "source_payments" drop column if exists "seal_hash" cascade;

-- step drop:column:source_sales_lines.seal_hash (destructive)
-- accept: drop:column:source_sales_lines.seal_hash
-- operational risk: access-exclusive-lock
alter table "source_sales_lines" drop column if exists "seal_hash" cascade;

-- step drop:column:transactions.seal_hash (destructive)
-- accept: drop:column:transactions.seal_hash
-- operational risk: access-exclusive-lock
alter table "transactions" drop column if exists "seal_hash" cascade;

-- step drop:column:ext_sales_orders.order (destructive)
-- accept: drop:column:ext_sales_orders.order
-- operational risk: access-exclusive-lock
alter table "ext_sales_orders" drop column if exists "order" cascade;

-- step drop:column:ext_sales_orders.source (destructive)
-- accept: drop:column:ext_sales_orders.source
-- operational risk: access-exclusive-lock
alter table "ext_sales_orders" drop column if exists "source" cascade;

-- step drop:column:salesperson_signatures.owner (destructive)
-- accept: drop:column:salesperson_signatures.owner
-- operational risk: access-exclusive-lock
alter table "salesperson_signatures" drop column if exists "owner" cascade;

-- step drop:column:transactions.ext_sales_order (destructive)
-- accept: drop:column:transactions.ext_sales_order
-- operational risk: access-exclusive-lock
alter table "transactions" drop column if exists "ext_sales_order" cascade;

-- step drop:table:ext_sales_orders (destructive)
-- accept: drop:table:ext_sales_orders
-- operational risk: access-exclusive-lock
drop table if exists "ext_sales_orders" cascade;

-- step drop:table:salesperson_signatures (destructive)
-- accept: drop:table:salesperson_signatures
-- operational risk: access-exclusive-lock
drop table if exists "salesperson_signatures" cascade;

-- step drop:function:bolt_record_label_ext_sales_orders_813c0aa8 (additive)
drop function if exists "bolt_record_label_ext_sales_orders_813c0aa8"(text) cascade;

-- step rename:orders.sealed_commission->commission (rename)
-- operational risk: access-exclusive-lock
alter table "orders" rename column "sealed_commission" to "commission";

-- step replace:history:schema:commission_statements (additive)
select bolt_history_register('commission_statements','{"audit":true,"fields":{"acknowledged_at":{"kind":"instant"},"acknowledged_by":{"default":{"var":"requestor.id"},"kind":"ref","to":"sys_user"},"amount":{"currency":"currency","kind":"money"},"calculation_hash":{"hidden":true,"kind":"text"},"currency":{"kind":"currency"},"number":{"kind":"seq","pattern":"CS-{yyyy}-{0000}"},"order_count":{"kind":"int"},"owner":{"kind":"ref","to":"sys_user"},"period":{"kind":"date"},"snapshot":{"hidden":true,"kind":"json","shape":{"fields":{"amount":{"kind":"text","optional":true},"awaiting_approval":{"kind":"bool"},"calculation_hash":{"kind":"text"},"number":{"kind":"text"},"order":{"kind":"text"},"unresolved_lines":{"kind":"int"}},"kind":"object","many":true}}},"record_label":"record.number","unique":[{"fields":["owner","period","currency","calculation_hash"],"name":"one_monthly_commission_statement"}]}'::jsonb);

-- step replace:history:schema:orders (additive)
select bolt_history_register('orders','{"audit":true,"fields":{"archived":{"default":false,"kind":"bool"},"buyer_contact":{"kind":"text","optional":true},"buyer_mobile":{"format":"phone","kind":"text","optional":true},"check_hash":{"hidden":true,"kind":"text","optional":true},"commission":{"hidden":true,"kind":"json","optional":true,"shape":{"fields":{"amount_expression":{"kind":"text","optional":true},"basis_unit":{"kind":"text"},"currency":{"kind":"text"},"effective_on":{"kind":"text"},"eligibility_expression":{"kind":"text","optional":true},"engine_version":{"kind":"text","optional":true},"fixed_rate":{"kind":"text"},"parameters":{"fields":{"name":{"kind":"text"},"value":{"kind":"text"}},"kind":"object","many":true,"optional":true},"rule_id":{"kind":"text"},"spread_pct":{"kind":"text"}},"kind":"object"},"was":"sealed_commission"},"currency":{"kind":"currency"},"delivery_address":{"kind":"text","optional":true},"delivery_date":{"kind":"date","optional":true},"delivery_terms":{"kind":"text","optional":true},"direction":{"kind":"enum","values":["sales","purchasing"]},"document_template":{"kind":"ref","optional":true,"to":"document_templates","where":{"status":{"eq":"published"}}},"freight_treatment":{"default":"deduct","kind":"enum","values":["deduct","include"]},"kingdee":{"hidden":true,"kind":"json","optional":true,"shape":{"fields":{"closed":{"kind":"bool"},"exchange_rate":{"kind":"text"},"fid":{"kind":"text"},"reference":{"kind":"text"},"status":{"kind":"enum","values":["draft","issued","void"]},"version":{"kind":"text"}},"kind":"object"}},"ledger":{"kind":"ref","to":"sys_integration","where":{"integration":{"eq":"kingdee"}}},"line_count":{"kind":"count","of":"lines"},"logistics_handler":{"kind":"ref","optional":true,"to":"sys_user"},"net":{"kind":"sum","of":"lines.net"},"notes":{"kind":"text","optional":true},"number":{"kind":"seq","pattern":"TR-{yyyy}-{0000}"},"ordered_on":{"default":{"var":"today"},"kind":"date"},"other_terms":{"kind":"text","optional":true},"owner":{"default":{"var":"requestor.id"},"kind":"ref","to":"sys_user"},"packaging":{"kind":"text","optional":true},"party":{"inverse":"orders","kind":"ref","to":"parties"},"party_name":{"kind":"text","optional":true},"payment_method":{"kind":"text","optional":true},"payment_terms":{"kind":"text"},"place_of_delivery":{"kind":"text","optional":true},"place_of_loading":{"kind":"text","optional":true},"print_values":{"fields":{"key":{"kind":"text"},"value":{"kind":"text"}},"kind":"object","many":true,"optional":true},"shipping_mark":{"kind":"text","optional":true},"shipping_terms":{"kind":"text","optional":true},"source_order_key":{"hidden":true,"kind":"text","optional":true},"status":{"initial":"draft","kind":"state","states":{"confirmed":{},"draft":{"to":["confirmed"]}}},"supporting_documents":{"accept":["application/pdf","image/jpeg","image/png","application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],"kind":"file","many":true,"max":"20MiB","optional":true},"tax":{"kind":"sum","of":"lines.tax"},"tax_inclusive":{"default":false,"kind":"bool"},"time_of_shipment":{"kind":"text","optional":true},"title":{"kind":"text"},"total":{"kind":"sum","of":"lines.total"},"valid_from":{"kind":"date","optional":true},"valid_until":{"kind":"date","optional":true},"warehouse":{"kind":"ref","optional":true,"to":"warehouses"},"write_target":{"hidden":true,"kind":"json","optional":true,"shape":{"fields":{"account":{"kind":"text"},"branch":{"kind":"text"}},"kind":"object"}}},"record_label":"record.number","search":{"text":["number","title","party_name"]},"unique":[{"fields":["source_order_key"],"import_key":true,"name":"natural_key"}]}'::jsonb);

-- step replace:history:schema:ext_purchase_orders (additive)
select bolt_history_register('ext_purchase_orders','{"audit":true,"fields":{"currency":{"kind":"currency"},"external_id":{"hidden":true,"kind":"text"},"order":{"inverse":"ext_purchase_orders","kind":"ref","to":"orders"},"reference":{"kind":"text"},"source":{"kind":"ref","to":"sys_integration","where":{"integration":{"eq":"kingdee"}}},"source_updated_at":{"kind":"instant","optional":true},"status":{"kind":"enum","values":["draft","issued","void"]}},"record_label":"record.reference","unique":[{"fields":["source","external_id"],"import_key":true,"name":"natural_key"}]}'::jsonb);

-- step replace:history:schema:order_files (additive)
select bolt_history_register('order_files','{"audit":true,"fields":{"file":{"accept":["application/pdf","image/jpeg","image/png"],"kind":"file","max":"20MiB"},"order":{"inverse":"filed_documents","kind":"ref","to":"orders"},"title":{"kind":"text"}},"record_label":"record.title"}'::jsonb);

-- step replace:history:schema:source_payments (additive)
select bolt_history_register('source_payments','{"audit":true,"fields":{"active":{"default":true,"kind":"bool"},"amount":{"currency":"currency","kind":"money"},"currency":{"kind":"currency"},"external_code":{"kind":"text"},"invoice":{"kind":"ref","optional":true,"to":"transactions"},"kind":{"kind":"enum","values":["receipt","refund"]},"order":{"inverse":"source_payments","kind":"ref","to":"orders"},"reference":{"kind":"text"},"settled_on":{"kind":"date"},"source":{"kind":"ref","to":"sys_integration","where":{"integration":{"eq":"kingdee"}}},"source_updated_at":{"kind":"instant"}},"record_label":"record.reference","unique":[{"fields":["source","external_code"],"import_key":true,"name":"natural_key"},{"fields":["order","reference"],"name":"one_source_receipt_per_order"}]}'::jsonb);

-- step replace:history:schema:source_sales_lines (additive)
select bolt_history_register('source_sales_lines','{"audit":true,"fields":{"active":{"default":true,"kind":"bool"},"booked_cost":{"kind":"decimal","optional":true,"scale":10},"booked_cost_currency":{"kind":"currency","optional":true},"business_on":{"kind":"date"},"currency":{"kind":"currency"},"external_code":{"kind":"text"},"freight":{"currency":"currency","kind":"money","optional":true},"kind":{"kind":"enum","values":["shipment","return","invoice_only","invoice"]},"lot_number":{"kind":"text","optional":true},"net_amount":{"currency":"currency","kind":"money","optional":true},"order":{"inverse":"source_sales_lines","kind":"ref","optional":true,"to":"orders"},"order_line":{"hidden":true,"kind":"text","optional":true},"quantity":{"kind":"decimal","scale":3},"reference":{"kind":"text"},"source":{"kind":"ref","to":"sys_integration","where":{"integration":{"eq":"kingdee"}}},"source_dimensions":{"hidden":true,"kind":"json","optional":true,"shape":{"fields":{"customer":{"kind":"text","optional":true},"employee":{"kind":"text","optional":true},"employee_id":{"kind":"text","optional":true},"product":{"kind":"text","optional":true}},"kind":"object"}},"source_updated_at":{"kind":"instant"},"tax_amount":{"currency":"currency","kind":"money","optional":true},"unit":{"kind":"text"},"unit_cost":{"kind":"decimal","optional":true,"scale":8}},"record_label":"record.reference","unique":[{"fields":["source","external_code"],"import_key":true,"name":"natural_key"}]}'::jsonb);

-- step replace:history:schema:transactions (additive)
select bolt_history_register('transactions','{"audit":true,"fields":{"currency":{"kind":"currency"},"documents":{"kind":"json","optional":true,"shape":{"fields":{"name":{"kind":"text"},"sha256":{"kind":"text"},"url":{"kind":"text"}},"kind":"object","many":true}},"due_on":{"kind":"date","optional":true},"erp_id":{"hidden":true,"kind":"text"},"ext_purchase_order":{"inverse":"transactions","kind":"ref","optional":true,"to":"ext_purchase_orders"},"issued_on":{"kind":"date","optional":true},"items":{"kind":"json","optional":true,"shape":{"fields":{"lot_number":{"kind":"text","optional":true},"net_amount":{"kind":"decimal","optional":true,"scale":8},"order_line_id":{"kind":"text"},"product_name":{"kind":"text"},"quantity":{"kind":"decimal","scale":3},"unit":{"kind":"text"},"unit_cost":{"kind":"decimal","optional":true,"scale":8},"unit_price":{"kind":"decimal","optional":true,"scale":4}},"kind":"object","many":true}},"kind":{"kind":"enum","values":["invoice","delivery"]},"order":{"inverse":"transactions","kind":"ref","to":"orders"},"reference":{"kind":"text"},"source":{"kind":"ref","to":"sys_integration","where":{"integration":{"eq":"kingdee"}}},"source_updated_at":{"kind":"instant","optional":true},"status":{"default":"issued","kind":"enum","values":["issued","void"]},"total":{"currency":"currency","kind":"money","optional":true}},"record_label":"record.reference","search":{"text":["reference","kind"]},"unique":[{"fields":["source","erp_id"],"import_key":true,"name":"natural_key"}]}'::jsonb);

-- step data:commission_statements.snapshot (data)
-- hazard: the shape of commission_statements.snapshot changed; rows written under the old shape may not decode under the new one.
-- Transform them here (an UPDATE over commission_statements); the check below counts the rows the new shape still refuses.
update "commission_statements" set "snapshot" = (
	select coalesce(jsonb_agg(e.v - 'seal_hash' order by e.n), '[]'::jsonb)
	from jsonb_array_elements("snapshot") with ordinality e(v, n)
)
where jsonb_typeof("snapshot") = 'array';
-- step check:commission_statements.snapshot (validating)
do $store$ declare n bigint; begin
	execute 'select count(*) from "commission_statements" where "snapshot" is null or store_json_valid("snapshot", ''{"hidden":true,"kind":"json","shape":{"fields":{"amount":{"kind":"text","optional":true},"awaiting_approval":{"kind":"bool"},"calculation_hash":{"kind":"text"},"number":{"kind":"text"},"order":{"kind":"text"},"unresolved_lines":{"kind":"int"}},"kind":"object","many":true}}''::jsonb) is not true' into n;
	if n > 0 then raise exception 'the shape of commission_statements.snapshot refuses % existing row(s)', n; end if;
end $store$;

-- step data:orders.commission (data)
-- hazard: the shape of orders.commission changed; rows written under the old shape may not decode under the new one.
-- Transform them here (an UPDATE over orders); the check below counts the rows the new shape still refuses.
-- step check:orders.commission (validating)
do $store$ declare n bigint; begin
	execute 'select count(*) from "orders" where "commission" is not null and store_json_valid("commission", ''{"hidden":true,"kind":"json","optional":true,"shape":{"fields":{"amount_expression":{"kind":"text","optional":true},"basis_unit":{"kind":"text"},"currency":{"kind":"text"},"effective_on":{"kind":"text"},"eligibility_expression":{"kind":"text","optional":true},"engine_version":{"kind":"text","optional":true},"fixed_rate":{"kind":"text"},"parameters":{"fields":{"name":{"kind":"text"},"value":{"kind":"text"}},"kind":"object","many":true,"optional":true},"rule_id":{"kind":"text"},"spread_pct":{"kind":"text"}},"kind":"object"},"was":"sealed_commission"}''::jsonb) is not true' into n;
	if n > 0 then raise exception 'the shape of orders.commission refuses % existing row(s)', n; end if;
end $store$;

-- step create:constraint:commission_statements.commission_statements__ck__568c0e59 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "commission_statements" where (("snapshot" is null or store_json_valid("snapshot", ''{"hidden":true,"kind":"json","shape":{"fields":{"amount":{"kind":"text","optional":true},"awaiting_approval":{"kind":"bool"},"calculation_hash":{"kind":"text"},"number":{"kind":"text"},"order":{"kind":"text"},"unresolved_lines":{"kind":"int"}},"kind":"object","many":true}}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'commission_statements__ck__568c0e59 refuses % existing row(s)', n; end if;
end $store$;
alter table "commission_statements" add constraint "commission_statements__ck__568c0e59" check (("snapshot" is null or store_json_valid("snapshot", '{"hidden":true,"kind":"json","shape":{"fields":{"amount":{"kind":"text","optional":true},"awaiting_approval":{"kind":"bool"},"calculation_hash":{"kind":"text"},"number":{"kind":"text"},"order":{"kind":"text"},"unresolved_lines":{"kind":"int"}},"kind":"object","many":true}}'::jsonb) is true));

-- step create:constraint:orders.orders__ck__e6773c01 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "orders" where (("commission" is null or store_json_valid("commission", ''{"hidden":true,"kind":"json","optional":true,"shape":{"fields":{"amount_expression":{"kind":"text","optional":true},"basis_unit":{"kind":"text"},"currency":{"kind":"text"},"effective_on":{"kind":"text"},"eligibility_expression":{"kind":"text","optional":true},"engine_version":{"kind":"text","optional":true},"fixed_rate":{"kind":"text"},"parameters":{"fields":{"name":{"kind":"text"},"value":{"kind":"text"}},"kind":"object","many":true,"optional":true},"rule_id":{"kind":"text"},"spread_pct":{"kind":"text"}},"kind":"object"},"was":"sealed_commission"}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'orders__ck__e6773c01 refuses % existing row(s)', n; end if;
end $store$;
alter table "orders" add constraint "orders__ck__e6773c01" check (("commission" is null or store_json_valid("commission", '{"hidden":true,"kind":"json","optional":true,"shape":{"fields":{"amount_expression":{"kind":"text","optional":true},"basis_unit":{"kind":"text"},"currency":{"kind":"text"},"effective_on":{"kind":"text"},"eligibility_expression":{"kind":"text","optional":true},"engine_version":{"kind":"text","optional":true},"fixed_rate":{"kind":"text"},"parameters":{"fields":{"name":{"kind":"text"},"value":{"kind":"text"}},"kind":"object","many":true,"optional":true},"rule_id":{"kind":"text"},"spread_pct":{"kind":"text"}},"kind":"object"},"was":"sealed_commission"}'::jsonb) is true));

-- step create:constraint:orders.orders__ck__d519ebfe (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "orders" where (("write_target" is null or store_json_valid("write_target", ''{"hidden":true,"kind":"json","optional":true,"shape":{"fields":{"account":{"kind":"text"},"branch":{"kind":"text"}},"kind":"object"}}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'orders__ck__d519ebfe refuses % existing row(s)', n; end if;
end $store$;
alter table "orders" add constraint "orders__ck__d519ebfe" check (("write_target" is null or store_json_valid("write_target", '{"hidden":true,"kind":"json","optional":true,"shape":{"fields":{"account":{"kind":"text"},"branch":{"kind":"text"}},"kind":"object"}}'::jsonb) is true));

-- step create:constraint:orders.orders__ck__85e70bbb (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "orders" where (("kingdee" is null or store_json_valid("kingdee", ''{"hidden":true,"kind":"json","optional":true,"shape":{"fields":{"closed":{"kind":"bool"},"exchange_rate":{"kind":"text"},"fid":{"kind":"text"},"reference":{"kind":"text"},"status":{"kind":"enum","values":["draft","issued","void"]},"version":{"kind":"text"}},"kind":"object"}}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'orders__ck__85e70bbb refuses % existing row(s)', n; end if;
end $store$;
alter table "orders" add constraint "orders__ck__85e70bbb" check (("kingdee" is null or store_json_valid("kingdee", '{"hidden":true,"kind":"json","optional":true,"shape":{"fields":{"closed":{"kind":"bool"},"exchange_rate":{"kind":"text"},"fid":{"kind":"text"},"reference":{"kind":"text"},"status":{"kind":"enum","values":["draft","issued","void"]},"version":{"kind":"text"}},"kind":"object"}}'::jsonb) is true));

-- step replace:trigger:orders.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "orders" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{"status":{"initial":"draft","states":{"confirmed":{},"draft":{"to":["confirmed"]}}}}}');

-- step replace:history:current (additive)
-- operational risk: writes-blocked, table-scan
update bolt_history_current set active=false where active and not (model=any(array['activities','approval_request','commercial_settings','commission_rules','commission_statements','contacts','credit_snapshots','document_templates','ext_purchase_orders','order_files','order_lines','orders','parties','pricing_floors','products','source_lot_costs','source_payments','source_receivables','source_sales_lines','source_stock_commitments','stock_snapshots','sys_api_key','sys_conversation','sys_envoy','sys_file','sys_integration','sys_invitation','sys_user','transactions','warehouses']::text[]));

-- step replace:engine:audit:transactions (additive)
drop trigger if exists bolt_audit_mark on "transactions";
drop trigger if exists bolt_audit on "transactions";
create trigger bolt_audit after insert or update or delete on "transactions" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[]','[["ext_purchase_order","ext_purchase_orders"],["order","orders"],["source","sys_integration"]]');
