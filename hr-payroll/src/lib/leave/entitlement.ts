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
		(rule.marital_status == null || rule.marital_status === person.maritalStatus)
	);
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
		lookup.window === 'SERVICE_YEAR' || lookup.per_months != null || offset > 0
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
	if (months < qualifying(lookup)) return { days: 0, window };
	if (bands.length === 0) return { days: Number(lookup.grant_days), window };
	return { days: bands.findLast((band) => band.service_months <= months)?.days ?? 0, window };
};

/** What a new window starts from: this window's entitlement, plus what the row says carries over. */
const opening = (lookup: JsonObject, days: number, held: number, applied: number) => {
	if (lookup.per_months != null) return held + days;
	if (!isJsonObject(lookup.carry)) return days;
	const carried = Math.min(held, applied);
	return (
		days +
		(lookup.carry.max_days == null ? carried : Math.min(carried, Number(lookup.carry.max_days)))
	);
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
			moveTo(code, opening(lookup, owed.days, held, applied ?? 0));
			windows[code] = owed.window;
		} else {
			moveTo(code, Math.max(0, held + owed.days - (applied ?? 0)));
		}
		windows[`${code}.granted`] = owed.days;
	}
	return { leave, windows, moves };
};
