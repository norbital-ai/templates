-- 0003_schema.sql: 19 step(s), from 0c0129c38da5dff31d115c7aaa9fa59b3dcca66dfa476339df087c5f9e273e79 to ff7da3f1da2f8a61f2016638ed3ccb7b2544ee1822eaa8c830ec35ffdd3b379d.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- hazard: validating: refuses, naming the constraint and the row count, if existing rows break it.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.

-- step replace:history:schema:holding (additive)
select bolt_history_register('holding','{"audit":true,"check":{"loan_is_owed":{"or":[{"asset_class":{"ne":"loan"}},{"value_base":{"lte":"0"}}]}},"fields":{"asset_class":{"default":"equity","kind":"enum","values":["equity","structured","fund","bond","metal","cash","loan","other"]},"change_1m_pct":{"kind":"decimal","optional":true,"scale":2},"change_1w_pct":{"kind":"decimal","optional":true,"scale":2},"change_1y_pct":{"kind":"decimal","optional":true,"scale":2},"cost_value":{"kind":"decimal","optional":true,"scale":2},"currency":{"kind":"currency"},"detail":{"kind":"text","optional":true},"documents":{"accept":["application/pdf","image/png","image/jpeg","text/csv"],"kind":"file","many":true,"max":"32MiB","optional":true},"from_high_pct":{"kind":"decimal","optional":true,"scale":2},"insights":{"fields":{"headline":{"kind":"text"},"source_name":{"kind":"text","optional":true},"url":{"kind":"text"}},"key":"url","kind":"object","many":true,"optional":true},"instrument":{"kind":"text"},"isin":{"kind":"text","optional":true},"live_change_pct":{"kind":"decimal","optional":true,"scale":2},"live_price":{"kind":"decimal","optional":true,"scale":4},"live_value_base":{"kind":"decimal","optional":true,"scale":2},"market_value":{"default":0,"kind":"decimal","scale":2},"money_flow":{"kind":"decimal","optional":true,"scale":2},"movement":{"kind":"enum","optional":true,"values":["surge","active","normal","quiet"]},"pnl_history":{"fields":{"date":{"kind":"date"},"pnl":{"kind":"decimal","scale":2},"pnl_pct":{"kind":"decimal","optional":true,"scale":2}},"key":"date","kind":"object","many":true,"optional":true},"pressure":{"kind":"enum","optional":true,"values":["buying","balanced","selling"]},"price_date":{"kind":"date","optional":true},"price_updated_at":{"kind":"instant","optional":true},"quantity":{"default":1,"kind":"decimal","scale":4},"research_at":{"kind":"instant","optional":true},"research_direction":{"kind":"text","optional":true},"research_summary":{"format":"markdown","kind":"text","optional":true},"risk_rating":{"kind":"int","max":5,"min":1,"optional":true},"rsi":{"kind":"decimal","optional":true,"scale":2},"sources":{"fields":{"label":{"kind":"text"},"url":{"kind":"text"}},"key":"url","kind":"object","many":true,"optional":true},"symbol":{"kind":"text","optional":true},"trend":{"kind":"enum","optional":true,"values":["up","sideways","down"]},"unrealised_pl":{"kind":"decimal","optional":true,"scale":2},"value_base":{"kind":"decimal","scale":2},"volatility_pct":{"kind":"decimal","optional":true,"scale":2},"volume_ratio":{"kind":"decimal","optional":true,"scale":2}},"record_label":"record.instrument","search":{"text":["instrument","symbol","detail","research_direction","research_summary"]}}'::jsonb);

-- step create:column:holding.change_1w_pct (additive)
-- operational risk: access-exclusive-lock
alter table "holding" add column "change_1w_pct" numeric;

-- step create:column:holding.change_1m_pct (additive)
-- operational risk: access-exclusive-lock
alter table "holding" add column "change_1m_pct" numeric;

-- step create:column:holding.change_1y_pct (additive)
-- operational risk: access-exclusive-lock
alter table "holding" add column "change_1y_pct" numeric;

-- step create:column:holding.trend (additive)
-- operational risk: access-exclusive-lock
alter table "holding" add column "trend" text;

-- step create:column:holding.money_flow (additive)
-- operational risk: access-exclusive-lock
alter table "holding" add column "money_flow" numeric;

-- step create:column:holding.pressure (additive)
-- operational risk: access-exclusive-lock
alter table "holding" add column "pressure" text;

-- step create:column:holding.rsi (additive)
-- operational risk: access-exclusive-lock
alter table "holding" add column "rsi" numeric;

-- step create:column:holding.from_high_pct (additive)
-- operational risk: access-exclusive-lock
alter table "holding" add column "from_high_pct" numeric;

-- step create:column:holding.volatility_pct (additive)
-- operational risk: access-exclusive-lock
alter table "holding" add column "volatility_pct" numeric;

-- step create:constraint:holding.holding__ck__d55dc878 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "holding" where ("change_1w_pct" not in (''NaN''::numeric, ''Infinity''::numeric, ''-Infinity''::numeric) and round("change_1w_pct", 2) = "change_1w_pct") is false' into n;
	if n > 0 then raise exception 'holding__ck__d55dc878 refuses % existing row(s)', n; end if;
end $store$;
alter table "holding" add constraint "holding__ck__d55dc878" check ("change_1w_pct" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("change_1w_pct", 2) = "change_1w_pct");

-- step create:constraint:holding.holding__ck__e751f494 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "holding" where ("change_1m_pct" not in (''NaN''::numeric, ''Infinity''::numeric, ''-Infinity''::numeric) and round("change_1m_pct", 2) = "change_1m_pct") is false' into n;
	if n > 0 then raise exception 'holding__ck__e751f494 refuses % existing row(s)', n; end if;
end $store$;
alter table "holding" add constraint "holding__ck__e751f494" check ("change_1m_pct" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("change_1m_pct", 2) = "change_1m_pct");

-- step create:constraint:holding.holding__ck__ce56b03e (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "holding" where ("change_1y_pct" not in (''NaN''::numeric, ''Infinity''::numeric, ''-Infinity''::numeric) and round("change_1y_pct", 2) = "change_1y_pct") is false' into n;
	if n > 0 then raise exception 'holding__ck__ce56b03e refuses % existing row(s)', n; end if;
end $store$;
alter table "holding" add constraint "holding__ck__ce56b03e" check ("change_1y_pct" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("change_1y_pct", 2) = "change_1y_pct");

-- step create:constraint:holding.holding__ck__3903edb9 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "holding" where ("trend" in (''up'', ''sideways'', ''down'')) is false' into n;
	if n > 0 then raise exception 'holding__ck__3903edb9 refuses % existing row(s)', n; end if;
end $store$;
alter table "holding" add constraint "holding__ck__3903edb9" check ("trend" in ('up', 'sideways', 'down'));

-- step create:constraint:holding.holding__ck__3d2d4d56 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "holding" where ("money_flow" not in (''NaN''::numeric, ''Infinity''::numeric, ''-Infinity''::numeric) and round("money_flow", 2) = "money_flow") is false' into n;
	if n > 0 then raise exception 'holding__ck__3d2d4d56 refuses % existing row(s)', n; end if;
end $store$;
alter table "holding" add constraint "holding__ck__3d2d4d56" check ("money_flow" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("money_flow", 2) = "money_flow");

-- step create:constraint:holding.holding__ck__8f7b16cb (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "holding" where ("pressure" in (''buying'', ''balanced'', ''selling'')) is false' into n;
	if n > 0 then raise exception 'holding__ck__8f7b16cb refuses % existing row(s)', n; end if;
end $store$;
alter table "holding" add constraint "holding__ck__8f7b16cb" check ("pressure" in ('buying', 'balanced', 'selling'));

-- step create:constraint:holding.holding__ck__ecc6bb62 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "holding" where ("rsi" not in (''NaN''::numeric, ''Infinity''::numeric, ''-Infinity''::numeric) and round("rsi", 2) = "rsi") is false' into n;
	if n > 0 then raise exception 'holding__ck__ecc6bb62 refuses % existing row(s)', n; end if;
end $store$;
alter table "holding" add constraint "holding__ck__ecc6bb62" check ("rsi" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("rsi", 2) = "rsi");

-- step create:constraint:holding.holding__ck__befaec23 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "holding" where ("from_high_pct" not in (''NaN''::numeric, ''Infinity''::numeric, ''-Infinity''::numeric) and round("from_high_pct", 2) = "from_high_pct") is false' into n;
	if n > 0 then raise exception 'holding__ck__befaec23 refuses % existing row(s)', n; end if;
end $store$;
alter table "holding" add constraint "holding__ck__befaec23" check ("from_high_pct" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("from_high_pct", 2) = "from_high_pct");

-- step create:constraint:holding.holding__ck__aca545c1 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "holding" where ("volatility_pct" not in (''NaN''::numeric, ''Infinity''::numeric, ''-Infinity''::numeric) and round("volatility_pct", 2) = "volatility_pct") is false' into n;
	if n > 0 then raise exception 'holding__ck__aca545c1 refuses % existing row(s)', n; end if;
end $store$;
alter table "holding" add constraint "holding__ck__aca545c1" check ("volatility_pct" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("volatility_pct", 2) = "volatility_pct");
