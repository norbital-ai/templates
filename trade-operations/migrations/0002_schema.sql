-- 0002_schema.sql: 6 step(s), from e649f8fadc4720a50f3588f84ea148f2f5eea1b5b973868b1fedc172a6bd688d to a65998dca5cddda85408bd66a2ef8c1387b6e4669c8a039b1bb1a58728d73ea4.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- hazard: validating: refuses, naming the constraint and the row count, if existing rows break it.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.

-- step replace:trigger:pricing_floors.store_row_rules (additive)
drop trigger if exists store_row_rules on "pricing_floors";

-- step replace:history:schema:pricing_floors (additive)
select bolt_history_register('pricing_floors','{"audit":true,"check":{"floor_price_nonnegative":{"floor_price":{"gte":"0"}},"import_revision_ephemeral":{"import_revision":{"isNull":true}}},"fields":{"currency":{"kind":"currency"},"effective_on":{"kind":"date"},"floor_price":{"currency":"currency","kind":"money","scale":4},"group_code":{"kind":"text"},"import_revision":{"hidden":true,"kind":"int","min":0,"optional":true},"minimum_quantity":{"default":0,"kind":"decimal","min":0,"scale":3},"product":{"kind":"ref","to":"products"},"tax_inclusive":{"kind":"bool"},"tax_rate":{"default":0,"kind":"decimal","max":100,"min":0,"scale":2},"unit":{"kind":"text"}},"nativeRules":2,"natural":["product","group_code","currency","effective_on","minimum_quantity"],"recordLabel":"[record.effective_on != null ? string(record.effective_on) : '''', record.group_code != null ? string(record.group_code) : ''''].filter(part, part != '''').join('' · '')","search":{"text":["product","group_code","unit"]}}'::jsonb);

-- step create:column:pricing_floors.import_revision (additive)
-- operational risk: access-exclusive-lock
alter table "pricing_floors" add column "import_revision" int;

-- step create:constraint:pricing_floors.pricing_floors__ck__739b5b3b (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "pricing_floors" where ("import_revision" >= 0) is false' into n;
	if n > 0 then raise exception 'pricing_floors__ck__739b5b3b refuses % existing row(s)', n; end if;
end $store$;
alter table "pricing_floors" add constraint "pricing_floors__ck__739b5b3b" check ("import_revision" >= 0);

-- step create:constraint:pricing_floors.pricing_floors__ck__a0893beb (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "pricing_floors" where (("import_revision" is null)) is false' into n;
	if n > 0 then raise exception 'pricing_floors__ck__a0893beb refuses % existing row(s)', n; end if;
end $store$;
alter table "pricing_floors" add constraint "pricing_floors__ck__a0893beb" check (("import_revision" is null));

-- step replace:trigger:pricing_floors.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "pricing_floors" for each row execute function store_row_rules('{"audit":true,"fields":{"currency":["currency"],"effective_on":["effective_on"],"floor_price":["floor_price"],"group_code":["group_code"],"import_revision":["import_revision"],"minimum_quantity":["minimum_quantity"],"product":["product"],"tax_inclusive":["tax_inclusive"],"tax_rate":["tax_rate"],"unit":["unit"]},"key":["id"],"parents":[],"states":{}}');
