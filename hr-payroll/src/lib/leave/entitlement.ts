import { completedMonths, isJsonObject } from '../payroll_engine/foundation.js';
import type { JsonObject } from '../payroll_engine/contracts.js';

/** An account no statute caps: too large ever to refuse, and the days taken still post to it. */
export const NO_CAP_DAYS = 36_500;

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
};
/** What a balance holds: days left by code, and in `windows` each code's window and `<code>.granted`, the entitlement applied. */
export type LeaveAccount = {
	readonly leave: Readonly<Record<string, number>>;
	readonly windows: Readonly<Record<string, number>>;
};
export type LeaveMove = {
	readonly code: string;
	readonly operation: 'ADD' | 'DEDUCT';
	readonly amount: number;
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
const fits = (lookup: JsonObject, person: LeavePerson) => {
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
	if (week > 4 || months < offset) return null;
	const year = Math.min(Math.floor((months - offset) / 12) + 1, 7);
	const row = table.find(
		(item) => isJsonObject(item) && item.normal_days_per_week === week && item.service_year === year
	);
	return isJsonObject(row) ? Number(row.days) : null;
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

/** The row's entitlement for this person on this day, and the window it belongs to. `null`: no figure, so no cap. */
export const entitlementOf = (
	lookup: JsonObject,
	person: LeavePerson,
	on: string
): { readonly days: number; readonly window: number } | null => {
	const months = completedMonths(person.started, on);
	const bands = bandsOf(
		person.partTime && lookup.part_time_service_bands != null
			? lookup.part_time_service_bands
			: lookup.service_bands
	);
	if (lookup.no_cap === true || (bands.length === 0 && lookup.grant_days == null)) return null;
	const offset = Number(lookup.service_offset_months ?? 0);
	const window =
		lookup.rolling_months != null
			? Math.floor(months / Number(lookup.rolling_months))
			: lookup.window === 'SERVICE_YEAR' || lookup.per_months != null || offset > 0
				? Math.floor((months - offset) / 12)
				: lookup.window === 'CALENDAR_YEAR'
					? Number(on.slice(0, 4))
					: // a balance cannot tell one event from the next: an event's days refill month by month
						lookup.window === 'EVENT'
						? Number(on.slice(0, 7).replace('-', ''))
						: 0;
	if (!fits(lookup, person)) return { days: 0, window };
	const first = bands[0];
	// until the first band, a share of it by completed months of service
	if (lookup.proration === 'COMPLETED_MONTHS' && first && months < first.service_months)
		return { days: Math.round((first.days * months) / first.service_months), window };
	const scheduled = scheduledDays(lookup, person, months, offset);
	if (scheduled !== null) return { days: scheduled, window };
	if (months < qualifying(lookup)) return { days: 0, window };
	const base =
		bands.length === 0
			? Number(lookup.grant_days)
			: (bands.findLast((band) => band.service_months <= months)?.days ?? 0);
	const days = base === 0 ? 0 : base + extraDays(lookup, person);
	return { days: firstYear(lookup, person, on, prorated(lookup, person, days)), window };
};

/** What a new window starts from: this window's entitlement, plus what the row says carries over. */
const opening = (
	lookup: JsonObject,
	person: LeavePerson,
	days: number,
	held: number,
	applied: number
) => {
	if (lookup.per_months != null) return held + days;
	if (!isJsonObject(lookup.carry)) return days;
	const limits = [lookup.carry.max_days, person.terms?.annual_leave_carry_limit_days].flatMap(
		(limit) => (limit == null ? [] : [Number(limit)])
	);
	return days + Math.min(held, applied, ...limits);
};

/**
 * One person's leave on a day. Idempotent: a change moves the balance by the difference from the entitlement already
 * applied, a new window starts it again, and a second call the same day finds nothing to do.
 */
export const settleLeave = (
	rows: readonly LeaveRow[],
	person: LeavePerson,
	account: LeaveAccount,
	on: string
): LeaveAccount & { readonly moves: readonly LeaveMove[] } => {
	const leave = { ...account.leave };
	const windows = { ...account.windows };
	const moves: LeaveMove[] = [];
	const moveTo = (code: string, next: number) => {
		const delta = next - (leave[code] ?? 0);
		if (delta !== 0)
			moves.push({ code, operation: delta > 0 ? 'ADD' : 'DEDUCT', amount: Math.abs(delta) });
		leave[code] = next;
	};
	for (const { code, lookup } of rows) {
		const owed = entitlementOf(lookup, person, on);
		if (owed === null) {
			if (leave[code] === undefined) moveTo(code, NO_CAP_DAYS);
			continue;
		}
		const held = leave[code];
		const applied = windows[`${code}.granted`];
		if (held !== undefined && applied === undefined) {
			// an account from before keeps what it holds: only its entitlement starts counting
			windows[code] = owed.window;
		} else if (held === undefined) {
			moveTo(code, owed.days);
			windows[code] = owed.window;
		} else if (windows[code] !== owed.window) {
			moveTo(code, opening(lookup, person, owed.days, held, applied ?? 0));
			windows[code] = owed.window;
		} else {
			moveTo(code, Math.max(0, held + owed.days - (applied ?? 0)));
		}
		windows[`${code}.granted`] = owed.days;
	}
	return { leave, windows, moves };
};
