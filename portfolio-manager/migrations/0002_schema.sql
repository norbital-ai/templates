-- step runtime:functions (backfill)
create or replace function store_json_valid(value jsonb, spec jsonb) returns boolean
language plpgsql immutable parallel safe set timezone = 'UTC' set datestyle = 'ISO,YMD' as $store_json$
declare
	kind text := spec->>'kind';
	shape text := jsonb_typeof(value);
	item jsonb;
	field_name text;
	field_spec jsonb;
	text_value text;
	numeric_value numeric;
	float_value double precision;
	length_value bigint;
	year_value int;
	month_value int;
	day_value int;
	days int[];
	from_value text;
	to_value text;
begin
	if value is null then return false; end if;
	if value = 'null'::jsonb and coalesce((spec->>'optional')::boolean, false) then return true; end if;
	if coalesce((spec->>'many')::boolean, false) then
		if shape <> 'array' then return false; end if;
		length_value := jsonb_array_length(value);
		if (spec ? 'min_items' and length_value < (spec->>'min_items')::numeric) or
			(spec ? 'max_items' and length_value > (spec->>'max_items')::numeric) then return false; end if;
		for item in select v from jsonb_array_elements(value) items(v) loop
			if not store_json_valid(item, spec - array['many','optional','min_items','max_items','key']) then return false; end if;
		end loop;
		return true;
	end if;
	case kind
	when 'json' then
		return case when spec ? 'shape' then store_json_valid(value, spec->'shape') else true end;
	when 'custom' then return true;
	when 'vector' then
		if shape <> 'array' then return false; end if;
		length_value := jsonb_array_length(value);
		if kind = 'vector' and length_value <> (spec->>'dim')::numeric then return false; end if;

		for item in select v from jsonb_array_elements(value) items(v) loop
			if not store_json_valid(item, '{"kind":"number"}'::jsonb) then return false; end if;
		end loop;
		return true;
	when 'object' then
		if shape <> 'object' then return false; end if;
		for field_name, field_spec in select key, v from jsonb_each(spec->'fields') fields(key,v) loop
			if not (value ? field_name) then
				if coalesce((field_spec->>'optional')::boolean, false) or field_spec ? 'default' then continue; end if;
				return false;
			end if;
			if value->field_name = 'null'::jsonb then
				if coalesce((field_spec->>'optional')::boolean, false) or field_spec ? 'default' then continue; end if;
				return false;
			end if;
			if not store_json_valid(value->field_name, field_spec) then return false; end if;
		end loop;
		if spec ? 'rest' then
			for field_name, item in select key, v from jsonb_each(value) fields(key,v) loop
				if not (spec->'fields' ? field_name) and not store_json_valid(item, spec->'rest') then return false; end if;
			end loop;
		elsif spec->'fields' = '{}'::jsonb and not coalesce((spec->>'tagged')::boolean, false) then
			return value = '{}'::jsonb;
		end if;
		return true;
	when 'union' then
		if spec ? 'arms' then
			if shape <> 'object' or jsonb_typeof(value->(spec->>'by')) is distinct from 'string' then return false; end if;
			text_value := value->>(spec->>'by');
			if not (spec->'arms' ? text_value) then return false; end if;
			return store_json_valid(value, jsonb_build_object('kind','object','fields',(spec->'arms'->text_value) - (spec->>'by'),'tagged',true));
		end if;
		for item in select v from jsonb_array_elements(spec->'of') items(v) loop
			if store_json_valid(value, item) then return true; end if;
		end loop;
		return false;
	when 'record' then
		if shape <> 'object' then return false; end if;
		for item in select v from jsonb_each(value) fields(key,v) loop
			if not store_json_valid(item, spec->'of') then return false; end if;
		end loop;
		return true;
	when 'file' then
		if shape <> 'object' then return false; end if;
		foreach field_name in array array['id','name','mime'] loop
			if jsonb_typeof(value->field_name) is distinct from 'string' then return false; end if;
		end loop;
		return not (value ? 'size') or store_json_valid(value->'size','{"kind":"int"}'::jsonb);
	when 'point' then
		return shape = 'object' and store_json_valid(value->'lat','{"kind":"number"}'::jsonb)
			and store_json_valid(value->'lng','{"kind":"number"}'::jsonb);
	when 'ref' then
		if jsonb_typeof(spec->'to') = 'string' then return shape = 'string'; end if;
		return coalesce(shape = 'object' and jsonb_typeof(value->'model') = 'string'
			and spec->'to' ? (value->>'model') and jsonb_typeof(value->'id') = 'string',false);
	when 'period' then
		if shape <> 'object' then return false; end if;
		field_name := case when spec->>'of' = 'date' then 'from' else 'start' end;
		text_value := case when spec->>'of' = 'date' then 'to' else 'end' end;
		field_spec := jsonb_build_object('kind', spec->>'of');
		if not store_json_valid(value->field_name, field_spec) then return false; end if;
		if not (value ? text_value) or value->text_value = 'null'::jsonb then return true; end if;
		if not store_json_valid(value->text_value, field_spec) then return false; end if;
		from_value := value->>field_name; to_value := value->>text_value;
		return case when spec->>'of' = 'date' then from_value <= to_value
			else from_value::timestamptz < to_value::timestamptz end;
	when 'bool' then return shape = 'boolean';
	when 'int', 'number', 'count' then
		if shape <> 'number' then return false; end if;
		text_value := value #>> '{}';
		float_value := text_value::double precision;
		if float_value in ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision) then return false; end if;
		numeric_value := text_value::numeric;
		if kind <> 'number' and trunc(numeric_value) <> numeric_value then return false; end if;
		if kind <> 'number' and abs(numeric_value) > 9007199254740991 then return false; end if;
		if kind = 'count' and numeric_value < 0 then return false; end if;
		return (not (spec ? 'min') or numeric_value >= (spec->>'min')::numeric)
			and (not (spec ? 'max') or numeric_value <= (spec->>'max')::numeric);
	when 'decimal', 'money', 'sum' then
		if shape = 'number' then
			float_value := (value #>> '{}')::double precision;
			return float_value not in ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision);
		end if;
		text_value := case when shape = 'string' then value #>> '{}' else null end;
		return coalesce(text_value ~ '^-?[0-9]+(\.[0-9]+)?$',false);
	when 'seq' then
		return case when spec ? 'pattern' then shape = 'string' else store_json_valid(value,'{"kind":"int"}'::jsonb) end;
	when 'text', 'currency', 'id', 'enum', 'state', 'date', 'instant', 'time' then
		if shape <> 'string' then return false; end if;
		text_value := value #>> '{}';
		case kind
		when 'text' then
			if spec ? 'max' then
				select coalesce(sum(case when ch='' then 0 when ascii(ch)>65535 then 2 else 1 end),0) into length_value
					from regexp_split_to_table(text_value,'') chars(ch);
				if length_value > (spec->>'max')::numeric then return false; end if;
			end if;
			return spec->>'format' is distinct from 'email' or text_value ~ '^[^@\s]+@[^@\s]+$';
		when 'currency' then return true;
		when 'id' then return text_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
		when 'enum' then return spec->'values' ? text_value;
		when 'state' then return spec->'states' ? text_value;
		when 'time' then return text_value ~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9](\.[0-9]+)?)?$';
		when 'date' then
			if text_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return false; end if;
			year_value := substring(text_value,1,4)::int; month_value := substring(text_value,6,2)::int; day_value := substring(text_value,9,2)::int;
			days := array[31,case when year_value%400=0 or (year_value%4=0 and year_value%100<>0) then 29 else 28 end,31,30,31,30,31,31,30,31,30,31];
			return month_value between 1 and 12 and day_value between 1 and days[month_value];
		when 'instant' then
			if text_value ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' then
				return store_json_valid(to_jsonb(substring(text_value,1,10)), '{"kind":"date"}'::jsonb)
					and store_json_valid(to_jsonb(substring(text_value,12,12)), '{"kind":"time"}'::jsonb);
			end if;
			return text_value ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}([Tt ][0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]+)?)?([Zz]|[+-][0-9]{2}(:?[0-9]{2})?)?)?$'
				and isfinite(text_value::timestamptz);
		else return false;
		end case;
	else return false;
	end case;
exception when data_exception then return false;
end;
$store_json$;
create or replace function store_row_rules() returns trigger language plpgsql as $store_rules$
declare
	rules jsonb := tg_argv[0]::jsonb;
	context jsonb := nullif(current_setting('store.write', true), '')::jsonb;
	mode text := coalesce(context->>'mode', 'write');
	before_row jsonb;
	after_row jsonb;
	state_name text;
	state_spec jsonb;
	state_rule jsonb;
	column_name text;
	trusted boolean;
	stamp_name text;
	stamps jsonb := '{}'::jsonb;
	at_time timestamptz;
begin
	if mode not in ('write', 'seed', 'restore') or
		(context is not null and jsonb_typeof(context) <> 'object') then
		raise exception 'invalid native write context' using errcode = '22023';
	end if;
	trusted := mode in ('seed', 'restore');
	-- whole-row JSON only where a key or state is compared: a plain insert or delete reads none
	if tg_op = 'UPDATE' or (tg_op = 'INSERT' and rules->'states' <> '{}'::jsonb) then
		if tg_op = 'UPDATE' then before_row := to_jsonb(old); end if;
		after_row := to_jsonb(new);
	end if;
	if tg_op = 'UPDATE' then
		for column_name in select jsonb_array_elements_text(rules->'key') loop
			if before_row->column_name is distinct from after_row->column_name then
				raise exception 'the primary key of % is immutable', tg_table_name
					using errcode = '23514', column = column_name;
			end if;
		end loop;
	end if;
	if not trusted and tg_op <> 'DELETE' then
		at_time := coalesce((context->>'at')::timestamptz, clock_timestamp());
		for state_name, state_spec in select key, value from jsonb_each(rules->'states') loop
			if tg_op = 'INSERT' or before_row->state_name is distinct from after_row->state_name then
				stamp_name := state_spec->'states'->(after_row->>state_name)->>'stamp';
				if stamp_name is not null then
					after_row := jsonb_set(after_row, array[stamp_name], to_jsonb(at_time), true);
					stamps := stamps || jsonb_build_object(stamp_name, to_jsonb(at_time));
				end if;
			end if;
		end loop;
		-- only the stamp columns: a whole-row round trip would turn a stored JSON null into SQL NULL
		if stamps <> '{}'::jsonb then new := jsonb_populate_record(new, stamps); end if;
	end if;
	if not trusted then
		for state_name, state_spec in select key, value from jsonb_each(rules->'states') loop
			if tg_op = 'INSERT' and after_row->>state_name is distinct from state_spec->>'initial' then
				raise exception 'a new % row starts with % = %', tg_table_name, state_name, state_spec->>'initial'
					using errcode = '23514', column = state_name;
			elsif tg_op = 'UPDATE' then
				state_rule := state_spec->'states'->(before_row->>state_name);
				if before_row->state_name is distinct from after_row->state_name and
					not coalesce(state_rule->'to' ? (after_row->>state_name), false) then
					raise exception '% cannot move from % to %', state_name, before_row->>state_name, after_row->>state_name
						using errcode = '23514', column = state_name;
				end if;
			end if;
		end loop;
	end if;
	if coalesce((rules->>'audit')::boolean, false) and tg_op <> 'DELETE' then
		at_time := coalesce((context->>'at')::timestamptz, clock_timestamp());
		if tg_op = 'INSERT' then
			if new.revision < 1 or (not trusted and new.revision <> 1) then
				raise exception 'a new % row starts at revision 1', tg_table_name using errcode = '23514', column = 'revision';
			end if;
			if context is not null then
				new.created_at := at_time;
				new.created_by := context->>'actor';
			end if;
			new.updated_at := new.created_at;
			new.updated_by := new.created_by;
		else
			if new.created_at is distinct from old.created_at or new.created_by is distinct from old.created_by then
				raise exception 'creation metadata is immutable' using errcode = '23514', column = 'created_at';
			end if;
			if new.revision is null or new.revision not in (old.revision, old.revision + 1) then
				raise exception 'revision must advance by one' using errcode = '23514', column = 'revision';
			end if;
			if context is not null then new.updated_by := context->>'actor';
			elsif new.revision = old.revision then new.updated_by := null;
			end if;
			new.revision := old.revision + 1;
			new.updated_at := at_time;
		end if;
	end if;
	if tg_op = 'DELETE' then return old; end if;
	return new;
end;
$store_rules$;
create or replace function store_statement_rules() returns trigger language plpgsql as $store_rules$
declare
	rules jsonb := tg_argv[0]::jsonb;
	context jsonb := nullif(current_setting('store.write', true), '')::jsonb;
	pairs text;
	locked_rule jsonb;
	before_row jsonb;
	after_row jsonb;
	state_name text;
	state_spec jsonb;
	stamp_name text;
	stamped jsonb;
	anonymised jsonb;
	field_name text;
	columns jsonb;
	column_name text;
	parent jsonb;
	ids text;
	locked boolean;
begin
	if coalesce(context->>'mode', 'write') in ('seed', 'restore') then return null; end if;
	if tg_op <> 'INSERT' then
		select string_agg(format('o.%I = n.%I', k, k), ' and ') into pairs from jsonb_array_elements_text(rules->'key') k;
		for locked_rule in select value from jsonb_array_elements(rules->'locks') loop
			for before_row, after_row in execute format(
				'select to_jsonb(o), %s from store_old o %s cross join lateral jsonb_populate_record(null::%I.%I, to_jsonb(o)) t where coalesce((%s), false)',
				case when tg_op = 'UPDATE' then 'to_jsonb(n)' else 'null::jsonb' end,
				case when tg_op = 'UPDATE' then 'join store_new n on ' || pairs else '' end,
				tg_table_schema, tg_table_name, locked_rule->>'sql')
			loop
				if tg_op = 'DELETE' then
					raise exception 'record is locked by %', locked_rule->>'name' using errcode = '23514', column = 'id', constraint = locked_rule->>'constraint';
				end if;
				stamped := '[]'::jsonb;
				for state_name, state_spec in select key, value from jsonb_each(rules->'states') loop
					stamp_name := state_spec->'states'->(after_row->>state_name)->>'stamp';
					if before_row->state_name is distinct from after_row->state_name and stamp_name is not null then
						stamped := stamped || jsonb_build_array(stamp_name);
					end if;
				end loop;
				anonymised := null;
				for field_name, columns in select key, value from jsonb_each(rules->'fields') loop
					if locked_rule->'except' ? field_name or stamped ? field_name then continue; end if;
					for column_name in select jsonb_array_elements_text(columns) loop
						if before_row->column_name is distinct from after_row->column_name then
							if anonymised is null then
								anonymised := '[]'::jsonb;
								if to_regprocedure(format('%I.%I(text,text)', tg_table_schema, 'store_anonymise_fields')) is not null then
									execute format('select %I.%I($1,$2)', tg_table_schema, 'store_anonymise_fields')
										into anonymised using tg_table_name, after_row->>'id';
								end if;
							end if;
							exit when anonymised ? field_name;
							raise exception '% is locked by %', field_name, locked_rule->>'name'
								using errcode = '23514', column = field_name, constraint = locked_rule->>'constraint';
						end if;
					end loop;
				end loop;
			end loop;
		end loop;
	end if;
	for parent in select value from jsonb_array_elements(rules->'parents') loop
		ids := format('select v::%s from (%s) s where v is not null', parent->>'type', concat_ws(' union ',
			case when tg_op <> 'INSERT' then format('select %I::text v from store_old', parent->>'column') end,
			case when tg_op <> 'DELETE' then format('select %I::text v from store_new', parent->>'column') end));
		execute format('select 1 from %I.%I p where p.%I in (%s) order by p.%I for share',
			tg_table_schema, parent->>'table', parent->>'key', ids, parent->>'key');
		for locked_rule in select value from jsonb_array_elements(parent->'locks') loop
			execute format('select exists(select 1 from %I.%I p cross join lateral jsonb_populate_record(null::%I.%I, to_jsonb(p)) t where p.%I in (%s) and coalesce((%s), false))',
				tg_table_schema, parent->>'table', tg_table_schema, parent->>'table', parent->>'key', ids, locked_rule->>'sql')
				into locked;
			if locked then
				raise exception 'relation % is locked by %', parent->>'relation', locked_rule->>'name'
					using errcode = '23514', column = parent->>'column', constraint = locked_rule->>'constraint';
			end if;
		end loop;
	end loop;
	return null;
end;
$store_rules$;

-- 0002_schema.sql: 21 step(s), from c1a741d1d8878434ab84837f76e290602ef43fb992415d175ab83f5ff12f4a81 to e2791412b0692a249005bb7de157e09ac03ed13eacf6cb97d4e6d656bbdcd3b4.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- hazard: validating: refuses, naming the constraint and the row count, if existing rows break it.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.

-- step drop:constraint:report.report__ck__4595e08e (additive)
-- operational risk: access-exclusive-lock
alter table "report" drop constraint if exists "report__ck__4595e08e";

-- step create:table:report_subscription (additive)
create table "report_subscription" ("id" uuid primary key, revision int not null default 1, created_at timestamptz not null default now(), created_by text, updated_at timestamptz not null default now(), updated_by text,
	"user" text not null,
	constraint "report_subscription__uq__f7773e92" unique ("user") deferrable initially immediate
);

-- step replace:history:schema:sys_user (additive)
select bolt_history_register('sys_user','{"check":{"admin_staff":{"or":[{"admin":{"eq":false}},{"kind":{"eq":"staff"}}]}},"computed":{"party_id":{"expr":{"json_text":[{"field":"party"},"id"]},"kind":"text"},"phone_key":{"expr":{"regex_replace":[{"field":"phone"},"\\D",""]},"kind":"text"}},"fields":{"active":{"default":true,"kind":"bool"},"admin":{"default":false,"kind":"bool"},"created_at":{"default":{"var":"now"},"kind":"instant"},"discord":{"kind":"text","optional":true},"email":{"format":"email","kind":"text","optional":true},"kind":{"default":"staff","kind":"enum","values":["staff","external","anonymous"]},"last_seen":{"kind":"instant","optional":true},"name":{"kind":"text"},"party":{"kind":"json","optional":true},"phone":{"kind":"text","optional":true},"revision":{"default":1,"kind":"int"},"signup":{"default":false,"kind":"bool"},"slack":{"kind":"text","optional":true},"team":{"format":"team","kind":"text","optional":true},"telegram":{"kind":"text","optional":true}},"indexes":[{"on":[{"lower":"email"}],"unique":true},{"on":["phone_key"],"unique":true}],"key":"text","record_label":"record.name","search":{"text":["name","email"]}}'::jsonb);

-- step replace:history:schema:holding (additive)
select bolt_history_register('holding','{"audit":true,"check":{"loan_is_owed":{"or":[{"asset_class":{"ne":"loan"}},{"value_base":{"lte":"0"}}]}},"fields":{"asset_class":{"default":"equity","kind":"enum","values":["equity","structured","fund","bond","metal","cash","loan","other"]},"cost_value":{"kind":"decimal","optional":true,"scale":2},"currency":{"kind":"currency"},"detail":{"kind":"text","optional":true},"documents":{"accept":["application/pdf","image/png","image/jpeg","text/csv"],"kind":"file","many":true,"max":"32MiB","optional":true},"insights":{"fields":{"headline":{"kind":"text"},"source_name":{"kind":"text","optional":true},"url":{"kind":"text"}},"key":"url","kind":"object","many":true,"optional":true},"instrument":{"kind":"text"},"isin":{"kind":"text","optional":true},"live_change_pct":{"kind":"decimal","optional":true,"scale":2},"live_price":{"kind":"decimal","optional":true,"scale":4},"live_value_base":{"kind":"decimal","optional":true,"scale":2},"market_value":{"default":0,"kind":"decimal","scale":2},"movement":{"kind":"enum","optional":true,"values":["surge","active","normal","quiet"]},"pnl_history":{"fields":{"date":{"kind":"date"},"pnl":{"kind":"decimal","scale":2},"pnl_pct":{"kind":"decimal","optional":true,"scale":2}},"key":"date","kind":"object","many":true,"optional":true},"price_date":{"kind":"date","optional":true},"price_updated_at":{"kind":"instant","optional":true},"quantity":{"default":1,"kind":"decimal","scale":4},"research_at":{"kind":"instant","optional":true},"research_direction":{"kind":"text","optional":true},"research_summary":{"format":"markdown","kind":"text","optional":true},"risk_rating":{"kind":"int","max":5,"min":1,"optional":true},"sources":{"fields":{"label":{"kind":"text"},"url":{"kind":"text"}},"key":"url","kind":"object","many":true,"optional":true},"symbol":{"kind":"text","optional":true},"unrealised_pl":{"kind":"decimal","optional":true,"scale":2},"value_base":{"kind":"decimal","scale":2},"volume_ratio":{"kind":"decimal","optional":true,"scale":2}},"record_label":"record.instrument","search":{"text":["instrument","symbol","detail","research_direction","research_summary"]}}'::jsonb);

-- step replace:history:schema:portfolio_settings (additive)
select bolt_history_register('portfolio_settings','{"audit":true,"fields":{"base_currency":{"kind":"currency"},"benchmarks":{"fields":{"name":{"kind":"text","optional":true},"symbol":{"kind":"text"}},"key":"symbol","kind":"object","many":true,"optional":true},"recipients":{"fields":{"handle":{"kind":"text"},"name":{"kind":"text","optional":true}},"key":"handle","kind":"object","many":true,"optional":true},"report_via":{"kind":"ref","optional":true,"to":"sys_integration"}},"record_label":"string(record.base_currency)"}'::jsonb);

-- step replace:history:schema:report (additive)
select bolt_history_register('report','{"audit":true,"fields":{"allocation":{"fields":{"label":{"kind":"text"},"value":{"kind":"decimal","scale":2},"weight":{"kind":"decimal","scale":2}},"key":"label","kind":"object","many":true,"optional":true},"base_currency":{"kind":"currency"},"cash":{"kind":"decimal","scale":2},"day_change":{"kind":"decimal","optional":true,"scale":2},"deliveries":{"kind":"ref","many":true,"optional":true,"to":"sys_message"},"for_date":{"kind":"date"},"fx_used":{"fields":{"pair":{"kind":"text"},"rate":{"kind":"decimal","scale":6}},"key":"pair","kind":"object","many":true,"optional":true},"headline":{"format":"markdown","kind":"text"},"invested":{"kind":"decimal","scale":2},"liabilities":{"kind":"decimal","scale":2},"market_view":{"format":"markdown","kind":"text","optional":true},"markets":{"fields":{"change_pct":{"kind":"decimal","optional":true,"scale":2},"instrument":{"kind":"text"},"level":{"kind":"decimal","scale":2}},"key":"instrument","kind":"object","many":true,"optional":true},"net_assets":{"kind":"decimal","scale":2},"positions":{"fields":{"analysis":{"format":"markdown","kind":"text"},"call":{"kind":"enum","values":["buy","sell","hold","watch"]},"change_pct":{"kind":"decimal","optional":true,"scale":2},"confidence":{"kind":"decimal","optional":true,"scale":2},"headline":{"kind":"text"},"instrument":{"kind":"text"},"pnl":{"kind":"decimal","optional":true,"scale":2},"pnl_pct":{"kind":"decimal","optional":true,"scale":2},"symbol":{"kind":"text","optional":true},"weight":{"kind":"decimal","optional":true,"scale":2}},"key":"instrument","kind":"object","many":true,"optional":true},"research_log":{"kind":"text","optional":true},"sources":{"fields":{"at":{"kind":"instant"},"publisher":{"kind":"text"},"title":{"kind":"text"},"url":{"format":"url","kind":"text"}},"key":"url","kind":"object","many":true,"optional":true},"summary":{"format":"markdown","kind":"text"},"unrealised_pl":{"kind":"decimal","optional":true,"scale":2}},"record_label":"string(record.for_date)","search":{"text":["headline","summary","market_view"]},"unique":[{"fields":["for_date"],"name":"one_per_day"}]}'::jsonb);

-- step create:column:sys_user.slack (additive)
-- operational risk: access-exclusive-lock
alter table "sys_user" add column "slack" text;

-- step create:column:sys_user.discord (additive)
-- operational risk: access-exclusive-lock
alter table "sys_user" add column "discord" text;

-- step create:column:portfolio_settings.benchmarks (additive)
-- operational risk: access-exclusive-lock
alter table "portfolio_settings" add column "benchmarks" jsonb;

-- step create:column:report.markets (additive)
-- operational risk: access-exclusive-lock
alter table "report" add column "markets" jsonb;

-- step create:column:report.sources (additive)
-- operational risk: access-exclusive-lock
alter table "report" add column "sources" jsonb;

-- step create:history:schema:report_subscription (additive)
select bolt_history_register('report_subscription','{"audit":true,"fields":{"user":{"default":{"var":"requestor.id"},"kind":"ref","to":"sys_user"}},"record_label":"record.user.name","unique":[{"fields":["user"],"name":"one_per_user"}]}'::jsonb);

-- step data:report.positions (data)
-- hazard: the shape of report.positions changed; rows written under the old shape may not decode under the new one.
-- Transform them here (an UPDATE over report); the check below counts the rows the new shape still refuses.
-- step check:report.positions (validating)
do $store$ declare n bigint; begin
	execute 'select count(*) from "report" where "positions" is not null and store_json_valid("positions", ''{"fields":{"analysis":{"format":"markdown","kind":"text"},"call":{"kind":"enum","values":["buy","sell","hold","watch"]},"change_pct":{"kind":"decimal","optional":true,"scale":2},"confidence":{"kind":"decimal","optional":true,"scale":2},"headline":{"kind":"text"},"instrument":{"kind":"text"},"pnl":{"kind":"decimal","optional":true,"scale":2},"pnl_pct":{"kind":"decimal","optional":true,"scale":2},"symbol":{"kind":"text","optional":true},"weight":{"kind":"decimal","optional":true,"scale":2}},"key":"instrument","kind":"object","many":true,"optional":true}''::jsonb) is not true' into n;
	if n > 0 then raise exception 'the shape of report.positions refuses % existing row(s)', n; end if;
end $store$;

-- step create:constraint:portfolio_settings.portfolio_settings__ck__393079ce (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "portfolio_settings" where (("benchmarks" is null or store_json_valid("benchmarks", ''{"fields":{"name":{"kind":"text","optional":true},"symbol":{"kind":"text"}},"key":"symbol","kind":"object","many":true,"optional":true}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'portfolio_settings__ck__393079ce refuses % existing row(s)', n; end if;
end $store$;
alter table "portfolio_settings" add constraint "portfolio_settings__ck__393079ce" check (("benchmarks" is null or store_json_valid("benchmarks", '{"fields":{"name":{"kind":"text","optional":true},"symbol":{"kind":"text"}},"key":"symbol","kind":"object","many":true,"optional":true}'::jsonb) is true));

-- step create:constraint:report.report__ck__83f2d44c (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "report" where (("markets" is null or store_json_valid("markets", ''{"fields":{"change_pct":{"kind":"decimal","optional":true,"scale":2},"instrument":{"kind":"text"},"level":{"kind":"decimal","scale":2}},"key":"instrument","kind":"object","many":true,"optional":true}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'report__ck__83f2d44c refuses % existing row(s)', n; end if;
end $store$;
alter table "report" add constraint "report__ck__83f2d44c" check (("markets" is null or store_json_valid("markets", '{"fields":{"change_pct":{"kind":"decimal","optional":true,"scale":2},"instrument":{"kind":"text"},"level":{"kind":"decimal","scale":2}},"key":"instrument","kind":"object","many":true,"optional":true}'::jsonb) is true));

-- step create:constraint:report.report__ck__644ed397 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "report" where (("positions" is null or store_json_valid("positions", ''{"fields":{"analysis":{"format":"markdown","kind":"text"},"call":{"kind":"enum","values":["buy","sell","hold","watch"]},"change_pct":{"kind":"decimal","optional":true,"scale":2},"confidence":{"kind":"decimal","optional":true,"scale":2},"headline":{"kind":"text"},"instrument":{"kind":"text"},"pnl":{"kind":"decimal","optional":true,"scale":2},"pnl_pct":{"kind":"decimal","optional":true,"scale":2},"symbol":{"kind":"text","optional":true},"weight":{"kind":"decimal","optional":true,"scale":2}},"key":"instrument","kind":"object","many":true,"optional":true}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'report__ck__644ed397 refuses % existing row(s)', n; end if;
end $store$;
alter table "report" add constraint "report__ck__644ed397" check (("positions" is null or store_json_valid("positions", '{"fields":{"analysis":{"format":"markdown","kind":"text"},"call":{"kind":"enum","values":["buy","sell","hold","watch"]},"change_pct":{"kind":"decimal","optional":true,"scale":2},"confidence":{"kind":"decimal","optional":true,"scale":2},"headline":{"kind":"text"},"instrument":{"kind":"text"},"pnl":{"kind":"decimal","optional":true,"scale":2},"pnl_pct":{"kind":"decimal","optional":true,"scale":2},"symbol":{"kind":"text","optional":true},"weight":{"kind":"decimal","optional":true,"scale":2}},"key":"instrument","kind":"object","many":true,"optional":true}'::jsonb) is true));

-- step create:constraint:report.report__ck__0685a627 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "report" where (("sources" is null or store_json_valid("sources", ''{"fields":{"at":{"kind":"instant"},"publisher":{"kind":"text"},"title":{"kind":"text"},"url":{"format":"url","kind":"text"}},"key":"url","kind":"object","many":true,"optional":true}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'report__ck__0685a627 refuses % existing row(s)', n; end if;
end $store$;
alter table "report" add constraint "report__ck__0685a627" check (("sources" is null or store_json_valid("sources", '{"fields":{"at":{"kind":"instant"},"publisher":{"kind":"text"},"title":{"kind":"text"},"url":{"format":"url","kind":"text"}},"key":"url","kind":"object","many":true,"optional":true}'::jsonb) is true));

-- step create:fk:report_subscription.report_subscription__fk__f8f94a56 (additive)
alter table "report_subscription" add constraint "report_subscription__fk__f8f94a56" foreign key ("user") references "sys_user" ("id") on delete restrict on update restrict;

-- step replace:history:current (additive)
-- operational risk: writes-blocked, table-scan
update bolt_history_current set active=false where active and not (model=any(array['approval_request','holding','portfolio_settings','report','report_subscription','sys_api_key','sys_conversation','sys_envoy','sys_file','sys_integration','sys_invitation','sys_user']::text[]));

-- step create:trigger:report_subscription.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "report_subscription" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

-- step create:index:report_subscription.report_subscription__ix__fccf4300 (additive)
create index "report_subscription__ix__fccf4300" on "report_subscription" ("user");

-- step create:engine:audit:report_subscription (additive)
drop trigger if exists bolt_audit_mark on "report_subscription";
drop trigger if exists bolt_audit on "report_subscription";
create trigger bolt_audit after insert or update or delete on "report_subscription" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[]','[["user","sys_user"]]');
