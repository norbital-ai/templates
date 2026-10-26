-- 0001_initial.sql: 561 step(s), from an empty database to 177e6ad327b897365f676780279a9ecca339efc182289619fb685fa66c25750f.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.

-- step create:function:store_json_valid (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
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
	if coalesce((spec->>'many')::boolean, false) or coalesce((spec->>'multiple')::boolean, false) then
		if shape <> 'array' then return false; end if;
		for item in select v from jsonb_array_elements(value) items(v) loop
			if not store_json_valid(item, spec - array['many','multiple','optional']) then return false; end if;
		end loop;
		return true;
	end if;
	case kind
	when 'json' then
		return case when spec ? 'shape' then store_json_valid(value, spec->'shape') else true end;
	when 'custom' then return true;
	when 'list', 'vector' then
		if shape <> 'array' then return false; end if;
		length_value := jsonb_array_length(value);
		if kind = 'vector' and length_value <> (spec->>'dim')::numeric then return false; end if;
		if kind = 'list' and ((spec ? 'min' and length_value < (spec->>'min')::numeric) or
			(spec ? 'max' and length_value > (spec->>'max')::numeric)) then return false; end if;
		for item in select v from jsonb_array_elements(value) items(v) loop
			if not store_json_valid(item, case when kind = 'vector' then '{"kind":"number"}'::jsonb else spec->'of' end) then return false; end if;
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
		return coalesce(shape = 'object' and jsonb_typeof(value->'collection') = 'string'
			and spec->'to' ? (value->>'collection') and jsonb_typeof(value->'id') = 'string',false);
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
	when 'int', 'number', 'count', 'duration' then
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
		text_value := case when shape = 'object' and jsonb_typeof(value->'$dec') = 'string' then value->>'$dec'
			when shape = 'string' then value #>> '{}' else null end;
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

-- step create:function:store_row_rules (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
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
	field_name text;
	columns jsonb;
	column_name text;
	parent jsonb;
	parent_id jsonb;
	parent_row jsonb;
	trusted boolean;
	anonymised jsonb := '[]'::jsonb;
	at_time timestamptz;
begin
	if mode not in ('write', 'seed', 'restore') or
		(context is not null and jsonb_typeof(context) <> 'object') then
		raise exception 'invalid native write context' using errcode = '22023';
	end if;
	trusted := mode in ('seed', 'restore');
	if tg_op <> 'INSERT' then before_row := to_jsonb(old); end if;
	if tg_op <> 'DELETE' then after_row := to_jsonb(new); end if;
	if tg_op = 'UPDATE' then
		for column_name in select jsonb_array_elements_text(rules->'key') loop
			if before_row->column_name is distinct from after_row->column_name then
				raise exception 'the primary key of % is immutable', tg_table_name
					using errcode = '23514', column = column_name;
			end if;
		end loop;
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
				if coalesce(state_rule->>'edit', 'all') <> 'all' then
					-- A host may admit exact anonymisation columns through its native operation, never a whole-row bypass.
					if to_regprocedure(format('%I.%I(text,text)', tg_table_schema, 'store_anonymise_fields')) is not null then
						execute format('select %I.%I($1,$2)', tg_table_schema, 'store_anonymise_fields')
							into anonymised using tg_table_name, after_row->>'id';
					end if;
					for field_name, columns in select key, value from jsonb_each(rules->'fields') loop
						if field_name = state_name or anonymised ? field_name
							or (jsonb_typeof(state_rule->'edit') = 'array' and state_rule->'edit' ? field_name) then continue; end if;
						for column_name in select jsonb_array_elements_text(columns) loop
							if before_row->column_name is distinct from after_row->column_name then
								raise exception '% is locked while % is %', field_name, state_name, before_row->>state_name
									using errcode = '23514', column = field_name;
								end if;
						end loop;
					end loop;
				end if;
			end if;
		end loop;
		for parent in select value from jsonb_array_elements(rules->'parents') loop
			for parent_id in
				select distinct value from jsonb_array_elements(jsonb_build_array(
					before_row->(parent->>'column'), after_row->(parent->>'column')
				)) where value <> 'null'::jsonb order by value
			loop
				execute format('select to_jsonb(p) from %I.%I p where p.%I = $1::%s for share',
					tg_table_schema, parent->>'table', parent->>'key', parent->>'type')
					into parent_row using parent_id #>> '{}';
				if parent_row is null then continue; end if;
				for state_name, state_spec in select key, value from jsonb_each(parent->'states') loop
					state_rule := state_spec->'states'->(parent_row->>state_name);
					if coalesce(state_rule->>'edit', 'all') <> 'all' and
						not coalesce(jsonb_typeof(state_rule->'edit') = 'array' and state_rule->'edit' ? (parent->>'relation'), false) then
						raise exception 'relation % is locked while % is %', parent->>'relation', state_name, parent_row->>state_name
							using errcode = '23514', column = parent->>'column';
					end if;
				end loop;
			end loop;
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

-- step create:engine:bolt_audit (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
create or replace function bolt_write_context() returns jsonb language plpgsql volatile as $bolt_audit$
declare value jsonb;
begin
	value := nullif(current_setting('bolt.write', true), '')::jsonb;
	if value is null then return null; end if;
	if jsonb_typeof(value) is distinct from 'object'
		or jsonb_typeof(value->'token') is distinct from 'string' then
		raise exception using errcode='22023', message='invalid native write context';
	end if;
	if to_regclass('pg_temp.bolt_write_context') is null
		or to_regclass('pg_temp.bolt_write_targets') is null then return null; end if;
	select saved.context into value from pg_temp.bolt_write_context saved where saved.token=value->>'token';
	if not found then return null; end if;
	if jsonb_typeof(value) is distinct from 'object'
		or jsonb_typeof(value->'token') is distinct from 'string'
		or jsonb_typeof(value->'now') is distinct from 'string'
		or jsonb_typeof(value->'actor') is distinct from 'string'
		or coalesce(value->>'mode', '') not in ('write', 'seed', 'restore') then
		raise exception using errcode='22023', message='invalid native write context';
	end if;
	return value;
end;
$bolt_audit$;
create or replace function store_anonymise_fields(table_name text, record_id text) returns jsonb language plpgsql volatile as $bolt_audit$
declare context jsonb; key text; fields jsonb;
begin
	context := bolt_write_context();
	key := table_name || '/' || record_id;
	if context is null or context->>'mode' <> 'write'
		or to_regclass('pg_temp.bolt_erased') is null then return '[]'::jsonb; end if;
	select target.anonymise into fields from pg_temp.bolt_write_targets target
	where target.token=context->>'token' and target.record_key=key and target.direct and target.erased
		and exists (select 1 from pg_temp.bolt_erased erased
			where erased.token=target.token and erased.c=table_name and erased.id=record_id);
	if jsonb_typeof(fields) is distinct from 'array' then return '[]'::jsonb; end if;
	return fields;
end;
$bolt_audit$;
create or replace function bolt_audit_mark() returns trigger language plpgsql volatile as $bolt_audit$
declare context jsonb; old_row jsonb; new_row jsonb; key text; marked boolean; direct_row boolean;
begin
	context := bolt_write_context();
	if context is not null then
		old_row := case when TG_OP='INSERT' then null else to_jsonb(OLD) end;
		new_row := case when TG_OP='DELETE' then null else to_jsonb(NEW) end;
		key := TG_TABLE_NAME || '/' || coalesce(new_row->>'id', old_row->>'id');
		select target.erased,target.direct into marked,direct_row from pg_temp.bolt_write_targets target
		where target.token=context->>'token' and target.record_key=key;
		marked := coalesce(marked,false);
		if not marked and not coalesce(direct_row,false) then
			select exists (
				select 1 from (values (old_row), (new_row)) image(j)
				cross join jsonb_array_elements(TG_ARGV[1]::jsonb) edge
				join pg_temp.bolt_erased parent on parent.token=context->>'token'
					and parent.c=edge->>1 and parent.id=image.j->>(edge->>0)
			) into marked;
		end if;
		if marked then
			insert into pg_temp.bolt_erased(token,c,id)
			values(context->>'token',TG_TABLE_NAME,coalesce(new_row->>'id',old_row->>'id'))
			on conflict do nothing;
		end if;
	end if;
	if TG_OP='DELETE' then return OLD; else return NEW; end if;
end;
$bolt_audit$;
create or replace function bolt_audit() returns trigger language plpgsql volatile as $bolt_audit$
declare context jsonb; old_row jsonb; new_row jsonb; row_id text; key text; revision_number int;
	operation text; reason text; history_reason text; source_revision int; erased_row boolean := false;
	explicit_reason text; explicit_erased boolean; ref_edge jsonb; parent_live boolean;
	held_request uuid; changes jsonb; native_at timestamptz; native_actor text; native_request uuid;
begin
	old_row := case when TG_OP='INSERT' then null else to_jsonb(OLD) end;
	new_row := case when TG_OP='DELETE' then null else to_jsonb(NEW) end;
	row_id := coalesce(new_row->>'id',old_row->>'id');
	key := TG_TABLE_NAME || '/' || row_id;
	operation := case TG_OP when 'INSERT' then 'create' when 'DELETE' then 'delete' else 'update' end;
	revision_number := case when TG_OP='DELETE' then (old_row->>'revision')::int + 1 else (new_row->>'revision')::int end;
	context := bolt_write_context();
	if context is null then
		with images(j) as (values (old_row),(new_row)), touched(c,id) as (
			select TG_TABLE_NAME::text,j->>'id' from images
			union
			select edge->>1,j->>(edge->>0) from images cross join jsonb_array_elements(TG_ARGV[0]::jsonb) edge
		)
		select a.id into held_request from bolt_approvals a
		where a.state in ('Pending','ChangesRequested') and exists (
			select 1 from jsonb_array_elements(a.records) AS entry(value) join touched t
			on t.c=entry.value->>'collection' and t.id=entry.value->>'id'
		) order by a.id limit 1 for update;
		if found then
			raise exception using errcode='BA001', message='underApproval ' || held_request::text || ' Under approval: raw writes cannot change this record or its owned children.';
		end if;
		-- An AFTER trigger is not nested inside the referential action that fired it (pg_trigger_depth is 1 for a
		-- cascaded row), so a row whose own referential parent is already gone was removed or unlinked by that action.
		reason := 'direct';
		if TG_OP <> 'INSERT' then
			for ref_edge in select value from jsonb_array_elements(coalesce(TG_ARGV[1],'[]')::jsonb) loop
				if old_row->>(ref_edge->>0) is not null then
					execute format('select exists(select 1 from %I where id::text = $1)', ref_edge->>1)
						using old_row->>(ref_edge->>0) into parent_live;
					if not parent_live then reason := 'cascade'; exit; end if;
				end if;
			end loop;
		end if;
		native_at := clock_timestamp();
		native_actor := 'sql';
	else
		select exists(select 1 from pg_temp.bolt_erased where token=context->>'token' and c=TG_TABLE_NAME and id=row_id) into erased_row;
		reason := case when context->>'mode'='seed' then 'seed' else 'cascade' end;
		select origin.cause,origin.erased into explicit_reason,explicit_erased from pg_temp.bolt_origins origin
		where origin.token=context->>'token' and origin.c=TG_TABLE_NAME and origin.id=row_id
			and origin.revision=revision_number and origin.op=operation;
		if found then reason := explicit_reason; erased_row := explicit_erased; end if;
		native_at := (context->>'now')::timestamptz;
		native_actor := context->>'actor';
		native_request := (context->>'request')::uuid;
		if reason='direct' then
			select target.restored into source_revision from pg_temp.bolt_write_targets target
			where target.token=context->>'token' and target.record_key=key and target.direct;
		end if;
	end if;
	history_reason := case when source_revision is null then reason else 'restored' end;
	changes := case when operation='create' or (erased_row and operation='update') then new_row - array['bolt_search','bolt_embedding']
		when operation='delete' then '{}'::jsonb else (
			select coalesce(jsonb_object_agg(k,v),'{}'::jsonb) from jsonb_each(new_row) entry(k,v)
			where k not in ('revision','updated_at','updated_by','bolt_search','bolt_embedding') and old_row->k is distinct from v
		) end;
	if row_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
		insert into bolt_history(collection,record,revision,at,actor,op,cause,changes,restored_from,request,operation,meta)
		values(TG_TABLE_NAME,row_id::uuid,revision_number,native_at,native_actor,operation,history_reason,changes,source_revision,native_request,nullif(current_setting('bolt.audit',true),''),
		jsonb_build_object('id',row_id,'revision',coalesce(new_row,old_row)->'revision','updated_at',coalesce(new_row,old_row)->'updated_at','updated_by',coalesce(new_row,old_row)->'updated_by','created_at',coalesce(new_row,old_row)->'created_at','created_by',coalesce(new_row,old_row)->'created_by'));
	end if;
	if context is not null and to_regclass('pg_temp.bolt_changes') is not null then
		insert into pg_temp.bolt_changes(token,c,id,revision,op,cause,erased,o,n)
		values(context->>'token',TG_TABLE_NAME,row_id,revision_number,operation,reason,erased_row,old_row,new_row);
	end if;
	return null;
end;
$bolt_audit$;

-- step create:table:approval_request (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
create table "approval_request" ("id" uuid primary key);

-- step create:table:requestor (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
create table "requestor" ("id" text primary key);

-- step create:table:sys_api_key (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
create table "sys_api_key" ("id" text primary key);

-- step create:table:sys_challenge (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
create table "sys_challenge" ("address_mac" text primary key);

-- step create:table:sys_config (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
create table "sys_config" ("key" text primary key);

-- step create:table:sys_conversation (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
create table "sys_conversation" ("id" text primary key);

-- step create:table:sys_file (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
create table "sys_file" ("id" text primary key);

-- step create:table:sys_inbox (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
create table "sys_inbox" ("id" uuid primary key);

-- step create:table:sys_integration (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
create table "sys_integration" ("id" text primary key);

-- step create:table:sys_invitation (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
create table "sys_invitation" ("id" text primary key);

-- step create:table:sys_message (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
create table "sys_message" ("id" text primary key);

-- step create:table:sys_notification (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
create table "sys_notification" ("id" text primary key);

-- step create:table:sys_outbox (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
create table "sys_outbox" ("id" uuid primary key);

-- step create:table:sys_run (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
create table "sys_run" ("id" text primary key);

-- step create:table:sys_session (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
create table "sys_session" ("id" text primary key);

-- step create:table:sys_sync (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
create table "sys_sync" ("id" uuid primary key);

-- step create:table:sys_sync_row (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
create table "sys_sync_row" ("id" uuid primary key);

-- step create:table:sys_user (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
create table "sys_user" ("id" text primary key);

-- step create:table:notes (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
create table "notes" ("id" uuid primary key, revision int not null default 1, created_at timestamptz not null default now(), created_by text, updated_at timestamptz not null default now(), updated_by text);

-- step create:engine:bolt_history (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
create table if not exists bolt_history (collection text not null, record uuid not null, revision int not null, at timestamptz not null default now(), actor text, op text not null check (op in ('create', 'update', 'delete')), cause text not null check (cause in ('direct', 'cascade', 'derived', 'seed', 'erased', 'restored')), changes jsonb not null default '{}', restored_from int check ((cause = 'restored') = (restored_from is not null)), request uuid, operation text);
alter table bolt_history add column if not exists operation text;
alter table bolt_history add column if not exists meta jsonb not null default '{}'::jsonb;
create index if not exists bolt_history__operation on bolt_history(operation) where operation is not null;
create index if not exists bolt_history__record on bolt_history (collection, record, revision);

-- step create:engine:bolt_approvals (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
create table if not exists bolt_approvals (id uuid primary key, state text not null check (state in ('Pending', 'ChangesRequested', 'Approved', 'Rejected', 'Superseded')), step int not null, collection text not null, record text not null, action text not null, requestor text not null, requestor_user text, route jsonb not null, records jsonb not null, log jsonb not null default '[]', at timestamptz not null, closed_at timestamptz, seq bigint generated always as identity);
create index if not exists bolt_approvals__open on bolt_approvals (state) where state in ('Pending', 'ChangesRequested');

-- step create:column:approval_request.collection_name (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "approval_request" add column "collection_name" text;

-- step create:column:approval_request.record_id (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "approval_request" add column "record_id" text;

-- step create:column:approval_request.action (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "approval_request" add column "action" text;

-- step create:column:approval_request.status (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "approval_request" add column "status" text;

-- step create:column:approval_request.step (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "approval_request" add column "step" int;

-- step create:column:approval_request.steps (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "approval_request" add column "steps" int;

-- step create:column:approval_request.step_names (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "approval_request" add column "step_names" jsonb;

-- step create:column:approval_request.approver_teams (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "approval_request" add column "approver_teams" jsonb;

-- step create:column:approval_request.approver_users (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "approval_request" add column "approver_users" jsonb;

-- step create:column:approval_request.superseder_teams (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "approval_request" add column "superseder_teams" jsonb;

-- step create:column:approval_request.closed_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "approval_request" add column "closed_at" timestamptz;

-- step create:column:approval_request.closed_by (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "approval_request" add column "closed_by" text;

-- step create:column:approval_request.revision (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "approval_request" add column "revision" int default '1'::int;

-- step create:column:approval_request.created_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "approval_request" add column "created_at" timestamptz;

-- step create:column:requestor.user_id (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "requestor" add column "user_id" text;

-- step create:column:sys_api_key.name (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_api_key" add column "name" text;

-- step create:column:sys_api_key.prefix (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_api_key" add column "prefix" text;

-- step create:column:sys_api_key.hash (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_api_key" add column "hash" text;

-- step create:column:sys_api_key.team (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_api_key" add column "team" text;

-- step create:column:sys_api_key.revoked_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_api_key" add column "revoked_at" timestamptz;

-- step create:column:sys_api_key.last_used_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_api_key" add column "last_used_at" timestamptz;

-- step create:column:sys_api_key.revision (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_api_key" add column "revision" int default '1'::int;

-- step create:column:sys_api_key.created_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_api_key" add column "created_at" timestamptz default (now());

-- step create:column:sys_challenge.code_mac (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_challenge" add column "code_mac" text;

-- step create:column:sys_challenge.attempts (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_challenge" add column "attempts" int default '0'::int;

-- step create:column:sys_challenge.expires_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_challenge" add column "expires_at" timestamptz;

-- step create:column:sys_config.value (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_config" add column "value" text;

-- step create:column:sys_conversation.created_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_conversation" add column "created_at" timestamptz default (now());

-- step create:column:sys_conversation.title (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_conversation" add column "title" text;

-- step create:column:sys_conversation.owner (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_conversation" add column "owner" text;

-- step create:column:sys_conversation.envoy (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_conversation" add column "envoy" text;

-- step create:column:sys_conversation.thread (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_conversation" add column "thread" text;

-- step create:column:sys_conversation.kind (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_conversation" add column "kind" text;

-- step create:column:sys_conversation.participants (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_conversation" add column "participants" jsonb;

-- step create:column:sys_conversation.parent (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_conversation" add column "parent" text;

-- step create:column:sys_conversation.run (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_conversation" add column "run" text;

-- step create:column:sys_conversation.inputs (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_conversation" add column "inputs" jsonb default '[]'::jsonb;

-- step create:column:sys_conversation.outputs (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_conversation" add column "outputs" jsonb default '[]'::jsonb;

-- step create:column:sys_conversation.status (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_conversation" add column "status" text default 'idle'::text;

-- step create:column:sys_conversation.lease_until (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_conversation" add column "lease_until" timestamptz;

-- step create:column:sys_conversation.model (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_conversation" add column "model" text default 'default'::text;

-- step create:column:sys_conversation.plan (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_conversation" add column "plan" jsonb;

-- step create:column:sys_conversation.goals (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_conversation" add column "goals" jsonb;

-- step create:column:sys_conversation.read (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_conversation" add column "read" jsonb default '{}'::jsonb;

-- step create:column:sys_conversation.revision (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_conversation" add column "revision" int default '1'::int;

-- step create:column:sys_conversation.updated_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_conversation" add column "updated_at" timestamptz default (now());

-- step create:column:sys_file.name (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_file" add column "name" text;

-- step create:column:sys_file.mime (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_file" add column "mime" text;

-- step create:column:sys_file.size (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_file" add column "size" int;

-- step create:column:sys_file.key (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_file" add column "key" text;

-- step create:column:sys_file.sha256 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_file" add column "sha256" text;

-- step create:column:sys_file.field (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_file" add column "field" text;

-- step create:column:sys_file.revision (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_file" add column "revision" int default '1'::int;

-- step create:column:sys_file.created_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_file" add column "created_at" timestamptz;

-- step create:column:sys_file.created_by (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_file" add column "created_by" text;

-- step create:column:sys_file.updated_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_file" add column "updated_at" timestamptz;

-- step create:column:sys_file.updated_by (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_file" add column "updated_by" text;

-- step create:column:sys_inbox.sync (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_inbox" add column "sync" text;

-- step create:column:sys_inbox.delivery (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_inbox" add column "delivery" text;

-- step create:column:sys_inbox.received_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_inbox" add column "received_at" timestamptz;

-- step create:column:sys_inbox.headers (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_inbox" add column "headers" jsonb;

-- step create:column:sys_inbox.body (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_inbox" add column "body" jsonb;

-- step create:column:sys_inbox.consumed_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_inbox" add column "consumed_at" timestamptz;

-- step create:column:sys_integration.integration (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_integration" add column "integration" text;

-- step create:column:sys_integration.name (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_integration" add column "name" text;

-- step create:column:sys_integration.named (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_integration" add column "named" boolean default false;

-- step create:column:sys_integration.envoy (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_integration" add column "envoy" text;

-- step create:column:sys_integration.active (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_integration" add column "active" boolean default true;

-- step create:column:sys_integration.configuration (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_integration" add column "configuration" jsonb default '{}'::jsonb;

-- step create:column:sys_integration.import_start (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_integration" add column "import_start" jsonb;

-- step create:column:sys_integration.status (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_integration" add column "status" jsonb;

-- step create:column:sys_integration.epoch (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_integration" add column "epoch" text;

-- step create:column:sys_integration.revision (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_integration" add column "revision" int default '1'::int;

-- step create:column:sys_invitation.email (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_invitation" add column "email" text;

-- step create:column:sys_invitation.phone (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_invitation" add column "phone" text;

-- step create:column:sys_invitation.external (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_invitation" add column "external" boolean default false;

-- step create:column:sys_invitation.team (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_invitation" add column "team" text;

-- step create:column:sys_invitation.party (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_invitation" add column "party" jsonb;

-- step create:column:sys_invitation.expires_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_invitation" add column "expires_at" timestamptz;

-- step create:column:sys_invitation.accepted_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_invitation" add column "accepted_at" timestamptz;

-- step create:column:sys_invitation.revoked_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_invitation" add column "revoked_at" timestamptz;

-- step create:column:sys_invitation.revision (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_invitation" add column "revision" int default '1'::int;

-- step create:column:sys_message.created_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_message" add column "created_at" timestamptz default (now());

-- step create:column:sys_message.conversation (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_message" add column "conversation" text;

-- step create:column:sys_message.seq (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: table-rewrite: may rewrite the table; disk use and work grow with existing data.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_message" add column "seq" bigint generated by default as identity;

-- step create:column:sys_message.role (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_message" add column "role" text;

-- step create:column:sys_message.content (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_message" add column "content" jsonb;

-- step create:column:sys_message.preview (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_message" add column "preview" text;

-- step create:column:sys_message.text (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_message" add column "text" text;

-- step create:column:sys_message.state (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_message" add column "state" text;

-- step create:column:sys_message.mode (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_message" add column "mode" text;

-- step create:column:sys_message.as (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_message" add column "as" jsonb;

-- step create:column:sys_message.author (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_message" add column "author" text;

-- step create:column:sys_message.meta (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_message" add column "meta" jsonb;

-- step create:column:sys_message.supersedes (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_message" add column "supersedes" text;

-- step create:column:sys_message.turn (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_message" add column "turn" text;

-- step create:column:sys_message.read_by (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_message" add column "read_by" text;

-- step create:column:sys_message.delivered_turn (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_message" add column "delivered_turn" text;

-- step create:column:sys_message.about (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_message" add column "about" jsonb;

-- step create:column:sys_message.direction (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_message" add column "direction" text;

-- step create:column:sys_message.origin (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_message" add column "origin" text;

-- step create:column:sys_message.provider_id (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_message" add column "provider_id" text;

-- step create:column:sys_message.version (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_message" add column "version" text;

-- step create:column:sys_message.sender (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_message" add column "sender" text;

-- step create:column:sys_message.sender_name (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_message" add column "sender_name" text;

-- step create:column:sys_message.sent_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_message" add column "sent_at" timestamptz;

-- step create:column:sys_message.source_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_message" add column "source_at" timestamptz;

-- step create:column:sys_message.invocation (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_message" add column "invocation" text;

-- step create:column:sys_message.addressed (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_message" add column "addressed" boolean;

-- step create:column:sys_message.refused (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_message" add column "refused" text;

-- step create:column:sys_message.email (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_message" add column "email" jsonb;

-- step create:column:sys_message.reply_to (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_message" add column "reply_to" text;

-- step create:column:sys_message.deleted_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_message" add column "deleted_at" timestamptz;

-- step create:column:sys_message.edited_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_message" add column "edited_at" timestamptz;

-- step create:column:sys_message.status (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_message" add column "status" text;

-- step create:column:sys_message.attempts (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_message" add column "attempts" int default '0'::int;

-- step create:column:sys_message.next_attempt_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_message" add column "next_attempt_at" timestamptz;

-- step create:column:sys_message.claimed_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_message" add column "claimed_at" timestamptz;

-- step create:column:sys_message.error (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_message" add column "error" text;

-- step create:column:sys_message.message (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_message" add column "message" jsonb;

-- step create:column:sys_message.thread (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_message" add column "thread" text;

-- step create:column:sys_message.epoch (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_message" add column "epoch" text;

-- step create:column:sys_message.delivery (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_message" add column "delivery" jsonb default '[]'::jsonb;

-- step create:column:sys_message.presume_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_message" add column "presume_at" timestamptz;

-- step create:column:sys_notification.recipient (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_notification" add column "recipient" jsonb;

-- step create:column:sys_notification.title (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_notification" add column "title" text;

-- step create:column:sys_notification.body (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_notification" add column "body" text;

-- step create:column:sys_notification.link (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_notification" add column "link" jsonb;

-- step create:column:sys_notification.attachments (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_notification" add column "attachments" jsonb default '[]'::jsonb;

-- step create:column:sys_notification.once (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_notification" add column "once" text;

-- step create:column:sys_notification.at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_notification" add column "at" timestamptz;

-- step create:column:sys_notification.member (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_notification" add column "member" text;

-- step create:column:sys_notification.read_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_notification" add column "read_at" timestamptz;

-- step create:column:sys_outbox.seq (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: table-rewrite: may rewrite the table; disk use and work grow with existing data.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_outbox" add column "seq" bigint generated by default as identity;

-- step create:column:sys_outbox.sync (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_outbox" add column "sync" text;

-- step create:column:sys_outbox.model (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_outbox" add column "model" text;

-- step create:column:sys_outbox.record (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_outbox" add column "record" text;

-- step create:column:sys_outbox.op (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_outbox" add column "op" text;

-- step create:column:sys_outbox.record_revision (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_outbox" add column "record_revision" int;

-- step create:column:sys_outbox.image (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_outbox" add column "image" jsonb;

-- step create:column:sys_outbox.changed (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_outbox" add column "changed" jsonb default '[]'::jsonb;

-- step create:column:sys_outbox.key (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_outbox" add column "key" text;

-- step create:column:sys_outbox.status (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_outbox" add column "status" text default 'queued'::text;

-- step create:column:sys_outbox.attempts (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_outbox" add column "attempts" int default '0'::int;

-- step create:column:sys_outbox.next_attempt_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_outbox" add column "next_attempt_at" timestamptz;

-- step create:column:sys_outbox.claimed_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_outbox" add column "claimed_at" timestamptz;

-- step create:column:sys_outbox.error (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_outbox" add column "error" jsonb;

-- step create:column:sys_outbox.epoch (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_outbox" add column "epoch" text;

-- step create:column:sys_outbox.acked_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_outbox" add column "acked_at" timestamptz;

-- step create:column:sys_outbox.result (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_outbox" add column "result" jsonb;

-- step create:column:sys_outbox.at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_outbox" add column "at" timestamptz;

-- step create:column:sys_run.automation (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_run" add column "automation" text;

-- step create:column:sys_run.input (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_run" add column "input" jsonb;

-- step create:column:sys_run.due_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_run" add column "due_at" timestamptz;

-- step create:column:sys_run.key (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_run" add column "key" text;

-- step create:column:sys_run.cause (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_run" add column "cause" text;

-- step create:column:sys_run.depth (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_run" add column "depth" int;

-- step create:column:sys_run.state (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_run" add column "state" text default 'queued'::text;

-- step create:column:sys_run.attempts (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_run" add column "attempts" int default '0'::int;

-- step create:column:sys_run.leases (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_run" add column "leases" int default '0'::int;

-- step create:column:sys_run.run_key (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_run" add column "run_key" text;

-- step create:column:sys_run.started_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_run" add column "started_at" timestamptz;

-- step create:column:sys_run.finished_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_run" add column "finished_at" timestamptz;

-- step create:column:sys_run.progress (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_run" add column "progress" jsonb;

-- step create:column:sys_run.output (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_run" add column "output" jsonb;

-- step create:column:sys_run.error (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_run" add column "error" jsonb;

-- step create:column:sys_run.results (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_run" add column "results" jsonb default '[]'::jsonb;

-- step create:column:sys_run.actor (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_run" add column "actor" text;

-- step create:column:sys_run.starter (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_run" add column "starter" jsonb;

-- step create:column:sys_session.token_hash (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_session" add column "token_hash" text;

-- step create:column:sys_session.via (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_session" add column "via" text;

-- step create:column:sys_session.created_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_session" add column "created_at" timestamptz;

-- step create:column:sys_session.expires_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_session" add column "expires_at" timestamptz;

-- step create:column:sys_session.refreshed_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_session" add column "refreshed_at" timestamptz;

-- step create:column:sys_session.agent (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_session" add column "agent" text;

-- step create:column:sys_sync.sync (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_sync" add column "sync" text;

-- step create:column:sys_sync.partition (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_sync" add column "partition" text default ''::text;

-- step create:column:sys_sync.cursor (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_sync" add column "cursor" jsonb;

-- step create:column:sys_sync.cycle (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_sync" add column "cycle" int default '0'::int;

-- step create:column:sys_sync.phase (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_sync" add column "phase" text default 'read'::text;

-- step create:column:sys_sync.health (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_sync" add column "health" jsonb;

-- step create:column:sys_sync.digest (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_sync" add column "digest" text;

-- step create:column:sys_sync.version (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_sync" add column "version" int default '0'::int;

-- step create:column:sys_sync.started_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_sync" add column "started_at" timestamptz default (now());

-- step create:column:sys_sync.last_read_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_sync" add column "last_read_at" timestamptz;

-- step create:column:sys_sync.last_change_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_sync" add column "last_change_at" timestamptz;

-- step create:column:sys_sync.last_hint_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_sync" add column "last_hint_at" timestamptz;

-- step create:column:sys_sync_row.sync (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_sync_row" add column "sync" text;

-- step create:column:sys_sync_row.partition (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_sync_row" add column "partition" text default ''::text;

-- step create:column:sys_sync_row.remote_id (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_sync_row" add column "remote_id" text;

-- step create:column:sys_sync_row.record (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_sync_row" add column "record" text;

-- step create:column:sys_sync_row.remote_version (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_sync_row" add column "remote_version" text;

-- step create:column:sys_sync_row.cycle (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_sync_row" add column "cycle" int;

-- step create:column:sys_sync_row.acked_revision (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_sync_row" add column "acked_revision" int;

-- step create:column:sys_user.email (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_user" add column "email" text;

-- step create:column:sys_user.name (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_user" add column "name" text;

-- step create:column:sys_user.kind (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_user" add column "kind" text default 'staff'::text;

-- step create:column:sys_user.active (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_user" add column "active" boolean default true;

-- step create:column:sys_user.admin (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_user" add column "admin" boolean default false;

-- step create:column:sys_user.signup (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_user" add column "signup" boolean default false;

-- step create:column:sys_user.team (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_user" add column "team" text;

-- step create:column:sys_user.party (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_user" add column "party" jsonb;

-- step create:column:sys_user.phone (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_user" add column "phone" text;

-- step create:column:sys_user.telegram (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_user" add column "telegram" text;

-- step create:column:sys_user.revision (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_user" add column "revision" int default '1'::int;

-- step create:column:sys_user.created_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_user" add column "created_at" timestamptz default (now());

-- step create:column:sys_user.party_id (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: table-rewrite: may rewrite the table; disk use and work grow with existing data.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_user" add column "party_id" text generated always as ((("party" ->> 'id'))::text) stored;

-- step create:column:sys_user.phone_key (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: table-rewrite: may rewrite the table; disk use and work grow with existing data.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_user" add column "phone_key" text generated always as ((regexp_replace("phone", '\D', '', 'g'))::text) stored;

-- step create:column:notes.title (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "notes" add column "title" text;

-- step create:column:notes.body (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "notes" add column "body" text;

-- step create:column:requestor.approval_request_id (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "requestor" add column "approval_request_id" uuid;

-- step create:column:sys_api_key.created_by (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_api_key" add column "created_by" text;

-- step create:column:sys_conversation.integration (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_conversation" add column "integration" text;

-- step create:column:sys_inbox.instance (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_inbox" add column "instance" text;

-- step create:column:sys_integration.owner (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_integration" add column "owner" text;

-- step create:column:sys_invitation.invited_by (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_invitation" add column "invited_by" text;

-- step create:column:sys_message.integration (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_message" add column "integration" text;

-- step create:column:sys_outbox.instance (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_outbox" add column "instance" text;

-- step create:column:sys_outbox.writer (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_outbox" add column "writer" text;

-- step create:column:sys_session.user (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_session" add column "user" text;

-- step create:column:sys_session.impersonated_by (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_session" add column "impersonated_by" text;

-- step create:column:sys_sync.instance (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_sync" add column "instance" text;

-- step create:column:sys_sync_row.instance (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_sync_row" add column "instance" text;

-- step create:default:approval_request.revision (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "approval_request" alter column "revision" set default '1'::int;

-- step create:default:sys_api_key.revision (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_api_key" alter column "revision" set default '1'::int;

-- step create:default:sys_api_key.created_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_api_key" alter column "created_at" set default (now());

-- step create:default:sys_challenge.attempts (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_challenge" alter column "attempts" set default '0'::int;

-- step create:default:sys_conversation.created_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_conversation" alter column "created_at" set default (now());

-- step create:default:sys_conversation.inputs (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_conversation" alter column "inputs" set default '[]'::jsonb;

-- step create:default:sys_conversation.outputs (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_conversation" alter column "outputs" set default '[]'::jsonb;

-- step create:default:sys_conversation.status (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_conversation" alter column "status" set default 'idle'::text;

-- step create:default:sys_conversation.model (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_conversation" alter column "model" set default 'default'::text;

-- step create:default:sys_conversation.read (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_conversation" alter column "read" set default '{}'::jsonb;

-- step create:default:sys_conversation.revision (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_conversation" alter column "revision" set default '1'::int;

-- step create:default:sys_conversation.updated_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_conversation" alter column "updated_at" set default (now());

-- step create:default:sys_file.revision (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_file" alter column "revision" set default '1'::int;

-- step create:default:sys_integration.named (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_integration" alter column "named" set default false;

-- step create:default:sys_integration.active (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_integration" alter column "active" set default true;

-- step create:default:sys_integration.configuration (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_integration" alter column "configuration" set default '{}'::jsonb;

-- step create:default:sys_integration.revision (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_integration" alter column "revision" set default '1'::int;

-- step create:default:sys_invitation.external (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_invitation" alter column "external" set default false;

-- step create:default:sys_invitation.revision (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_invitation" alter column "revision" set default '1'::int;

-- step create:default:sys_message.created_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_message" alter column "created_at" set default (now());

-- step create:default:sys_message.attempts (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_message" alter column "attempts" set default '0'::int;

-- step create:default:sys_message.delivery (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_message" alter column "delivery" set default '[]'::jsonb;

-- step create:default:sys_notification.attachments (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_notification" alter column "attachments" set default '[]'::jsonb;

-- step create:default:sys_outbox.changed (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_outbox" alter column "changed" set default '[]'::jsonb;

-- step create:default:sys_outbox.status (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_outbox" alter column "status" set default 'queued'::text;

-- step create:default:sys_outbox.attempts (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_outbox" alter column "attempts" set default '0'::int;

-- step create:default:sys_run.state (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_run" alter column "state" set default 'queued'::text;

-- step create:default:sys_run.attempts (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_run" alter column "attempts" set default '0'::int;

-- step create:default:sys_run.leases (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_run" alter column "leases" set default '0'::int;

-- step create:default:sys_run.results (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_run" alter column "results" set default '[]'::jsonb;

-- step create:default:sys_sync.partition (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_sync" alter column "partition" set default ''::text;

-- step create:default:sys_sync.cycle (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_sync" alter column "cycle" set default '0'::int;

-- step create:default:sys_sync.phase (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_sync" alter column "phase" set default 'read'::text;

-- step create:default:sys_sync.version (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_sync" alter column "version" set default '0'::int;

-- step create:default:sys_sync.started_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_sync" alter column "started_at" set default (now());

-- step create:default:sys_sync_row.partition (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_sync_row" alter column "partition" set default ''::text;

-- step create:default:sys_user.kind (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_user" alter column "kind" set default 'staff'::text;

-- step create:default:sys_user.active (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_user" alter column "active" set default true;

-- step create:default:sys_user.admin (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_user" alter column "admin" set default false;

-- step create:default:sys_user.signup (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_user" alter column "signup" set default false;

-- step create:default:sys_user.revision (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_user" alter column "revision" set default '1'::int;

-- step create:default:sys_user.created_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_user" alter column "created_at" set default (now());

-- step create:notNull:approval_request.collection_name (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "approval_request" where "collection_name" is null' into n;
	if n > 0 then raise exception 'notNull:approval_request.collection_name refuses % existing row(s)', n; end if;
end $store$;
alter table "approval_request" alter column "collection_name" set not null;

-- step create:notNull:approval_request.record_id (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "approval_request" where "record_id" is null' into n;
	if n > 0 then raise exception 'notNull:approval_request.record_id refuses % existing row(s)', n; end if;
end $store$;
alter table "approval_request" alter column "record_id" set not null;

-- step create:notNull:approval_request.action (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "approval_request" where "action" is null' into n;
	if n > 0 then raise exception 'notNull:approval_request.action refuses % existing row(s)', n; end if;
end $store$;
alter table "approval_request" alter column "action" set not null;

-- step create:notNull:approval_request.status (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "approval_request" where "status" is null' into n;
	if n > 0 then raise exception 'notNull:approval_request.status refuses % existing row(s)', n; end if;
end $store$;
alter table "approval_request" alter column "status" set not null;

-- step create:notNull:approval_request.step (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "approval_request" where "step" is null' into n;
	if n > 0 then raise exception 'notNull:approval_request.step refuses % existing row(s)', n; end if;
end $store$;
alter table "approval_request" alter column "step" set not null;

-- step create:notNull:approval_request.steps (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "approval_request" where "steps" is null' into n;
	if n > 0 then raise exception 'notNull:approval_request.steps refuses % existing row(s)', n; end if;
end $store$;
alter table "approval_request" alter column "steps" set not null;

-- step create:notNull:approval_request.step_names (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "approval_request" where "step_names" is null' into n;
	if n > 0 then raise exception 'notNull:approval_request.step_names refuses % existing row(s)', n; end if;
end $store$;
alter table "approval_request" alter column "step_names" set not null;

-- step create:notNull:approval_request.approver_teams (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "approval_request" where "approver_teams" is null' into n;
	if n > 0 then raise exception 'notNull:approval_request.approver_teams refuses % existing row(s)', n; end if;
end $store$;
alter table "approval_request" alter column "approver_teams" set not null;

-- step create:notNull:approval_request.approver_users (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "approval_request" where "approver_users" is null' into n;
	if n > 0 then raise exception 'notNull:approval_request.approver_users refuses % existing row(s)', n; end if;
end $store$;
alter table "approval_request" alter column "approver_users" set not null;

-- step create:notNull:approval_request.superseder_teams (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "approval_request" where "superseder_teams" is null' into n;
	if n > 0 then raise exception 'notNull:approval_request.superseder_teams refuses % existing row(s)', n; end if;
end $store$;
alter table "approval_request" alter column "superseder_teams" set not null;

-- step create:notNull:approval_request.revision (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "approval_request" where "revision" is null' into n;
	if n > 0 then raise exception 'notNull:approval_request.revision refuses % existing row(s)', n; end if;
end $store$;
alter table "approval_request" alter column "revision" set not null;

-- step create:notNull:approval_request.created_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "approval_request" where "created_at" is null' into n;
	if n > 0 then raise exception 'notNull:approval_request.created_at refuses % existing row(s)', n; end if;
end $store$;
alter table "approval_request" alter column "created_at" set not null;

-- step create:notNull:requestor.user_id (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "requestor" where "user_id" is null' into n;
	if n > 0 then raise exception 'notNull:requestor.user_id refuses % existing row(s)', n; end if;
end $store$;
alter table "requestor" alter column "user_id" set not null;

-- step create:notNull:sys_api_key.name (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_api_key" where "name" is null' into n;
	if n > 0 then raise exception 'notNull:sys_api_key.name refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_api_key" alter column "name" set not null;

-- step create:notNull:sys_api_key.prefix (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_api_key" where "prefix" is null' into n;
	if n > 0 then raise exception 'notNull:sys_api_key.prefix refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_api_key" alter column "prefix" set not null;

-- step create:notNull:sys_api_key.hash (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_api_key" where "hash" is null' into n;
	if n > 0 then raise exception 'notNull:sys_api_key.hash refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_api_key" alter column "hash" set not null;

-- step create:notNull:sys_api_key.revision (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_api_key" where "revision" is null' into n;
	if n > 0 then raise exception 'notNull:sys_api_key.revision refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_api_key" alter column "revision" set not null;

-- step create:notNull:sys_api_key.created_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_api_key" where "created_at" is null' into n;
	if n > 0 then raise exception 'notNull:sys_api_key.created_at refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_api_key" alter column "created_at" set not null;

-- step create:notNull:sys_challenge.code_mac (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_challenge" where "code_mac" is null' into n;
	if n > 0 then raise exception 'notNull:sys_challenge.code_mac refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_challenge" alter column "code_mac" set not null;

-- step create:notNull:sys_challenge.attempts (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_challenge" where "attempts" is null' into n;
	if n > 0 then raise exception 'notNull:sys_challenge.attempts refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_challenge" alter column "attempts" set not null;

-- step create:notNull:sys_challenge.expires_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_challenge" where "expires_at" is null' into n;
	if n > 0 then raise exception 'notNull:sys_challenge.expires_at refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_challenge" alter column "expires_at" set not null;

-- step create:notNull:sys_config.value (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_config" where "value" is null' into n;
	if n > 0 then raise exception 'notNull:sys_config.value refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_config" alter column "value" set not null;

-- step create:notNull:sys_conversation.created_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_conversation" where "created_at" is null' into n;
	if n > 0 then raise exception 'notNull:sys_conversation.created_at refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_conversation" alter column "created_at" set not null;

-- step create:notNull:sys_conversation.inputs (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_conversation" where "inputs" is null' into n;
	if n > 0 then raise exception 'notNull:sys_conversation.inputs refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_conversation" alter column "inputs" set not null;

-- step create:notNull:sys_conversation.outputs (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_conversation" where "outputs" is null' into n;
	if n > 0 then raise exception 'notNull:sys_conversation.outputs refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_conversation" alter column "outputs" set not null;

-- step create:notNull:sys_conversation.status (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_conversation" where "status" is null' into n;
	if n > 0 then raise exception 'notNull:sys_conversation.status refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_conversation" alter column "status" set not null;

-- step create:notNull:sys_conversation.model (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_conversation" where "model" is null' into n;
	if n > 0 then raise exception 'notNull:sys_conversation.model refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_conversation" alter column "model" set not null;

-- step create:notNull:sys_conversation.read (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_conversation" where "read" is null' into n;
	if n > 0 then raise exception 'notNull:sys_conversation.read refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_conversation" alter column "read" set not null;

-- step create:notNull:sys_conversation.revision (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_conversation" where "revision" is null' into n;
	if n > 0 then raise exception 'notNull:sys_conversation.revision refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_conversation" alter column "revision" set not null;

-- step create:notNull:sys_conversation.updated_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_conversation" where "updated_at" is null' into n;
	if n > 0 then raise exception 'notNull:sys_conversation.updated_at refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_conversation" alter column "updated_at" set not null;

-- step create:notNull:sys_file.name (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_file" where "name" is null' into n;
	if n > 0 then raise exception 'notNull:sys_file.name refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_file" alter column "name" set not null;

-- step create:notNull:sys_file.mime (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_file" where "mime" is null' into n;
	if n > 0 then raise exception 'notNull:sys_file.mime refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_file" alter column "mime" set not null;

-- step create:notNull:sys_file.size (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_file" where "size" is null' into n;
	if n > 0 then raise exception 'notNull:sys_file.size refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_file" alter column "size" set not null;

-- step create:notNull:sys_file.key (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_file" where "key" is null' into n;
	if n > 0 then raise exception 'notNull:sys_file.key refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_file" alter column "key" set not null;

-- step create:notNull:sys_file.sha256 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_file" where "sha256" is null' into n;
	if n > 0 then raise exception 'notNull:sys_file.sha256 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_file" alter column "sha256" set not null;

-- step create:notNull:sys_file.field (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_file" where "field" is null' into n;
	if n > 0 then raise exception 'notNull:sys_file.field refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_file" alter column "field" set not null;

-- step create:notNull:sys_file.revision (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_file" where "revision" is null' into n;
	if n > 0 then raise exception 'notNull:sys_file.revision refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_file" alter column "revision" set not null;

-- step create:notNull:sys_file.created_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_file" where "created_at" is null' into n;
	if n > 0 then raise exception 'notNull:sys_file.created_at refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_file" alter column "created_at" set not null;

-- step create:notNull:sys_inbox.sync (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_inbox" where "sync" is null' into n;
	if n > 0 then raise exception 'notNull:sys_inbox.sync refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_inbox" alter column "sync" set not null;

-- step create:notNull:sys_inbox.delivery (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_inbox" where "delivery" is null' into n;
	if n > 0 then raise exception 'notNull:sys_inbox.delivery refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_inbox" alter column "delivery" set not null;

-- step create:notNull:sys_inbox.received_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_inbox" where "received_at" is null' into n;
	if n > 0 then raise exception 'notNull:sys_inbox.received_at refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_inbox" alter column "received_at" set not null;

-- step create:notNull:sys_integration.integration (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_integration" where "integration" is null' into n;
	if n > 0 then raise exception 'notNull:sys_integration.integration refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_integration" alter column "integration" set not null;

-- step create:notNull:sys_integration.name (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_integration" where "name" is null' into n;
	if n > 0 then raise exception 'notNull:sys_integration.name refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_integration" alter column "name" set not null;

-- step create:notNull:sys_integration.named (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_integration" where "named" is null' into n;
	if n > 0 then raise exception 'notNull:sys_integration.named refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_integration" alter column "named" set not null;

-- step create:notNull:sys_integration.active (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_integration" where "active" is null' into n;
	if n > 0 then raise exception 'notNull:sys_integration.active refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_integration" alter column "active" set not null;

-- step create:notNull:sys_integration.configuration (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_integration" where "configuration" is null' into n;
	if n > 0 then raise exception 'notNull:sys_integration.configuration refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_integration" alter column "configuration" set not null;

-- step create:notNull:sys_integration.revision (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_integration" where "revision" is null' into n;
	if n > 0 then raise exception 'notNull:sys_integration.revision refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_integration" alter column "revision" set not null;

-- step create:notNull:sys_invitation.external (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_invitation" where "external" is null' into n;
	if n > 0 then raise exception 'notNull:sys_invitation.external refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_invitation" alter column "external" set not null;

-- step create:notNull:sys_invitation.expires_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_invitation" where "expires_at" is null' into n;
	if n > 0 then raise exception 'notNull:sys_invitation.expires_at refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_invitation" alter column "expires_at" set not null;

-- step create:notNull:sys_invitation.revision (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_invitation" where "revision" is null' into n;
	if n > 0 then raise exception 'notNull:sys_invitation.revision refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_invitation" alter column "revision" set not null;

-- step create:notNull:sys_message.created_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_message" where "created_at" is null' into n;
	if n > 0 then raise exception 'notNull:sys_message.created_at refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_message" alter column "created_at" set not null;

-- step create:notNull:sys_message.attempts (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_message" where "attempts" is null' into n;
	if n > 0 then raise exception 'notNull:sys_message.attempts refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_message" alter column "attempts" set not null;

-- step create:notNull:sys_message.delivery (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_message" where "delivery" is null' into n;
	if n > 0 then raise exception 'notNull:sys_message.delivery refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_message" alter column "delivery" set not null;

-- step create:notNull:sys_notification.recipient (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_notification" where "recipient" is null' into n;
	if n > 0 then raise exception 'notNull:sys_notification.recipient refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_notification" alter column "recipient" set not null;

-- step create:notNull:sys_notification.title (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_notification" where "title" is null' into n;
	if n > 0 then raise exception 'notNull:sys_notification.title refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_notification" alter column "title" set not null;

-- step create:notNull:sys_notification.attachments (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_notification" where "attachments" is null' into n;
	if n > 0 then raise exception 'notNull:sys_notification.attachments refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_notification" alter column "attachments" set not null;

-- step create:notNull:sys_notification.at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_notification" where "at" is null' into n;
	if n > 0 then raise exception 'notNull:sys_notification.at refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_notification" alter column "at" set not null;

-- step create:notNull:sys_outbox.sync (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_outbox" where "sync" is null' into n;
	if n > 0 then raise exception 'notNull:sys_outbox.sync refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_outbox" alter column "sync" set not null;

-- step create:notNull:sys_outbox.model (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_outbox" where "model" is null' into n;
	if n > 0 then raise exception 'notNull:sys_outbox.model refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_outbox" alter column "model" set not null;

-- step create:notNull:sys_outbox.record (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_outbox" where "record" is null' into n;
	if n > 0 then raise exception 'notNull:sys_outbox.record refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_outbox" alter column "record" set not null;

-- step create:notNull:sys_outbox.op (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_outbox" where "op" is null' into n;
	if n > 0 then raise exception 'notNull:sys_outbox.op refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_outbox" alter column "op" set not null;

-- step create:notNull:sys_outbox.record_revision (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_outbox" where "record_revision" is null' into n;
	if n > 0 then raise exception 'notNull:sys_outbox.record_revision refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_outbox" alter column "record_revision" set not null;

-- step create:notNull:sys_outbox.changed (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_outbox" where "changed" is null' into n;
	if n > 0 then raise exception 'notNull:sys_outbox.changed refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_outbox" alter column "changed" set not null;

-- step create:notNull:sys_outbox.key (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_outbox" where "key" is null' into n;
	if n > 0 then raise exception 'notNull:sys_outbox.key refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_outbox" alter column "key" set not null;

-- step create:notNull:sys_outbox.status (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_outbox" where "status" is null' into n;
	if n > 0 then raise exception 'notNull:sys_outbox.status refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_outbox" alter column "status" set not null;

-- step create:notNull:sys_outbox.attempts (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_outbox" where "attempts" is null' into n;
	if n > 0 then raise exception 'notNull:sys_outbox.attempts refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_outbox" alter column "attempts" set not null;

-- step create:notNull:sys_outbox.next_attempt_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_outbox" where "next_attempt_at" is null' into n;
	if n > 0 then raise exception 'notNull:sys_outbox.next_attempt_at refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_outbox" alter column "next_attempt_at" set not null;

-- step create:notNull:sys_outbox.at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_outbox" where "at" is null' into n;
	if n > 0 then raise exception 'notNull:sys_outbox.at refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_outbox" alter column "at" set not null;

-- step create:notNull:sys_run.automation (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_run" where "automation" is null' into n;
	if n > 0 then raise exception 'notNull:sys_run.automation refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_run" alter column "automation" set not null;

-- step create:notNull:sys_run.input (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_run" where "input" is null' into n;
	if n > 0 then raise exception 'notNull:sys_run.input refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_run" alter column "input" set not null;

-- step create:notNull:sys_run.due_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_run" where "due_at" is null' into n;
	if n > 0 then raise exception 'notNull:sys_run.due_at refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_run" alter column "due_at" set not null;

-- step create:notNull:sys_run.cause (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_run" where "cause" is null' into n;
	if n > 0 then raise exception 'notNull:sys_run.cause refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_run" alter column "cause" set not null;

-- step create:notNull:sys_run.depth (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_run" where "depth" is null' into n;
	if n > 0 then raise exception 'notNull:sys_run.depth refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_run" alter column "depth" set not null;

-- step create:notNull:sys_run.state (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_run" where "state" is null' into n;
	if n > 0 then raise exception 'notNull:sys_run.state refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_run" alter column "state" set not null;

-- step create:notNull:sys_run.attempts (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_run" where "attempts" is null' into n;
	if n > 0 then raise exception 'notNull:sys_run.attempts refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_run" alter column "attempts" set not null;

-- step create:notNull:sys_run.leases (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_run" where "leases" is null' into n;
	if n > 0 then raise exception 'notNull:sys_run.leases refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_run" alter column "leases" set not null;

-- step create:notNull:sys_run.results (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_run" where "results" is null' into n;
	if n > 0 then raise exception 'notNull:sys_run.results refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_run" alter column "results" set not null;

-- step create:notNull:sys_session.token_hash (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_session" where "token_hash" is null' into n;
	if n > 0 then raise exception 'notNull:sys_session.token_hash refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_session" alter column "token_hash" set not null;

-- step create:notNull:sys_session.via (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_session" where "via" is null' into n;
	if n > 0 then raise exception 'notNull:sys_session.via refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_session" alter column "via" set not null;

-- step create:notNull:sys_session.created_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_session" where "created_at" is null' into n;
	if n > 0 then raise exception 'notNull:sys_session.created_at refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_session" alter column "created_at" set not null;

-- step create:notNull:sys_session.expires_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_session" where "expires_at" is null' into n;
	if n > 0 then raise exception 'notNull:sys_session.expires_at refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_session" alter column "expires_at" set not null;

-- step create:notNull:sys_session.refreshed_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_session" where "refreshed_at" is null' into n;
	if n > 0 then raise exception 'notNull:sys_session.refreshed_at refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_session" alter column "refreshed_at" set not null;

-- step create:notNull:sys_sync.sync (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_sync" where "sync" is null' into n;
	if n > 0 then raise exception 'notNull:sys_sync.sync refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_sync" alter column "sync" set not null;

-- step create:notNull:sys_sync.partition (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_sync" where "partition" is null' into n;
	if n > 0 then raise exception 'notNull:sys_sync.partition refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_sync" alter column "partition" set not null;

-- step create:notNull:sys_sync.cycle (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_sync" where "cycle" is null' into n;
	if n > 0 then raise exception 'notNull:sys_sync.cycle refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_sync" alter column "cycle" set not null;

-- step create:notNull:sys_sync.phase (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_sync" where "phase" is null' into n;
	if n > 0 then raise exception 'notNull:sys_sync.phase refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_sync" alter column "phase" set not null;

-- step create:notNull:sys_sync.digest (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_sync" where "digest" is null' into n;
	if n > 0 then raise exception 'notNull:sys_sync.digest refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_sync" alter column "digest" set not null;

-- step create:notNull:sys_sync.version (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_sync" where "version" is null' into n;
	if n > 0 then raise exception 'notNull:sys_sync.version refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_sync" alter column "version" set not null;

-- step create:notNull:sys_sync.started_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_sync" where "started_at" is null' into n;
	if n > 0 then raise exception 'notNull:sys_sync.started_at refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_sync" alter column "started_at" set not null;

-- step create:notNull:sys_sync_row.sync (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_sync_row" where "sync" is null' into n;
	if n > 0 then raise exception 'notNull:sys_sync_row.sync refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_sync_row" alter column "sync" set not null;

-- step create:notNull:sys_sync_row.partition (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_sync_row" where "partition" is null' into n;
	if n > 0 then raise exception 'notNull:sys_sync_row.partition refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_sync_row" alter column "partition" set not null;

-- step create:notNull:sys_sync_row.remote_id (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_sync_row" where "remote_id" is null' into n;
	if n > 0 then raise exception 'notNull:sys_sync_row.remote_id refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_sync_row" alter column "remote_id" set not null;

-- step create:notNull:sys_sync_row.record (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_sync_row" where "record" is null' into n;
	if n > 0 then raise exception 'notNull:sys_sync_row.record refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_sync_row" alter column "record" set not null;

-- step create:notNull:sys_sync_row.cycle (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_sync_row" where "cycle" is null' into n;
	if n > 0 then raise exception 'notNull:sys_sync_row.cycle refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_sync_row" alter column "cycle" set not null;

-- step create:notNull:sys_user.name (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_user" where "name" is null' into n;
	if n > 0 then raise exception 'notNull:sys_user.name refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_user" alter column "name" set not null;

-- step create:notNull:sys_user.kind (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_user" where "kind" is null' into n;
	if n > 0 then raise exception 'notNull:sys_user.kind refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_user" alter column "kind" set not null;

-- step create:notNull:sys_user.active (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_user" where "active" is null' into n;
	if n > 0 then raise exception 'notNull:sys_user.active refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_user" alter column "active" set not null;

-- step create:notNull:sys_user.admin (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_user" where "admin" is null' into n;
	if n > 0 then raise exception 'notNull:sys_user.admin refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_user" alter column "admin" set not null;

-- step create:notNull:sys_user.signup (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_user" where "signup" is null' into n;
	if n > 0 then raise exception 'notNull:sys_user.signup refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_user" alter column "signup" set not null;

-- step create:notNull:sys_user.revision (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_user" where "revision" is null' into n;
	if n > 0 then raise exception 'notNull:sys_user.revision refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_user" alter column "revision" set not null;

-- step create:notNull:sys_user.created_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_user" where "created_at" is null' into n;
	if n > 0 then raise exception 'notNull:sys_user.created_at refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_user" alter column "created_at" set not null;

-- step create:notNull:notes.title (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "notes" where "title" is null' into n;
	if n > 0 then raise exception 'notNull:notes.title refuses % existing row(s)', n; end if;
end $store$;
alter table "notes" alter column "title" set not null;

-- step create:notNull:requestor.approval_request_id (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "requestor" where "approval_request_id" is null' into n;
	if n > 0 then raise exception 'notNull:requestor.approval_request_id refuses % existing row(s)', n; end if;
end $store$;
alter table "requestor" alter column "approval_request_id" set not null;

-- step create:notNull:sys_inbox.instance (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_inbox" where "instance" is null' into n;
	if n > 0 then raise exception 'notNull:sys_inbox.instance refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_inbox" alter column "instance" set not null;

-- step create:notNull:sys_outbox.instance (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_outbox" where "instance" is null' into n;
	if n > 0 then raise exception 'notNull:sys_outbox.instance refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_outbox" alter column "instance" set not null;

-- step create:notNull:sys_session.user (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_session" where "user" is null' into n;
	if n > 0 then raise exception 'notNull:sys_session.user refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_session" alter column "user" set not null;

-- step create:notNull:sys_sync.instance (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_sync" where "instance" is null' into n;
	if n > 0 then raise exception 'notNull:sys_sync.instance refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_sync" alter column "instance" set not null;

-- step create:notNull:sys_sync_row.instance (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_sync_row" where "instance" is null' into n;
	if n > 0 then raise exception 'notNull:sys_sync_row.instance refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_sync_row" alter column "instance" set not null;

-- step create:constraint:approval_request.approval_request__ck__fa21e76e (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "approval_request" where ("action" in (''create'', ''update'', ''delete'')) is false' into n;
	if n > 0 then raise exception 'approval_request__ck__fa21e76e refuses % existing row(s)', n; end if;
end $store$;
alter table "approval_request" add constraint "approval_request__ck__fa21e76e" check ("action" in ('create', 'update', 'delete'));

-- step create:constraint:approval_request.approval_request__ck__8e3c4626 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "approval_request" where ("status" in (''ONGOING'', ''CHANGES_REQUESTED'', ''APPROVED'', ''REJECTED'', ''SUPERSEDED'')) is false' into n;
	if n > 0 then raise exception 'approval_request__ck__8e3c4626 refuses % existing row(s)', n; end if;
end $store$;
alter table "approval_request" add constraint "approval_request__ck__8e3c4626" check ("status" in ('ONGOING', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED', 'SUPERSEDED'));

-- step create:constraint:approval_request.approval_request__ck__62ab75f9 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "approval_request" where (("step_names" is null or store_json_valid("step_names", ''{"kind":"json","shape":{"kind":"list","of":{"kind":"text"}}}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'approval_request__ck__62ab75f9 refuses % existing row(s)', n; end if;
end $store$;
alter table "approval_request" add constraint "approval_request__ck__62ab75f9" check (("step_names" is null or store_json_valid("step_names", '{"kind":"json","shape":{"kind":"list","of":{"kind":"text"}}}'::jsonb) is true));

-- step create:constraint:approval_request.approval_request__ck__27a1764b (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "approval_request" where (("approver_teams" is null or store_json_valid("approver_teams", ''{"kind":"json","shape":{"kind":"list","of":{"kind":"text"}}}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'approval_request__ck__27a1764b refuses % existing row(s)', n; end if;
end $store$;
alter table "approval_request" add constraint "approval_request__ck__27a1764b" check (("approver_teams" is null or store_json_valid("approver_teams", '{"kind":"json","shape":{"kind":"list","of":{"kind":"text"}}}'::jsonb) is true));

-- step create:constraint:approval_request.approval_request__ck__68ec0c83 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "approval_request" where (("approver_users" is null or store_json_valid("approver_users", ''{"kind":"json","shape":{"kind":"list","of":{"kind":"text"}}}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'approval_request__ck__68ec0c83 refuses % existing row(s)', n; end if;
end $store$;
alter table "approval_request" add constraint "approval_request__ck__68ec0c83" check (("approver_users" is null or store_json_valid("approver_users", '{"kind":"json","shape":{"kind":"list","of":{"kind":"text"}}}'::jsonb) is true));

-- step create:constraint:approval_request.approval_request__ck__bb280767 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "approval_request" where (("superseder_teams" is null or store_json_valid("superseder_teams", ''{"kind":"json","shape":{"kind":"list","of":{"kind":"text"}}}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'approval_request__ck__bb280767 refuses % existing row(s)', n; end if;
end $store$;
alter table "approval_request" add constraint "approval_request__ck__bb280767" check (("superseder_teams" is null or store_json_valid("superseder_teams", '{"kind":"json","shape":{"kind":"list","of":{"kind":"text"}}}'::jsonb) is true));

-- step create:constraint:approval_request.approval_request__ck__04466614 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "approval_request" where (isfinite("closed_at")) is false' into n;
	if n > 0 then raise exception 'approval_request__ck__04466614 refuses % existing row(s)', n; end if;
end $store$;
alter table "approval_request" add constraint "approval_request__ck__04466614" check (isfinite("closed_at"));

-- step create:constraint:approval_request.approval_request__ck__367d8eb4 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "approval_request" where (isfinite("created_at")) is false' into n;
	if n > 0 then raise exception 'approval_request__ck__367d8eb4 refuses % existing row(s)', n; end if;
end $store$;
alter table "approval_request" add constraint "approval_request__ck__367d8eb4" check (isfinite("created_at"));

-- step create:constraint:sys_api_key.sys_api_key__uq__410283f1 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select coalesce(sum(n - 1), 0)::int as n from (select count(*) as n from "sys_api_key" where "prefix" is not null group by "prefix" having count(*) > 1) d' into n;
	if n > 0 then raise exception 'sys_api_key__uq__410283f1 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_api_key" add constraint "sys_api_key__uq__410283f1" unique ("prefix");

-- step create:constraint:sys_api_key.sys_api_key__ck__3ec0653c (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_api_key" where (isfinite("revoked_at")) is false' into n;
	if n > 0 then raise exception 'sys_api_key__ck__3ec0653c refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_api_key" add constraint "sys_api_key__ck__3ec0653c" check (isfinite("revoked_at"));

-- step create:constraint:sys_api_key.sys_api_key__ck__21d4c9ff (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_api_key" where (isfinite("last_used_at")) is false' into n;
	if n > 0 then raise exception 'sys_api_key__ck__21d4c9ff refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_api_key" add constraint "sys_api_key__ck__21d4c9ff" check (isfinite("last_used_at"));

-- step create:constraint:sys_api_key.sys_api_key__ck__367d8eb4 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_api_key" where (isfinite("created_at")) is false' into n;
	if n > 0 then raise exception 'sys_api_key__ck__367d8eb4 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_api_key" add constraint "sys_api_key__ck__367d8eb4" check (isfinite("created_at"));

-- step create:constraint:sys_challenge.sys_challenge__ck__58adc270 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_challenge" where (isfinite("expires_at")) is false' into n;
	if n > 0 then raise exception 'sys_challenge__ck__58adc270 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_challenge" add constraint "sys_challenge__ck__58adc270" check (isfinite("expires_at"));

-- step create:constraint:sys_conversation.sys_conversation__ck__367d8eb4 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_conversation" where (isfinite("created_at")) is false' into n;
	if n > 0 then raise exception 'sys_conversation__ck__367d8eb4 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_conversation" add constraint "sys_conversation__ck__367d8eb4" check (isfinite("created_at"));

-- step create:constraint:sys_conversation.sys_conversation__ck__27c26974 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_conversation" where (("participants" is null or store_json_valid("participants", ''{"kind":"json","optional":true}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'sys_conversation__ck__27c26974 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_conversation" add constraint "sys_conversation__ck__27c26974" check (("participants" is null or store_json_valid("participants", '{"kind":"json","optional":true}'::jsonb) is true));

-- step create:constraint:sys_conversation.sys_conversation__ck__cc931632 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_conversation" where (("inputs" is null or store_json_valid("inputs", ''{"default":[],"kind":"json"}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'sys_conversation__ck__cc931632 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_conversation" add constraint "sys_conversation__ck__cc931632" check (("inputs" is null or store_json_valid("inputs", '{"default":[],"kind":"json"}'::jsonb) is true));

-- step create:constraint:sys_conversation.sys_conversation__ck__44b2543d (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_conversation" where (("outputs" is null or store_json_valid("outputs", ''{"default":[],"kind":"json"}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'sys_conversation__ck__44b2543d refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_conversation" add constraint "sys_conversation__ck__44b2543d" check (("outputs" is null or store_json_valid("outputs", '{"default":[],"kind":"json"}'::jsonb) is true));

-- step create:constraint:sys_conversation.sys_conversation__ck__13b8fb0a (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_conversation" where (isfinite("lease_until")) is false' into n;
	if n > 0 then raise exception 'sys_conversation__ck__13b8fb0a refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_conversation" add constraint "sys_conversation__ck__13b8fb0a" check (isfinite("lease_until"));

-- step create:constraint:sys_conversation.sys_conversation__ck__14aaee8f (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_conversation" where (("plan" is null or store_json_valid("plan", ''{"kind":"json","optional":true}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'sys_conversation__ck__14aaee8f refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_conversation" add constraint "sys_conversation__ck__14aaee8f" check (("plan" is null or store_json_valid("plan", '{"kind":"json","optional":true}'::jsonb) is true));

-- step create:constraint:sys_conversation.sys_conversation__ck__85277cdf (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_conversation" where (("goals" is null or store_json_valid("goals", ''{"kind":"json","optional":true}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'sys_conversation__ck__85277cdf refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_conversation" add constraint "sys_conversation__ck__85277cdf" check (("goals" is null or store_json_valid("goals", '{"kind":"json","optional":true}'::jsonb) is true));

-- step create:constraint:sys_conversation.sys_conversation__ck__56b593d1 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_conversation" where (("read" is null or store_json_valid("read", ''{"default":{},"kind":"json"}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'sys_conversation__ck__56b593d1 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_conversation" add constraint "sys_conversation__ck__56b593d1" check (("read" is null or store_json_valid("read", '{"default":{},"kind":"json"}'::jsonb) is true));

-- step create:constraint:sys_conversation.sys_conversation__ck__bfedbfd4 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_conversation" where (isfinite("updated_at")) is false' into n;
	if n > 0 then raise exception 'sys_conversation__ck__bfedbfd4 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_conversation" add constraint "sys_conversation__ck__bfedbfd4" check (isfinite("updated_at"));

-- step create:constraint:sys_file.sys_file__ck__367d8eb4 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_file" where (isfinite("created_at")) is false' into n;
	if n > 0 then raise exception 'sys_file__ck__367d8eb4 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_file" add constraint "sys_file__ck__367d8eb4" check (isfinite("created_at"));

-- step create:constraint:sys_file.sys_file__ck__bfedbfd4 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_file" where (isfinite("updated_at")) is false' into n;
	if n > 0 then raise exception 'sys_file__ck__bfedbfd4 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_file" add constraint "sys_file__ck__bfedbfd4" check (isfinite("updated_at"));

-- step create:constraint:sys_inbox.sys_inbox__ck__c5857e25 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_inbox" where (isfinite("received_at")) is false' into n;
	if n > 0 then raise exception 'sys_inbox__ck__c5857e25 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_inbox" add constraint "sys_inbox__ck__c5857e25" check (isfinite("received_at"));

-- step create:constraint:sys_inbox.sys_inbox__ck__533ced4e (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_inbox" where (("headers" is null or store_json_valid("headers", ''{"kind":"json","optional":true}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'sys_inbox__ck__533ced4e refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_inbox" add constraint "sys_inbox__ck__533ced4e" check (("headers" is null or store_json_valid("headers", '{"kind":"json","optional":true}'::jsonb) is true));

-- step create:constraint:sys_inbox.sys_inbox__ck__b2cfee0c (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_inbox" where (("body" is null or store_json_valid("body", ''{"kind":"json","optional":true}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'sys_inbox__ck__b2cfee0c refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_inbox" add constraint "sys_inbox__ck__b2cfee0c" check (("body" is null or store_json_valid("body", '{"kind":"json","optional":true}'::jsonb) is true));

-- step create:constraint:sys_inbox.sys_inbox__ck__a7351f01 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_inbox" where (isfinite("consumed_at")) is false' into n;
	if n > 0 then raise exception 'sys_inbox__ck__a7351f01 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_inbox" add constraint "sys_inbox__ck__a7351f01" check (isfinite("consumed_at"));

-- step create:constraint:sys_inbox.sys_inbox__uq__243217d1 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select coalesce(sum(n - 1), 0)::int as n from (select count(*) as n from "sys_inbox" group by "sync", "instance", "delivery" having count(*) > 1) d' into n;
	if n > 0 then raise exception 'sys_inbox__uq__243217d1 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_inbox" add constraint "sys_inbox__uq__243217d1" unique nulls not distinct ("sync", "instance", "delivery");

-- step create:constraint:sys_integration.sys_integration__ck__fc03c40f (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_integration" where (("configuration" is null or store_json_valid("configuration", ''{"default":{},"kind":"json"}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'sys_integration__ck__fc03c40f refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_integration" add constraint "sys_integration__ck__fc03c40f" check (("configuration" is null or store_json_valid("configuration", '{"default":{},"kind":"json"}'::jsonb) is true));

-- step create:constraint:sys_integration.sys_integration__ck__da5b6244 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_integration" where (("import_start" is null or store_json_valid("import_start", ''{"kind":"json","optional":true}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'sys_integration__ck__da5b6244 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_integration" add constraint "sys_integration__ck__da5b6244" check (("import_start" is null or store_json_valid("import_start", '{"kind":"json","optional":true}'::jsonb) is true));

-- step create:constraint:sys_integration.sys_integration__ck__67fc27ec (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_integration" where (("status" is null or store_json_valid("status", ''{"kind":"json","optional":true}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'sys_integration__ck__67fc27ec refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_integration" add constraint "sys_integration__ck__67fc27ec" check (("status" is null or store_json_valid("status", '{"kind":"json","optional":true}'::jsonb) is true));

-- step create:constraint:sys_invitation.sys_invitation__ck__cceca9d3 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_invitation" where (("party" is null or store_json_valid("party", ''{"kind":"json","optional":true}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'sys_invitation__ck__cceca9d3 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_invitation" add constraint "sys_invitation__ck__cceca9d3" check (("party" is null or store_json_valid("party", '{"kind":"json","optional":true}'::jsonb) is true));

-- step create:constraint:sys_invitation.sys_invitation__ck__58adc270 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_invitation" where (isfinite("expires_at")) is false' into n;
	if n > 0 then raise exception 'sys_invitation__ck__58adc270 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_invitation" add constraint "sys_invitation__ck__58adc270" check (isfinite("expires_at"));

-- step create:constraint:sys_invitation.sys_invitation__ck__43a80355 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_invitation" where (isfinite("accepted_at")) is false' into n;
	if n > 0 then raise exception 'sys_invitation__ck__43a80355 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_invitation" add constraint "sys_invitation__ck__43a80355" check (isfinite("accepted_at"));

-- step create:constraint:sys_invitation.sys_invitation__ck__3ec0653c (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_invitation" where (isfinite("revoked_at")) is false' into n;
	if n > 0 then raise exception 'sys_invitation__ck__3ec0653c refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_invitation" add constraint "sys_invitation__ck__3ec0653c" check (isfinite("revoked_at"));

-- step create:constraint:sys_invitation.sys_invitation__ck__aea09130 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_invitation" where (("email" is not null or "phone" is not null)) is false' into n;
	if n > 0 then raise exception 'sys_invitation__ck__aea09130 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_invitation" add constraint "sys_invitation__ck__aea09130" check (("email" is not null or "phone" is not null));

-- step create:constraint:sys_message.sys_message__ck__367d8eb4 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_message" where (isfinite("created_at")) is false' into n;
	if n > 0 then raise exception 'sys_message__ck__367d8eb4 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_message" add constraint "sys_message__ck__367d8eb4" check (isfinite("created_at"));

-- step create:constraint:sys_message.sys_message__ck__d15d4c4e (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_message" where (("content" is null or store_json_valid("content", ''{"kind":"json","optional":true}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'sys_message__ck__d15d4c4e refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_message" add constraint "sys_message__ck__d15d4c4e" check (("content" is null or store_json_valid("content", '{"kind":"json","optional":true}'::jsonb) is true));

-- step create:constraint:sys_message.sys_message__ck__5cc387c4 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_message" where (("as" is null or store_json_valid("as", ''{"kind":"json","optional":true}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'sys_message__ck__5cc387c4 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_message" add constraint "sys_message__ck__5cc387c4" check (("as" is null or store_json_valid("as", '{"kind":"json","optional":true}'::jsonb) is true));

-- step create:constraint:sys_message.sys_message__ck__66a46aa1 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_message" where (("meta" is null or store_json_valid("meta", ''{"kind":"json","optional":true}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'sys_message__ck__66a46aa1 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_message" add constraint "sys_message__ck__66a46aa1" check (("meta" is null or store_json_valid("meta", '{"kind":"json","optional":true}'::jsonb) is true));

-- step create:constraint:sys_message.sys_message__ck__f6576594 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_message" where (("about" is null or store_json_valid("about", ''{"kind":"json","optional":true}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'sys_message__ck__f6576594 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_message" add constraint "sys_message__ck__f6576594" check (("about" is null or store_json_valid("about", '{"kind":"json","optional":true}'::jsonb) is true));

-- step create:constraint:sys_message.sys_message__ck__057f376e (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_message" where (isfinite("sent_at")) is false' into n;
	if n > 0 then raise exception 'sys_message__ck__057f376e refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_message" add constraint "sys_message__ck__057f376e" check (isfinite("sent_at"));

-- step create:constraint:sys_message.sys_message__ck__23a77955 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_message" where (isfinite("source_at")) is false' into n;
	if n > 0 then raise exception 'sys_message__ck__23a77955 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_message" add constraint "sys_message__ck__23a77955" check (isfinite("source_at"));

-- step create:constraint:sys_message.sys_message__ck__bd0c4a0e (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_message" where (("email" is null or store_json_valid("email", ''{"kind":"json","optional":true}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'sys_message__ck__bd0c4a0e refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_message" add constraint "sys_message__ck__bd0c4a0e" check (("email" is null or store_json_valid("email", '{"kind":"json","optional":true}'::jsonb) is true));

-- step create:constraint:sys_message.sys_message__ck__e92641ad (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_message" where (isfinite("deleted_at")) is false' into n;
	if n > 0 then raise exception 'sys_message__ck__e92641ad refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_message" add constraint "sys_message__ck__e92641ad" check (isfinite("deleted_at"));

-- step create:constraint:sys_message.sys_message__ck__57ae3894 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_message" where (isfinite("edited_at")) is false' into n;
	if n > 0 then raise exception 'sys_message__ck__57ae3894 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_message" add constraint "sys_message__ck__57ae3894" check (isfinite("edited_at"));

-- step create:constraint:sys_message.sys_message__ck__f6ff471a (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_message" where (isfinite("next_attempt_at")) is false' into n;
	if n > 0 then raise exception 'sys_message__ck__f6ff471a refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_message" add constraint "sys_message__ck__f6ff471a" check (isfinite("next_attempt_at"));

-- step create:constraint:sys_message.sys_message__ck__a7d38bd9 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_message" where (isfinite("claimed_at")) is false' into n;
	if n > 0 then raise exception 'sys_message__ck__a7d38bd9 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_message" add constraint "sys_message__ck__a7d38bd9" check (isfinite("claimed_at"));

-- step create:constraint:sys_message.sys_message__ck__3f646fdc (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_message" where (("message" is null or store_json_valid("message", ''{"kind":"json","optional":true}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'sys_message__ck__3f646fdc refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_message" add constraint "sys_message__ck__3f646fdc" check (("message" is null or store_json_valid("message", '{"kind":"json","optional":true}'::jsonb) is true));

-- step create:constraint:sys_message.sys_message__ck__4626e31a (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_message" where (("delivery" is null or store_json_valid("delivery", ''{"default":[],"kind":"json"}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'sys_message__ck__4626e31a refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_message" add constraint "sys_message__ck__4626e31a" check (("delivery" is null or store_json_valid("delivery", '{"default":[],"kind":"json"}'::jsonb) is true));

-- step create:constraint:sys_message.sys_message__ck__b99a97ab (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_message" where (isfinite("presume_at")) is false' into n;
	if n > 0 then raise exception 'sys_message__ck__b99a97ab refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_message" add constraint "sys_message__ck__b99a97ab" check (isfinite("presume_at"));

-- step create:constraint:sys_notification.sys_notification__ck__8e13ac8a (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_notification" where (("recipient" is null or store_json_valid("recipient", ''{"kind":"json"}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'sys_notification__ck__8e13ac8a refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_notification" add constraint "sys_notification__ck__8e13ac8a" check (("recipient" is null or store_json_valid("recipient", '{"kind":"json"}'::jsonb) is true));

-- step create:constraint:sys_notification.sys_notification__ck__af8b3b10 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_notification" where (("link" is null or store_json_valid("link", ''{"kind":"json","optional":true}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'sys_notification__ck__af8b3b10 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_notification" add constraint "sys_notification__ck__af8b3b10" check (("link" is null or store_json_valid("link", '{"kind":"json","optional":true}'::jsonb) is true));

-- step create:constraint:sys_notification.sys_notification__ck__c9a52988 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_notification" where (("attachments" is null or store_json_valid("attachments", ''{"default":[],"kind":"json"}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'sys_notification__ck__c9a52988 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_notification" add constraint "sys_notification__ck__c9a52988" check (("attachments" is null or store_json_valid("attachments", '{"default":[],"kind":"json"}'::jsonb) is true));

-- step create:constraint:sys_notification.sys_notification__uq__544dc786 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select coalesce(sum(n - 1), 0)::int as n from (select count(*) as n from "sys_notification" where "once" is not null group by "once" having count(*) > 1) d' into n;
	if n > 0 then raise exception 'sys_notification__uq__544dc786 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_notification" add constraint "sys_notification__uq__544dc786" unique ("once");

-- step create:constraint:sys_notification.sys_notification__ck__2298f760 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_notification" where (isfinite("at")) is false' into n;
	if n > 0 then raise exception 'sys_notification__ck__2298f760 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_notification" add constraint "sys_notification__ck__2298f760" check (isfinite("at"));

-- step create:constraint:sys_notification.sys_notification__ck__db820902 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_notification" where (isfinite("read_at")) is false' into n;
	if n > 0 then raise exception 'sys_notification__ck__db820902 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_notification" add constraint "sys_notification__ck__db820902" check (isfinite("read_at"));

-- step create:constraint:sys_outbox.sys_outbox__ck__4bdc0603 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_outbox" where ("op" in (''create'', ''update'', ''delete'')) is false' into n;
	if n > 0 then raise exception 'sys_outbox__ck__4bdc0603 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_outbox" add constraint "sys_outbox__ck__4bdc0603" check ("op" in ('create', 'update', 'delete'));

-- step create:constraint:sys_outbox.sys_outbox__ck__cb287458 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_outbox" where (("image" is null or store_json_valid("image", ''{"kind":"json","optional":true}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'sys_outbox__ck__cb287458 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_outbox" add constraint "sys_outbox__ck__cb287458" check (("image" is null or store_json_valid("image", '{"kind":"json","optional":true}'::jsonb) is true));

-- step create:constraint:sys_outbox.sys_outbox__ck__a25a9f7c (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_outbox" where (("changed" is null or store_json_valid("changed", ''{"default":[],"kind":"json","shape":{"kind":"list","of":{"kind":"text"}}}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'sys_outbox__ck__a25a9f7c refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_outbox" add constraint "sys_outbox__ck__a25a9f7c" check (("changed" is null or store_json_valid("changed", '{"default":[],"kind":"json","shape":{"kind":"list","of":{"kind":"text"}}}'::jsonb) is true));

-- step create:constraint:sys_outbox.sys_outbox__uq__f1a22a1c (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select coalesce(sum(n - 1), 0)::int as n from (select count(*) as n from "sys_outbox" where "key" is not null group by "key" having count(*) > 1) d' into n;
	if n > 0 then raise exception 'sys_outbox__uq__f1a22a1c refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_outbox" add constraint "sys_outbox__uq__f1a22a1c" unique ("key");

-- step create:constraint:sys_outbox.sys_outbox__ck__fb29df7c (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_outbox" where ("status" in (''queued'', ''sending'', ''acked'', ''failed'', ''dead'', ''skipped'')) is false' into n;
	if n > 0 then raise exception 'sys_outbox__ck__fb29df7c refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_outbox" add constraint "sys_outbox__ck__fb29df7c" check ("status" in ('queued', 'sending', 'acked', 'failed', 'dead', 'skipped'));

-- step create:constraint:sys_outbox.sys_outbox__ck__f6ff471a (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_outbox" where (isfinite("next_attempt_at")) is false' into n;
	if n > 0 then raise exception 'sys_outbox__ck__f6ff471a refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_outbox" add constraint "sys_outbox__ck__f6ff471a" check (isfinite("next_attempt_at"));

-- step create:constraint:sys_outbox.sys_outbox__ck__a7d38bd9 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_outbox" where (isfinite("claimed_at")) is false' into n;
	if n > 0 then raise exception 'sys_outbox__ck__a7d38bd9 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_outbox" add constraint "sys_outbox__ck__a7d38bd9" check (isfinite("claimed_at"));

-- step create:constraint:sys_outbox.sys_outbox__ck__b77b5c87 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_outbox" where (("error" is null or store_json_valid("error", ''{"kind":"json","optional":true}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'sys_outbox__ck__b77b5c87 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_outbox" add constraint "sys_outbox__ck__b77b5c87" check (("error" is null or store_json_valid("error", '{"kind":"json","optional":true}'::jsonb) is true));

-- step create:constraint:sys_outbox.sys_outbox__ck__c8a3b1f1 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_outbox" where (isfinite("acked_at")) is false' into n;
	if n > 0 then raise exception 'sys_outbox__ck__c8a3b1f1 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_outbox" add constraint "sys_outbox__ck__c8a3b1f1" check (isfinite("acked_at"));

-- step create:constraint:sys_outbox.sys_outbox__ck__0bde5ff1 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_outbox" where (("result" is null or store_json_valid("result", ''{"kind":"json","optional":true}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'sys_outbox__ck__0bde5ff1 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_outbox" add constraint "sys_outbox__ck__0bde5ff1" check (("result" is null or store_json_valid("result", '{"kind":"json","optional":true}'::jsonb) is true));

-- step create:constraint:sys_outbox.sys_outbox__ck__2298f760 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_outbox" where (isfinite("at")) is false' into n;
	if n > 0 then raise exception 'sys_outbox__ck__2298f760 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_outbox" add constraint "sys_outbox__ck__2298f760" check (isfinite("at"));

-- step create:constraint:sys_run.sys_run__ck__fcb01943 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_run" where (("input" is null or store_json_valid("input", ''{"kind":"json"}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'sys_run__ck__fcb01943 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_run" add constraint "sys_run__ck__fcb01943" check (("input" is null or store_json_valid("input", '{"kind":"json"}'::jsonb) is true));

-- step create:constraint:sys_run.sys_run__ck__9f882481 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_run" where (isfinite("due_at")) is false' into n;
	if n > 0 then raise exception 'sys_run__ck__9f882481 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_run" add constraint "sys_run__ck__9f882481" check (isfinite("due_at"));

-- step create:constraint:sys_run.sys_run__uq__f1a22a1c (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select coalesce(sum(n - 1), 0)::int as n from (select count(*) as n from "sys_run" where "key" is not null group by "key" having count(*) > 1) d' into n;
	if n > 0 then raise exception 'sys_run__uq__f1a22a1c refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_run" add constraint "sys_run__uq__f1a22a1c" unique ("key");

-- step create:constraint:sys_run.sys_run__ck__df253602 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_run" where (isfinite("started_at")) is false' into n;
	if n > 0 then raise exception 'sys_run__ck__df253602 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_run" add constraint "sys_run__ck__df253602" check (isfinite("started_at"));

-- step create:constraint:sys_run.sys_run__ck__a6d9a98d (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_run" where (isfinite("finished_at")) is false' into n;
	if n > 0 then raise exception 'sys_run__ck__a6d9a98d refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_run" add constraint "sys_run__ck__a6d9a98d" check (isfinite("finished_at"));

-- step create:constraint:sys_run.sys_run__ck__ca03cc42 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_run" where (("progress" is null or store_json_valid("progress", ''{"kind":"json","optional":true}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'sys_run__ck__ca03cc42 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_run" add constraint "sys_run__ck__ca03cc42" check (("progress" is null or store_json_valid("progress", '{"kind":"json","optional":true}'::jsonb) is true));

-- step create:constraint:sys_run.sys_run__ck__b291c454 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_run" where (("output" is null or store_json_valid("output", ''{"kind":"json","optional":true}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'sys_run__ck__b291c454 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_run" add constraint "sys_run__ck__b291c454" check (("output" is null or store_json_valid("output", '{"kind":"json","optional":true}'::jsonb) is true));

-- step create:constraint:sys_run.sys_run__ck__b77b5c87 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_run" where (("error" is null or store_json_valid("error", ''{"kind":"json","optional":true}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'sys_run__ck__b77b5c87 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_run" add constraint "sys_run__ck__b77b5c87" check (("error" is null or store_json_valid("error", '{"kind":"json","optional":true}'::jsonb) is true));

-- step create:constraint:sys_run.sys_run__ck__f38716e4 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_run" where (("results" is null or store_json_valid("results", ''{"default":[],"kind":"json"}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'sys_run__ck__f38716e4 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_run" add constraint "sys_run__ck__f38716e4" check (("results" is null or store_json_valid("results", '{"default":[],"kind":"json"}'::jsonb) is true));

-- step create:constraint:sys_run.sys_run__ck__20970459 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_run" where (("starter" is null or store_json_valid("starter", ''{"kind":"json","optional":true}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'sys_run__ck__20970459 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_run" add constraint "sys_run__ck__20970459" check (("starter" is null or store_json_valid("starter", '{"kind":"json","optional":true}'::jsonb) is true));

-- step create:constraint:sys_session.sys_session__uq__ba86567f (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select coalesce(sum(n - 1), 0)::int as n from (select count(*) as n from "sys_session" where "token_hash" is not null group by "token_hash" having count(*) > 1) d' into n;
	if n > 0 then raise exception 'sys_session__uq__ba86567f refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_session" add constraint "sys_session__uq__ba86567f" unique ("token_hash");

-- step create:constraint:sys_session.sys_session__ck__753fc483 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_session" where ("via" in (''code'', ''invitation'', ''signup'', ''host'')) is false' into n;
	if n > 0 then raise exception 'sys_session__ck__753fc483 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_session" add constraint "sys_session__ck__753fc483" check ("via" in ('code', 'invitation', 'signup', 'host'));

-- step create:constraint:sys_session.sys_session__ck__367d8eb4 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_session" where (isfinite("created_at")) is false' into n;
	if n > 0 then raise exception 'sys_session__ck__367d8eb4 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_session" add constraint "sys_session__ck__367d8eb4" check (isfinite("created_at"));

-- step create:constraint:sys_session.sys_session__ck__58adc270 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_session" where (isfinite("expires_at")) is false' into n;
	if n > 0 then raise exception 'sys_session__ck__58adc270 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_session" add constraint "sys_session__ck__58adc270" check (isfinite("expires_at"));

-- step create:constraint:sys_session.sys_session__ck__e61a07a4 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_session" where (isfinite("refreshed_at")) is false' into n;
	if n > 0 then raise exception 'sys_session__ck__e61a07a4 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_session" add constraint "sys_session__ck__e61a07a4" check (isfinite("refreshed_at"));

-- step create:constraint:sys_sync.sys_sync__ck__e99263c2 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_sync" where (("cursor" is null or store_json_valid("cursor", ''{"kind":"json","optional":true}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'sys_sync__ck__e99263c2 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_sync" add constraint "sys_sync__ck__e99263c2" check (("cursor" is null or store_json_valid("cursor", '{"kind":"json","optional":true}'::jsonb) is true));

-- step create:constraint:sys_sync.sys_sync__ck__f5908383 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_sync" where ("phase" in (''read'', ''reconcile'')) is false' into n;
	if n > 0 then raise exception 'sys_sync__ck__f5908383 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_sync" add constraint "sys_sync__ck__f5908383" check ("phase" in ('read', 'reconcile'));

-- step create:constraint:sys_sync.sys_sync__ck__98079e6a (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_sync" where (("health" is null or store_json_valid("health", ''{"kind":"json","optional":true}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'sys_sync__ck__98079e6a refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_sync" add constraint "sys_sync__ck__98079e6a" check (("health" is null or store_json_valid("health", '{"kind":"json","optional":true}'::jsonb) is true));

-- step create:constraint:sys_sync.sys_sync__ck__df253602 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_sync" where (isfinite("started_at")) is false' into n;
	if n > 0 then raise exception 'sys_sync__ck__df253602 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_sync" add constraint "sys_sync__ck__df253602" check (isfinite("started_at"));

-- step create:constraint:sys_sync.sys_sync__ck__d1313278 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_sync" where (isfinite("last_read_at")) is false' into n;
	if n > 0 then raise exception 'sys_sync__ck__d1313278 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_sync" add constraint "sys_sync__ck__d1313278" check (isfinite("last_read_at"));

-- step create:constraint:sys_sync.sys_sync__ck__232ebd77 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_sync" where (isfinite("last_change_at")) is false' into n;
	if n > 0 then raise exception 'sys_sync__ck__232ebd77 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_sync" add constraint "sys_sync__ck__232ebd77" check (isfinite("last_change_at"));

-- step create:constraint:sys_sync.sys_sync__ck__22245f07 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_sync" where (isfinite("last_hint_at")) is false' into n;
	if n > 0 then raise exception 'sys_sync__ck__22245f07 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_sync" add constraint "sys_sync__ck__22245f07" check (isfinite("last_hint_at"));

-- step create:constraint:sys_sync.sys_sync__uq__6547545b (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select coalesce(sum(n - 1), 0)::int as n from (select count(*) as n from "sys_sync" group by "sync", "instance", "partition" having count(*) > 1) d' into n;
	if n > 0 then raise exception 'sys_sync__uq__6547545b refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_sync" add constraint "sys_sync__uq__6547545b" unique nulls not distinct ("sync", "instance", "partition");

-- step create:constraint:sys_sync_row.sys_sync_row__uq__2381ae65 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select coalesce(sum(n - 1), 0)::int as n from (select count(*) as n from "sys_sync_row" group by "sync", "instance", "remote_id" having count(*) > 1) d' into n;
	if n > 0 then raise exception 'sys_sync_row__uq__2381ae65 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_sync_row" add constraint "sys_sync_row__uq__2381ae65" unique nulls not distinct ("sync", "instance", "remote_id");

-- step create:constraint:sys_sync_row.sys_sync_row__uq__d838f8ad (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select coalesce(sum(n - 1), 0)::int as n from (select count(*) as n from "sys_sync_row" group by "sync", "instance", "record" having count(*) > 1) d' into n;
	if n > 0 then raise exception 'sys_sync_row__uq__d838f8ad refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_sync_row" add constraint "sys_sync_row__uq__d838f8ad" unique nulls not distinct ("sync", "instance", "record");

-- step create:constraint:sys_user.sys_user__ck__88131100 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_user" where ("email" ~ ''^[^@\s]+@[^@\s]+\.[^@\s]+$'') is false' into n;
	if n > 0 then raise exception 'sys_user__ck__88131100 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_user" add constraint "sys_user__ck__88131100" check ("email" ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');

-- step create:constraint:sys_user.sys_user__ck__973b1124 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_user" where ("kind" in (''staff'', ''external'')) is false' into n;
	if n > 0 then raise exception 'sys_user__ck__973b1124 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_user" add constraint "sys_user__ck__973b1124" check ("kind" in ('staff', 'external'));

-- step create:constraint:sys_user.sys_user__ck__cceca9d3 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_user" where (("party" is null or store_json_valid("party", ''{"kind":"json","optional":true}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'sys_user__ck__cceca9d3 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_user" add constraint "sys_user__ck__cceca9d3" check (("party" is null or store_json_valid("party", '{"kind":"json","optional":true}'::jsonb) is true));

-- step create:constraint:sys_user.sys_user__ck__367d8eb4 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_user" where (isfinite("created_at")) is false' into n;
	if n > 0 then raise exception 'sys_user__ck__367d8eb4 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_user" add constraint "sys_user__ck__367d8eb4" check (isfinite("created_at"));

-- step create:constraint:sys_user.sys_user__ck__477bc0d2 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_user" where ((coalesce("admin" = false, false) or coalesce("kind" = ''staff''::text, false))) is false' into n;
	if n > 0 then raise exception 'sys_user__ck__477bc0d2 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_user" add constraint "sys_user__ck__477bc0d2" check ((coalesce("admin" = false, false) or coalesce("kind" = 'staff'::text, false)));

-- step create:fk:requestor.requestor__fk__5c80de5d (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "requestor" c where c."approval_request_id" is not null and not exists (select 1 from "approval_request" p where p."id" = c."approval_request_id")' into n;
	if n > 0 then raise exception 'requestor__fk__5c80de5d refuses % existing row(s)', n; end if;
end $store$;
alter table "requestor" add constraint "requestor__fk__5c80de5d" foreign key ("approval_request_id") references "approval_request" ("id") on delete restrict on update restrict;

-- step create:fk:sys_api_key.sys_api_key__fk__39b6eca5 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_api_key" c where c."created_by" is not null and not exists (select 1 from "sys_user" p where p."id" = c."created_by")' into n;
	if n > 0 then raise exception 'sys_api_key__fk__39b6eca5 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_api_key" add constraint "sys_api_key__fk__39b6eca5" foreign key ("created_by") references "sys_user" ("id") on delete restrict on update restrict;

-- step create:fk:sys_conversation.sys_conversation__fk__c30bef48 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_conversation" c where c."integration" is not null and not exists (select 1 from "sys_integration" p where p."id" = c."integration")' into n;
	if n > 0 then raise exception 'sys_conversation__fk__c30bef48 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_conversation" add constraint "sys_conversation__fk__c30bef48" foreign key ("integration") references "sys_integration" ("id") on delete cascade on update restrict;

-- step create:fk:sys_inbox.sys_inbox__fk__328a1493 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_inbox" c where c."instance" is not null and not exists (select 1 from "sys_integration" p where p."id" = c."instance")' into n;
	if n > 0 then raise exception 'sys_inbox__fk__328a1493 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_inbox" add constraint "sys_inbox__fk__328a1493" foreign key ("instance") references "sys_integration" ("id") on delete cascade on update restrict;

-- step create:fk:sys_integration.sys_integration__fk__6b4b5400 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_integration" c where c."owner" is not null and not exists (select 1 from "sys_user" p where p."id" = c."owner")' into n;
	if n > 0 then raise exception 'sys_integration__fk__6b4b5400 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_integration" add constraint "sys_integration__fk__6b4b5400" foreign key ("owner") references "sys_user" ("id") on delete restrict on update restrict;

-- step create:fk:sys_invitation.sys_invitation__fk__1777d672 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_invitation" c where c."invited_by" is not null and not exists (select 1 from "sys_user" p where p."id" = c."invited_by")' into n;
	if n > 0 then raise exception 'sys_invitation__fk__1777d672 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_invitation" add constraint "sys_invitation__fk__1777d672" foreign key ("invited_by") references "sys_user" ("id") on delete restrict on update restrict;

-- step create:fk:sys_message.sys_message__fk__c30bef48 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_message" c where c."integration" is not null and not exists (select 1 from "sys_integration" p where p."id" = c."integration")' into n;
	if n > 0 then raise exception 'sys_message__fk__c30bef48 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_message" add constraint "sys_message__fk__c30bef48" foreign key ("integration") references "sys_integration" ("id") on delete cascade on update restrict;

-- step create:fk:sys_outbox.sys_outbox__fk__328a1493 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_outbox" c where c."instance" is not null and not exists (select 1 from "sys_integration" p where p."id" = c."instance")' into n;
	if n > 0 then raise exception 'sys_outbox__fk__328a1493 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_outbox" add constraint "sys_outbox__fk__328a1493" foreign key ("instance") references "sys_integration" ("id") on delete cascade on update restrict;

-- step create:fk:sys_outbox.sys_outbox__fk__8ce85697 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_outbox" c where c."writer" is not null and not exists (select 1 from "sys_user" p where p."id" = c."writer")' into n;
	if n > 0 then raise exception 'sys_outbox__fk__8ce85697 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_outbox" add constraint "sys_outbox__fk__8ce85697" foreign key ("writer") references "sys_user" ("id") on delete set null on update restrict;

-- step create:fk:sys_session.sys_session__fk__91b4d50c (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_session" c where c."user" is not null and not exists (select 1 from "sys_user" p where p."id" = c."user")' into n;
	if n > 0 then raise exception 'sys_session__fk__91b4d50c refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_session" add constraint "sys_session__fk__91b4d50c" foreign key ("user") references "sys_user" ("id") on delete cascade on update restrict;

-- step create:fk:sys_session.sys_session__fk__515456ab (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_session" c where c."impersonated_by" is not null and not exists (select 1 from "sys_user" p where p."id" = c."impersonated_by")' into n;
	if n > 0 then raise exception 'sys_session__fk__515456ab refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_session" add constraint "sys_session__fk__515456ab" foreign key ("impersonated_by") references "sys_user" ("id") on delete restrict on update restrict;

-- step create:fk:sys_sync.sys_sync__fk__328a1493 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_sync" c where c."instance" is not null and not exists (select 1 from "sys_integration" p where p."id" = c."instance")' into n;
	if n > 0 then raise exception 'sys_sync__fk__328a1493 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_sync" add constraint "sys_sync__fk__328a1493" foreign key ("instance") references "sys_integration" ("id") on delete cascade on update restrict;

-- step create:fk:sys_sync_row.sys_sync_row__fk__328a1493 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_sync_row" c where c."instance" is not null and not exists (select 1 from "sys_integration" p where p."id" = c."instance")' into n;
	if n > 0 then raise exception 'sys_sync_row__fk__328a1493 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_sync_row" add constraint "sys_sync_row__fk__328a1493" foreign key ("instance") references "sys_integration" ("id") on delete cascade on update restrict;

-- step create:trigger:approval_request.store_row_rules (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
create trigger store_row_rules before insert or update or delete on "approval_request" for each row execute function store_row_rules('{"audit":false,"fields":{"action":["action"],"approver_teams":["approver_teams"],"approver_users":["approver_users"],"closed_at":["closed_at"],"closed_by":["closed_by"],"collection_name":["collection_name"],"created_at":["created_at"],"record_id":["record_id"],"revision":["revision"],"status":["status"],"step":["step"],"step_names":["step_names"],"steps":["steps"],"superseder_teams":["superseder_teams"]},"key":["id"],"parents":[],"states":{}}');

-- step create:index:approval_request.approval_request__ux__2e4b03bd (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
create unique index "approval_request__ux__2e4b03bd" on "approval_request" ("collection_name", "record_id") where ("status" = 'ONGOING'::text);

-- step create:trigger:requestor.store_row_rules (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
create trigger store_row_rules before insert or update or delete on "requestor" for each row execute function store_row_rules('{"audit":false,"fields":{"approval_request_id":["approval_request_id"],"user_id":["user_id"]},"key":["id"],"parents":[],"states":{}}');

-- step create:trigger:sys_api_key.store_row_rules (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
create trigger store_row_rules before insert or update or delete on "sys_api_key" for each row execute function store_row_rules('{"audit":false,"fields":{"created_at":["created_at"],"created_by":["created_by"],"hash":["hash"],"last_used_at":["last_used_at"],"name":["name"],"prefix":["prefix"],"revision":["revision"],"revoked_at":["revoked_at"],"team":["team"]},"key":["id"],"parents":[],"states":{}}');

-- step create:trigger:sys_challenge.store_row_rules (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
create trigger store_row_rules before insert or update or delete on "sys_challenge" for each row execute function store_row_rules('{"audit":false,"fields":{"address_mac":["address_mac"],"attempts":["attempts"],"code_mac":["code_mac"],"expires_at":["expires_at"]},"key":["address_mac"],"parents":[],"states":{}}');

-- step create:trigger:sys_config.store_row_rules (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
create trigger store_row_rules before insert or update or delete on "sys_config" for each row execute function store_row_rules('{"audit":false,"fields":{"key":["key"],"value":["value"]},"key":["key"],"parents":[],"states":{}}');

-- step create:trigger:sys_conversation.store_row_rules (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
create trigger store_row_rules before insert or update or delete on "sys_conversation" for each row execute function store_row_rules('{"audit":false,"fields":{"created_at":["created_at"],"envoy":["envoy"],"goals":["goals"],"inputs":["inputs"],"integration":["integration"],"kind":["kind"],"lease_until":["lease_until"],"model":["model"],"outputs":["outputs"],"owner":["owner"],"parent":["parent"],"participants":["participants"],"plan":["plan"],"read":["read"],"revision":["revision"],"run":["run"],"status":["status"],"thread":["thread"],"title":["title"],"updated_at":["updated_at"]},"key":["id"],"parents":[],"states":{}}');

-- step create:trigger:sys_file.store_row_rules (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
create trigger store_row_rules before insert or update or delete on "sys_file" for each row execute function store_row_rules('{"audit":false,"fields":{"created_at":["created_at"],"created_by":["created_by"],"field":["field"],"key":["key"],"mime":["mime"],"name":["name"],"revision":["revision"],"sha256":["sha256"],"size":["size"],"updated_at":["updated_at"],"updated_by":["updated_by"]},"key":["id"],"parents":[],"states":{}}');

-- step create:trigger:sys_inbox.store_row_rules (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
create trigger store_row_rules before insert or update or delete on "sys_inbox" for each row execute function store_row_rules('{"audit":false,"fields":{"body":["body"],"consumed_at":["consumed_at"],"delivery":["delivery"],"headers":["headers"],"instance":["instance"],"received_at":["received_at"],"sync":["sync"]},"key":["id"],"parents":[],"states":{}}');

-- step create:index:sys_inbox.sys_inbox__ix__e6ba37d2 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
create index "sys_inbox__ix__e6ba37d2" on "sys_inbox" ("sync", "instance", "received_at") where ("consumed_at" is null);

-- step create:trigger:sys_integration.store_row_rules (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
create trigger store_row_rules before insert or update or delete on "sys_integration" for each row execute function store_row_rules('{"audit":false,"fields":{"active":["active"],"configuration":["configuration"],"envoy":["envoy"],"epoch":["epoch"],"import_start":["import_start"],"integration":["integration"],"name":["name"],"named":["named"],"owner":["owner"],"revision":["revision"],"status":["status"]},"key":["id"],"parents":[],"states":{}}');

-- step create:index:sys_integration.sys_integration__ux__3c46fc6b (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
create unique index "sys_integration__ux__3c46fc6b" on "sys_integration" ("owner", "integration") where ("owner" is not null);

-- step create:trigger:sys_invitation.store_row_rules (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
create trigger store_row_rules before insert or update or delete on "sys_invitation" for each row execute function store_row_rules('{"audit":false,"fields":{"accepted_at":["accepted_at"],"email":["email"],"expires_at":["expires_at"],"external":["external"],"invited_by":["invited_by"],"party":["party"],"phone":["phone"],"revision":["revision"],"revoked_at":["revoked_at"],"team":["team"]},"key":["id"],"parents":[],"states":{}}');

-- step create:index:sys_invitation.sys_invitation__ix__08e69363 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
create index "sys_invitation__ix__08e69363" on "sys_invitation" (lower("email"));

-- step create:index:sys_invitation.sys_invitation__ix__55565b71 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
create index "sys_invitation__ix__55565b71" on "sys_invitation" ("phone");

-- step create:trigger:sys_message.store_row_rules (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
create trigger store_row_rules before insert or update or delete on "sys_message" for each row execute function store_row_rules('{"audit":false,"fields":{"about":["about"],"addressed":["addressed"],"as":["as"],"attempts":["attempts"],"author":["author"],"claimed_at":["claimed_at"],"content":["content"],"conversation":["conversation"],"created_at":["created_at"],"deleted_at":["deleted_at"],"delivered_turn":["delivered_turn"],"delivery":["delivery"],"direction":["direction"],"edited_at":["edited_at"],"email":["email"],"epoch":["epoch"],"error":["error"],"integration":["integration"],"invocation":["invocation"],"message":["message"],"meta":["meta"],"mode":["mode"],"next_attempt_at":["next_attempt_at"],"origin":["origin"],"presume_at":["presume_at"],"preview":["preview"],"provider_id":["provider_id"],"read_by":["read_by"],"refused":["refused"],"reply_to":["reply_to"],"role":["role"],"sender":["sender"],"sender_name":["sender_name"],"sent_at":["sent_at"],"seq":["seq"],"source_at":["source_at"],"state":["state"],"status":["status"],"supersedes":["supersedes"],"text":["text"],"thread":["thread"],"turn":["turn"],"version":["version"]},"key":["id"],"parents":[],"states":{}}');

-- step create:index:sys_message.sys_message__ix__a95ef2c9 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
create index "sys_message__ix__a95ef2c9" on "sys_message" ("conversation", "seq");

-- step create:index:sys_message.sys_message__ix__49e2e89c (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
create index "sys_message__ix__49e2e89c" on "sys_message" ("integration", "provider_id");

-- step create:index:sys_message.sys_message__ix__6a5d3d55 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
create index "sys_message__ix__6a5d3d55" on "sys_message" ("conversation") where ("state" = 'queued'::text);

-- step create:index:sys_message.sys_message__ix__ddeff634 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
create index "sys_message__ix__ddeff634" on "sys_message" ("conversation") where ("state" = 'pending'::text);

-- step create:index:sys_message.sys_message__ix__5c3f70a3 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
create index "sys_message__ix__5c3f70a3" on "sys_message" ("seq") where ("status" in ('queued'::text, 'sending'::text));

-- step create:trigger:sys_notification.store_row_rules (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
create trigger store_row_rules before insert or update or delete on "sys_notification" for each row execute function store_row_rules('{"audit":false,"fields":{"at":["at"],"attachments":["attachments"],"body":["body"],"link":["link"],"member":["member"],"once":["once"],"read_at":["read_at"],"recipient":["recipient"],"title":["title"]},"key":["id"],"parents":[],"states":{}}');

-- step create:index:sys_notification.sys_notification__ix__846c656b (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
create index "sys_notification__ix__846c656b" on "sys_notification" ("member", "at") where ("member" is not null);

-- step create:trigger:sys_outbox.store_row_rules (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
create trigger store_row_rules before insert or update or delete on "sys_outbox" for each row execute function store_row_rules('{"audit":false,"fields":{"acked_at":["acked_at"],"at":["at"],"attempts":["attempts"],"changed":["changed"],"claimed_at":["claimed_at"],"epoch":["epoch"],"error":["error"],"image":["image"],"instance":["instance"],"key":["key"],"model":["model"],"next_attempt_at":["next_attempt_at"],"op":["op"],"record":["record"],"record_revision":["record_revision"],"result":["result"],"seq":["seq"],"status":["status"],"sync":["sync"],"writer":["writer"]},"key":["id"],"parents":[],"states":{}}');

-- step create:index:sys_outbox.sys_outbox__ux__fb7eed3b (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
create unique index "sys_outbox__ux__fb7eed3b" on "sys_outbox" ("sync", "instance", "record") where ("attempts" = '0'::int and "status" = 'queued'::text);

-- step create:index:sys_outbox.sys_outbox__ix__3f170955 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
create index "sys_outbox__ix__3f170955" on "sys_outbox" ("next_attempt_at") where ("status" = 'queued'::text);

-- step create:index:sys_outbox.sys_outbox__ix__565ce04f (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
create index "sys_outbox__ix__565ce04f" on "sys_outbox" ("sync", "record", "seq") where ("status" in ('queued'::text, 'sending'::text));

-- step create:index:sys_outbox.sys_outbox__ix__564640ab (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
create index "sys_outbox__ix__564640ab" on "sys_outbox" ("sync") where ("status" = 'dead'::text);

-- step create:trigger:sys_run.store_row_rules (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
create trigger store_row_rules before insert or update or delete on "sys_run" for each row execute function store_row_rules('{"audit":false,"fields":{"actor":["actor"],"attempts":["attempts"],"automation":["automation"],"cause":["cause"],"depth":["depth"],"due_at":["due_at"],"error":["error"],"finished_at":["finished_at"],"input":["input"],"key":["key"],"leases":["leases"],"output":["output"],"progress":["progress"],"results":["results"],"run_key":["run_key"],"started_at":["started_at"],"starter":["starter"],"state":["state"]},"key":["id"],"parents":[],"states":{}}');

-- step create:index:sys_run.sys_run__ix__1ee5eb39 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
create index "sys_run__ix__1ee5eb39" on "sys_run" ("due_at") where ("state" = 'queued'::text);

-- step create:trigger:sys_session.store_row_rules (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
create trigger store_row_rules before insert or update or delete on "sys_session" for each row execute function store_row_rules('{"audit":false,"fields":{"agent":["agent"],"created_at":["created_at"],"expires_at":["expires_at"],"impersonated_by":["impersonated_by"],"refreshed_at":["refreshed_at"],"token_hash":["token_hash"],"user":["user"],"via":["via"]},"key":["id"],"parents":[],"states":{}}');

-- step create:trigger:sys_sync.store_row_rules (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
create trigger store_row_rules before insert or update or delete on "sys_sync" for each row execute function store_row_rules('{"audit":false,"fields":{"cursor":["cursor"],"cycle":["cycle"],"digest":["digest"],"health":["health"],"instance":["instance"],"last_change_at":["last_change_at"],"last_hint_at":["last_hint_at"],"last_read_at":["last_read_at"],"partition":["partition"],"phase":["phase"],"started_at":["started_at"],"sync":["sync"],"version":["version"]},"key":["id"],"parents":[],"states":{}}');

-- step create:trigger:sys_sync_row.store_row_rules (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
create trigger store_row_rules before insert or update or delete on "sys_sync_row" for each row execute function store_row_rules('{"audit":false,"fields":{"acked_revision":["acked_revision"],"cycle":["cycle"],"instance":["instance"],"partition":["partition"],"record":["record"],"remote_id":["remote_id"],"remote_version":["remote_version"],"sync":["sync"]},"key":["id"],"parents":[],"states":{}}');

-- step create:index:sys_sync_row.sys_sync_row__ix__c5cc52ee (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
create index "sys_sync_row__ix__c5cc52ee" on "sys_sync_row" ("sync", "instance", "partition", "cycle");

-- step create:trigger:sys_user.store_row_rules (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
create trigger store_row_rules before insert or update or delete on "sys_user" for each row execute function store_row_rules('{"audit":false,"fields":{"active":["active"],"admin":["admin"],"created_at":["created_at"],"email":["email"],"kind":["kind"],"name":["name"],"party":["party"],"phone":["phone"],"revision":["revision"],"signup":["signup"],"team":["team"],"telegram":["telegram"]},"key":["id"],"parents":[],"states":{}}');

-- step create:index:sys_user.sys_user__ux__08e69363 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
create unique index "sys_user__ux__08e69363" on "sys_user" (lower("email"));

-- step create:index:sys_user.sys_user__ux__1c9f4db2 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
create unique index "sys_user__ux__1c9f4db2" on "sys_user" ("phone_key");

-- step create:trigger:notes.store_row_rules (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
create trigger store_row_rules before insert or update or delete on "notes" for each row execute function store_row_rules('{"audit":true,"fields":{"body":["body"],"title":["title"]},"key":["id"],"parents":[],"states":{}}');

-- step create:index:requestor.requestor__ix__084de4b0 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
create index "requestor__ix__084de4b0" on "requestor" ("approval_request_id");

-- step create:index:sys_api_key.sys_api_key__ix__6ae667f2 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
create index "sys_api_key__ix__6ae667f2" on "sys_api_key" ("created_by");

-- step create:index:sys_conversation.sys_conversation__ix__20648086 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
create index "sys_conversation__ix__20648086" on "sys_conversation" ("integration");

-- step create:index:sys_inbox.sys_inbox__ix__8be7dc72 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
create index "sys_inbox__ix__8be7dc72" on "sys_inbox" ("instance");

-- step create:index:sys_integration.sys_integration__ix__eb10cfe3 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
create index "sys_integration__ix__eb10cfe3" on "sys_integration" ("owner");

-- step create:index:sys_invitation.sys_invitation__ix__e7f1b36f (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
create index "sys_invitation__ix__e7f1b36f" on "sys_invitation" ("invited_by");

-- step create:index:sys_message.sys_message__ix__20648086 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
create index "sys_message__ix__20648086" on "sys_message" ("integration");

-- step create:index:sys_outbox.sys_outbox__ix__8be7dc72 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
create index "sys_outbox__ix__8be7dc72" on "sys_outbox" ("instance");

-- step create:index:sys_outbox.sys_outbox__ix__b99bf354 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
create index "sys_outbox__ix__b99bf354" on "sys_outbox" ("writer");

-- step create:index:sys_session.sys_session__ix__fccf4300 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
create index "sys_session__ix__fccf4300" on "sys_session" ("user");

-- step create:index:sys_session.sys_session__ix__8325fb86 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
create index "sys_session__ix__8325fb86" on "sys_session" ("impersonated_by");

-- step create:index:sys_sync.sys_sync__ix__8be7dc72 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
create index "sys_sync__ix__8be7dc72" on "sys_sync" ("instance");

-- step create:index:sys_sync_row.sys_sync_row__ix__8be7dc72 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
create index "sys_sync_row__ix__8be7dc72" on "sys_sync_row" ("instance");

-- step create:engine:audit:notes (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
drop trigger if exists bolt_audit_mark on "notes";
create trigger bolt_audit_mark before insert or update or delete on "notes" for each row execute function bolt_audit_mark('[]','[]');
drop trigger if exists bolt_audit on "notes";
create trigger bolt_audit after insert or update or delete on "notes" for each row execute function bolt_audit('[]','[]');
