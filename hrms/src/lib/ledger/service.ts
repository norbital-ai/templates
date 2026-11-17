import { BigDecimal, DateTime, Effect } from 'effect';
import { new_id, type CarriedWrites, type EffectCtx, type Id } from '@norbital-ai/bolt';
import {
	Refusal,
	isJsonObject,
	jsonObject,
	type Json,
	type JsonObject
} from '../payroll_engine/foundation.js';
import { idOf, idsOf, objectValue, queryRows, type Reader } from '../payroll_engine/reads.js';
import {
	accountsOf,
	apply,
	diff,
	measureOf,
	isPeriodKey,
	periodOf,
	eventsOf,
	expired,
	leftIn,
	nextWindow,
	openedBy,
	opensOn,
	periodKey,
	periodOn,
	totalsScope,
	unlimited,
	windowOf,
	windowOn,
	windowStart,
	type Accounts,
	type Event,
	type Measure,
	type Movement,
	type PeriodKey,
	type Unit,
	type Wanted
} from './core.js';
import { validateRegistered, type Operation } from '../payroll_engine/registrations.js';
import { employerOn } from '../company.js';
import {
	PARAMETER_FIELDS,
	PROFILE_FIELDS,
	STINT_FIELDS,
	TERM_FIELDS,
	chainOf,
	employmentOn,
	leaveDaysOf,
	partsIn,
	startsOf,
	type Parts,
	type Starts
} from '../person.js';
import { lawRead, lawsOf, type Law } from '../law.js';
import { leaveOffDay } from '../payroll_engine/attendance.js';
import { payPeriodOf } from '../payroll_engine/pay_cycle.js';
import {
	carriedOf,
	entitlementOf,
	expressed,
	fits,
	type LeavePerson,
	type LeaveRow
} from './entitlement.js';

/**
 * The only writer of the ledger and the balance. A record says what it should have posted, or a person's facts say what
 * they are owed, and `postings` works out the difference with its balance: the record's own write carries it (posting,
 * `onApproved`), and `settle` writes it for sync. Everything else here works out what should stand.
 */
export type Plan = {
	readonly source: string;
	readonly balance_id: string;
	readonly wanted: readonly Wanted[];
};
type Ctx = Pick<EffectCtx, 'act' | 'query' | 'today'>;

const BATCH = 50;
const FIELDS = [
	'balance_id',
	'source',
	'operation',
	'account',
	'code',
	'period',
	'measure',
	'amount',
	'unit',
	'effective_on'
] as const;
const unitOf = (value: unknown): Unit | undefined =>
	value === 'DAY' ||
	value === 'CALENDAR_DAY' ||
	value === 'HOUR' ||
	value === 'MONEY' ||
	value === 'COUNT'
		? value
		: undefined;
const movementOf = (row: JsonObject): Omit<Movement, 'source'> => ({
	account: String(row.account),
	code: String(row.code),
	period: periodOf(row.period),
	measure: measureOf(row.measure),
	operation: row.operation === 'DEDUCT' ? 'DEDUCT' : row.operation === 'REMOVE' ? 'REMOVE' : 'ADD',
	amount: Number(row.amount ?? 0),
	unit: unitOf(row.unit),
	effective_on: String(row.effective_on)
});
const planKey = (balance: string, source: string) => `${balance}\u0000${source}`;
/**
 * What no source sync settles stands beside it: HR's manual adjustments, and the overtime a run owes as time off. A sync
 * or a seal reads them beside the balance.
 */
const MANUAL = {
	or: [
		{ source: { like: 'manual:%' } },
		{ account: { eq: 'leave' }, source: { like: 'payroll_run:%' } }
	]
} as const;
/** What each balance's manual adjustments and owed time off hold, by balance id. */
const manualOf = (rows: readonly JsonObject[]): ReadonlyMap<string, Accounts> =>
	new Map(
		[...Map.groupBy(rows, (row) => String(row.balance_id))].map(([balance, held]) => [
			balance,
			apply(
				{},
				held.map((row) => ({ ...movementOf(row), source: String(row.source) }))
			)
		])
	);

/** What a dated row holds beside the fields of its family. */
const DATED = ['id', 'employment_id', 'effective_from', 'clears'] as const;
/**
 * The stints of these people, each with its dated rows, its person and their dependants: the layers of one request.
 */
const stintsRead = (people: readonly Id<'employee_profile'>[]) =>
	({
		employment: {
			where: { employee_id: { in: people } },
			fields: [...STINT_FIELDS],
			limit: 10000,
			entity_id: { fields: ['settings_code'] }
		},
		contract_terms: {
			where: { employment_id: { is: { employee_id: { in: people } } } },
			fields: [...DATED, 'signed_on', ...TERM_FIELDS],
			limit: 10000
		},
		statutory_parameters: {
			where: { employment_id: { is: { employee_id: { in: people } } } },
			fields: [...DATED, ...PARAMETER_FIELDS],
			limit: 10000
		},
		employee_profile: { where: { id: { in: people } }, fields: [...PROFILE_FIELDS], limit: 10000 },
		dependant: { where: { employee_id: { in: people } }, limit: 10000 }
	}) as const;
/** The laws the companies of these stints follow (`stintsRead` reads each stint's company code): one more read. */
const lawsFrom = Effect.fnUntraced(function* (read: Reader, stints: readonly JsonObject[]) {
	return lawsOf(
		yield* queryRows(
			read,
			lawRead([
				...new Set(
					stints.flatMap((row) =>
						isJsonObject(row.entity_id) ? [String(row.entity_id.settings_code)] : []
					)
				)
			])
		)
	);
});
/**
 * What `stintsRead` found: each stint with its rows, the law code of each company they name, and the people whose
 * service counts every stint.
 */
const stintsOf = (found: Readonly<Record<string, readonly JsonObject[] | undefined>>) => {
	const { chain, lineage } = chainOf(found.employment ?? []);
	return {
		parts: partsIn({ ...found, employment: chain }),
		lineage,
		cumulative: new Set(
			(found.employee_profile ?? []).flatMap((row) =>
				row.cumulative_service === true ? [String(row.id)] : []
			)
		)
	};
};
const covers = (range: unknown, on: string) => {
	const { from, to } = objectValue(range);
	return String(from) <= on && (typeof to !== 'string' || on <= to);
};

/**
 * The ledger rows and balance moves that take each source from what it `posted` to what it should have, as a write
 * carries them; `balances` holds each plan's balance as read. Repeating it carries nothing.
 */
export const carry = (
	plans: readonly Plan[],
	posted: readonly JsonObject[],
	balances: readonly JsonObject[]
) => {
	const create: LedgerRow[] = [];
	const update: BalanceMove[] = [];
	const carried = {
		ledger_entry: { create },
		employee_balance: { update }
	} satisfies CarriedWrites;
	const held = Map.groupBy(posted, (row) => planKey(String(row.balance_id), String(row.source)));
	const moves = new Map<string, Movement[]>();
	for (const plan of plans) {
		const movements = diff(
			plan.source,
			plan.wanted,
			(held.get(planKey(plan.balance_id, plan.source)) ?? []).map(movementOf)
		);
		if (movements.length > 0)
			moves.set(plan.balance_id, [...(moves.get(plan.balance_id) ?? []), ...movements]);
	}
	for (const row of balances) {
		const movements = moves.get(String(row.id));
		if (movements === undefined) continue;
		carried.ledger_entry.create.push(...movements.map((move) => ledgerRow(String(row.id), move)));
		carried.employee_balance.update.push({
			target: { id: idOf('employee_balance', String(row.id)), revision: Number(row.revision) },
			set: { account: apply(accountsOf(row.account), movements) }
		});
	}
	return carried;
};
type LedgerRow = NonNullable<NonNullable<CarriedWrites['ledger_entry']>['create']>[number];
type BalanceMove = {
	readonly target: { readonly id: Id<'employee_balance'>; readonly revision: number };
	readonly set: { readonly account: Accounts };
};
const ledgerRow = (balance: string, row: Movement): LedgerRow => ({
	balance_id: idOf('employee_balance', balance),
	operation: row.operation === 'DEDUCT' ? 'DEDUCT' : 'ADD',
	account: row.account,
	code: row.code,
	period: row.period,
	measure: row.measure,
	amount: new Intl.NumberFormat('en', { useGrouping: false, maximumFractionDigits: 100 }).format(
		`${row.amount}` as const
	),
	...(row.unit === undefined ? {} : { unit: row.unit }),
	effective_on: row.effective_on,
	source: row.source
});

/**
 * Sync writes the difference in batches of balances: every batch's read goes out together, then one write each.
 * Repeating it writes nothing.
 */
export const settle = Effect.fn('ledger.settle')(function* (ctx: Ctx, plans: readonly Plan[]) {
	const balances = [...new Set(plans.map((plan) => plan.balance_id))];
	const batches = Array.from({ length: Math.ceil(balances.length / BATCH) }, (_, at) => {
		const chunk = balances.slice(at * BATCH, (at + 1) * BATCH);
		return { chunk, due: plans.filter((plan) => chunk.includes(plan.balance_id)) };
	});
	// a batch's write moves only its own balances: no batch's read waits on another's write
	const read = yield* Effect.all(
		batches.map(({ chunk, due }) =>
			queryRows(ctx.query, {
				ledger_entry: {
					where: {
						balance_id: { in: idsOf('employee_balance', chunk) },
						source: { in: [...new Set(due.map((plan) => plan.source))] }
					},
					fields: FIELDS,
					limit: 10000
				},
				employee_balance: {
					where: { id: { in: idsOf('employee_balance', chunk) } },
					fields: ['account', 'revision'],
					limit: BATCH
				}
			}).pipe(Effect.map((found) => ({ due, found })))
		),
		{ concurrency: 'unbounded' }
	);
	for (const { due, found } of read) {
		const { ledger_entry, employee_balance } = carry(
			due,
			found.ledger_entry,
			found.employee_balance
		);
		if (ledger_entry.create.length === 0) continue;
		yield* ctx.act({
			'ledger_entry.create': ledger_entry.create,
			'employee_balance.update': employee_balance.update
		});
	}
});

/** What records that are gone posted, inverted exactly: what their delete carries. */
const inverted = (posted: readonly JsonObject[], balances: readonly JsonObject[]) =>
	carry(
		[
			...new Map(
				posted.map((row) => [
					planKey(String(row.balance_id), String(row.source)),
					{ source: String(row.source), balance_id: String(row.balance_id), wanted: [] }
				])
			).values()
		],
		posted,
		balances
	);
/** What gone records posted, inverted: two reads, what they posted and then the balances it names. */
export const undone = Effect.fn('ledger.undone')(function* (
	read: Reader,
	sources: readonly string[]
) {
	if (sources.length === 0) return inverted([], []);
	// ponytail: one read of what the sources posted; a run that posted more than 10,000 rows is refused here until its
	// rows are rebuilt from its payslips instead
	const { ledger_entry: posted } = yield* queryRows(read, {
		ledger_entry: { where: { source: { in: [...sources] } }, fields: FIELDS, limit: 10000 }
	});
	const { employee_balance: balances } = yield* queryRows(read, {
		employee_balance: {
			where: { id: { in: idsOf('employee_balance', uniqueIds(posted, 'balance_id')) } },
			fields: ['account', 'revision'],
			limit: 10000
		}
	});
	return inverted(posted, balances);
});

/** What HR adjusts by hand: a leave row's entitled days, in half days, or hours on a row that counts in hours, or a claim row's limit. */
const ADJUSTABLE = {
	leave: { measure: 'entitled', units: ['DAY', 'HOUR'] },
	claim: { measure: 'limit', units: ['MONEY'] }
} as const;
const ADJUSTMENT_SHAPE =
	"A manual adjustment adds to or takes from a leave row's entitled days (in half days, or hours where the row counts in hours) or a claim row's limit, on a date, with a note naming its cause. Its period and source are worked out, never typed.";
/**
 * HR's manual adjustment of a balance, written on the employee profile: each row moves one leave or claim row of the
 * law in force for the person on its date, in that row's window holding the date. Its `period` and `source`
 * (`manual:<row id>`) are worked out here; the balance move rides in the same write.
 */
export const manualAdjustments = Effect.fn('ledger.manualAdjustments')(function* (
	read: Reader,
	rows: readonly JsonObject[]
) {
	const refuse = (message: string) => Effect.fail(new Refusal({ message }));
	for (const row of rows) {
		const shape =
			row.account === 'leave' || row.account === 'claim' ? ADJUSTABLE[row.account] : undefined;
		const amount = Number(row.amount);
		if (
			shape === undefined ||
			row.measure !== shape.measure ||
			!shape.units.some((unit) => unit === row.unit) ||
			(row.operation !== 'ADD' && row.operation !== 'DEDUCT') ||
			!(amount > 0) ||
			(row.unit === 'DAY' && !Number.isInteger(amount * 2)) ||
			row.period != null ||
			row.source != null ||
			typeof row.note !== 'string' ||
			row.note.trim() === ''
		)
			return yield* refuse(ADJUSTMENT_SHAPE);
	}
	const { employee_balance: balances = [] } = yield* queryRows(read, {
		employee_balance: {
			where: { id: { in: idsOf('employee_balance', uniqueIds(rows, 'balance_id')) } },
			fields: ['employee_id', 'account', 'revision'],
			limit: 10000
		}
	});
	const people = idsOf('employee_profile', uniqueIds(balances, 'employee_id'));
	const found = yield* queryRows(read, stintsRead(people));
	const laws = yield* lawsFrom(read, found.employment);
	const { parts, lineage, cumulative } = stintsOf(found);
	const chain = parts.map((held) => held.stint);
	const balance = new Map(balances.map((row) => [String(row.id), row]));
	const keys: { readonly period: PeriodKey; readonly source: string }[] = [];
	const moves = new Map<string, Movement[]>();
	for (const row of rows) {
		const date = String(row.effective_on);
		const held = balance.get(String(row.balance_id));
		const own = parts.find(
			({ stint }) => stint.employee_id === held?.employee_id && covers(stint.effective_range, date)
		);
		if (held === undefined || own === undefined)
			return yield* refuse(`No employment of this person covers ${date}.`);
		const { stint } = own;
		const law = laws(lineage.get(String(stint.entity_id)), date);
		const target = law?.rows[row.account === 'claim' ? 'claim_catalog' : 'leave_catalog'].find(
			(item) => item.code === row.code
		);
		if (law === undefined || target === undefined)
			return yield* refuse(
				`${String(row.code)} is not a ${String(row.account)} row of the law in force on ${date}.`
			);
		// a leave row counts in days, or in hours where it says so
		if (
			row.account === 'leave' &&
			row.unit !== (objectValue(target.lookup).unit === 'HOUR' ? 'HOUR' : 'DAY')
		)
			return yield* refuse(ADJUSTMENT_SHAPE);
		const period = periodOn(
			objectValue(target.lookup),
			{
				scope: law.code,
				started: startsOf(stint, chain, lineage, cumulative.has(String(stint.employee_id)))
					.service_started_on,
				events: eventsOf(employmentOn(own, date))
			},
			date
		);
		const source = `manual:${String(row.id)}`;
		keys.push({ period, source });
		moves.set(String(held.id), [
			...(moves.get(String(held.id)) ?? []),
			{ ...movementOf({ ...row, period }), source }
		]);
	}
	const onApproved = {
		employee_balance: {
			update: [...moves].map(([id, movements]): BalanceMove => {
				const held = balance.get(id);
				return {
					target: { id: idOf('employee_balance', id), revision: Number(held?.revision) },
					set: { account: apply(accountsOf(held?.account), movements) }
				};
			})
		}
	} satisfies CarriedWrites;
	return { keys, onApproved };
});

const uniqueIds = (rows: readonly JsonObject[], field: string) => [
	...new Set(rows.flatMap((row) => (typeof row[field] === 'string' ? [row[field]] : [])))
];

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
const grantsOf = (lookup: JsonObject, subject: Subject, person: LeavePerson) => {
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
const opened = (measures: Readonly<Record<string, number>> | undefined, manualDays: number) =>
	measures?.carried !== undefined || (measures?.entitled ?? manualDays) !== manualDays;
const eventPeriods = (periods: Accounts[string][string] | undefined, scope: string): PeriodKey[] =>
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

type Family = 'leave' | 'claim';
const rowOfCatalog = (row: JsonObject): LeaveRow => ({
	code: String(row.code),
	lookup: objectValue(row.lookup)
});
/**
 * The facts a leave row can read about a person, from their employment (`employmentOn`) and their employer as they stand
 * on the day. Its rule reads the starts worked out from the stints as the employment's `service_started_on` and
 * `employment_started_on`.
 */
const personOf = (
	contract: JsonObject,
	starts: Starts,
	employer?: JsonObject,
	workEvents: readonly JsonObject[] = []
): LeavePerson => {
	const payroll = objectValue(contract.payroll);
	const extension = objectValue(contract.statutory_parameters);
	const facts = Object.fromEntries(
		Object.entries(extension).filter(([key]) => key !== 'statutory')
	);
	const employerExtension = objectValue(employer?.statutory_parameters ?? {});
	return {
		started: starts.service_started_on,
		partTime: contract.engagement === 'PART_TIME',
		gender: typeof payroll.gender === 'string' ? payroll.gender : null,
		maritalStatus: typeof payroll.marital_status === 'string' ? payroll.marital_status : null,
		terms: objectValue(contract.terms),
		facts,
		stateOwned: employerExtension.state_owned === true,
		workEvents,
		employment: { ...contract, ...starts },
		...(employer === undefined ? {} : { employer })
	};
};

type Entries = 'leave_catalog_entry' | 'claim_catalog_entry' | 'adhoc_catalog_entry';
/**
 * What a batch of entries reads, in two requests: every stint of their people, then those stints' dated rows and
 * dependants, the people's balances, what the batch's entries posted and the laws their companies answer to. A leave
 * batch also reads its stints' open entries and what they posted, the people's leave on the batch's days, and what
 * plans those days. Every check and the posting read it.
 */
export type Known = {
	/** Every stint of the people, by its id. */
	readonly parts: ReadonlyMap<string, Parts>;
	/** The lineage (`settings_code`) of each entity the people's stints name, for their service start. */
	readonly lineage: ReadonlyMap<string, string>;
	/** The people whose service counts every stint (`cumulative_service`). */
	readonly cumulative: ReadonlySet<string>;
	/** The law of a jurisdiction code as it stands on a day. */
	readonly laws: (code: unknown, day: string) => Law | undefined;
	readonly balance: ReadonlyMap<string, JsonObject>;
	readonly entries: readonly JsonObject[];
	readonly posted: readonly JsonObject[];
	readonly captures: ReadonlyMap<string, readonly JsonObject[]>;
	/** What plans the people's days, read for leave alone: holidays, pay groups, shifts, patterns and roster rows. */
	readonly plan: Readonly<Record<string, readonly JsonObject[]>>;
};
const known = Effect.fn('ledger.known')(function* (
	read: Reader,
	model: Entries,
	entries: readonly JsonObject[]
) {
	const named = idsOf('employment', uniqueIds(entries, 'employment_id'));
	// leave falls only on days the person works: their companies' holidays, shifts and patterns, and their roster rows
	// ponytail: roster rows a month either side of the days asked; a holiday replacing a day further off reads its plan
	const dates = entries
		.flatMap((entry) => (Array.isArray(entry.days) ? entry.days : []))
		.filter(isJsonObject)
		.map((day) => String(day.date ?? day.incurred_on))
		.toSorted();
	const [first, last] = [dates[0], dates.at(-1)];
	const month = (day: string, months: number) =>
		DateTime.formatIsoDate(DateTime.add(DateTime.makeUnsafe(day), { months }));
	const planned = model === LEAVE && first !== undefined && last !== undefined;
	// every stint of the entries' people, with its company's law code; for leave, the open entries of the batch's
	// stints, whose postings say which of them wait for approval
	const { employment: stints, leave_catalog_entry: open } = yield* queryRows(read, {
		employment: {
			where: { employee_id: { is: { employment: { some: { id: { in: named } } } } } },
			fields: ['employee_id', 'entity_id'],
			limit: 10000,
			entity_id: { fields: ['settings_code'] }
		},
		leave_catalog_entry: {
			where: { employment_id: { in: planned ? named : [] }, payroll_run_id: { is_null: true } },
			limit: 10000
		}
	});
	const people = idsOf('employee_profile', uniqueIds(stints, 'employee_id'));
	const companies = idsOf(
		'entity',
		planned
			? stints.map((row) => (isJsonObject(row.entity_id) ? row.entity_id.id : row.entity_id))
			: []
	);
	const sources = [...entries, ...open].map((row) => `${model}:${String(row.id)}`);
	// the people's leave on the batch's days, from its first to its last: what a half-day may collide with
	const sameDays = { incurred_on: { gte: first ?? '1970-01-01', lte: last ?? '1970-01-01' } };
	const own = yield* queryRows(read, {
		...stintsRead(people),
		...lawRead([
			...new Set(
				stints.flatMap((row) =>
					isJsonObject(row.entity_id) ? [String(row.entity_id.settings_code)] : []
				)
			)
		]),
		employee_balance: {
			where: { employee_id: { in: people } },
			fields: ['employee_id', 'account', 'revision'],
			limit: 10000
		},
		// what those entries posted, by their own sources: never the person's history. `in` takes 1,000 values
		ledger_entry: {
			where: {
				or: Array.from({ length: Math.max(1, Math.ceil(sources.length / 1000)) }, (_, at) => ({
					source: { in: sources.slice(at * 1000, (at + 1) * 1000) }
				}))
			},
			fields: FIELDS,
			limit: 10000
		},
		leave_catalog_entry: {
			where: {
				employment_id: { is: { employee_id: { in: planned ? people : [] } } },
				leave_catalog_entry_day: { some: sameDays }
			},
			limit: 10000
		},
		// every slot of the batch's own and the open entries; the people's other slots only on the batch's days
		leave_catalog_entry_day: {
			where: {
				or: [
					{
						leave_entry_id: {
							in: idsOf('leave_catalog_entry', planned ? uniqueIds(entries, 'id') : [])
						}
					},
					{
						leave_entry_id: {
							is: { employment_id: { in: planned ? named : [] }, payroll_run_id: { is_null: true } }
						}
					},
					{
						...sameDays,
						leave_entry_id: {
							is: { employment_id: { is: { employee_id: { in: planned ? people : [] } } } }
						}
					}
				]
			},
			fields: ['leave_entry_id', 'incurred_on', 'part', 'payroll_run_id'],
			limit: 10000
		},
		roster_entry: {
			where: {
				employment_id: { is: { employee_id: { in: planned ? people : [] } } },
				work_date: {
					gte: month(first ?? '1970-01-01', -1),
					lte: month(last ?? '1970-01-01', 1)
				}
			},
			fields: ['employment_id', 'work_date', 'shift_definition_id'],
			limit: 10000
		},
		holiday: {
			where: { entity_id: { in: companies } },
			fields: ['date', 'published_at', 'employee_id', 'replaces', 'given_to'],
			limit: 10000
		},
		pay_group: {
			where: { entity_id: { in: companies } },
			fields: ['payment_schedule'],
			limit: 1000
		},
		shift_pattern: {
			where: { entity_id: { in: companies } },
			fields: ['pattern', 'effective_range'],
			limit: 1000
		},
		shift_definition: {
			where: { entity_id: { in: companies } },
			fields: ['variant'],
			limit: 1000
		}
	});
	// the stored leave a check judges against: the open entries and those on the batch's days, each once
	const stored = [
		...new Map([...open, ...own.leave_catalog_entry].map((row) => [String(row.id), row])).values()
	];
	return knownOf(own, stored, own.leave_catalog_entry_day, lawsOf(own));
});
/**
 * `Known` from rows already read: the people's stints with their dated rows (`stintsRead`'s roots), their balances,
 * ledger rows and plan rows in `found`, their stored `entries` and those entries' slots. A page builds it from its own
 * queries, so the checks below judge there exactly as they do before the write.
 */
export const knownOf = (
	found: Readonly<Record<string, readonly JsonObject[] | undefined>>,
	entries: readonly JsonObject[],
	captures: readonly JsonObject[],
	laws: Known['laws']
): Known => {
	const { parts, lineage, cumulative } = stintsOf(found);
	return {
		parts: new Map(parts.map((held) => [String(held.stint.id), held])),
		lineage,
		cumulative,
		laws,
		balance: new Map((found.employee_balance ?? []).map((row) => [String(row.employee_id), row])),
		entries,
		posted: found.ledger_entry ?? [],
		captures: Map.groupBy(captures, (row) => String(row.leave_entry_id)),
		plan: {
			holiday: found.holiday ?? [],
			pay_group: found.pay_group ?? [],
			shift_pattern: found.shift_pattern ?? [],
			shift_definition: found.shift_definition ?? [],
			roster_entry: found.roster_entry ?? []
		}
	};
};
/**
 * A batch of entries' read (`Known`, two crossings), and with an `operation` its registered rules' validation beside
 * it: both start together, so each crossing carries both, and the slower of the two sets the count.
 */
export const entryRead = (
	read: Reader,
	model: Entries,
	entries: readonly JsonObject[],
	operation?: Operation
) =>
	Effect.all(
		[
			known(read, model, entries),
			operation === undefined ? Effect.void : validateRegistered(read, model, operation, entries)
		],
		{ concurrency: 'unbounded' }
	).pipe(Effect.map(([read]) => read));

/**
 * The law an entry answers to: its company's, in force on the entry's own day. That day is a claim's or an ad hoc
 * entry's `incurred_on` and a leave entry's first slot; an entry with no slot posts nothing under any law.
 */
const lawOf = (known: Known, entry: JsonObject): Law | undefined => {
	const stint = known.parts.get(String(entry.employment_id))?.stint;
	return stint === undefined
		? undefined
		: known.laws(known.lineage.get(String(stint.entity_id)), dayOf(known, entry));
};
const dayOf = (known: Known, entry: JsonObject): string =>
	typeof entry.incurred_on === 'string'
		? entry.incurred_on
		: ((Array.isArray(entry.days) ? entry.days : (known.captures.get(String(entry.id)) ?? []))
				.filter(isJsonObject)
				.map((slot) => String(slot.date ?? slot.incurred_on))
				.toSorted()[0] ?? '');

/** What each entry should post, from what its batch read. A record that is gone is not here: its delete inverts it. */
const entryPlans = (
	known: Known,
	family: Family | 'adhoc',
	model: string,
	entries: readonly JsonObject[]
): readonly Plan[] => {
	if (entries.length === 0) return [];
	const postedBy = Map.groupBy(known.posted, (row) => String(row.source));
	const drew = (source: string) =>
		(postedBy.get(source) ?? [])
			.filter((item) => item.measure === 'used')
			.reduce(
				(total, item) => total + (item.operation === 'DEDUCT' ? -1 : 1) * Number(item.amount ?? 0),
				0
			);
	const inBatch = new Map<string, number>();
	return entries.flatMap((entry) => {
		const own = known.parts.get(String(entry.employment_id));
		const law = lawOf(known, entry);
		const familyRows = law?.rows[`${family}_catalog` as const] ?? [];
		const catalog = familyRows.find((item) => item.code === entry.catalog_code);
		const balance = known.balance.get(String(own?.stint.employee_id));
		if (own === undefined || law === undefined || catalog === undefined || balance === undefined)
			return [];
		const settings = law.settings;
		// the employment as it stands on the entry's own day
		const contract = employmentOn(own, dayOf(known, entry));
		const subject = {
			scope: law.code,
			started: startsOf(
				own.stint,
				[...known.parts.values()].map((held) => held.stint),
				known.lineage,
				known.cumulative.has(String(own.stint.employee_id))
			).service_started_on,
			events: eventsOf(contract),
			taxYearStart: Number(settings.tax_year_start_month ?? 1)
		};
		const row = rowOfCatalog(catalog);
		const rowOf = (code: string) => {
			const found = familyRows.find((item) => item.code === code);
			return found === undefined ? undefined : rowOfCatalog(found);
		};
		// the child slots are the truth: a stored entry carries them in `captures`, a batch's own entry on `days`
		const withSlots = (row: JsonObject) =>
			family === 'leave'
				? jsonObject({
						...row,
						// an entry of this batch states its slots (a slot taken off it is gone); a stored one's are its children
						days: [
							...new Map(
								(Array.isArray(row.days) ? row.days : (known.captures.get(String(row.id)) ?? []))
									.filter(isJsonObject)
									.map((child) => {
										const day = {
											date: String(child.date ?? child.incurred_on),
											part: child.part
										};
										return [`${day.date}/${String(day.part)}`, day] as const;
									})
							).values()
						]
					})
				: row;
		const source = `${model}:${String(entry.id)}`;
		const left = (period: string) => {
			// what this claim already drew stays available to it
			const key = `${String(balance.id)}/${row.code}/${period}`;
			return (
				claimLeft(accountsOf(balance.account), row, period) + drew(source) - (inBatch.get(key) ?? 0)
			);
		};
		const wanted =
			family === 'leave'
				? leaveWanted(
						withSlots(entry),
						row,
						rowOf,
						subject,
						Number(objectValue(contract.terms).normal_hours_per_day ?? 0)
					)
				: family === 'claim'
					? claimWanted(entry, row, subject, left)
					: adhocWanted(entry, row, {
							...subject,
							scope: totalsScope(settings, entry.entity_id)
						});
		if (family === 'claim')
			for (const item of wanted) {
				const key = `${String(balance.id)}/${row.code}/${item.period}`;
				inBatch.set(key, (inBatch.get(key) ?? 0) + item.amount - drew(source));
			}
		return [{ source: `${model}:${String(entry.id)}`, balance_id: String(balance.id), wanted }];
	});
};

const UNOPENED =
	"This person's balance is not open yet. It opens when the ledger sync after their hire finishes; try again then.";

const FAMILY = {
	leave_catalog_entry: 'leave',
	claim_catalog_entry: 'claim',
	adhoc_catalog_entry: 'adhoc'
} as const;

/** What these entries post, as their own write carries it, from what their batch read. */
export const entryPostings = Effect.fn('ledger.entryPostings')(function* (
	known: Known,
	model: Entries,
	entries: readonly JsonObject[]
) {
	// no balance row, no posting: the entry would stand, or be approved, with nothing on the ledger
	const closed = entries.find((entry) => {
		const stint = known.parts.get(String(entry.employment_id))?.stint;
		return stint !== undefined && !known.balance.has(String(stint.employee_id));
	});
	if (closed !== undefined) return yield* Effect.fail(new Refusal({ message: UNOPENED }));
	return carry(entryPlans(known, FAMILY[model], model, entries), known.posted, [
		...known.balance.values()
	]);
});
/** What these entries, deleted, posted: inverted, as their delete carries it. */
export const entriesUndone = (known: Known, model: Entries, entries: readonly JsonObject[]) => {
	const sources = new Set(entries.map((entry) => `${model}:${String(entry.id)}`));
	return inverted(
		known.posted.filter((row) => sources.has(String(row.source))),
		[...known.balance.values()]
	);
};

/**
 * What runs post from their payslips: those a create makes (`payslips`), else the stored ones. A caller that has read
 * the laws passes them (`laws`); otherwise they are one more read.
 */
export const runPostings = Effect.fn('ledger.runPostings')(function* (
	read: Reader,
	runs: readonly {
		readonly id: string;
		readonly pay_date: string;
		readonly payslips?: readonly JsonObject[];
	}[],
	laws?: Known['laws']
) {
	const made = runs.every((run) => run.payslips !== undefined);
	const slips = made
		? runs.flatMap((run) =>
				(run.payslips ?? []).map((slip) => jsonObject({ ...slip, payroll_run_id: run.id }))
			)
		: ((yield* queryRows(read, {
				payslip: {
					where: {
						payroll_run_id: {
							in: idsOf(
								'payroll_run',
								runs.map((run) => run.id)
							)
						}
					},
					fields: ['payroll_run_id', 'employee_id', 'employment_id', 'entity_id', 'breakdown'],
					limit: 10000
				}
			})).payslip ?? []);
	const companies = idsOf('entity', uniqueIds(slips, 'entity_id'));
	const found = yield* queryRows(read, {
		entity: { where: { id: { in: companies } }, fields: ['id', 'settings_code'], limit: 50 },
		employment: {
			where: { id: { in: idsOf('employment', uniqueIds(slips, 'employment_id')) } },
			fields: ['id'],
			limit: 10000
		},
		employee_balance: {
			where: { employee_id: { in: idsOf('employee_profile', uniqueIds(slips, 'employee_id')) } },
			fields: ['employee_id', 'account', 'revision'],
			limit: 10000
		},
		// a run just made has posted nothing: it asks for no source
		ledger_entry: {
			where: { source: { in: made ? [] : runs.map((run) => `payroll_run:${run.id}`) } },
			fields: FIELDS,
			limit: 10000
		}
	});
	const {
		entity: entities,
		employment: stints,
		employee_balance: balances,
		ledger_entry: posted
	} = found;
	const payDate = new Map(runs.map((run) => [run.id, run.pay_date]));
	const stint = new Set(stints.map((row) => String(row.id)));
	const balance = new Map(balances.map((row) => [String(row.employee_id), String(row.id)]));
	// a payslip answers to the law of its company on its run's pay date
	const lawIn =
		laws ??
		lawsOf(yield* queryRows(read, lawRead(entities.map((row) => String(row.settings_code)))));
	const lineage = new Map(entities.map((row) => [String(row.id), row.settings_code]));
	const lawFor = (slip: JsonObject) =>
		lawIn(lineage.get(String(slip.entity_id)), String(payDate.get(String(slip.payroll_run_id))));
	const codesOf = (rows: readonly JsonObject[]) => rows.map((row) => String(row.code));
	// the ledger write boundary: a payslip may only post a code its law declares
	for (const slip of slips) {
		const law = lawFor(slip);
		const codes = new Set(
			codesOf([...(law?.rows.subtotal ?? []), ...(law?.rows.statutory_contribution_catalog ?? [])])
		);
		const leaveCodes = new Set(codesOf(law?.rows.leave_catalog ?? []));
		for (const key of ['checkpoints', 'statutory', 'time_off']) {
			const rows = objectValue(slip.breakdown)[key];
			for (const row of Array.isArray(rows) ? rows : [])
				if (isJsonObject(row) && !(key === 'time_off' ? leaveCodes : codes).has(String(row.code)))
					return yield* Effect.fail(
						new Refusal({
							message: `${String(row.code)}: not a code of the law on this pay date.`
						})
					);
		}
	}
	// a payslip with no balance row would be paid with nothing on the ledger
	if (slips.some((slip) => !balance.has(String(slip.employee_id))))
		return yield* Effect.fail(new Refusal({ message: UNOPENED }));
	const plans = slips.flatMap((slip) => {
		const balance_id = String(balance.get(String(slip.employee_id)));
		const run = String(slip.payroll_run_id);
		const law = lawFor(slip);
		if (law === undefined || !stint.has(String(slip.employment_id))) return [];
		const own = law.settings;
		// the catalog rows own the posting window: a monthly checkpoint or scheme posts to the month as well as the year
		const monthly = (rows: readonly JsonObject[]) =>
			codesOf(rows.filter((row) => row.balance_window === 'MONTH'));
		const byMonth = [
			...monthly(law.rows.subtotal),
			...monthly(law.rows.statutory_contribution_catalog).flatMap((code) => [
				`${code}.employee`,
				`${code}.employer`
			])
		];
		return [
			{
				source: `payroll_run:${run}`,
				balance_id,
				wanted: [
					...payslipWanted(objectValue(slip.breakdown), String(payDate.get(run)), {
						scope: totalsScope(own, slip.entity_id),
						// a payslip posts to calendar windows, which no service start moves
						started: String(payDate.get(run)),
						events: [],
						taxYearStart: Number(own.tax_year_start_month ?? 1),
						byMonth
					}),
					// what it carries for earlier periods posts to those periods, as its breakdown records
					...carriedFor(slip.breakdown).flatMap((entry) => entry.postings)
				]
			}
		];
	});
	return carry(plans, posted, balances);
});

const LEAVE = 'leave_catalog_entry';
const sourceOf = (row: JsonObject) => `${LEAVE}:${String(row.id)}`;

/** A check's verdict as the write's refusal: the check says why in its own words. */
const refuse = (problem: string | undefined) =>
	problem === undefined ? Effect.void : Effect.fail(new Refusal({ message: problem }));
/**
 * The half-days of an entry, as `person/date/part`: a person's leave is one calendar across their stints. A stored
 * entry's slots are its captured children; an entry being written carries them on `days`.
 */
const slotsOf = (known: Known, row: JsonObject) => [
	...new Set(
		[...(known.captures.get(String(row.id)) ?? []), ...(Array.isArray(row.days) ? row.days : [])]
			.filter(isJsonObject)
			.map(
				(day) =>
					`${String(known.parts.get(String(row.employment_id))?.stint.employee_id)}/${String(day.date ?? day.incurred_on)}/${String(day.part)}`
			)
	)
];
/** The half-days the people's stored leave already covers (`person/date/part`), but for the entries being `replaced`. */
export const leaveTaken = (known: Known, replaced: readonly JsonObject[] = []) => {
	const gone = new Set(replaced.map((row) => String(row.id)));
	return new Set(
		known.entries
			.filter((row) => row.encashment !== true && !gone.has(String(row.id)))
			.flatMap((row) => slotsOf(known, row))
	);
};
/**
 * Why a leave entry may not commit, if it may not: a half-day other leave covers, or a window it draws on without the
 * days. The balance does not show an entry held for approval, so a held one counts here. The form asks it as the write
 * does.
 */
export const leaveShort = (
	known: Known,
	entries: readonly JsonObject[],
	today: string,
	replaced: readonly JsonObject[] = []
): string | undefined => {
	const taking = entries.filter((row) => row.encashment !== true);
	const ids = uniqueIds(entries, 'employment_id');
	const held = known.entries;
	const taken = leaveTaken(known, replaced);
	for (const slot of taking.flatMap((row) => slotsOf(known, row))) {
		if (taken.has(slot)) return `Leave already covers ${slot.split('/')[1]}.`;
		taken.add(slot);
	}
	const open = held.filter(
		(row) => row.payroll_run_id == null && ids.includes(String(row.employment_id))
	);
	const posted = new Set(known.posted.map((row) => String(row.source)));
	const editing = new Set(replaced.map(sourceOf));
	const waiting = open.filter((row) => !posted.has(sourceOf(row)) && !editing.has(sourceOf(row)));
	const undone = replaced.filter((row) => posted.has(sourceOf(row)));
	const plans = entryPlans(known, 'leave', LEAVE, entries);
	if (plans.length === 0) return undefined;
	const limited = new Map<string, boolean>();
	const opened = new Set<string>();
	for (const entry of entries)
		for (const row of lawOf(known, entry)?.rows.leave_catalog ?? []) {
			limited.set(String(row.code), !unlimited(objectValue(row.lookup)));
			if (Object.keys(openedBy(objectValue(row.lookup))).length > 0) opened.add(String(row.code));
		}
	const accounts = new Map(
		[...known.balance.values()].map((row) => [String(row.id), accountsOf(row.account)])
	);
	const drawn = new Map<string, { row: Wanted; amount: number }>();
	for (const plan of plans)
		for (const row of plan.wanted) {
			if (limited.get(row.code) !== true) continue;
			const key = [plan.balance_id, row.code, row.period].join('/');
			drawn.set(key, { row, amount: (drawn.get(key)?.amount ?? 0) + row.amount });
		}
	const adjust = (others: readonly Plan[], sign: 1 | -1) => {
		for (const plan of others)
			for (const row of plan.wanted) {
				const key = [plan.balance_id, row.code, row.period].join('/');
				const held = drawn.get(key);
				if (held !== undefined)
					drawn.set(key, { ...held, amount: held.amount + sign * row.amount });
			}
	};
	adjust(entryPlans(known, 'leave', LEAVE, waiting), 1);
	adjust(entryPlans(known, 'leave', LEAVE, undone), -1);
	for (const [key, { row, amount }] of drawn) {
		if (amount <= 0) continue;
		const balance = key.slice(0, key.indexOf('/'));
		const measures = accounts.get(balance)?.[row.account]?.[row.code]?.[row.period];
		// a window no sync has opened yet has nothing to refuse against
		const unopened = opened.has(row.code) && !row.period.includes('.E.');
		if (measures === undefined && row.effective_on > today && !unopened) continue;
		const remaining = leftIn(measures);
		if (
			BigDecimal.isNegative(
				BigDecimal.round(BigDecimal.fromNumberUnsafe(remaining - amount), { scale: 8 })
			)
		)
			return `${row.code}: insufficient balance.`;
	}
	return undefined;
};
export const assertLeft = (...given: Parameters<typeof leaveShort>) =>
	Effect.suspend(() => refuse(leaveShort(...given)));

/**
 * Why these leave days may not be taken, if they may not: leave is taken on days the person works, so a rest day or a
 * holiday of theirs is refused. A row counted in calendar days takes every day.
 */
export const leaveOff = (known: Known, entries: readonly JsonObject[]): string | undefined => {
	for (const entry of entries) {
		const held = known.parts.get(String(entry.employment_id));
		const row = lawOf(known, entry)?.rows.leave_catalog.find(
			(item) => item.code === entry.catalog_code
		);
		if (
			held === undefined ||
			entry.encashment === true ||
			objectValue(row?.lookup).unit === 'CALENDAR_DAY'
		)
			continue;
		const own = leaveDaysOf(held, known.plan);
		for (const day of (Array.isArray(entry.days) ? entry.days : []).filter(isJsonObject)) {
			const date = String(day.date ?? day.incurred_on);
			const off = leaveOffDay(date, own);
			if (off !== undefined)
				return off === 'HOLIDAY'
					? `${date} is a holiday: no leave is taken on it.`
					: `${date} is a rest day: no leave is taken on it.`;
		}
	}
	return undefined;
};
export const assertWorked = (...given: Parameters<typeof leaveOff>) =>
	Effect.suspend(() => refuse(leaveOff(...given)));
/** A cash-out pays its row's `payout`: a row that declares none has nothing a run could pay for the days drawn. */
export const assertCashable = Effect.fn('ledger.assertCashable')(function* (
	known: Known,
	entries: readonly JsonObject[]
) {
	const rowOf = (entry: JsonObject) =>
		lawOf(known, entry)?.rows.leave_catalog.find((item) => item.code === entry.catalog_code);
	const bare = entries.find((entry) => {
		const payout = rowOf(entry)?.payout;
		return entry.encashment === true && (typeof payout !== 'string' || payout.trim() === '');
	});
	if (bare !== undefined)
		return yield* Effect.fail(
			new Refusal({
				message: `${String(rowOf(bare)?.code ?? 'This leave')} has no payout, so its days cannot be cashed out. Take them as leave, or give the row a payout.`
			})
		);
});

/**
 * The check before a person's facts change: a fact the write drops must not leave days taken under it with nothing
 * behind them. Each `employment` is a stint as the write leaves it (`employmentOn`), read under its company's law on
 * `on`. A caller that has read those laws passes them (`laws`).
 */
export const assertFactsHold = Effect.fn('ledger.assertFactsHold')(function* (
	read: Reader,
	facts: readonly { readonly employment: JsonObject; readonly on: string }[],
	laws?: (code: unknown, day: string) => Law | undefined
) {
	if (facts.length === 0) return;
	const views = facts.map(({ employment }) => employment);
	const people = idsOf('employee_profile', uniqueIds(views, 'employee_id'));
	const companyIds = idsOf('entity', uniqueIds(views, 'entity_id'));
	const {
		employee_balance: balances = [],
		ledger_entry: manualRows = [],
		entity: companies = [],
		entity_change: companyChanges = [],
		employment: stored = []
	} = yield* queryRows(read, {
		employment: {
			where: { employee_id: { in: people } },
			fields: ['employee_id', 'effective_range', 'entity_id'],
			limit: 10000,
			entity_id: { fields: ['settings_code'] },
			employee_id: { fields: ['cumulative_service'] }
		},
		employee_balance: {
			where: { employee_id: { in: people } },
			fields: ['employee_id', 'account'],
			limit: 10000
		},
		ledger_entry: {
			where: { ...MANUAL, balance_id: { is: { employee_id: { in: people } } } },
			fields: FIELDS,
			limit: 10000
		},
		entity: { where: { id: { in: companyIds } }, fields: ['id', 'settings_code'], limit: 50 },
		entity_change: { where: { entity_id: { in: companyIds } }, limit: 10000 }
	});
	const held = chainOf(stored);
	const lineage = new Map([
		...held.lineage,
		...companies.map((row) => [String(row.id), String(row.settings_code)] as const)
	]);
	const lawIn =
		laws ??
		lawsOf(yield* queryRows(read, lawRead(companies.map((row) => String(row.settings_code)))));
	const manual = manualOf(manualRows);
	const balance = new Map(balances.map((row) => [String(row.employee_id), row]));
	for (const { employment, on } of facts) {
		const law = lawIn(lineage.get(String(employment.entity_id)), on);
		const entity = companies.find((row) => row.id === employment.entity_id);
		// each reads its employer as it stands on the same day
		const employer =
			entity === undefined
				? undefined
				: employerOn(
						entity,
						companyChanges.filter((row) => row.entity_id === entity.id),
						on
					);
		const starts = startsOf(
			employment,
			held.chain,
			lineage,
			held.cumulative.has(String(employment.employee_id))
		);
		const subject = {
			scope: String(law?.code),
			started: starts.service_started_on,
			events: eventsOf(employment)
		};
		const own = balance.get(String(employment.employee_id));
		const leave = accountsOf(own?.account).leave ?? {};
		const added = manual.get(String(own?.id))?.leave ?? {};
		for (const row of law?.rows.leave_catalog ?? []) {
			const { code, lookup } = rowOfCatalog(row);
			const grants = grantsOf(lookup, subject, personOf(employment, starts, employer));
			for (const period of eventPeriods(leave[code], subject.scope)) {
				const used = leave[code]?.[period]?.used ?? 0;
				const grant = grants.get(period);
				const behind = (grant?.days ?? 0) + (added[code]?.[period]?.entitled ?? 0);
				if (used > 0 && (grant === undefined || (!unlimited(lookup) && used > behind)))
					return yield* Effect.fail(
						new Refusal({
							message: `${code}: days taken stand on a fact this change removes or moves. Where only its date moved, give the old date as Leave from.`
						})
					);
			}
		}
	}
});

/** What a company's people are entitled under: the company on any day, its work events and the law it follows. */
const companyRead = (read: Reader, companies: readonly Id<'entity'>[], codes: readonly string[]) =>
	queryRows(read, {
		entity: { where: { id: { in: companies } }, fields: ['id', 'settings_code'], limit: 50 },
		entity_change: { where: { entity_id: { in: companies } }, limit: 10000 },
		...lawRead(codes),
		work_event: {
			where: { entity_id: { in: companies } },
			fields: ['id', 'entity_id', 'employment_id', 'catalog_code', 'from', 'to', 'location'],
			limit: 10000
		}
	});
type CompanyRead = Effect.Success<ReturnType<typeof companyRead>>;
/** People synced in one pass of reads and one settle. */
const SYNC_BATCH = 200;

/**
 * Sync: entitlements on a day, from the rows in force and the facts of each person's employment that day. For the
 * people named, or for everyone with a stint (one read); either way in batches, each a read keyed by its people, one
 * of their companies and the settle's one. A company's law and events are read once and kept for its next batches.
 */
export const syncEntitlements = Effect.fn('ledger.syncEntitlements')(function* (
	ctx: Ctx,
	employees?: readonly string[]
) {
	const everyone = idsOf(
		'employee_profile',
		employees ??
			uniqueIds(
				(yield* queryRows(ctx.query, { employment: { fields: ['employee_id'], limit: 10000 } }))
					.employment,
				'employee_id'
			)
	);
	const companies = new Map<string, CompanyRead>();
	let people = 0;
	let boundary: string | undefined;
	for (let at = 0; at < everyone.length; at += SYNC_BATCH) {
		const done = yield* syncPeople(ctx, everyone.slice(at, at + SYNC_BATCH), companies);
		people += done.people;
		if (done.boundary !== undefined && (boundary === undefined || done.boundary < boundary))
			boundary = done.boundary;
	}
	return { people, boundary };
});

const syncPeople = Effect.fnUntraced(function* (
	ctx: Ctx,
	employees: readonly Id<'employee_profile'>[],
	companies: Map<string, CompanyRead>
) {
	const day = String(ctx.today);
	// their stints, balances and the rows HR keyed by hand
	const own = yield* queryRows(ctx.query, {
		...stintsRead(employees),
		employee_balance: {
			where: { employee_id: { in: employees } },
			fields: ['employee_id', 'account'],
			limit: 10000
		},
		ledger_entry: {
			where: { ...MANUAL, balance_id: { is: { employee_id: { in: employees } } } },
			fields: FIELDS,
			limit: 10000
		}
	});
	// a balance row opens with the person's first stint; a pass opens any that is still missing, so nobody is left where
	// every entry is refused for want of one. Its id is minted here: an empty balance needs no read back
	const has = new Set(own.employee_balance.map((row) => String(row.employee_id)));
	const opened = employees
		.filter((id) => !has.has(id))
		.map((employee_id) => ({ id: new_id('employee_balance'), employee_id, account: {} }));
	if (opened.length > 0) yield* ctx.act({ 'employee_balance.create': opened });
	// the companies those stints name: read once, kept for the next batch of the same companies
	const named = own.employment.flatMap((row) =>
		isJsonObject(row.entity_id) ? [row.entity_id] : []
	);
	const ids = idsOf(
		'entity',
		named.map((row) => row.id)
	).toSorted();
	const key = ids.join(',');
	const theirs =
		companies.get(key) ??
		(yield* companyRead(ctx.query, ids, [
			...new Set(named.map((row) => String(row.settings_code)))
		]));
	companies.set(key, theirs);
	const read = {
		...own,
		...theirs,
		employee_balance: [...own.employee_balance, ...opened.map((row) => jsonObject(row))]
	};
	const manual = manualOf(read.ledger_entry ?? []);
	// a stint's law is its entity's jurisdiction as it stands on the day
	const lineage = new Map(
		(read.entity ?? []).map((row) => [String(row.id), String(row.settings_code)])
	);
	const laws = lawsOf(read);
	const lawIn = (entity: unknown, on: string) => laws(lineage.get(String(entity)), on);
	const entitled = (account: string, rows: readonly JsonObject[]) =>
		rows.map((row) => ({ account, code: String(row.code), lookup: objectValue(row.lookup) }));
	const rowsOf = (law: Law | undefined) =>
		law === undefined
			? []
			: [
					...entitled('leave', law.rows.leave_catalog),
					...entitled('claim', law.rows.claim_catalog)
				];
	// a stint no terms row has reached yet (a hire still being written) owes nothing
	const { parts: stints } = stintsOf(read);
	const agreed = Map.groupBy(
		stints.filter((parts) => parts.terms.length > 0),
		(parts) => String(parts.stint.employee_id)
	);
	const workEvents = (read.work_event ?? []).map((row) => ({
		code: String(row.catalog_code),
		entity_id: String(row.entity_id),
		employment_id: row.employment_id == null ? null : String(row.employment_id),
		from: String(row.from),
		to: row.to == null ? null : String(row.to),
		location: row.location ?? null
	}));
	const eventsFor = (contract: JsonObject) =>
		workEvents.filter(
			(event) =>
				event.entity_id === String(contract.entity_id) &&
				(event.employment_id == null || event.employment_id === String(contract.id))
		);
	const chains = Map.groupBy(
		stints.map((parts) => parts.stint),
		(row) => String(row.employee_id)
	);
	const changesOf = Map.groupBy(read.entity_change ?? [], (row) => String(row.entity_id));
	const employerAt = (entity: unknown, on: string) => {
		const company = (read.entity ?? []).find((row) => row.id === entity);
		return company === undefined
			? undefined
			: employerOn(company, changesOf.get(String(company.id)) ?? [], on);
	};
	const plans: Plan[] = [];
	let boundary: string | undefined;
	for (const balance of read.employee_balance ?? []) {
		const own = agreed.get(String(balance.employee_id)) ?? [];
		const now = own.find((parts) => covers(parts.stint.effective_range, day));
		if (now === undefined) continue;
		// the stint covering today, as it stands today
		const contract = employmentOn(now, day);
		const law = lawIn(contract.entity_id, day);
		const rows = rowsOf(law);
		const starts = startsOf(
			now.stint,
			chains.get(String(balance.employee_id)) ?? [],
			lineage,
			now.profile.cumulative_service === true
		);
		const subject = {
			scope: String(law?.code),
			started: starts.service_started_on,
			events: eventsOf(contract)
		};
		const personOn = (held: JsonObject, on: string) =>
			personOf(held, starts, employerAt(held.entity_id, on), eventsFor(held));
		plans.push(
			...entitlementPlans(
				rows,
				personOn(contract, day),
				subject,
				String(balance.id),
				accountsOf(balance.account),
				day,
				// a window that closed settles under the law of its last day and the stint covering it, as it stood then
				({ code }, on) => {
					const then = own.find((parts) => covers(parts.stint.effective_range, on));
					const held = then === undefined ? contract : employmentOn(then, on);
					const row = rowsOf(lawIn(held.entity_id, on)).find((item) => item.code === code);
					return row === undefined ? undefined : { lookup: row.lookup, person: personOn(held, on) };
				},
				manual.get(String(balance.id))
			)
		);
		for (const row of rows) {
			if (row.account !== 'leave' || unlimited(row.lookup)) continue;
			const next = nextWindow(windowOf(row.lookup), day, subject.started);
			if (next !== undefined && (boundary === undefined || next < boundary)) boundary = next;
		}
	}
	yield* settle(ctx, plans);
	return { people: (read.employee_balance ?? []).length, boundary };
});

const YEARS_HELD = 3;
/** Old periods leave the balance through dated movements; the ledger keeps them forever. */
export const retire = Effect.fn('ledger.retire')(function* (ctx: Ctx) {
	const { employee_balance: rows = [] } = yield* queryRows(ctx.query, {
		employee_balance: { fields: ['account', 'revision'], limit: 1000 }
	});
	const today = String(ctx.today);
	const due = rows.flatMap((balance) => {
		const movements = expired(accountsOf(balance.account), today, YEARS_HELD);
		return movements.length === 0 ? [] : [{ balance, movements }];
	});
	for (let at = 0; at < due.length; at += BATCH) {
		const batch = due.slice(at, at + BATCH);
		const acts: Record<string, Json> = {
			'ledger_entry.create': batch.flatMap(({ balance, movements }) =>
				// `REMOVE` only drops the emptied key from the balance: the ledger keeps the movement that emptied it
				movements
					.filter((row) => row.operation !== 'REMOVE')
					.map((row) => jsonObject({ ...row, balance_id: String(balance.id) }))
			),
			'employee_balance.update': batch.map(({ balance, movements }) => ({
				target: { id: String(balance.id), revision: Number(balance.revision) },
				set: jsonObject({ account: apply(accountsOf(balance.account), movements) })
			}))
		};
		yield* ctx.act(acts);
	}
});

/** The leave postings and manual adjustments of these rows in a window that has closed. */
const lateIn = (today: unknown, rows: readonly JsonObject[]) => {
	// a window lasts a year: one that began a year ago or more has closed, whatever day of the year it opens on
	const closed = DateTime.formatIsoDate(
		DateTime.subtract(DateTime.makeUnsafe(String(today)), { years: 1 })
	);
	return rows.filter(
		(row) =>
			(String(row.source).startsWith('leave_catalog_entry:') ||
				String(row.source).startsWith('manual:') ||
				(String(row.source).startsWith('payroll_run:') && row.account === 'leave')) &&
			String(row.period).slice(-10) <= closed
	);
};
/** A leave posting or a manual adjustment in a window that has closed can change what carried since: its people sync again. */
export const syncLate = Effect.fn('ledger.syncLate')(function* (
	ctx: Pick<EffectCtx, 'query' | 'schedule' | 'today'>,
	rows: readonly JsonObject[]
) {
	const late = lateIn(ctx.today, rows);
	if (late.length === 0) return;
	const { employee_balance: balances = [] } = yield* queryRows(ctx.query, {
		employee_balance: {
			where: { id: { in: idsOf('employee_balance', uniqueIds(late, 'balance_id')) } },
			fields: ['employee_id'],
			limit: 1000
		}
	});
	yield* ctx.schedule('ledger', {
		employees: uniqueIds(balances, 'employee_id').map((id) => idOf('employee_profile', id))
	});
});

/**
 * After a write that carried postings (their rows go straight to storage): the same look at what its sources posted,
 * each row read with its person, in one read.
 */
export const syncLatePosted = Effect.fn('ledger.syncLatePosted')(function* (
	ctx: Pick<EffectCtx, 'query' | 'schedule' | 'today'>,
	sources: readonly string[]
) {
	// an approval move runs the effect with no change list: nothing was written
	if (sources.length === 0) return;
	const { ledger_entry: posted } = yield* queryRows(ctx.query, {
		ledger_entry: {
			where: { source: { in: [...sources] } },
			fields: ['source', 'account', 'period', 'balance_id'],
			limit: 10000,
			balance_id: { fields: ['employee_id'] }
		}
	});
	const late = lateIn(ctx.today, posted);
	if (late.length === 0) return;
	yield* ctx.schedule('ledger', {
		employees: idsOf(
			'employee_profile',
			late.flatMap((row) => {
				const person = objectValue(row.balance_id).employee_id;
				return typeof person === 'string' ? [person] : [];
			})
		)
	});
});

/** Who writes the ledger and the balance directly: sync (`payroll_execution`). A record that posts carries its rows in its own write. */
export const writesLedger = (ctx: { readonly policies: readonly string[] }) =>
	ctx.policies.includes('payroll_execution');

/** A sync that failed for good raises a task, so nothing is lost in silence. */
export const raiseFailure = Effect.fn('ledger.raiseFailure')(function* (
	ctx: Ctx,
	label: string,
	reason: string,
	title = 'Ledger sync failed'
) {
	// any one company carries the task: the first page is enough, however many there are
	const { entity } = yield* ctx.query({ entity: { fields: ['id'], limit: 1 } });
	const first = entity.rows[0];
	if (first === undefined) return;
	yield* ctx.act({
		'obligation.create': [
			{
				entity_id: first.id,
				title: `${title}: ${label}. ${reason}`,
				occurrence_key: `ledger-failure:${String(ctx.today)}:${label}`
			}
		]
	});
});
