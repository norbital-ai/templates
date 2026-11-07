import { evaluate } from '../payroll_engine/expressions.js';
import { completedMonths, isJsonObject } from '../payroll_engine/foundation.js';
import type { JsonObject } from '../payroll_engine/contracts.js';
import type { Event } from './core.js';

export type LeaveRow = { readonly code: string; readonly lookup: JsonObject };
export type LeavePerson = {
	readonly started: string;
	readonly partTime: boolean;
	readonly gender: string | null;
	readonly maritalStatus: string | null;
	/** The contract's terms and term facts, and whether the employer is state-owned. */
	readonly terms?: JsonObject;
	readonly facts?: JsonObject;
	readonly stateOwned?: boolean;
	/** The rows a row's own `entitlement` expression reads as `ctx.subject`. */
	readonly employment?: JsonObject;
	readonly employer?: JsonObject;
};
type Band = { readonly service_months: number; readonly days: number };
const bandsOf = (value: unknown): readonly Band[] =>
	(Array.isArray(value) ? value : [])
		.flatMap((band) =>
			isJsonObject(band)
				? [{ service_months: Number(band.service_months), days: Number(band.days) }]
				: []
		)
		.toSorted((left, right) => left.service_months - right.service_months);
const qualifying = ({
	service_months,
	eligibility_months,
	qualifying_service_months
}: JsonObject) => Number(service_months ?? eligibility_months ?? qualifying_service_months ?? 0);
export const fits = (lookup: JsonObject, person: LeavePerson) => {
	const rule = isJsonObject(lookup.eligibility) ? lookup.eligibility : {};
	return (
		(rule.gender == null || rule.gender === person.gender) &&
		(rule.marital_status == null || rule.marital_status === person.maritalStatus) &&
		(rule.engagement !== 'PART_TIME' || person.partTime) &&
		(lookup.state_owned_employer !== true || person.stateOwned === true)
	);
};
/** Fewer than the statute's weekly hours and days: the table for that many days a week, by year of service. */
const scheduledDays = (lookup: JsonObject, person: LeavePerson, months: number, offset: number) => {
	const table = lookup.grant_days_by_normal_days_per_week;
	const hours = Number(person.terms?.normal_hours_per_week ?? 0);
	const week = Number(person.terms?.normal_days_per_week ?? 5);
	if (!Array.isArray(table) || hours <= 0 || hours >= Number(lookup.full_time_weekly_hours))
		return null;
	if (months < offset) return null;
	const rows = table.filter(isJsonObject);
	const longest = Math.max(...rows.map((item) => Number(item.service_year)));
	const year = Math.min(Math.floor((months - offset) / 12) + 1, longest);
	const row = rows.find((item) => item.normal_days_per_week === week && item.service_year === year);
	return row === undefined ? null : Number(row.days);
};
/** Days a class of work or a fact on the contract adds to the row. */
const extraDays = (lookup: JsonObject, person: LeavePerson) =>
	(Array.isArray(lookup.extra_days) ? lookup.extra_days : []).reduce<number>(
		(total, item) =>
			isJsonObject(item) &&
			((item.fact != null && person.facts?.[String(item.fact)] === true) ||
				(item.category != null && person.terms?.statutory_work_category === item.category))
				? Math.max(total, Number(item.days))
				: total,
		0
	);
/** Hours pro rata: a part-timer's share of the full-time figure. */
const prorated = (lookup: JsonObject, person: LeavePerson, days: number) => {
	const hours = Number(person.terms?.normal_hours_per_week ?? 0);
	return lookup.part_time_pro_rata === true && person.partTime && hours > 0
		? Math.round(((days * hours) / Number(lookup.full_time_weekly_hours)) * 100) / 100
		: days;
};
/** The year someone first qualifies counts only the calendar days left in it, whole days only. */
const firstYear = (lookup: JsonObject, person: LeavePerson, on: string, days: number) => {
	const basis = Number(lookup.first_year_proration_days ?? 0);
	if (basis === 0) return days;
	const from = new Date(`${person.started}T00:00:00Z`);
	from.setUTCMonth(from.getUTCMonth() + qualifying(lookup));
	if (from.getUTCFullYear() !== Number(on.slice(0, 4))) return days;
	const end = Date.UTC(from.getUTCFullYear(), 11, 31);
	const left = Math.round((end - from.getTime()) / 86_400_000) + 1;
	return Math.floor((days * left) / basis);
};

/** A row with a statutory test of its own states it in `lookup.entitlement`: days, or null for no limit. */
export const expressed = (
	lookup: JsonObject,
	person: LeavePerson,
	on: string,
	event?: Event
): number | null => {
	const days = evaluate(
		String(lookup.entitlement),
		'CALCULATION',
		{
			lookup,
			as_of: on,
			event,
			subject: { employment: person.employment ?? {}, employer: person.employer ?? {} }
		},
		'entitlement'
	);
	return days === null || days === undefined ? null : Number(days);
};

/** The row's entitlement for this person on this day. `null`: no figure, so no limit. */
export const entitlementOf = (
	lookup: JsonObject,
	person: LeavePerson,
	on: string
): number | null => {
	if (typeof lookup.entitlement === 'string')
		return fits(lookup, person) ? expressed(lookup, person, on) : 0;
	const months = completedMonths(person.started, on);
	const bands = bandsOf(
		person.partTime && lookup.part_time_service_bands != null
			? lookup.part_time_service_bands
			: lookup.service_bands
	);
	if (lookup.no_cap === true || (bands.length === 0 && lookup.grant_days == null)) return null;
	if (lookup.window === 'EVENT') return 0;
	const offset = Number(lookup.service_offset_months ?? 0);
	if (!fits(lookup, person)) return 0;
	const first = bands[0];
	// until the first band, a share of it by completed months of service
	if (lookup.proration === 'COMPLETED_MONTHS' && first && months < first.service_months)
		return Math.round((first.days * months) / first.service_months);
	const scheduled = scheduledDays(lookup, person, months, offset);
	if (scheduled !== null) return scheduled;
	if (months < qualifying(lookup)) return 0;
	const base =
		bands.length === 0
			? Number(lookup.grant_days)
			: (bands.findLast((band) => band.service_months <= months)?.days ?? 0);
	const days = base === 0 ? 0 : base + extraDays(lookup, person);
	return firstYear(lookup, person, on, prorated(lookup, person, days));
};

/** What carries into a new window: the row's rule, on what the last window left and what it granted. */
export const carriedOf = (
	lookup: JsonObject,
	person: LeavePerson,
	left: number,
	granted: number
): number => {
	if (lookup.per_months != null) return left;
	if (!isJsonObject(lookup.carry)) return 0;
	if (lookup.carry.statutory_grant_carries === true) {
		// the statutory days carry in full; the cap holds only for company days above them
		const cap = Number(
			person.terms?.annual_leave_carry_limit_days ?? lookup.carry.company_cap_days ?? 0
		);
		return Math.min(left, granted) + Math.min(Math.max(0, left - granted), cap);
	}
	const limits = [lookup.carry.max_days, person.terms?.annual_leave_carry_limit_days].flatMap(
		(limit) => (limit == null ? [] : [Number(limit)])
	);
	return Math.max(0, Math.min(left, granted, ...limits));
};
