-- 0010_schema.sql: 32 step(s), from 7626475484fdda9dae4d951ec571ee0b62658d87b61df5f3cea3fa06543e97fe to b178669bab87d1c1bbc6c9753c02a716cfeb41a5b7ffb1ef938b9c2dd8a10f1b.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- hazard: DESTRUCTIVE: drops data (a table or a stored column) or rebuilds it; runs only under its accept line.
-- hazard: backfill: rows of the changed catalogs are rewritten from every row (time grows with the table).
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.

-- step replace:trigger:leave_catalog.store_row_rules (additive)
drop trigger if exists store_row_rules on "leave_catalog";

-- step replace:trigger:claim_catalog.store_row_rules (additive)
drop trigger if exists store_row_rules on "claim_catalog";

-- step replace:trigger:allowance_catalog.store_row_rules (additive)
drop trigger if exists store_row_rules on "allowance_catalog";

-- step backfill:catalogs (data)
-- One pricing rule per catalog: what the dropped columns said moves into each row's conversion or subtotal.
update "leave_catalog" set "conversion" = $q$// js
return 0;$q$ where "pay_treatment" = 'UNPAID';
update "leave_catalog" set "conversion" = $q$const deducted = (() => {
$q$ || "conversion" || $q$
})();
return ctx.day_pay * ctx.entry.quantity - deducted;$q$
where "pay_treatment" = 'PAID' and "direction" = 'DEDUCT' and coalesce("conversion", '') <> '';
update "leave_catalog" set "conversion" = replace("conversion",
	$q$if (get(ctx.entry, 'encashment', false) !== true) return 0;$q$,
	$q$if (get(ctx.entry, 'encashment', false) !== true) return ctx.day_pay * ctx.entry.quantity;$q$)
where "pay_treatment" = 'PAID' and "direction" = 'ADD' and coalesce("conversion", '') <> '';
update "allowance_catalog" set "conversion" = $q$const prorated = (() => {
$q$ || "conversion" || $q$
})();
return prorated * ctx.paid_share;$q$
where "prorate";
update "allowance_catalog" set "subtotal_id" = null where "party" = 'EMPLOYER';
update "claim_catalog" set "subtotal_id" = null where "party" = 'EMPLOYER';
-- a sealed row refuses raw writes: its row rules stand aside for this one rewrite
alter table "statutory_contribution_catalog" disable trigger store_row_rules;
update "statutory_contribution_catalog" set "employer_amount" = replace(replace("employer_amount",
	$q$const housing = subtotal('HOUSING_PAY') - subtotal('WORK_EXPENSE_PAY');$q$,
	$q$// Housing the employer pays is no pay line: the contract amount, on the share of the salary BASIC pays, on-cycle.
const housingRate = Number(get(ctx.subject.employment, 'terms.rate.amount', 0));
const housingAmount = Number(get(ctx.subject.employment, 'terms.allowances.HOUSING.amount', 0));
const housing =
	get(ctx.run, 'kind', '') === 'OFF_CYCLE' || get(ctx.subject.employment, 'terms.rate.unit', '') !== 'MONTHLY'
		? 0
		: round(housingRate > 0 ? (housingAmount * subtotal('BASIC')) / housingRate : housingAmount);$q$),
	$q$- meal - workExpense - housing - outside - exemptOvertime$q$,
	$q$- meal - workExpense - outside - exemptOvertime$q$)
where "code" = 'PIT_TAXABLE_INCOME';
alter table "statutory_contribution_catalog" enable trigger store_row_rules;
update "leave_catalog" set "lookup" = "lookup" - 'no_cap' - 'can_encash' where "lookup" ?| array['no_cap', 'can_encash'];

-- step drop:constraint:leave_catalog.leave_catalog__ck__6d503d68 (additive)
-- operational risk: access-exclusive-lock
alter table "leave_catalog" drop constraint if exists "leave_catalog__ck__6d503d68";

-- step drop:constraint:leave_catalog.leave_catalog__ck__4006a972 (additive)
-- operational risk: access-exclusive-lock
alter table "leave_catalog" drop constraint if exists "leave_catalog__ck__4006a972";

-- step drop:notNull:leave_catalog.direction (additive)
-- operational risk: access-exclusive-lock
alter table "leave_catalog" alter column "direction" drop not null;

-- step drop:notNull:leave_catalog.pay_treatment (additive)
-- operational risk: access-exclusive-lock
alter table "leave_catalog" alter column "pay_treatment" drop not null;

-- step drop:default:leave_catalog.direction (additive)
-- operational risk: access-exclusive-lock
alter table "leave_catalog" alter column "direction" drop default;

-- step drop:column:leave_catalog.direction (destructive)
-- accept: drop:column:leave_catalog.direction
-- operational risk: access-exclusive-lock
alter table "leave_catalog" drop column if exists "direction" cascade;

-- step drop:column:leave_catalog.pay_treatment (destructive)
-- accept: drop:column:leave_catalog.pay_treatment
-- operational risk: access-exclusive-lock
alter table "leave_catalog" drop column if exists "pay_treatment" cascade;

-- step replace:history:schema:leave_catalog (additive)
select bolt_history_register('leave_catalog','{"audit":true,"fields":{"code":{"kind":"text"},"conversion":{"kind":"text","max":65536,"optional":true},"description":{"kind":"text","optional":true},"eligibility":{"kind":"text","max":65536,"optional":true},"lookup":{"default":{},"kind":"json","shape":{"kind":"record","of":{"kind":"json"}}},"references":{"kind":"custom","of":"references","optional":true},"settings_id":{"inverse":"leave_catalog","kind":"ref","owned":true,"to":"jurisdiction_settings"},"subtotal_id":{"inverse":"leave_catalog","kind":"ref","onDelete":"restrict","optional":true,"to":"subtotal"}},"nativeRules":2,"recordLabel":"record.code","unique":[{"fields":["settings_id","code"]}]}'::jsonb);

-- step drop:constraint:allowance_catalog.allowance_catalog__ck__856ea7dc (additive)
-- operational risk: access-exclusive-lock
alter table "allowance_catalog" drop constraint if exists "allowance_catalog__ck__856ea7dc";

-- step drop:constraint:claim_catalog.claim_catalog__ck__6d503d68 (additive)
-- operational risk: access-exclusive-lock
alter table "claim_catalog" drop constraint if exists "claim_catalog__ck__6d503d68";

-- step drop:constraint:claim_catalog.claim_catalog__ck__856ea7dc (additive)
-- operational risk: access-exclusive-lock
alter table "claim_catalog" drop constraint if exists "claim_catalog__ck__856ea7dc";

-- step drop:notNull:allowance_catalog.party (additive)
-- operational risk: access-exclusive-lock
alter table "allowance_catalog" alter column "party" drop not null;

-- step drop:notNull:allowance_catalog.prorate (additive)
-- operational risk: access-exclusive-lock
alter table "allowance_catalog" alter column "prorate" drop not null;

-- step drop:notNull:claim_catalog.direction (additive)
-- operational risk: access-exclusive-lock
alter table "claim_catalog" alter column "direction" drop not null;

-- step drop:notNull:claim_catalog.party (additive)
-- operational risk: access-exclusive-lock
alter table "claim_catalog" alter column "party" drop not null;

-- step drop:default:allowance_catalog.party (additive)
-- operational risk: access-exclusive-lock
alter table "allowance_catalog" alter column "party" drop default;

-- step drop:default:allowance_catalog.prorate (additive)
-- operational risk: access-exclusive-lock
alter table "allowance_catalog" alter column "prorate" drop default;

-- step drop:default:claim_catalog.direction (additive)
-- operational risk: access-exclusive-lock
alter table "claim_catalog" alter column "direction" drop default;

-- step drop:default:claim_catalog.party (additive)
-- operational risk: access-exclusive-lock
alter table "claim_catalog" alter column "party" drop default;

-- step drop:column:allowance_catalog.party (destructive)
-- accept: drop:column:allowance_catalog.party
-- operational risk: access-exclusive-lock
alter table "allowance_catalog" drop column if exists "party" cascade;

-- step drop:column:allowance_catalog.prorate (destructive)
-- accept: drop:column:allowance_catalog.prorate
-- operational risk: access-exclusive-lock
alter table "allowance_catalog" drop column if exists "prorate" cascade;

-- step drop:column:claim_catalog.direction (destructive)
-- accept: drop:column:claim_catalog.direction
-- operational risk: access-exclusive-lock
alter table "claim_catalog" drop column if exists "direction" cascade;

-- step drop:column:claim_catalog.party (destructive)
-- accept: drop:column:claim_catalog.party
-- operational risk: access-exclusive-lock
alter table "claim_catalog" drop column if exists "party" cascade;

-- step replace:history:schema:claim_catalog (additive)
select bolt_history_register('claim_catalog','{"audit":true,"fields":{"code":{"kind":"text"},"conversion":{"kind":"text","max":65536,"optional":true},"description":{"kind":"text","optional":true},"eligibility":{"kind":"text","max":65536,"optional":true},"lookup":{"default":{},"kind":"json","shape":{"kind":"record","of":{"kind":"json"}}},"references":{"kind":"custom","of":"references","optional":true},"settings_id":{"inverse":"claim_catalog","kind":"ref","owned":true,"to":"jurisdiction_settings"},"subtotal_id":{"inverse":"claim_catalog","kind":"ref","onDelete":"restrict","optional":true,"to":"subtotal"}},"nativeRules":2,"recordLabel":"record.code","unique":[{"fields":["settings_id","code"]}]}'::jsonb);

-- step replace:history:schema:allowance_catalog (additive)
select bolt_history_register('allowance_catalog','{"audit":true,"fields":{"code":{"kind":"text"},"conversion":{"kind":"text","max":65536},"description":{"help":"What this catalog row does: its rule, behaviour and any legal or operational note.","kind":"text","optional":true},"eligibility":{"kind":"text","max":65536},"include_in_rate":{"default":false,"kind":"bool"},"lookup":{"default":{},"kind":"json","shape":{"kind":"record","of":{"kind":"json"}}},"references":{"kind":"custom","of":"references","optional":true},"settings_id":{"inverse":"allowance_catalog","kind":"ref","owned":true,"to":"jurisdiction_settings"},"subtotal_id":{"inverse":"allowance_catalog","kind":"ref","onDelete":"restrict","optional":true,"to":"subtotal"}},"nativeRules":2,"recordLabel":"record.code","unique":[{"fields":["settings_id","code"]}]}'::jsonb);

-- step replace:trigger:leave_catalog.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "leave_catalog" for each row execute function store_row_rules('{"audit":true,"fields":{"code":["code"],"conversion":["conversion"],"description":["description"],"eligibility":["eligibility"],"lookup":["lookup"],"references":["references"],"settings_id":["settings_id"],"subtotal_id":["subtotal_id"]},"key":["id"],"parents":[{"column":"settings_id","key":"id","relation":"leave_catalog","states":{"status":{"initial":"DRAFT","states":{"DRAFT":{"edit":"all","to":["SEALED","VOID"]},"SEALED":{"edit":["effective_range","reason"],"to":["VOID"]},"VOID":{"edit":"none","to":[]}}}},"table":"jurisdiction_settings","type":"uuid"}],"states":{}}');

-- step replace:trigger:claim_catalog.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "claim_catalog" for each row execute function store_row_rules('{"audit":true,"fields":{"code":["code"],"conversion":["conversion"],"description":["description"],"eligibility":["eligibility"],"lookup":["lookup"],"references":["references"],"settings_id":["settings_id"],"subtotal_id":["subtotal_id"]},"key":["id"],"parents":[{"column":"settings_id","key":"id","relation":"claim_catalog","states":{"status":{"initial":"DRAFT","states":{"DRAFT":{"edit":"all","to":["SEALED","VOID"]},"SEALED":{"edit":["effective_range","reason"],"to":["VOID"]},"VOID":{"edit":"none","to":[]}}}},"table":"jurisdiction_settings","type":"uuid"}],"states":{}}');

-- step replace:trigger:allowance_catalog.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "allowance_catalog" for each row execute function store_row_rules('{"audit":true,"fields":{"code":["code"],"conversion":["conversion"],"description":["description"],"eligibility":["eligibility"],"include_in_rate":["include_in_rate"],"lookup":["lookup"],"references":["references"],"settings_id":["settings_id"],"subtotal_id":["subtotal_id"]},"key":["id"],"parents":[{"column":"settings_id","key":"id","relation":"allowance_catalog","states":{"status":{"initial":"DRAFT","states":{"DRAFT":{"edit":"all","to":["SEALED","VOID"]},"SEALED":{"edit":["effective_range","reason"],"to":["VOID"]},"VOID":{"edit":"none","to":[]}}}},"table":"jurisdiction_settings","type":"uuid"}],"states":{}}');
