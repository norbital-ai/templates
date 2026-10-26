-- 0002_schema.sql: 16 step(s), from c86dd729d38ba6cc09b945427d22bd9732f891e01778e4db2df7346330ef5af6 to 83fc17f78868e63d70c1d8a560550047da2223e0f05b47683f9985aed26494f2.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.

-- step replace:trigger:order_lines.store_row_rules (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
drop trigger if exists store_row_rules on "order_lines";

-- step replace:trigger:orders.store_row_rules (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
drop trigger if exists store_row_rules on "orders";

-- step drop:constraint:orders.orders__ck__2adb5fbf (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "orders" drop constraint if exists "orders__ck__2adb5fbf";

-- step drop:constraint:orders.orders__ck__ca2823bc (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "orders" drop constraint if exists "orders__ck__ca2823bc";

-- step drop:constraint:orders.orders__ck__37e6d3e1 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "orders" drop constraint if exists "orders__ck__37e6d3e1";

-- step drop:constraint:orders.orders__ck__14dad942 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "orders" drop constraint if exists "orders__ck__14dad942";

-- step create:column:orders.archived (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "orders" add column "archived" boolean default false;

-- step create:column:orders.draft_document_ids (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "orders" add column "draft_document_ids" jsonb;

-- Preserve operational remarks before retiring the separate status reason.
update "orders" set "notes" = case
	when btrim(coalesce("reason", '')) = '' then "notes"
	when btrim(coalesce("notes", '')) = '' then "reason"
	when "notes" = "reason" then "notes"
	else "notes" || E'\n\n' || "reason"
end;

-- Filing no longer changes the validity of retained contractual or financial evidence.
update "orders" set
	"archived" = "status" in ('closed', 'cancelled'),
	"status" = case when "status" in ('closed', 'cancelled') then
		case when "seal_hash" is not null or "sealed_snapshot" is not null
			or jsonb_array_length(coalesce("contract_versions", '[]'::jsonb)) > 0
			then 'confirmed' else 'draft' end
		else "status" end,
	"draft_document_ids" = (
		select coalesce(jsonb_agg(file->'id'), '[]'::jsonb)
		from jsonb_array_elements(coalesce("supporting_documents", '[]'::jsonb)) as file
	);

-- step drop:column:orders.reason (destructive)
-- accept: drop:column:orders.reason
-- The former reason is retained in notes above; sealed proofs and closure evidence are untouched.
alter table "orders" drop column if exists "reason" cascade;

-- step create:default:orders.archived (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "orders" alter column "archived" set default false;

-- step data:orders.operational_contracts (data)
-- hazard: the shape of orders.operational_contracts changed; rows written under the old shape may not decode under the new one.
-- Transform them here (an UPDATE over orders); the check below counts the rows the new shape still refuses.
-- step check:orders.operational_contracts (validating)
do $store$ declare n bigint; begin
	execute 'select count(*) from "orders" where "operational_contracts" is not null and store_json_valid("operational_contracts", ''{"hidden":true,"kind":"json","optional":true,"shape":{"kind":"list","of":{"fields":{"current":{"kind":"bool","optional":true},"lines":{"kind":"list","of":{"fields":{"id":{"kind":"text"},"product":{"kind":"text","optional":true},"quantity":{"kind":"text"},"unit":{"kind":"text"}},"kind":"object"}},"seal_hash":{"kind":"text"}},"kind":"object"}}}''::jsonb) is not true' into n;
	if n > 0 then raise exception 'the shape of orders.operational_contracts refuses % existing row(s)', n; end if;
end $store$;

-- step data:orders.contract_versions (data)
-- hazard: the shape of orders.contract_versions changed; rows written under the old shape may not decode under the new one.
-- Transform them here (an UPDATE over orders); the check below counts the rows the new shape still refuses.
-- step check:orders.contract_versions (validating)
do $store$ declare n bigint; begin
	execute 'select count(*) from "orders" where "contract_versions" is not null and store_json_valid("contract_versions", ''{"hidden":true,"kind":"json","optional":true,"shape":{"kind":"list","of":{"fields":{"approved_at":{"kind":"instant"},"approved_by":{"kind":"text"},"commission":{"fields":{"amount_expression":{"kind":"text","optional":true},"basis_unit":{"kind":"text"},"currency":{"kind":"text"},"effective_on":{"kind":"text"},"eligibility_expression":{"kind":"text","optional":true},"engine_version":{"kind":"text","optional":true},"fixed_rate":{"kind":"text"},"parameters":{"kind":"list","of":{"fields":{"name":{"kind":"text"},"value":{"kind":"text"}},"kind":"object"},"optional":true},"rule_id":{"kind":"text"},"spread_pct":{"kind":"text"}},"kind":"object","optional":true},"contract":{"kind":"text"},"events":{"kind":"list","of":{"fields":{"at":{"kind":"instant"},"key":{"kind":"text"},"kind":{"kind":"text"},"source_changed_at":{"kind":"instant","optional":true},"source_changed_by":{"kind":"text","optional":true},"source_id":{"kind":"text"},"source_version":{"kind":"text"},"status":{"kind":"text"}},"kind":"object"},"optional":true},"freight_treatment":{"kind":"enum","values":["deduct","include"]},"kingdee":{"fields":{"archived":{"kind":"bool"},"binding_id":{"kind":"text","optional":true},"branch":{"kind":"text"},"closed":{"kind":"bool","optional":true},"content_hash":{"kind":"text"},"entries":{"kind":"list","of":{"fields":{"detail_id":{"kind":"text"},"entry_id":{"kind":"text"},"local_line_id":{"kind":"text"}},"kind":"object"},"optional":true},"live_source_id":{"kind":"text"},"observed_at":{"kind":"instant"},"source_changed_at":{"kind":"instant","optional":true},"source_changed_by":{"kind":"text","optional":true},"source_id":{"kind":"text"},"source_uuid":{"kind":"text"},"source_version":{"kind":"text"},"status":{"kind":"enum","optional":true,"values":["draft","issued","void"]}},"kind":"object","optional":true},"lifecycle":{"kind":"enum","optional":true,"values":["pending","current","superseded"]},"ordered_on":{"kind":"date"},"origin":{"kind":"enum","optional":true,"values":["local","kingdee"]},"seal_hash":{"kind":"text"},"snapshot":{"fields":{"contract_version":{"kind":"text"},"currency":{"kind":"text"},"delivery_terms":{"kind":"text"},"direction":{"kind":"enum","values":["sales","purchasing"]},"document_title":{"kind":"text","optional":true},"lines":{"kind":"list","of":{"fields":{"commission_basis_unit":{"kind":"text"},"commission_factor":{"kind":"text"},"discount_pct":{"kind":"text"},"floor_net":{"kind":"text"},"id":{"kind":"text"},"net":{"kind":"text"},"product":{"kind":"text","optional":true},"product_code":{"kind":"text"},"product_name":{"kind":"text"},"quantity":{"kind":"text"},"tax":{"kind":"text"},"tax_rate":{"kind":"text"},"total":{"kind":"text"},"unit":{"kind":"text"},"unit_price":{"kind":"text"}},"kind":"object"}},"net":{"kind":"text"},"order_id":{"kind":"text"},"party_code":{"kind":"text"},"party_name":{"kind":"text"},"payment_terms":{"kind":"text"},"tax":{"kind":"text"},"tax_inclusive":{"kind":"bool"},"title":{"kind":"text","optional":true},"total":{"kind":"text"},"valid_from":{"kind":"text","optional":true},"valid_until":{"kind":"text","optional":true},"warehouse":{"kind":"text","optional":true}},"kind":"object"},"supporting_documents":{"accept":["application/pdf","image/jpeg","image/png","application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],"kind":"file","max":"20MiB","multiple":true,"optional":true},"version":{"kind":"int"}},"kind":"object"}}}''::jsonb) is not true' into n;
	if n > 0 then raise exception 'the shape of orders.contract_versions refuses % existing row(s)', n; end if;
end $store$;

-- step data:orders.closure_snapshot (data)
-- hazard: the shape of orders.closure_snapshot changed; rows written under the old shape may not decode under the new one.
-- Transform them here (an UPDATE over orders); the check below counts the rows the new shape still refuses.
-- step check:orders.closure_snapshot (validating)
do $store$ declare n bigint; begin
	execute 'select count(*) from "orders" where "closure_snapshot" is not null and store_json_valid("closure_snapshot", ''{"hidden":true,"kind":"json","optional":true,"shape":{"kind":"list","of":{"fields":{"fulfilled":{"kind":"text"},"order_line":{"kind":"text"},"ordered":{"kind":"text"},"product_name":{"kind":"text"},"released":{"kind":"text"},"unit":{"kind":"text"}},"kind":"object"}}}''::jsonb) is not true' into n;
	if n > 0 then raise exception 'the shape of orders.closure_snapshot refuses % existing row(s)', n; end if;
end $store$;

-- step create:notNull:orders.archived (validating)
-- hazard: validating: refuses, naming the constraint and the row count, if existing rows break it.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "orders" where "archived" is null' into n;
	if n > 0 then raise exception 'notNull:orders.archived refuses % existing row(s)', n; end if;
end $store$;
alter table "orders" alter column "archived" set not null;

-- step create:constraint:orders.orders__ck__2a213db2 (validating)
-- hazard: validating: refuses, naming the constraint and the row count, if existing rows break it.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "orders" where ("status" in (''confirmed'', ''draft'')) is false' into n;
	if n > 0 then raise exception 'orders__ck__2a213db2 refuses % existing row(s)', n; end if;
end $store$;
alter table "orders" add constraint "orders__ck__2a213db2" check ("status" in ('confirmed', 'draft'));

-- step create:constraint:orders.orders__ck__edeeb331 (validating)
-- hazard: validating: refuses, naming the constraint and the row count, if existing rows break it.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "orders" where (("draft_document_ids" is null or store_json_valid("draft_document_ids", ''{"hidden":true,"kind":"list","of":{"kind":"text"},"optional":true}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'orders__ck__edeeb331 refuses % existing row(s)', n; end if;
end $store$;
alter table "orders" add constraint "orders__ck__edeeb331" check (("draft_document_ids" is null or store_json_valid("draft_document_ids", '{"hidden":true,"kind":"list","of":{"kind":"text"},"optional":true}'::jsonb) is true));

-- step create:constraint:orders.orders__ck__ba2b1198 (validating)
-- hazard: validating: refuses, naming the constraint and the row count, if existing rows break it.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "orders" where (("operational_contracts" is null or store_json_valid("operational_contracts", ''{"hidden":true,"kind":"json","optional":true,"shape":{"kind":"list","of":{"fields":{"current":{"kind":"bool","optional":true},"lines":{"kind":"list","of":{"fields":{"id":{"kind":"text"},"product":{"kind":"text","optional":true},"quantity":{"kind":"text"},"unit":{"kind":"text"}},"kind":"object"}},"seal_hash":{"kind":"text"}},"kind":"object"}}}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'orders__ck__ba2b1198 refuses % existing row(s)', n; end if;
end $store$;
alter table "orders" add constraint "orders__ck__ba2b1198" check (("operational_contracts" is null or store_json_valid("operational_contracts", '{"hidden":true,"kind":"json","optional":true,"shape":{"kind":"list","of":{"fields":{"current":{"kind":"bool","optional":true},"lines":{"kind":"list","of":{"fields":{"id":{"kind":"text"},"product":{"kind":"text","optional":true},"quantity":{"kind":"text"},"unit":{"kind":"text"}},"kind":"object"}},"seal_hash":{"kind":"text"}},"kind":"object"}}}'::jsonb) is true));

-- step create:constraint:orders.orders__ck__89cdde8c (validating)
-- hazard: validating: refuses, naming the constraint and the row count, if existing rows break it.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "orders" where (("contract_versions" is null or store_json_valid("contract_versions", ''{"hidden":true,"kind":"json","optional":true,"shape":{"kind":"list","of":{"fields":{"approved_at":{"kind":"instant"},"approved_by":{"kind":"text"},"commission":{"fields":{"amount_expression":{"kind":"text","optional":true},"basis_unit":{"kind":"text"},"currency":{"kind":"text"},"effective_on":{"kind":"text"},"eligibility_expression":{"kind":"text","optional":true},"engine_version":{"kind":"text","optional":true},"fixed_rate":{"kind":"text"},"parameters":{"kind":"list","of":{"fields":{"name":{"kind":"text"},"value":{"kind":"text"}},"kind":"object"},"optional":true},"rule_id":{"kind":"text"},"spread_pct":{"kind":"text"}},"kind":"object","optional":true},"contract":{"kind":"text"},"events":{"kind":"list","of":{"fields":{"at":{"kind":"instant"},"key":{"kind":"text"},"kind":{"kind":"text"},"source_changed_at":{"kind":"instant","optional":true},"source_changed_by":{"kind":"text","optional":true},"source_id":{"kind":"text"},"source_version":{"kind":"text"},"status":{"kind":"text"}},"kind":"object"},"optional":true},"freight_treatment":{"kind":"enum","values":["deduct","include"]},"kingdee":{"fields":{"archived":{"kind":"bool"},"binding_id":{"kind":"text","optional":true},"branch":{"kind":"text"},"closed":{"kind":"bool","optional":true},"content_hash":{"kind":"text"},"entries":{"kind":"list","of":{"fields":{"detail_id":{"kind":"text"},"entry_id":{"kind":"text"},"local_line_id":{"kind":"text"}},"kind":"object"},"optional":true},"live_source_id":{"kind":"text"},"observed_at":{"kind":"instant"},"source_changed_at":{"kind":"instant","optional":true},"source_changed_by":{"kind":"text","optional":true},"source_id":{"kind":"text"},"source_uuid":{"kind":"text"},"source_version":{"kind":"text"},"status":{"kind":"enum","optional":true,"values":["draft","issued","void"]}},"kind":"object","optional":true},"lifecycle":{"kind":"enum","optional":true,"values":["pending","current","superseded"]},"ordered_on":{"kind":"date"},"origin":{"kind":"enum","optional":true,"values":["local","kingdee"]},"seal_hash":{"kind":"text"},"snapshot":{"fields":{"contract_version":{"kind":"text"},"currency":{"kind":"text"},"delivery_terms":{"kind":"text"},"direction":{"kind":"enum","values":["sales","purchasing"]},"document_title":{"kind":"text","optional":true},"lines":{"kind":"list","of":{"fields":{"commission_basis_unit":{"kind":"text"},"commission_factor":{"kind":"text"},"discount_pct":{"kind":"text"},"floor_net":{"kind":"text"},"id":{"kind":"text"},"net":{"kind":"text"},"product":{"kind":"text","optional":true},"product_code":{"kind":"text"},"product_name":{"kind":"text"},"quantity":{"kind":"text"},"tax":{"kind":"text"},"tax_rate":{"kind":"text"},"total":{"kind":"text"},"unit":{"kind":"text"},"unit_price":{"kind":"text"}},"kind":"object"}},"net":{"kind":"text"},"order_id":{"kind":"text"},"party_code":{"kind":"text"},"party_name":{"kind":"text"},"payment_terms":{"kind":"text"},"tax":{"kind":"text"},"tax_inclusive":{"kind":"bool"},"title":{"kind":"text","optional":true},"total":{"kind":"text"},"valid_from":{"kind":"text","optional":true},"valid_until":{"kind":"text","optional":true},"warehouse":{"kind":"text","optional":true}},"kind":"object"},"supporting_documents":{"accept":["application/pdf","image/jpeg","image/png","application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],"kind":"file","max":"20MiB","multiple":true,"optional":true},"version":{"kind":"int"}},"kind":"object"}}}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'orders__ck__89cdde8c refuses % existing row(s)', n; end if;
end $store$;
alter table "orders" add constraint "orders__ck__89cdde8c" check (("contract_versions" is null or store_json_valid("contract_versions", '{"hidden":true,"kind":"json","optional":true,"shape":{"kind":"list","of":{"fields":{"approved_at":{"kind":"instant"},"approved_by":{"kind":"text"},"commission":{"fields":{"amount_expression":{"kind":"text","optional":true},"basis_unit":{"kind":"text"},"currency":{"kind":"text"},"effective_on":{"kind":"text"},"eligibility_expression":{"kind":"text","optional":true},"engine_version":{"kind":"text","optional":true},"fixed_rate":{"kind":"text"},"parameters":{"kind":"list","of":{"fields":{"name":{"kind":"text"},"value":{"kind":"text"}},"kind":"object"},"optional":true},"rule_id":{"kind":"text"},"spread_pct":{"kind":"text"}},"kind":"object","optional":true},"contract":{"kind":"text"},"events":{"kind":"list","of":{"fields":{"at":{"kind":"instant"},"key":{"kind":"text"},"kind":{"kind":"text"},"source_changed_at":{"kind":"instant","optional":true},"source_changed_by":{"kind":"text","optional":true},"source_id":{"kind":"text"},"source_version":{"kind":"text"},"status":{"kind":"text"}},"kind":"object"},"optional":true},"freight_treatment":{"kind":"enum","values":["deduct","include"]},"kingdee":{"fields":{"archived":{"kind":"bool"},"binding_id":{"kind":"text","optional":true},"branch":{"kind":"text"},"closed":{"kind":"bool","optional":true},"content_hash":{"kind":"text"},"entries":{"kind":"list","of":{"fields":{"detail_id":{"kind":"text"},"entry_id":{"kind":"text"},"local_line_id":{"kind":"text"}},"kind":"object"},"optional":true},"live_source_id":{"kind":"text"},"observed_at":{"kind":"instant"},"source_changed_at":{"kind":"instant","optional":true},"source_changed_by":{"kind":"text","optional":true},"source_id":{"kind":"text"},"source_uuid":{"kind":"text"},"source_version":{"kind":"text"},"status":{"kind":"enum","optional":true,"values":["draft","issued","void"]}},"kind":"object","optional":true},"lifecycle":{"kind":"enum","optional":true,"values":["pending","current","superseded"]},"ordered_on":{"kind":"date"},"origin":{"kind":"enum","optional":true,"values":["local","kingdee"]},"seal_hash":{"kind":"text"},"snapshot":{"fields":{"contract_version":{"kind":"text"},"currency":{"kind":"text"},"delivery_terms":{"kind":"text"},"direction":{"kind":"enum","values":["sales","purchasing"]},"document_title":{"kind":"text","optional":true},"lines":{"kind":"list","of":{"fields":{"commission_basis_unit":{"kind":"text"},"commission_factor":{"kind":"text"},"discount_pct":{"kind":"text"},"floor_net":{"kind":"text"},"id":{"kind":"text"},"net":{"kind":"text"},"product":{"kind":"text","optional":true},"product_code":{"kind":"text"},"product_name":{"kind":"text"},"quantity":{"kind":"text"},"tax":{"kind":"text"},"tax_rate":{"kind":"text"},"total":{"kind":"text"},"unit":{"kind":"text"},"unit_price":{"kind":"text"}},"kind":"object"}},"net":{"kind":"text"},"order_id":{"kind":"text"},"party_code":{"kind":"text"},"party_name":{"kind":"text"},"payment_terms":{"kind":"text"},"tax":{"kind":"text"},"tax_inclusive":{"kind":"bool"},"title":{"kind":"text","optional":true},"total":{"kind":"text"},"valid_from":{"kind":"text","optional":true},"valid_until":{"kind":"text","optional":true},"warehouse":{"kind":"text","optional":true}},"kind":"object"},"supporting_documents":{"accept":["application/pdf","image/jpeg","image/png","application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],"kind":"file","max":"20MiB","multiple":true,"optional":true},"version":{"kind":"int"}},"kind":"object"}}}'::jsonb) is true));

-- step create:constraint:orders.orders__ck__3e6c9be4 (validating)
-- hazard: validating: refuses, naming the constraint and the row count, if existing rows break it.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "orders" where (("closure_snapshot" is null or store_json_valid("closure_snapshot", ''{"hidden":true,"kind":"json","optional":true,"shape":{"kind":"list","of":{"fields":{"fulfilled":{"kind":"text"},"order_line":{"kind":"text"},"ordered":{"kind":"text"},"product_name":{"kind":"text"},"released":{"kind":"text"},"unit":{"kind":"text"}},"kind":"object"}}}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'orders__ck__3e6c9be4 refuses % existing row(s)', n; end if;
end $store$;
alter table "orders" add constraint "orders__ck__3e6c9be4" check (("closure_snapshot" is null or store_json_valid("closure_snapshot", '{"hidden":true,"kind":"json","optional":true,"shape":{"kind":"list","of":{"fields":{"fulfilled":{"kind":"text"},"order_line":{"kind":"text"},"ordered":{"kind":"text"},"product_name":{"kind":"text"},"released":{"kind":"text"},"unit":{"kind":"text"}},"kind":"object"}}}'::jsonb) is true));

-- step replace:trigger:order_lines.store_row_rules (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
create trigger store_row_rules before insert or update or delete on "order_lines" for each row execute function store_row_rules('{"audit":true,"fields":{"commission_basis_unit":["commission_basis_unit"],"commission_factor":["commission_factor"],"currency":["currency"],"discount_pct":["discount_pct"],"floor_net":["floor_net"],"floor_on":["floor_on"],"net":["net"],"order":["order"],"product":["product"],"product_code":["product_code"],"product_name":["product_name"],"quantity":["quantity"],"tax":["tax"],"tax_rate":["tax_rate"],"total":["total"],"unit":["unit"],"unit_price":["unit_price"]},"key":["id"],"parents":[{"column":"order","key":"id","relation":"lines","states":{"status":{"initial":"draft","states":{"confirmed":{"edit":["title","notes","archived","contract_versions","operational_contracts","check_hash","contract_version","sealed_at","sealed_by","sealed_snapshot","sealed_commission","sealed_contract","sealed_contract_version","seal_hash","freight_treatment","warehouse","ordered_on","currency","tax_inclusive","valid_from","valid_until","payment_terms","delivery_terms","supporting_documents","draft_document_ids"],"to":["draft"]},"draft":{"to":["confirmed"]}}}},"table":"orders","type":"uuid"}],"states":{}}');

-- step replace:trigger:orders.store_row_rules (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
create trigger store_row_rules before insert or update or delete on "orders" for each row execute function store_row_rules('{"audit":true,"fields":{"archived":["archived"],"check_hash":["check_hash"],"closure_snapshot":["closure_snapshot"],"contract_version":["contract_version"],"contract_versions":["contract_versions"],"currency":["currency"],"delivery_terms":["delivery_terms"],"direction":["direction"],"draft_document_ids":["draft_document_ids"],"freight_treatment":["freight_treatment"],"ledger":["ledger"],"notes":["notes"],"operational_contracts":["operational_contracts"],"ordered_on":["ordered_on"],"owner":["owner"],"party":["party"],"party_name":["party_name"],"payment_terms":["payment_terms"],"seal_hash":["seal_hash"],"sealed_at":["sealed_at"],"sealed_by":["sealed_by"],"sealed_commission":["sealed_commission"],"sealed_contract":["sealed_contract"],"sealed_contract_version":["sealed_contract_version"],"sealed_snapshot":["sealed_snapshot"],"status":["status"],"supporting_documents":["supporting_documents"],"tax_inclusive":["tax_inclusive"],"title":["title"],"valid_from":["valid_from"],"valid_until":["valid_until"],"warehouse":["warehouse"]},"key":["id"],"parents":[],"states":{"status":{"initial":"draft","states":{"confirmed":{"edit":["title","notes","archived","contract_versions","operational_contracts","check_hash","contract_version","sealed_at","sealed_by","sealed_snapshot","sealed_commission","sealed_contract","sealed_contract_version","seal_hash","freight_treatment","warehouse","ordered_on","currency","tax_inclusive","valid_from","valid_until","payment_terms","delivery_terms","supporting_documents","draft_document_ids"],"to":["draft"]},"draft":{"to":["confirmed"]}}}}}');
