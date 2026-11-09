-- 0011_schema.sql: 9 step(s), from b178669bab87d1c1bbc6c9753c02a716cfeb41a5b7ffb1ef938b9c2dd8a10f1b to 2812ec28da477072abf21f6b8e507f7652556c3896441f94be30f03aba811de8.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- hazard: backfill: leave rows are rewritten from their conversion before it is dropped.
-- hazard: DESTRUCTIVE: drops data (a table or a stored column) or rebuilds it; runs only under its accept line.
-- hazard: validating: refuses, naming the constraint and the row count, if existing rows break it.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.

-- step replace:trigger:leave_catalog.store_row_rules (additive)
drop trigger if exists store_row_rules on "leave_catalog";

-- step drop:constraint:leave_catalog.leave_catalog__ck__b517fae2 (additive)
-- operational risk: access-exclusive-lock
alter table "leave_catalog" drop constraint if exists "leave_catalog__ck__b517fae2";

-- step replace:history:schema:leave_catalog (additive)
select bolt_history_register('leave_catalog','{"audit":true,"fields":{"code":{"kind":"text"},"description":{"kind":"text","optional":true},"eligibility":{"kind":"text","max":65536,"optional":true},"lookup":{"default":{},"kind":"json","shape":{"kind":"record","of":{"kind":"json"}}},"paid_share":{"kind":"text","max":65536,"optional":true},"payout":{"kind":"text","max":65536,"optional":true},"references":{"kind":"custom","of":"references","optional":true},"settings_id":{"inverse":"leave_catalog","kind":"ref","owned":true,"to":"jurisdiction_settings"},"subtotal_id":{"inverse":"leave_catalog","kind":"ref","onDelete":"restrict","optional":true,"to":"subtotal"}},"nativeRules":2,"recordLabel":"record.code","unique":[{"fields":["settings_id","code"]}]}'::jsonb);

-- step create:column:leave_catalog.paid_share (additive)
-- operational risk: access-exclusive-lock
alter table "leave_catalog" add column "paid_share" text;

-- step create:column:leave_catalog.payout (additive)
-- operational risk: access-exclusive-lock
alter table "leave_catalog" add column "payout" text;

-- step backfill:leave_catalog.paid_share (data)
-- A leave row says what share of a normal day a slot pays (`paid_share`) and what a cash-out pays (`payout`):
-- every seeded conversion moves by its exact text; a no-pay row and a cash-out branch by their shape.
update "leave_catalog" set "paid_share" = null, "payout" = $q$// js
// 职工带薪年休假条例 第五条; 企业职工带薪年休假实施办法 第十条: 应休未休的天数按日工资收入的300%支付, 其中包含正常工作期间的工资. 第十二条: 离职时按当年已过日历天数折算, 不足1整天不支付.
const range = ctx.subject.employment.effective_range;
const end = get(range, 'to', null);
const started = get(ctx.subject.employment, 'service_started_on', range.from);
if (end == null) return ctx.day_rate * ctx.entry.quantity * ctx.lookup.encashment_factor;
const band = ctx.lookup.service_bands.filter((row) => row.service_months <= calendar_completed_months(started, end)).at(-1);
if (band == null) return 0;
const start = end.slice(0, 4) + '-01-01';
const qualified = add_months(started, ctx.lookup.qualifying_service_months);
const from = qualified > start ? qualified : start;
const part = (to) => Math.floor((band.days * (calendar_distance_days(from, to) + 1)) / ctx.lookup.first_year_proration_days);
const year = from === start ? band.days : part(end.slice(0, 4) + '-12-31');
return ctx.day_rate * Math.max(0, ctx.entry.quantity - year + part(end)) * ctx.lookup.encashment_factor;$q$
where "conversion" = $q$// js
// 职工带薪年休假条例 第五条; 企业职工带薪年休假实施办法 第十条: 应休未休的天数按日工资收入的300%支付, 其中包含正常工作期间的工资. 第十二条: 离职时按当年已过日历天数折算, 不足1整天不支付.
if (get(ctx.entry, 'encashment', false) !== true) return ctx.day_pay * ctx.entry.quantity;
const range = ctx.subject.employment.effective_range;
const end = get(range, 'to', null);
const started = get(ctx.subject.employment, 'service_started_on', range.from);
if (end == null) return ctx.day_rate * ctx.entry.quantity * ctx.lookup.encashment_factor;
const band = ctx.lookup.service_bands.filter((row) => row.service_months <= calendar_completed_months(started, end)).at(-1);
if (band == null) return 0;
const start = end.slice(0, 4) + '-01-01';
const qualified = add_months(started, ctx.lookup.qualifying_service_months);
const from = qualified > start ? qualified : start;
const part = (to) => Math.floor((band.days * (calendar_distance_days(from, to) + 1)) / ctx.lookup.first_year_proration_days);
const year = from === start ? band.days : part(end.slice(0, 4) + '-12-31');
return ctx.day_rate * Math.max(0, ctx.entry.quantity - year + part(end)) * ctx.lookup.encashment_factor;$q$;
update "leave_catalog" set "paid_share" = $q$// js
// 沪劳保发〔1995〕83号: 连续休假6个月以内, 连续工龄不满2年60%, 满2年70%, 满4年80%, 满6年90%, 满8年100%; 超过6个月的疾病救济费, 不满1年40%, 满1年50%, 满3年60%. In force to 2026-08-15.
// 劳部发〔1995〕309号 第59条; 沪劳保保发〔2000〕14号: 不低于最低工资的80%. 昆明市工资支付条例 第二十七条: 按有关规定支付. An agreed higher share binds.
const scheduled = get(ctx.subject.employer, 'payment_schedule.non_working_weekdays', [0, 6]);
const week = Number(get(ctx.subject.employment.terms, 'normal_days_per_week', 7 - scheduled.length));
const off = week === 7 - scheduled.length ? scheduled : [0, 6, 5, 4, 3, 2, 1].slice(0, 7 - week);
const day = ctx.work.days.find((row) => row.date === ctx.as_of);
if (day == null ? off.includes(weekday(ctx.as_of)) : !['WORK', 'ABS'].includes(get(day, 'day_type', 'WORK'))) return 1;
const region = String(get(ctx.subject.employer, 'entity_extension_data.region', ''));
const zones = ctx.lookup.minimum_wage_by_zone.filter((row) => row.region === region);
if (zones.length === 0 || !(ctx.month_wage > 0)) return 1;
const zone = String(get(ctx.subject.employer, 'entity_extension_data.wage_zone', zones[0].default_zone));
const least = (ctx.lookup.minimum_wage_floor_share * zones.find((row) => row.zone === zone).monthly) / ctx.month_wage;
const agreed = Number(get(ctx.subject.employment, 'employee_extension_data.sick_pay_share', 0));
const scale = () => {
	if (region !== 'SH' || ctx.as_of > ctx.lookup.shanghai_scale_until) return 0;
	const long = ctx.event != null && calendar_completed_months(ctx.event.on, ctx.as_of) >= ctx.lookup.shanghai_scale_first_months;
	const service = calendar_completed_months(get(ctx.subject.employment, 'service_started_on', ctx.subject.employment.effective_range.from), ctx.as_of);
	return (long ? ctx.lookup.shanghai_scale_later : ctx.lookup.shanghai_scale_first).find((step) => step.completed_months == null || service <= step.completed_months).share;
};
return Math.min(1, Math.max(agreed, least, scale()));$q$, "payout" = null
where "conversion" = $q$// js
// 沪劳保发〔1995〕83号: 连续休假6个月以内, 连续工龄不满2年60%, 满2年70%, 满4年80%, 满6年90%, 满8年100%; 超过6个月的疾病救济费, 不满1年40%, 满1年50%, 满3年60%. In force to 2026-08-15.
// 劳部发〔1995〕309号 第59条; 沪劳保保发〔2000〕14号: 不低于最低工资的80%. 昆明市工资支付条例 第二十七条: 按有关规定支付. An agreed higher share binds.
// This line takes the share of each working day the wage does not pay; FIXED_ALLOWANCE falls with BASIC.
const terms = ctx.subject.employment.terms;
const coverage = ctx.run.salary_coverage;
const scheduled = get(ctx.subject.employer, 'payment_schedule.non_working_weekdays', [0, 6]);
const week = Number(get(ctx.subject.employment.terms, 'normal_days_per_week', 7 - scheduled.length));
const off = week === 7 - scheduled.length ? scheduled : [0, 6, 5, 4, 3, 2, 1].slice(0, 7 - week);
const worksOn = (date) => {
	const day = ctx.work.days.find((row) => row.date === date);
	return day == null ? !off.includes(weekday(date)) : ['WORK', 'ABS'].includes(get(day, 'day_type', 'WORK'));
};
const reversal = get(ctx.entry, 'reverses', null) != null;
const back = add_days(coverage.from, -1);
const days = ctx.working_days;
const region = String(get(ctx.subject.employer, 'entity_extension_data.region', ''));
const zones = ctx.lookup.minimum_wage_by_zone.filter((row) => row.region === region);
if (zones.length === 0 || ctx.day_rate === 0) return ctx.day_pay * ctx.entry.quantity;
const zone = String(get(ctx.subject.employer, 'entity_extension_data.wage_zone', zones[0].default_zone));
const least = (ctx.lookup.minimum_wage_floor_share * zones.find((row) => row.zone === zone).monthly) / ctx.month_wage;
const agreed = Number(get(ctx.subject.employment, 'employee_extension_data.sick_pay_share', 0));
const illnesses = get(ctx.subject.employment, 'events', []).filter((event) => Object.hasOwn(ctx.lookup.opened_by, event.kind));
const scale = (date) => {
	if (region !== 'SH' || date > ctx.lookup.shanghai_scale_until) return 0;
	const illness = first(illnesses.filter((item) => item.on <= date && (get(item, 'ended_on', null) == null || date <= item.ended_on)));
	const long = illness != null && calendar_completed_months(illness.on, date) >= ctx.lookup.shanghai_scale_first_months;
	const service = calendar_completed_months(get(ctx.subject.employment, 'service_started_on', ctx.subject.employment.effective_range.from), date);
	return (long ? ctx.lookup.shanghai_scale_later : ctx.lookup.shanghai_scale_first).find((step) => step.completed_months == null || service <= step.completed_months).share;
};
const lost = Math.min(sum(ctx.entry.days.filter((day) => worksOn(day.date)).map((day) => 1 - Math.min(1, Math.max(agreed, least, scale(reversal ? back : day.date))))) / 2, days);
if (['DAILY', 'HOURLY'].includes(get(terms, 'rate.unit', 'MONTHLY'))) return ctx.day_pay * ctx.entry.quantity - (ctx.day_rate * lost);
return ctx.day_pay * ctx.entry.quantity - ((Number(get(terms, 'rate.amount', 0)) * lost) / ctx.working_days);$q$;
update "leave_catalog" set "paid_share" = $q$0$q$, "payout" = null
where "conversion" = $q$// js
return 0;$q$;
update "leave_catalog" set "paid_share" = $q$// js
// 上海市女职工劳动保护办法 第十八条: 产前假工资按80%发给.
const scheduled = get(ctx.subject.employer, 'payment_schedule.non_working_weekdays', [0, 6]);
const week = Number(get(ctx.subject.employment.terms, 'normal_days_per_week', 7 - scheduled.length));
const off = week === 7 - scheduled.length ? scheduled : [0, 6, 5, 4, 3, 2, 1].slice(0, 7 - week);
const day = ctx.work.days.find((row) => row.date === ctx.as_of);
if (day == null ? off.includes(weekday(ctx.as_of)) : !['WORK', 'ABS'].includes(get(day, 'day_type', 'WORK'))) return 1;
const held = first(ctx.lookup.paid_share_by_region.filter((row) => row.region === get(ctx.subject.employer, 'entity_extension_data.region', '')));
return held == null ? 1 : held.share;$q$, "payout" = null
where "conversion" = $q$// js
// 上海市女职工劳动保护办法 第十八条: 产前假工资按80%发给.
// This line takes the share of each working day the wage does not pay; FIXED_ALLOWANCE falls with BASIC.
const terms = ctx.subject.employment.terms;
const coverage = ctx.run.salary_coverage;
const scheduled = get(ctx.subject.employer, 'payment_schedule.non_working_weekdays', [0, 6]);
const week = Number(get(ctx.subject.employment.terms, 'normal_days_per_week', 7 - scheduled.length));
const off = week === 7 - scheduled.length ? scheduled : [0, 6, 5, 4, 3, 2, 1].slice(0, 7 - week);
const worksOn = (date) => {
	const day = ctx.work.days.find((row) => row.date === date);
	return day == null ? !off.includes(weekday(date)) : ['WORK', 'ABS'].includes(get(day, 'day_type', 'WORK'));
};
const reversal = get(ctx.entry, 'reverses', null) != null;
const back = add_days(coverage.from, -1);
const days = ctx.working_days;
const held = first(ctx.lookup.paid_share_by_region.filter((row) => row.region === get(ctx.subject.employer, 'entity_extension_data.region', '')));
if (held == null) return ctx.day_pay * ctx.entry.quantity;
const lost = Math.min(ctx.entry.days.filter((day) => worksOn(day.date)).length / 2, days) * (1 - held.share);
if (['DAILY', 'HOURLY'].includes(get(terms, 'rate.unit', 'MONTHLY'))) return ctx.day_pay * ctx.entry.quantity - (ctx.day_rate * lost);
return ctx.day_pay * ctx.entry.quantity - ((Number(get(terms, 'rate.amount', 0)) * lost) / ctx.working_days);$q$;
update "leave_catalog" set "paid_share" = $q$// js
// 上海市女职工劳动保护办法 第十八条: 哺乳假工资按80%发给.
const scheduled = get(ctx.subject.employer, 'payment_schedule.non_working_weekdays', [0, 6]);
const week = Number(get(ctx.subject.employment.terms, 'normal_days_per_week', 7 - scheduled.length));
const off = week === 7 - scheduled.length ? scheduled : [0, 6, 5, 4, 3, 2, 1].slice(0, 7 - week);
const day = ctx.work.days.find((row) => row.date === ctx.as_of);
if (day == null ? off.includes(weekday(ctx.as_of)) : !['WORK', 'ABS'].includes(get(day, 'day_type', 'WORK'))) return 1;
const held = first(ctx.lookup.paid_share_by_region.filter((row) => row.region === get(ctx.subject.employer, 'entity_extension_data.region', '')));
return held == null ? 1 : held.share;$q$, "payout" = null
where "conversion" = $q$// js
// 上海市女职工劳动保护办法 第十八条: 哺乳假工资按80%发给.
// This line takes the share of each working day the wage does not pay; FIXED_ALLOWANCE falls with BASIC.
const terms = ctx.subject.employment.terms;
const coverage = ctx.run.salary_coverage;
const scheduled = get(ctx.subject.employer, 'payment_schedule.non_working_weekdays', [0, 6]);
const week = Number(get(ctx.subject.employment.terms, 'normal_days_per_week', 7 - scheduled.length));
const off = week === 7 - scheduled.length ? scheduled : [0, 6, 5, 4, 3, 2, 1].slice(0, 7 - week);
const worksOn = (date) => {
	const day = ctx.work.days.find((row) => row.date === date);
	return day == null ? !off.includes(weekday(date)) : ['WORK', 'ABS'].includes(get(day, 'day_type', 'WORK'));
};
const reversal = get(ctx.entry, 'reverses', null) != null;
const back = add_days(coverage.from, -1);
const days = ctx.working_days;
const held = first(ctx.lookup.paid_share_by_region.filter((row) => row.region === get(ctx.subject.employer, 'entity_extension_data.region', '')));
if (held == null) return ctx.day_pay * ctx.entry.quantity;
const lost = Math.min(ctx.entry.days.filter((day) => worksOn(day.date)).length / 2, days) * (1 - held.share);
if (['DAILY', 'HOURLY'].includes(get(terms, 'rate.unit', 'MONTHLY'))) return ctx.day_pay * ctx.entry.quantity - (ctx.day_rate * lost);
return ctx.day_pay * ctx.entry.quantity - ((Number(get(terms, 'rate.amount', 0)) * lost) / ctx.working_days);$q$;
update "leave_catalog" set "paid_share" = $q$// js
// 上海市计划生育奖励与补助若干规定 第十九条: 按正常出勤工资; 昆明市医保局生育保险政策: 由生育津贴支付, 单位不发工资.
const scheduled = get(ctx.subject.employer, 'payment_schedule.non_working_weekdays', [0, 6]);
const week = Number(get(ctx.subject.employment.terms, 'normal_days_per_week', 7 - scheduled.length));
const off = week === 7 - scheduled.length ? scheduled : [0, 6, 5, 4, 3, 2, 1].slice(0, 7 - week);
const day = ctx.work.days.find((row) => row.date === ctx.as_of);
if (day == null ? off.includes(weekday(ctx.as_of)) : !['WORK', 'ABS'].includes(get(day, 'day_type', 'WORK'))) return 1;
const held = first(ctx.lookup.paid_share_by_region.filter((row) => row.region === get(ctx.subject.employer, 'entity_extension_data.region', '')));
return held == null ? 1 : held.share;$q$, "payout" = null
where "conversion" = $q$// js
// 上海市计划生育奖励与补助若干规定 第十九条: 按正常出勤工资; 昆明市医保局生育保险政策: 由生育津贴支付, 单位不发工资.
// This line takes the share of each working day the wage does not pay; FIXED_ALLOWANCE falls with BASIC.
const terms = ctx.subject.employment.terms;
const coverage = ctx.run.salary_coverage;
const scheduled = get(ctx.subject.employer, 'payment_schedule.non_working_weekdays', [0, 6]);
const week = Number(get(ctx.subject.employment.terms, 'normal_days_per_week', 7 - scheduled.length));
const off = week === 7 - scheduled.length ? scheduled : [0, 6, 5, 4, 3, 2, 1].slice(0, 7 - week);
const worksOn = (date) => {
	const day = ctx.work.days.find((row) => row.date === date);
	return day == null ? !off.includes(weekday(date)) : ['WORK', 'ABS'].includes(get(day, 'day_type', 'WORK'));
};
const reversal = get(ctx.entry, 'reverses', null) != null;
const back = add_days(coverage.from, -1);
const days = ctx.working_days;
const held = first(ctx.lookup.paid_share_by_region.filter((row) => row.region === get(ctx.subject.employer, 'entity_extension_data.region', '')));
if (held == null) return ctx.day_pay * ctx.entry.quantity;
const lost = Math.min(ctx.entry.days.filter((day) => worksOn(day.date)).length / 2, days) * (1 - held.share);
if (['DAILY', 'HOURLY'].includes(get(terms, 'rate.unit', 'MONTHLY'))) return ctx.day_pay * ctx.entry.quantity - (ctx.day_rate * lost);
return ctx.day_pay * ctx.entry.quantity - ((Number(get(terms, 'rate.amount', 0)) * lost) / ctx.working_days);$q$;
update "leave_catalog" set "paid_share" = $q$// js
// 劳部发〔1995〕309号 第59条: 病假工资不低于最低工资的80%. 昆明市工资支付条例 第二十七条: 按有关规定支付. An agreed higher share binds.
const scheduled = get(ctx.subject.employer, 'payment_schedule.non_working_weekdays', [0, 6]);
const week = Number(get(ctx.subject.employment.terms, 'normal_days_per_week', 7 - scheduled.length));
const off = week === 7 - scheduled.length ? scheduled : [0, 6, 5, 4, 3, 2, 1].slice(0, 7 - week);
const day = ctx.work.days.find((row) => row.date === ctx.as_of);
if (day == null ? off.includes(weekday(ctx.as_of)) : !['WORK', 'ABS'].includes(get(day, 'day_type', 'WORK'))) return 1;
const ext = get(ctx.subject.employer, 'entity_extension_data', {});
const employerRegion = String(get(ext, 'region', ''));
const worksite = String(get(ctx.subject.employment.terms, 'work_region', ''));
const region = worksite !== '' ? worksite : employerRegion;
const zones = ctx.lookup.minimum_wage_by_zone.filter((row) => row.region === region);
if (zones.length === 0 || !(ctx.month_wage > 0)) return 1;
const zone = worksite !== '' && worksite !== employerRegion
  ? String(zones[0].default_zone)
  : String(get(ext, 'wage_zone', zones[0].default_zone));
const least = (ctx.lookup.minimum_wage_floor_share * zones.find((row) => row.zone === zone).monthly) / ctx.month_wage;
const agreed = Number(get(ctx.subject.employment, 'employee_extension_data.sick_pay_share', 0));
return Math.min(1, Math.max(agreed, least));$q$, "payout" = null
where "conversion" = $q$// js
// 劳部发〔1995〕309号 第59条: 病假工资不低于最低工资的80%. 昆明市工资支付条例 第二十七条: 按有关规定支付. An agreed higher share binds.
// This line takes the share of each working day the wage does not pay; FIXED_ALLOWANCE falls with BASIC.
const terms = ctx.subject.employment.terms;
const scheduled = get(ctx.subject.employer, 'payment_schedule.non_working_weekdays', [0, 6]);
const week = Number(get(ctx.subject.employment.terms, 'normal_days_per_week', 7 - scheduled.length));
const off = week === 7 - scheduled.length ? scheduled : [0, 6, 5, 4, 3, 2, 1].slice(0, 7 - week);
const worksOn = (date) => {
	const day = ctx.work.days.find((row) => row.date === date);
	return day == null ? !off.includes(weekday(date)) : ['WORK', 'ABS'].includes(get(day, 'day_type', 'WORK'));
};
const days = ctx.working_days;
const ext = get(ctx.subject.employer, 'entity_extension_data', {});
const employerRegion = String(get(ext, 'region', ''));
const worksite = String(get(terms, 'work_region', ''));
const region = worksite !== '' ? worksite : employerRegion;
const zones = ctx.lookup.minimum_wage_by_zone.filter((row) => row.region === region);
if (zones.length === 0 || ctx.day_rate === 0) return ctx.day_pay * ctx.entry.quantity;
const zone = worksite !== '' && worksite !== employerRegion
  ? String(zones[0].default_zone)
  : String(get(ext, 'wage_zone', zones[0].default_zone));
const least = (ctx.lookup.minimum_wage_floor_share * zones.find((row) => row.zone === zone).monthly) / ctx.month_wage;
const agreed = Number(get(ctx.subject.employment, 'employee_extension_data.sick_pay_share', 0));
const lost = Math.min(ctx.entry.days.filter((day) => worksOn(day.date)).length / 2, days) * (1 - Math.min(1, Math.max(agreed, least)));
if (['DAILY', 'HOURLY'].includes(get(terms, 'rate.unit', 'MONTHLY'))) return ctx.day_pay * ctx.entry.quantity - (ctx.day_rate * lost);
return ctx.day_pay * ctx.entry.quantity - ((Number(get(terms, 'rate.amount', 0)) * lost) / ctx.working_days);$q$;
update "leave_catalog" set "paid_share" = $q$// js
// 上海市女职工劳动保护办法 第十八条: 产前假工资按80%发给.
const scheduled = get(ctx.subject.employer, 'payment_schedule.non_working_weekdays', [0, 6]);
const week = Number(get(ctx.subject.employment.terms, 'normal_days_per_week', 7 - scheduled.length));
const off = week === 7 - scheduled.length ? scheduled : [0, 6, 5, 4, 3, 2, 1].slice(0, 7 - week);
const day = ctx.work.days.find((row) => row.date === ctx.as_of);
if (day == null ? off.includes(weekday(ctx.as_of)) : !['WORK', 'ABS'].includes(get(day, 'day_type', 'WORK'))) return 1;
const employerRegion = String(get(ctx.subject.employer, 'entity_extension_data.region', ''));
const worksite = String(get(ctx.subject.employment, 'terms.work_region', ''));
const region = worksite !== '' ? worksite : employerRegion;
const held = first(ctx.lookup.paid_share_by_region.filter((row) => row.region === region));
return held == null ? 1 : held.share;$q$, "payout" = null
where "conversion" = $q$// js
// 上海市女职工劳动保护办法 第十八条: 产前假工资按80%发给.
// This line takes the share of each working day the wage does not pay; FIXED_ALLOWANCE falls with BASIC.
const terms = ctx.subject.employment.terms;
const scheduled = get(ctx.subject.employer, 'payment_schedule.non_working_weekdays', [0, 6]);
const week = Number(get(ctx.subject.employment.terms, 'normal_days_per_week', 7 - scheduled.length));
const off = week === 7 - scheduled.length ? scheduled : [0, 6, 5, 4, 3, 2, 1].slice(0, 7 - week);
const worksOn = (date) => {
	const day = ctx.work.days.find((row) => row.date === date);
	return day == null ? !off.includes(weekday(date)) : ['WORK', 'ABS'].includes(get(day, 'day_type', 'WORK'));
};
const days = ctx.working_days;
const employerRegion = String(get(ctx.subject.employer, 'entity_extension_data.region', ''));
const worksite = String(get(ctx.subject.employment, 'terms.work_region', ''));
const region = worksite !== '' ? worksite : employerRegion;
const held = first(ctx.lookup.paid_share_by_region.filter((row) => row.region === region));
if (held == null) return ctx.day_pay * ctx.entry.quantity;
const lost = Math.min(ctx.entry.days.filter((day) => worksOn(day.date)).length / 2, days) * (1 - held.share);
if (['DAILY', 'HOURLY'].includes(get(terms, 'rate.unit', 'MONTHLY'))) return ctx.day_pay * ctx.entry.quantity - (ctx.day_rate * lost);
return ctx.day_pay * ctx.entry.quantity - ((Number(get(terms, 'rate.amount', 0)) * lost) / ctx.working_days);$q$;
update "leave_catalog" set "paid_share" = $q$// js
// 上海市女职工劳动保护办法 第十八条: 哺乳假工资按80%发给.
const scheduled = get(ctx.subject.employer, 'payment_schedule.non_working_weekdays', [0, 6]);
const week = Number(get(ctx.subject.employment.terms, 'normal_days_per_week', 7 - scheduled.length));
const off = week === 7 - scheduled.length ? scheduled : [0, 6, 5, 4, 3, 2, 1].slice(0, 7 - week);
const day = ctx.work.days.find((row) => row.date === ctx.as_of);
if (day == null ? off.includes(weekday(ctx.as_of)) : !['WORK', 'ABS'].includes(get(day, 'day_type', 'WORK'))) return 1;
const employerRegion = String(get(ctx.subject.employer, 'entity_extension_data.region', ''));
const worksite = String(get(ctx.subject.employment, 'terms.work_region', ''));
const region = worksite !== '' ? worksite : employerRegion;
const held = first(ctx.lookup.paid_share_by_region.filter((row) => row.region === region));
return held == null ? 1 : held.share;$q$, "payout" = null
where "conversion" = $q$// js
// 上海市女职工劳动保护办法 第十八条: 哺乳假工资按80%发给.
// This line takes the share of each working day the wage does not pay; FIXED_ALLOWANCE falls with BASIC.
const terms = ctx.subject.employment.terms;
const scheduled = get(ctx.subject.employer, 'payment_schedule.non_working_weekdays', [0, 6]);
const week = Number(get(ctx.subject.employment.terms, 'normal_days_per_week', 7 - scheduled.length));
const off = week === 7 - scheduled.length ? scheduled : [0, 6, 5, 4, 3, 2, 1].slice(0, 7 - week);
const worksOn = (date) => {
	const day = ctx.work.days.find((row) => row.date === date);
	return day == null ? !off.includes(weekday(date)) : ['WORK', 'ABS'].includes(get(day, 'day_type', 'WORK'));
};
const days = ctx.working_days;
const employerRegion = String(get(ctx.subject.employer, 'entity_extension_data.region', ''));
const worksite = String(get(ctx.subject.employment, 'terms.work_region', ''));
const region = worksite !== '' ? worksite : employerRegion;
const held = first(ctx.lookup.paid_share_by_region.filter((row) => row.region === region));
if (held == null) return ctx.day_pay * ctx.entry.quantity;
const lost = Math.min(ctx.entry.days.filter((day) => worksOn(day.date)).length / 2, days) * (1 - held.share);
if (['DAILY', 'HOURLY'].includes(get(terms, 'rate.unit', 'MONTHLY'))) return ctx.day_pay * ctx.entry.quantity - (ctx.day_rate * lost);
return ctx.day_pay * ctx.entry.quantity - ((Number(get(terms, 'rate.amount', 0)) * lost) / ctx.working_days);$q$;
update "leave_catalog" set "paid_share" = $q$// js
// 上海市计划生育奖励与补助若干规定 第十九条: 按正常出勤工资; 昆明市医保局生育保险政策: 由生育津贴支付, 单位不发工资.
const scheduled = get(ctx.subject.employer, 'payment_schedule.non_working_weekdays', [0, 6]);
const week = Number(get(ctx.subject.employment.terms, 'normal_days_per_week', 7 - scheduled.length));
const off = week === 7 - scheduled.length ? scheduled : [0, 6, 5, 4, 3, 2, 1].slice(0, 7 - week);
const day = ctx.work.days.find((row) => row.date === ctx.as_of);
if (day == null ? off.includes(weekday(ctx.as_of)) : !['WORK', 'ABS'].includes(get(day, 'day_type', 'WORK'))) return 1;
const employerRegion = String(get(ctx.subject.employer, 'entity_extension_data.region', ''));
const worksite = String(get(ctx.subject.employment, 'terms.work_region', ''));
const region = worksite !== '' ? worksite : employerRegion;
const held = first(ctx.lookup.paid_share_by_region.filter((row) => row.region === region));
return held == null ? 1 : held.share;$q$, "payout" = null
where "conversion" = $q$// js
// 上海市计划生育奖励与补助若干规定 第十九条: 按正常出勤工资; 昆明市医保局生育保险政策: 由生育津贴支付, 单位不发工资.
// This line takes the share of each working day the wage does not pay; FIXED_ALLOWANCE falls with BASIC.
const terms = ctx.subject.employment.terms;
const scheduled = get(ctx.subject.employer, 'payment_schedule.non_working_weekdays', [0, 6]);
const week = Number(get(ctx.subject.employment.terms, 'normal_days_per_week', 7 - scheduled.length));
const off = week === 7 - scheduled.length ? scheduled : [0, 6, 5, 4, 3, 2, 1].slice(0, 7 - week);
const worksOn = (date) => {
	const day = ctx.work.days.find((row) => row.date === date);
	return day == null ? !off.includes(weekday(date)) : ['WORK', 'ABS'].includes(get(day, 'day_type', 'WORK'));
};
const days = ctx.working_days;
const employerRegion = String(get(ctx.subject.employer, 'entity_extension_data.region', ''));
const worksite = String(get(ctx.subject.employment, 'terms.work_region', ''));
const region = worksite !== '' ? worksite : employerRegion;
const held = first(ctx.lookup.paid_share_by_region.filter((row) => row.region === region));
if (held == null) return ctx.day_pay * ctx.entry.quantity;
const lost = Math.min(ctx.entry.days.filter((day) => worksOn(day.date)).length / 2, days) * (1 - held.share);
if (['DAILY', 'HOURLY'].includes(get(terms, 'rate.unit', 'MONTHLY'))) return ctx.day_pay * ctx.entry.quantity - (ctx.day_rate * lost);
return ctx.day_pay * ctx.entry.quantity - ((Number(get(terms, 'rate.amount', 0)) * lost) / ctx.working_days);$q$;
update "leave_catalog" set "paid_share" = null, "payout" = $q$// js
// UU 13/2003 art.156(4)(a) as amended by UU 6/2023, PP 35/2021 art.40(4)(a): unused annual leave that has not lapsed is compensated on termination.
return ctx.day_rate * ctx.entry.quantity;$q$
where "conversion" = $q$// js
// UU 13/2003 art.156(4)(a) as amended by UU 6/2023, PP 35/2021 art.40(4)(a): unused annual leave that has not lapsed is compensated on termination.
if (get(ctx.entry, 'encashment', false) !== true) return ctx.day_pay * ctx.entry.quantity;
return ctx.day_rate * ctx.entry.quantity;$q$;
update "leave_catalog" set "paid_share" = $q$// js
// PP 36/2021 art.41(1): 100% of the wage for the first four months of an illness, 75% for the next four, 50% for the next four and 25% thereafter until dismissal.
if (ctx.event == null) return 1;
const months = calendar_completed_months(ctx.event.on, ctx.as_of);
return 1 - ctx.lookup.pay_steps.find((step) => step.until_month == null || months < step.until_month).unpaid_share;$q$, "payout" = null
where "conversion" = $q$// js
// PP 36/2021 art.41(1): 100% of the wage for the first four months of an illness, 75% for the next four, 50% for the next four and 25% thereafter until dismissal.
const events = get(ctx.subject.employment, 'events', []).filter((event) => Object.hasOwn(ctx.lookup.opened_by, event.kind));
const shareOf = (date) => {
	const event = first(events.filter((item) => item.on <= date && (get(item, 'ended_on', null) == null || date <= item.ended_on)));
	if (event == null) return 0;
	const months = calendar_completed_months(event.on, date);
	return ctx.lookup.pay_steps.find((step) => step.until_month == null || months < step.until_month).unpaid_share;
};
const at = add_days(ctx.run.salary_coverage.from, -1);
const lost = Math.min(
	sum(ctx.entry.days.map((day) => shareOf(get(ctx.entry, 'reverses', null) != null ? at : day.date))) / 2,
	ctx.entry.quantity
);
return ctx.day_pay * ctx.entry.quantity - (ctx.day_rate * lost);$q$;
update "leave_catalog" set "paid_share" = $q$// js
// UU 4/2024 art.5(2): paid in full for the first four months and 75% for the fifth and sixth; the months past the third need a doctor’s certificate of a special condition of mother or child.
if (ctx.event == null) return 1;
const months = calendar_completed_months(ctx.event.on, ctx.as_of);
return 1 - ctx.lookup.pay_steps.find((step) => step.until_month == null || months < step.until_month).unpaid_share;$q$, "payout" = null
where "conversion" = $q$// js
// UU 4/2024 art.5(2): paid in full for the first four months and 75% for the fifth and sixth; the months past the third need a doctor’s certificate of a special condition of mother or child.
const events = get(ctx.subject.employment, 'events', []).filter((event) => Object.hasOwn(ctx.lookup.opened_by, event.kind));
const shareOf = (date) => {
	const event = first(events.filter((item) => item.on <= date && (get(item, 'ended_on', null) == null || date <= item.ended_on)));
	if (event == null) return 0;
	const months = calendar_completed_months(event.on, date);
	return ctx.lookup.pay_steps.find((step) => step.until_month == null || months < step.until_month).unpaid_share;
};
const at = add_days(ctx.run.salary_coverage.from, -1);
const lost = Math.min(
	sum(ctx.entry.days.map((day) => shareOf(get(ctx.entry, 'reverses', null) != null ? at : day.date))) / 2,
	ctx.entry.quantity
);
return ctx.day_pay * ctx.entry.quantity - (ctx.day_rate * lost);$q$;
update "leave_catalog" set "paid_share" = null, "payout" = $q$// js
// An employer that pays out an unused in-lieu day at exit files an encashment entry: it pays at the day rate.
return ctx.day_rate * ctx.entry.quantity;$q$
where "conversion" = $q$// js
// An employer that pays out an unused in-lieu day at exit files an encashment entry: it pays at the day rate.
if (get(ctx.entry, 'encashment', false) !== true) return ctx.day_pay * ctx.entry.quantity;
return ctx.day_rate * ctx.entry.quantity;$q$;
update "leave_catalog" set "paid_share" = null, "payout" = $q$// js
const terms = get(ctx.subject.employment, 'terms', {});
const rate = get(terms, 'rate', {});
const days = Number(get(ctx.entry, 'quantity', 0));
const daily = ctx.day_rate;
return daily * days;$q$
where "conversion" = $q$// js
if (get(ctx.entry, 'encashment', false) !== true) return ctx.day_pay * ctx.entry.quantity;
const terms = get(ctx.subject.employment, 'terms', {});
const rate = get(terms, 'rate', {});
const days = Number(get(ctx.entry, 'quantity', 0));
const daily = ctx.day_rate;
return daily * days;$q$;
update "leave_catalog" set "paid_share" = null, "payout" = $q$// js
const terms = ctx.subject.employment.terms;
const basic = ctx.month_wage;
if (get(terms, 'rate.unit', 'MONTHLY') !== 'MONTHLY' || !(basic > 0)) return ctx.day_rate * ctx.entry.quantity;
// MOM gross rate of pay for salary in lieu of annual leave: the basic day with the fixed allowance on it
const allowance = get(terms, 'allowances.FIXED_MONTHLY.amount', 0);
const fixed = typeof allowance === 'number' ? allowance : get(allowance, 'value', 0);
return ctx.day_rate * ((basic + fixed) / basic) * ctx.entry.quantity;
$q$
where "conversion" = $q$// js
if (get(ctx.entry, 'encashment', false) !== true) return ctx.day_pay * ctx.entry.quantity;
const terms = ctx.subject.employment.terms;
const basic = ctx.month_wage;
if (get(terms, 'rate.unit', 'MONTHLY') !== 'MONTHLY' || !(basic > 0)) return ctx.day_rate * ctx.entry.quantity;
// MOM gross rate of pay for salary in lieu of annual leave: the basic day with the fixed allowance on it
const allowance = get(terms, 'allowances.FIXED_MONTHLY.amount', 0);
const fixed = typeof allowance === 'number' ? allowance : get(allowance, 'value', 0);
return ctx.day_rate * ((basic + fixed) / basic) * ctx.entry.quantity;
$q$;
update "leave_catalog" set "paid_share" = $q$// js
// LPA s.116: at least half the working-day wage.
return ctx.lookup.paid_share;$q$, "payout" = null
where "conversion" = $q$// js
// LPA s.116: at least half the working-day wage. The salary pays the whole day, so the other half comes off.
return ctx.day_pay * ctx.entry.quantity - (ctx.day_rate * (1 - ctx.lookup.paid_share) * ctx.entry.quantity);$q$;
update "leave_catalog" set "paid_share" = $q$// js
// LPA s.59/1: half the working-day wage.
return ctx.lookup.paid_share;$q$, "payout" = null
where "conversion" = $q$// js
// LPA s.59/1: half the working-day wage. The salary pays the whole day, so the other half comes off.
return ctx.day_pay * ctx.entry.quantity - (ctx.day_rate * (1 - ctx.lookup.paid_share) * ctx.entry.quantity);$q$;
update "leave_catalog" set "paid_share" = $q$// js
// 勞工請假規則 §4(3): half wages for an ordinary sick day; the rule SICK_LEAVE_PAY_POOL holds the thirty days.
return ctx.lookup.half_pay_share;$q$, "payout" = null
where "conversion" = $q$// 勞工請假規則 §4(3): half wages for an ordinary sick day; the rule SICK_LEAVE_PAY_POOL holds the thirty days.
return ctx.day_pay * ctx.entry.quantity - (ctx.day_rate * ctx.entry.quantity * ctx.lookup.half_pay_share);$q$;
update "leave_catalog" set "paid_share" = $q$// js
// 勞動基準法 §50(2): full wages after six months' service, half before.
const earliest = ctx.entry.days.map((slot) => slot.date).toSorted()[0];
return calendar_completed_months(get(ctx.subject.employment, 'service_started_on', ctx.subject.employment.effective_range.from), earliest) >= ctx.lookup.full_pay_service_months ? 1 : ctx.lookup.half_pay_share;$q$, "payout" = null
where "conversion" = $q$// 勞動基準法 §50(2): full wages after six months' service, half before.
const earliest = ctx.entry.days.map((slot) => slot.date).toSorted()[0];
if (calendar_completed_months(get(ctx.subject.employment, 'service_started_on', ctx.subject.employment.effective_range.from), earliest) >= ctx.lookup.full_pay_service_months) return ctx.day_pay * ctx.entry.quantity;
return ctx.day_pay * ctx.entry.quantity - (ctx.day_rate * ctx.entry.quantity * ctx.lookup.half_pay_share);$q$;
update "leave_catalog" set "paid_share" = $q$// js
// 性別平等工作法 §14: half wages; the rule SICK_LEAVE_PAY_POOL holds the monthly day, the three free days and the thirty-day pool.
return ctx.lookup.half_pay_share;$q$, "payout" = null
where "conversion" = $q$// 性別平等工作法 §14: half wages; the rule SICK_LEAVE_PAY_POOL holds the monthly day, the three free days and the thirty-day pool.
return ctx.day_pay * ctx.entry.quantity - (ctx.day_rate * ctx.entry.quantity * ctx.lookup.half_pay_share);$q$;
update "leave_catalog" set "paid_share" = $q$0$q$, "payout" = null
where "conversion" = $q$// 性別平等工作法 §16; 民法 §123(2): no wage for the stretch, on a 30-day month. PAID so this line, not the salary basis, takes the days: BASIC_AFTER_PARENTAL_LEAVE tells the premium rows how many (§16(2): employer share waived, worker's deferred).
if (get(ctx.subject.employment, 'terms.rate.unit', 'MONTHLY') !== 'MONTHLY') return ctx.day_pay * ctx.entry.quantity - Math.min(ctx.base_pay, ctx.day_rate * ctx.entry.quantity);
const dates = ctx.entry.days.map((slot) => slot.date).toSorted();
const last = dates.at(-1);
const month_days = 30;
const first_day = Math.min(month_days, Number(dates[0].substring(8)));
const last_day = last === month_end(last) ? month_days : Number(last.substring(8));
return ctx.day_pay * ctx.entry.quantity - ((ctx.month_wage * (last_day - first_day + 1)) / month_days);$q$;
update "leave_catalog" set "paid_share" = $q$// js
// 勞工請假規則 §4(3): half wages inside the thirty-day pool; the rule SICK_LEAVE_PAY_POOL holds it and the days beyond are SICK_LEAVE_UNPAID.
return ctx.lookup.half_pay_share;$q$, "payout" = null
where "conversion" = $q$// 勞工請假規則 §4(3): half wages inside the thirty-day pool; the rule SICK_LEAVE_PAY_POOL holds it and the days beyond are SICK_LEAVE_UNPAID.
return ctx.day_pay * ctx.entry.quantity - (ctx.day_rate * ctx.entry.quantity * ctx.lookup.half_pay_share);$q$;
update "leave_catalog" set "paid_share" = $q$0$q$, "payout" = null
where "conversion" = $q$// 育嬰留職停薪實施辦法 §2, §9: no wage for the days taken; BASIC_AFTER_PARENTAL_LEAVE tells the premium rows how many.
return ctx.day_pay * ctx.entry.quantity - (ctx.day_rate * ctx.entry.quantity);$q$;
update "leave_catalog" set "paid_share" = null, "payout" = $q$// js
// Labour Code art.113(3); Decree 145/2020 art.67(3): the untaken days are paid at the contractual daily wage
// of the month before the exit month, recorded on the exit review.
const review = get(ctx.subject.employment, 'employee_extension_data.encashment_review', {});
const daily = Number(get(review, 'daily_wage_vnd', 0));
return daily * Number(get(ctx.entry, 'quantity', 0));$q$
where "conversion" = $q$// js
// Labour Code art.113(3); Decree 145/2020 art.67(3): the untaken days are paid at the contractual daily wage
// of the month before the exit month, recorded on the exit review.
if (get(ctx.entry, 'encashment', false) !== true) return ctx.day_pay * ctx.entry.quantity;
const review = get(ctx.subject.employment, 'employee_extension_data.encashment_review', {});
const daily = Number(get(review, 'daily_wage_vnd', 0));
return daily * Number(get(ctx.entry, 'quantity', 0));$q$;
update "leave_catalog" set "paid_share" = '0'
where "paid_share" is null and "payout" is null and btrim("conversion") = $q$// js
return 0;$q$;
update "leave_catalog" set "payout" = replace("conversion",
	$q$if (get(ctx.entry, 'encashment', false) !== true) return ctx.day_pay * ctx.entry.quantity;
$q$, '')
where "paid_share" is null and "payout" is null
	and "conversion" like $q$%if (get(ctx.entry, 'encashment', false) !== true) return ctx.day_pay * ctx.entry.quantity;%$q$;
-- a payout now says the row can be cashed out
update "leave_catalog" set "lookup" = "lookup" - 'encash_on_exit' where "lookup" ? 'encash_on_exit';
do $store$ declare n bigint; begin
	select count(*) into n from "leave_catalog"
	where coalesce(btrim("conversion"), '') <> '' and "paid_share" is null and "payout" is null;
	if n > 0 then raise exception 'leave_catalog: % row(s) have a conversion no paid_share or payout translates; set them by hand', n; end if;
end $store$;

-- step drop:column:leave_catalog.conversion (destructive)
-- accept: drop:column:leave_catalog.conversion
-- operational risk: access-exclusive-lock
alter table "leave_catalog" drop column if exists "conversion" cascade;

-- step create:constraint:leave_catalog.leave_catalog__ck__8821d273 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "leave_catalog" where (char_length("paid_share") <= 65536) is false' into n;
	if n > 0 then raise exception 'leave_catalog__ck__8821d273 refuses % existing row(s)', n; end if;
end $store$;
alter table "leave_catalog" add constraint "leave_catalog__ck__8821d273" check (char_length("paid_share") <= 65536);

-- step create:constraint:leave_catalog.leave_catalog__ck__f8d4002b (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "leave_catalog" where (char_length("payout") <= 65536) is false' into n;
	if n > 0 then raise exception 'leave_catalog__ck__f8d4002b refuses % existing row(s)', n; end if;
end $store$;
alter table "leave_catalog" add constraint "leave_catalog__ck__f8d4002b" check (char_length("payout") <= 65536);

-- step replace:trigger:leave_catalog.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "leave_catalog" for each row execute function store_row_rules('{"audit":true,"fields":{"code":["code"],"description":["description"],"eligibility":["eligibility"],"lookup":["lookup"],"paid_share":["paid_share"],"payout":["payout"],"references":["references"],"settings_id":["settings_id"],"subtotal_id":["subtotal_id"]},"key":["id"],"parents":[{"column":"settings_id","key":"id","relation":"leave_catalog","states":{"status":{"initial":"DRAFT","states":{"DRAFT":{"edit":"all","to":["SEALED","VOID"]},"SEALED":{"edit":["effective_range","reason"],"to":["VOID"]},"VOID":{"edit":"none","to":[]}}}},"table":"jurisdiction_settings","type":"uuid"}],"states":{}}');
