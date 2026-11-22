import { DateTime } from 'effect';
import { isJsonObject, type JsonObject } from '../../../../../lib/foundation.js';
import { objectValue } from '../../../../../lib/reads.js';
import {
	measureOf,
	isPeriodKey,
	periodOf,
	leftIn,
	openedBy,
	opensOn,
	periodKey,
	windowOf,
	windowOn,
	windowStart,
	type Accounts,
	type Event,
	type Measure,
	type PeriodKey,
	type Wanted
} from './core.js';
import {
	carriedOf,
	entitlementOf,
	expressed,
	fits,
	type LeavePerson,
	type LeaveRow
} from './entitlement.js';
import { carry, manualOf, unitOf, type Plan } from './ledger_store.js';

export type Subject = {
	readonly scope: string;
	readonly started: string;
	readonly events: readonly Event[];
};

/**
 * What a leave entry should have posted: half a day at a time, in the window each day falls in. A row that counts in
 * hours (`unit: 'HOUR'`) takes half the contract's normal day (`dayHours`) for each half day.
 */
export const leaveWanted = (
	entry: JsonObject,
	row: LeaveRow,
	rowOf: (code: string) => LeaveRow | undefined,
	subject: Subject,
	dayHours: number
): readonly Wanted[] => {
	const accounts = Array.isArray(row.lookup.accounts) ? row.lookup.accounts : [];
	const target = accounts.find(isJsonObject);
	const code = typeof target?.code === 'string' ? target.code : row.code;
	const counted = rowOf(code) ?? row;
	const hours = counted.lookup.unit === 'HOUR';
	const days = Array.isArray(entry.days) ? entry.days.filter(isJsonObject) : [];
	return days.map((day) => {
		const date = String(day.date);
		return {
			account: 'leave',
			code,
			period: periodKey(
				subject.scope,
				windowOn(counted.lookup, date, subject.events),
				date,
				subject.started
			),
			measure: 'used',
			amount: hours ? dayHours / 2 : 0.5,
			unit: hours ? 'HOUR' : 'DAY',
			effective_on: date
		};
	});
};

/**
 * What a claim should have posted: its amount against the year it was incurred. A row with a limit pays what remains of
 * it, so `left` is what the window has without this claim, and the excess stays on the entry for HR to see.
 */
export const claimWanted = (
	entry: JsonObject,
	row: LeaveRow,
	subject: Subject,
	left?: (period: string) => number
): readonly Wanted[] => {
	const date = String(entry.incurred_on);
	const period = periodKey(subject.scope, windowOf(row.lookup), date, subject.started);
	const quantity = Number(entry.quantity ?? 0);
	const payable =
		row.lookup.annual_limit == null || left === undefined
			? quantity
			: Math.max(0, Math.min(quantity, left(period)));
	return [
		{
			account: 'claim',
			code: row.code,
			period,
			measure: 'used',
			amount: payable,
			unit: 'MONEY',
			effective_on: date
		}
	];
};

/** What a claim row has left in a window. A window no sync has opened yet still has the row's limit. */
export const claimLeft = (accounts: Accounts, row: LeaveRow, period: string) =>
	leftIn({
		limit: Number(row.lookup.annual_limit ?? 0),
		...accounts.claim?.[row.code]?.[period]
	});

/** An adhoc row posts only what it declares. */
export const adhocWanted = (
	entry: JsonObject,
	row: LeaveRow,
	subject: Subject & { readonly taxYearStart: number }
): readonly Wanted[] => {
	const date = String(entry.incurred_on);
	const accounts = Array.isArray(row.lookup.accounts) ? row.lookup.accounts : [];
	return accounts.filter(isJsonObject).map((target) => ({
		account: String(target.account),
		code: String(target.code),
		period: periodKey(
			subject.scope,
			target.period === 'MONTH'
				? { kind: 'MONTH' }
				: { kind: 'YEAR', start_month: subject.taxYearStart },
			date,
			subject.started
		),
		measure: measureOf(target.measure),
		amount: (target.operation === 'DEDUCT' ? -1 : 1) * Number(entry.quantity ?? 0),
		unit: 'MONEY',
		effective_on: date
	}));
};

/** What one payslip carried for one earlier pay period: where the difference posts, beside its tagged lines. */
export interface Carried {
	readonly run_id: string;
	readonly period: string;
	readonly postings: readonly Wanted[];
}
/** What a payslip carried for earlier periods, as its breakdown records it. */
export const carriedFor = (breakdown: unknown): readonly Carried[] => {
	const carried = isJsonObject(breakdown) ? breakdown.carried : undefined;
	return (Array.isArray(carried) ? carried : []).filter(isJsonObject).map((entry) => ({
		run_id: String(entry.run_id),
		period: String(entry.period),
		postings: (Array.isArray(entry.postings) ? entry.postings : [])
			.filter(isJsonObject)
			.map((row) => ({
				account: String(row.account),
				code: String(row.code),
				period: periodOf(row.period),
				measure: measureOf(row.measure),
				amount: Number(row.amount ?? 0),
				unit: unitOf(row.unit),
				effective_on: String(row.effective_on)
			}))
	}));
};

/** What a paid-out payslip adds: its checkpoints and statutory rows, for the year and where the row's balance window says the month. */
export const payslipWanted = (
	breakdown: JsonObject,
	payDate: string,
	subject: Subject & { readonly taxYearStart: number; readonly byMonth: readonly unknown[] }
): readonly Wanted[] => {
	const year = periodKey(
		subject.scope,
		{ kind: 'YEAR', start_month: subject.taxYearStart },
		payDate,
		subject.started
	);
	const month = periodKey(subject.scope, { kind: 'MONTH' }, payDate, subject.started);
	const held = (account: string, code: string, measure: Measure, amount: number): Wanted[] =>
		[year, ...(subject.byMonth.includes(code) ? [month] : [])].map((period) => ({
			account,
			code,
			period,
			measure,
			amount,
			unit: 'MONEY',
			effective_on: payDate
		}));
	const rows = (key: string) =>
		(Array.isArray(breakdown[key]) ? breakdown[key] : []).filter(isJsonObject);
	return [
		// overtime taken as time off is owed by the hour, in the window of the day it was worked
		...rows('time_off').map((row): Wanted => ({
			account: 'leave',
			code: String(row.code),
			period: periodOf(row.period),
			measure: 'entitled',
			amount: Number(row.hours),
			unit: 'HOUR',
			effective_on: String(row.on)
		})),
		// leave an exit settled on its last payslip leaves the balance as days used: paid out, or taken back
		...rows('cash_out').map((row): Wanted => ({
			account: 'leave',
			code: String(row.code),
			period: periodOf(row.period),
			measure: 'used',
			amount: Number(row.amount),
			unit: row.unit === 'HOUR' ? 'HOUR' : 'DAY',
			effective_on: String(row.on)
		})),
		...rows('checkpoints').flatMap((row) =>
			Number(row.value) > 0 ? held('pay', String(row.code), 'total', Number(row.value)) : []
		),
		...rows('statutory').flatMap((row) => [
			...(Number(row.employee) !== 0
				? held('statutory', `${String(row.code)}.employee`, 'paid', Number(row.employee))
				: []),
			...(Number(row.employer) !== 0
				? held('statutory', `${String(row.code)}.employer`, 'paid', Number(row.employer))
				: [])
		])
	];
};

/** What a person's facts open of a row: each event's period and the days it gives. */
export const grantsOf = (lookup: JsonObject, subject: Subject, person: LeavePerson) => {
	const grants = new Map<PeriodKey, { from: string; days: number }>();
	for (const event of subject.events) {
		if (!Object.hasOwn(openedBy(lookup), event.kind)) continue;
		const days =
			typeof lookup.entitlement === 'string'
				? (expressed(lookup, person, event.on, event) ?? 0)
				: Number(objectValue(openedBy(lookup)[event.kind]).days ?? lookup.grant_days ?? 0);
		const from = opensOn(event);
		const period = periodKey(subject.scope, { kind: 'EVENT', on: from }, from, subject.started);
		grants.set(period, { from, days: (grants.get(period)?.days ?? 0) + days });
	}
	return grants;
};
/** A window sync has opened: it posted what the window grants or carries, beside HR's manual days in it. */
export const opened = (
	measures: Readonly<Record<string, number>> | undefined,
	manualDays: number
) => measures?.carried !== undefined || (measures?.entitled ?? manualDays) !== manualDays;
export const eventPeriods = (
	periods: Accounts[string][string] | undefined,
	scope: string
): PeriodKey[] =>
	Object.keys(periods ?? {})
		.filter(isPeriodKey)
		.filter((period) => period.startsWith(`${scope}.E.`));

/** A row's rule and the person on the last day of a window that closed; `undefined` leaves the window as it stood. */
export type ClosingRule = (
	row: LeaveRow,
	day: string
) => { readonly lookup: JsonObject; readonly person: LeavePerson } | undefined;

/**
 * One person's entitlements on a day, as plans: new law, a new fact and a new window all come to the same call. A window
 * that closed settles once more as the next opens, under `closing`: by default the rows and person given. `manual` is
 * what HR's manual adjustments hold (`manualOf`): no plan posts or undoes them, and the carry counts them.
 */
export const entitlementPlans = (
	rows: readonly (LeaveRow & { readonly account: string })[],
	person: LeavePerson,
	subject: Subject,
	balance_id: string,
	accounts: Accounts,
	on: string,
	closing: ClosingRule = ({ lookup }) => ({ lookup, person }),
	manual: Accounts = {}
): readonly Plan[] =>
	rows.flatMap(({ account, code, lookup }) => {
		const plan = (period: PeriodKey, measures: Readonly<Record<string, number>>, from: string) => ({
			source: `entitlement:${balance_id}:${code}:${period}`,
			balance_id,
			wanted: Object.entries(measures)
				.filter(([, amount]) => amount !== 0)
				.map(([measure, amount]) => ({
					account,
					code,
					period,
					measure: measureOf(measure),
					amount,
					unit: account === 'leave' ? ('DAY' as const) : ('MONEY' as const),
					effective_on: from
				}))
		});
		if (Object.keys(openedBy(lookup)).length > 0) {
			if (!fits(lookup, person)) return [];
			const grants = grantsOf(lookup, subject, person);
			// a fact no longer held: its period should stand at nothing
			const dropped = eventPeriods(accounts[account]?.[code], subject.scope).filter(
				(period) => !grants.has(period)
			);
			return [
				...[...grants].map(([period, { from, days }]) => plan(period, { entitled: days }, from)),
				...dropped.map((period) => plan(period, {}, on))
			];
		}
		if (account === 'claim')
			return lookup.annual_limit == null
				? []
				: [
						plan(
							periodKey(subject.scope, windowOf(lookup), on, subject.started),
							{ limit: Number(lookup.annual_limit) },
							windowStart(windowOf(lookup), on, subject.started)
						)
					];
		const granted = entitlementOf(lookup, person, on);
		if (granted === null) return [];
		const window = windowOf(lookup);
		const from = windowStart(window, on, subject.started);
		const period = periodKey(subject.scope, window, on, subject.started);
		const before = DateTime.formatIsoDate(
			DateTime.subtract(DateTime.makeUnsafe(from), { days: 1 })
		);
		const last =
			before < subject.started
				? undefined
				: periodKey(subject.scope, window, before, subject.started);
		const held =
			last === undefined || last === period ? undefined : accounts[account]?.[code]?.[last];
		const manualIn = (key: string) => manual[account]?.[code]?.[key]?.entitled ?? 0;
		// the window that closed settles once, as the next opens: its rule as of its last day, its carry as it stood
		const ended =
			last !== undefined &&
			opened(held, manualIn(last)) &&
			!opened(accounts[account]?.[code]?.[period], manualIn(period))
				? last
				: undefined;
		const then = ended === undefined ? undefined : closing({ code, lookup }, before);
		const closed = then === undefined ? null : entitlementOf(then.lookup, then.person, before);
		const settled =
			ended === undefined || closed === null
				? undefined
				: {
						period: ended,
						measures: { entitled: closed, carried: held?.carried ?? 0 }
					};
		// the settled figure replaces only what sync posted: HR's manual days in the window stand beside it
		const left =
			settled === undefined
				? held
				: { ...held, entitled: settled.measures.entitled + manualIn(settled.period) };
		const carried = carriedOf(lookup, person, leftIn(left), left?.entitled ?? 0);
		return [
			plan(period, { entitled: granted, carried }, from),
			...(settled === undefined ? [] : [plan(settled.period, settled.measures, before)])
		];
	});
