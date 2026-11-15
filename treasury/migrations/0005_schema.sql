-- 0005_schema.sql: 9 step(s), from 199872451dc42f9d3ef3523add2218545de93f132400a4bc02dc9fce37535369 to de56ebfbf47a22e486db8a6c486cfedc6075f30de13619139f7f58ce73604ffa.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- hazard: backfill: a derived column is filled from every row (time grows with the table).
-- hazard: validating: refuses, naming the constraint and the row count, if existing rows break it.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-rewrite: may rewrite the table; disk use and work grow with existing data.
-- operational risk: table-scan: may scan existing rows; work grows with the table.

-- step replace:history:schema:drawdown_charge (additive)
select bolt_history_register('drawdown_charge','{"audit":true,"computed":{"amount_usd":{"expr":{"round":[{"times":[{"field":"amount"},{"field":"fx_rate_to_usd"}]},2]},"kind":"decimal","scale":2}},"fields":{"amount":{"kind":"decimal","scale":2},"charge_type":{"default":"commission","kind":"enum","values":["commission","cable","swift","cost_of_funds_transfer","processing","tr_extension","penalty","other"]},"currency":{"default":"USD","kind":"currency"},"description":{"kind":"text","optional":true},"drawdown":{"inverse":"charges","kind":"ref","on_delete":"cascade","to":"drawdown"},"fx_rate_to_usd":{"default":1,"kind":"decimal","min":0,"scale":12},"stage":{"default":"drawdown","kind":"enum","values":["drawdown","settlement"]}},"record_label":"record.charge_type"}'::jsonb);

-- step replace:history:schema:facility_fee (additive)
select bolt_history_register('facility_fee','{"audit":true,"fields":{"amount":{"kind":"decimal","optional":true,"scale":2},"currency":{"default":"USD","kind":"currency"},"facility":{"inverse":"fees","kind":"ref","on_delete":"cascade","to":"facility"},"fee_type":{"default":"commission","kind":"enum","values":["commission","cable","swift","cost_of_funds_transfer","processing","tr_extension","penalty","other"]},"include_in_estimates":{"default":true,"kind":"bool"},"method":{"default":"percent","kind":"enum","values":["percent","flat"]},"minimum_amount":{"kind":"decimal","optional":true,"scale":2},"minimum_currency":{"default":"USD","kind":"currency"},"notes":{"kind":"text","optional":true},"product":{"kind":"enum","optional":true,"values":["lc","import_bill","da","dp","tb","ba","bad","if","if_after_lc_or_da","pif","twc","oaf","apf","psil","psbl","ofcl","mctf","tradepay","packing","fbep","dbep","ecr","badd","stl","term","efs","lis","tbl","ma","property","bg","sg","awb","sblc","fx","card","cash"]},"rate_pct":{"kind":"decimal","optional":true,"scale":6},"stage":{"default":"drawdown","kind":"enum","values":["drawdown","settlement"]}},"record_label":"record.fee_type"}'::jsonb);

-- step create:column:drawdown_charge.fx_rate_to_usd (additive)
-- operational risk: access-exclusive-lock
alter table "drawdown_charge" add column "fx_rate_to_usd" numeric default '1'::numeric;

-- step create:column:drawdown_charge.amount_usd (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "drawdown_charge" add column "amount_usd" numeric generated always as ((round(((("amount")::numeric * ("fx_rate_to_usd")::numeric))::numeric, 2))::numeric) stored;

-- step create:column:facility_fee.minimum_currency (additive)
-- operational risk: access-exclusive-lock
alter table "facility_fee" add column "minimum_currency" text default 'USD'::text;

-- step create:notNull:drawdown_charge.fx_rate_to_usd (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "drawdown_charge" where "fx_rate_to_usd" is null' into n;
	if n > 0 then raise exception 'notNull:drawdown_charge.fx_rate_to_usd refuses % existing row(s)', n; end if;
end $store$;
alter table "drawdown_charge" alter column "fx_rate_to_usd" set not null;

-- step create:notNull:facility_fee.minimum_currency (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "facility_fee" where "minimum_currency" is null' into n;
	if n > 0 then raise exception 'notNull:facility_fee.minimum_currency refuses % existing row(s)', n; end if;
end $store$;
alter table "facility_fee" alter column "minimum_currency" set not null;

-- step create:constraint:drawdown_charge.drawdown_charge__ck__e9535888 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "drawdown_charge" where ("fx_rate_to_usd" not in (''NaN''::numeric, ''Infinity''::numeric, ''-Infinity''::numeric) and round("fx_rate_to_usd", 12) = "fx_rate_to_usd" and "fx_rate_to_usd" >= 0) is false' into n;
	if n > 0 then raise exception 'drawdown_charge__ck__e9535888 refuses % existing row(s)', n; end if;
end $store$;
alter table "drawdown_charge" add constraint "drawdown_charge__ck__e9535888" check ("fx_rate_to_usd" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("fx_rate_to_usd", 12) = "fx_rate_to_usd" and "fx_rate_to_usd" >= 0);

-- step create:constraint:facility_fee.facility_fee__ck__0e60c11a (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "facility_fee" where ("minimum_currency" ~ ''^[A-Z]{3}$'') is false' into n;
	if n > 0 then raise exception 'facility_fee__ck__0e60c11a refuses % existing row(s)', n; end if;
end $store$;
alter table "facility_fee" add constraint "facility_fee__ck__0e60c11a" check ("minimum_currency" ~ '^[A-Z]{3}$');
