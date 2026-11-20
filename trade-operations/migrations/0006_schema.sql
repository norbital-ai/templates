-- 0006_schema.sql: 12 step(s), from a7e7089fab1289a8dde5690c7f2a63ac623243a7c9ca9404a03aa7763367ad87 to d21a916f0b9cd48f9dcdd1b6445e55175d4a672370b9c2128702da8e2b04bafd.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- hazard: DESTRUCTIVE: drops data (a table or a stored column) or rebuilds it; runs only under its accept line.
-- hazard: validating: refuses, naming the constraint and the row count, if existing rows break it.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.

-- step drop:constraint:orders.orders__ck__0c5580b8 (additive)
-- operational risk: access-exclusive-lock
alter table "orders" drop constraint if exists "orders__ck__0c5580b8";

-- step drop:constraint:orders.orders__ck__42a82693 (additive)
-- operational risk: access-exclusive-lock
alter table "orders" drop constraint if exists "orders__ck__42a82693";

-- step create:column:orders.trade (additive)
-- operational risk: access-exclusive-lock
alter table "orders" add column "trade" jsonb default '{"kind":"domestic"}'::jsonb;

-- A warehouse name alone was filled automatically. Keep every other shipping term
-- in the foreign arm. The model holds shipment dates inclusively; daterange does not.
update orders o set trade = case
	when shipping_terms is not null or shipping_mark is not null or shipment is not null or other_terms is not null
		or (place_of_loading is not null and (direction <> 'sales' or place_of_loading is distinct from
			(select w.name from warehouses w where w.id = o.warehouse)))
		or (place_of_delivery is not null and (direction <> 'purchasing' or place_of_delivery is distinct from
			(select w.name from warehouses w where w.id = o.warehouse)))
	then jsonb_strip_nulls(jsonb_build_object(
		'kind', 'foreign', 'shipping_terms', shipping_terms, 'place_of_loading', place_of_loading,
		'place_of_delivery', place_of_delivery, 'shipping_mark', shipping_mark, 'other_terms', other_terms
	)) || case when shipment is null then '{}'::jsonb else jsonb_build_object(
		'shipment', jsonb_build_object('from', lower(shipment)::text, 'to', (upper(shipment) - 1)::text)
	) end
	else jsonb_strip_nulls(jsonb_build_object('kind', 'domestic', 'delivery_place',
		case when direction = 'purchasing' then place_of_delivery else delivery_address end))
end;

-- step drop:column:orders.other_terms (destructive)
-- accept: drop:column:orders.other_terms
-- operational risk: access-exclusive-lock
alter table "orders" drop column if exists "other_terms" cascade;

-- step drop:column:orders.place_of_delivery (destructive)
-- accept: drop:column:orders.place_of_delivery
-- operational risk: access-exclusive-lock
alter table "orders" drop column if exists "place_of_delivery" cascade;

-- step drop:column:orders.place_of_loading (destructive)
-- accept: drop:column:orders.place_of_loading
-- operational risk: access-exclusive-lock
alter table "orders" drop column if exists "place_of_loading" cascade;

-- step drop:column:orders.shipment (destructive)
-- accept: drop:column:orders.shipment
-- operational risk: access-exclusive-lock
alter table "orders" drop column if exists "shipment" cascade;

-- step drop:column:orders.shipping_mark (destructive)
-- accept: drop:column:orders.shipping_mark
-- operational risk: access-exclusive-lock
alter table "orders" drop column if exists "shipping_mark" cascade;

-- step drop:column:orders.shipping_terms (destructive)
-- accept: drop:column:orders.shipping_terms
-- operational risk: access-exclusive-lock
alter table "orders" drop column if exists "shipping_terms" cascade;

-- step replace:history:schema:orders (additive)
select bolt_history_register('orders','{"audit":true,"fields":{"archived":{"default":false,"kind":"bool"},"buyer_contact":{"kind":"ref","optional":true,"to":"contacts"},"commission":{"hidden":true,"kind":"json","optional":true,"shape":{"fields":{"amount_expression":{"kind":"text","optional":true},"basis_unit":{"kind":"text"},"currency":{"kind":"text"},"effective_on":{"kind":"text"},"eligibility_expression":{"kind":"text","optional":true},"engine_version":{"kind":"text","optional":true},"fixed_rate":{"kind":"text"},"parameters":{"fields":{"name":{"kind":"text"},"value":{"kind":"text"}},"kind":"object","many":true,"optional":true},"rule_id":{"kind":"text"},"spread_pct":{"kind":"text"}},"kind":"object"},"was":"sealed_commission"},"currency":{"kind":"currency"},"customer_po_no":{"kind":"text","optional":true},"delivery_address":{"kind":"text","optional":true},"direction":{"kind":"enum","values":["sales","purchasing"]},"freight_treatment":{"default":"deduct","kind":"enum","values":["deduct","include"]},"kingdee":{"hidden":true,"kind":"json","optional":true,"shape":{"fields":{"closed":{"kind":"bool"},"exchange_rate":{"kind":"text"},"fid":{"kind":"text"},"reference":{"kind":"text"},"status":{"kind":"enum","values":["draft","issued","void"]},"version":{"kind":"text"}},"kind":"object"}},"ledger":{"kind":"ref","to":"sys_integration","where":{"integration":{"eq":"kingdee"}}},"line_count":{"kind":"count","of":"lines"},"logistics_handler":{"kind":"ref","optional":true,"to":"sys_user","where":{"active":{"eq":true},"team":{"eq":"logistics"}}},"net":{"kind":"sum","of":"lines.net"},"notes":{"kind":"text","optional":true},"number":{"kind":"seq","pattern":"TR-{yyyy}-{0000}"},"ordered_on":{"default":{"var":"today"},"kind":"date"},"owner":{"default":{"var":"actor.id"},"kind":"ref","to":"sys_user"},"packaging":{"kind":"text","optional":true},"party":{"inverse":"orders","kind":"ref","to":"parties"},"party_name":{"kind":"text","optional":true},"payment_method":{"kind":"enum","optional":true,"values":["wire_transfer","acceptance_bill"]},"payment_terms":{"kind":"ref","optional":true,"to":"settlements","where":{"active":{"eq":true}}},"print_values":{"fields":{"key":{"kind":"text"},"value":{"kind":"text"}},"kind":"object","many":true,"optional":true},"source_order_key":{"hidden":true,"kind":"text","optional":true},"status":{"initial":"draft","kind":"state","states":{"confirmed":{},"draft":{"to":["confirmed"]}}},"tax":{"kind":"sum","of":"lines.tax"},"tax_inclusive":{"default":false,"kind":"bool"},"title":{"kind":"text"},"total":{"kind":"sum","of":"lines.total"},"trade":{"default":{"kind":"domestic"},"kind":"json","shape":{"arms":{"domestic":{"delivery_date":{"kind":"date","optional":true},"delivery_place":{"kind":"text","optional":true}},"foreign":{"other_terms":{"kind":"text","optional":true},"place_of_delivery":{"kind":"text","optional":true},"place_of_loading":{"kind":"text","optional":true},"shipment":{"kind":"period","of":"date","optional":true},"shipping_mark":{"kind":"text","optional":true},"shipping_terms":{"kind":"enum","optional":true,"values":["exw","fca","fas","fob","cfr","cif","cpt","cip","dap","dpu","ddp"]}}},"by":"kind","kind":"union"}},"valid_from":{"kind":"date","optional":true},"valid_until":{"kind":"date","optional":true},"warehouse":{"kind":"ref","optional":true,"to":"warehouses"},"write_target":{"hidden":true,"kind":"json","optional":true,"shape":{"fields":{"account":{"kind":"text"},"branch":{"kind":"text"}},"kind":"object"}}},"record_label":"record.number","search":{"text":["number","title","party_name"]},"unique":[{"fields":["source_order_key"],"import_key":true,"name":"natural_key"}]}'::jsonb);

-- step create:notNull:orders.trade (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "orders" where "trade" is null' into n;
	if n > 0 then raise exception 'notNull:orders.trade refuses % existing row(s)', n; end if;
end $store$;
alter table "orders" alter column "trade" set not null;

-- step create:constraint:orders.orders__ck__d0fad340 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "orders" where (("trade" is null or store_json_valid("trade", ''{"default":{"kind":"domestic"},"kind":"json","shape":{"arms":{"domestic":{"delivery_date":{"kind":"date","optional":true},"delivery_place":{"kind":"text","optional":true}},"foreign":{"other_terms":{"kind":"text","optional":true},"place_of_delivery":{"kind":"text","optional":true},"place_of_loading":{"kind":"text","optional":true},"shipment":{"kind":"period","of":"date","optional":true},"shipping_mark":{"kind":"text","optional":true},"shipping_terms":{"kind":"enum","optional":true,"values":["exw","fca","fas","fob","cfr","cif","cpt","cip","dap","dpu","ddp"]}}},"by":"kind","kind":"union"}}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'orders__ck__d0fad340 refuses % existing row(s)', n; end if;
end $store$;
alter table "orders" add constraint "orders__ck__d0fad340" check (("trade" is null or store_json_valid("trade", '{"default":{"kind":"domestic"},"kind":"json","shape":{"arms":{"domestic":{"delivery_date":{"kind":"date","optional":true},"delivery_place":{"kind":"text","optional":true}},"foreign":{"other_terms":{"kind":"text","optional":true},"place_of_delivery":{"kind":"text","optional":true},"place_of_loading":{"kind":"text","optional":true},"shipment":{"kind":"period","of":"date","optional":true},"shipping_mark":{"kind":"text","optional":true},"shipping_terms":{"kind":"enum","optional":true,"values":["exw","fca","fas","fob","cfr","cif","cpt","cip","dap","dpu","ddp"]}}},"by":"kind","kind":"union"}}'::jsonb) is true));
