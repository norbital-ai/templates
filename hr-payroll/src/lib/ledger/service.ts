import { addDays, PlainDate } from '@norbital-ai/std/date';
import { Effect } from 'effect';
import type { CarriedWrites, EffectCtx, Id } from '@norbital-ai/bolt';
import {
	Refusal,
	isJsonObject,
	jsonObject,
	type JsonObject
} from '../payroll_engine/foundation.js';
import { dynamicRead } from '@norbital-ai/bolt/protocol';
import {
	idOf,
	objectValue,
	queryAllRows,
	queryRows,
	type Reader
} from '../payroll_engine/reads.js';
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
import {
	lawOn,
	startOf,
	validateRegistered,
	type Operation
} from '../payroll_engine/registrations.js';
import { chainOf, startsOf, versionOn, type Starts } from '../payroll_engine/contract_change.js';
import { sharesPay } from '../payroll_engine/engine.js';
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
];
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

/**
 * The ledger rows and balance moves that take each source from what it `posted` to what it should have, as a write
 * carries them; `balances` holds each plan's balance as read. Repeating it carries nothing.
 */
export const carry = (
	plans: readonly Plan[],
	posted: readonly JsonObject[],
	balances: readonly JsonObject[]
) => {
	const carried = {
		ledger_entry: { create: [] as LedgerRow[] },
		employee_balance: { update: [] as BalanceMove[] }
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
			target: idOf('employee_balance', String(row.id)),
			set: { account: apply(accountsOf(row.account), movements) },
			observed: Number(row.revision)
		});
	}
	return carried;
};
type LedgerRow = NonNullable<NonNullable<CarriedWrites['ledger_entry']>['create']>[number];
type BalanceMove = {
	readonly target: Id<'employee_balance'>;
	readonly set: { readonly account: Accounts };
	readonly observed: number;
};
const ledgerRow = (balance: string, row: Movement): LedgerRow => ({
	balance_id: idOf('employee_balance', balance),
	operation: row.operation === 'DEDUCT' ? 'DEDUCT' : 'ADD',
	account: row.account,
	code: row.code,
	period: row.period,
	measure: row.measure,
	amount: row.amount,
	...(row.unit === undefined ? {} : { unit: row.unit }),
	effective_on: PlainDate(row.effective_on),
	source: row.source
});

/** Sync writes the difference in batches of balances: one read and one write each. Repeating it writes nothing. */
export const settle = Effect.fn('ledger.settle')(function* (ctx: Ctx, plans: readonly Plan[]) {
	const balances = [...new Set(plans.map((plan) => plan.balance_id))];
	for (let at = 0; at < balances.length; at += BATCH) {
		const chunk = balances.slice(at, at + BATCH);
		const due = plans.filter((plan) => chunk.includes(plan.balance_id));
		const { ledger_entry: posted = [], employee_balance: stored = [] } = yield* queryAllRows(
			ctx.query,
			{
				ledger_entry: {
					where: {
						balance_id: { in: chunk },
						source: { in: [...new Set(due.map((plan) => plan.source))] }
					},
					fields: FIELDS,
					limit: 10000
				},
				employee_balance: {
					where: { id: { in: chunk } },
					fields: ['account', 'revision'],
					limit: BATCH
				}
			}
		);
		const { ledger_entry, employee_balance } = carry(due, posted, stored);
		if (ledger_entry.create.length === 0) continue;
		yield* ctx.act.checked([
			{ callable: 'ledger_entry.create', input: ledger_entry.create.map(jsonObject) },
			{
				callable: 'employee_balance.update',
				input: employee_balance.update.map(({ target, set }) => ({ target, set })),
				observed: Object.fromEntries(
					employee_balance.update.map(({ target, observed }) => [target, observed])
				)
			}
		]);
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
/** What gone records posted, inverted, read in one request with the balances they moved. */
export const undone = Effect.fn('ledger.undone')(function* (
	read: Reader,
	sources: readonly string[]
) {
	if (sources.length === 0) return inverted([], []);
	const { ledger_entry: posted = [], employee_balance: balances = [] } = yield* queryAllRows(read, {
		ledger_entry: { where: { source: { in: [...sources] } }, fields: FIELDS, limit: 10000 },
		employee_balance: {
			where: { entries: { some: { source: { in: [...sources] } } } },
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
			where: { id: { in: uniqueIds(rows, 'balance_id') } },
			fields: ['employee_id', 'account', 'revision'],
			limit: 10000
		}
	});
	const codes = [...new Set(rows.map((row) => String(row.code)))];
	const catalog = {
		where: { code: { in: codes }, settings_id: { is: { status: { eq: 'SEALED' } } } },
		fields: ['settings_id', 'code', 'lookup'],
		limit: 10000
	};
	const found = yield* queryRows(read, {
		employee_contract: {
			where: { employee_id: { in: uniqueIds(balances, 'employee_id') }, status: { eq: 'SEALED' } },
			fields: [
				'employee_id',
				'entity_id',
				'status',
				'effective_range',
				'service_started_on',
				'events',
				'family'
			],
			limit: 10000
		},
		'employee_contract.entity_id': { fields: ['settings_code'] },
		'employee_contract.employee_id': { fields: ['cumulative_service'] },
		jurisdiction_settings: {
			where: { status: { eq: 'SEALED' } },
			fields: ['code', 'effective_range'],
			limit: 10000
		},
		leave_catalog: catalog,
		claim_catalog: catalog
	});
	const { chain, lineage, cumulative } = chainOf(found.employee_contract ?? []);
	const balance = new Map(balances.map((row) => [String(row.id), row]));
	const keys: { readonly period: PeriodKey; readonly source: string }[] = [];
	const moves = new Map<string, Movement[]>();
	for (const row of rows) {
		const date = String(row.effective_on);
		const held = balance.get(String(row.balance_id));
		const contract = chain.find((version) => {
			const { from, to } = objectValue(version.effective_range);
			return (
				version.employee_id === held?.employee_id &&
				String(from) <= date &&
				(typeof to !== 'string' || date <= to)
			);
		});
		if (held === undefined || contract === undefined)
			return yield* refuse(`No sealed contract of this person covers ${date}.`);
		const version = versionOn(
			found.jurisdiction_settings ?? [],
			lineage.get(String(contract.entity_id)),
			date
		);
		const target = (found[row.account === 'claim' ? 'claim_catalog' : 'leave_catalog'] ?? []).find(
			(item) => item.code === row.code && item.settings_id === version?.id
		);
		if (version === undefined || target === undefined)
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
				scope: String(version.code),
				started: startsOf(contract, chain, lineage, cumulative.has(String(contract.employee_id)))
					.service_started_on,
				events: eventsOf(contract)
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
					target: idOf('employee_balance', id),
					set: { account: apply(accountsOf(held?.account), movements) },
					observed: Number(held?.revision)
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
const signOf = (entry: JsonObject) => (entry.reverses != null ? -1 : 1);

/**
 * What a leave entry should have posted: half a day at a time, in the window each day falls in. A row that counts in
 * hours (`unit: 'HOUR'`) takes half the contract's normal day (`dayHours`) for each half day.
 */
export const leaveWanted = (
	entry: JsonObject,
	row: LeaveRow,
	rowOf: (code: string) => LeaveRow | undefined,
	subject: Subject,
	dayHours: number,
	original?: JsonObject
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
			amount: signOf(entry) * (hours ? dayHours / 2 : 0.5),
			unit: hours ? 'HOUR' : 'DAY',
			effective_on: date
		};
	});
};

/**
 * What a claim should have posted: its amount against the year it was incurred. A row with a limit pays what remains of
 * it, so `left` is what the window has without this claim, and the excess stays on the entry for HR to see. A reversal
 * gives back no more than its original drew.
 */
export const claimWanted = (
	entry: JsonObject,
	row: LeaveRow,
	subject: Subject,
	original?: JsonObject,
	left?: (period: string) => number
): readonly Wanted[] => {
	const date = String((original ?? entry).incurred_on);
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
			amount: signOf(entry) * payable,
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

/** An adhoc row posts only what it declares: a statutory adjustment moves the scheme it corrects. */
export const adhocWanted = (
	entry: JsonObject,
	row: LeaveRow,
	subject: Subject & { readonly taxYearStart: number },
	original?: JsonObject
): readonly Wanted[] => {
	const date = String((original ?? entry).incurred_on);
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
		amount: signOf(entry) * (target.operation === 'DEDUCT' ? -1 : 1) * Number(entry.quantity ?? 0),
		unit: 'MONEY',
		effective_on: date
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
			// a fact a new version dropped: its period should stand at nothing
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
		const before = String(addDays(from, -1));
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
const CATALOG = { leave: 'leave_catalog', claim: 'claim_catalog' } as const;
const rowOfCatalog = (row: JsonObject): LeaveRow => ({
	code: String(row.code),
	lookup: objectValue(row.lookup)
});
/**
 * The facts a leave row can read about a person, from their contract and their employer's sealed profile. Its rule reads
 * the starts worked out from the stints as the contract's `service_started_on` and `employment_started_on`.
 */
const personOf = (
	contract: JsonObject,
	starts: Starts,
	employer?: JsonObject,
	workEvents: readonly JsonObject[] = []
): LeavePerson => {
	const payroll = objectValue(contract.payroll);
	const extension = objectValue(contract.employee_extension_data);
	const facts = Object.fromEntries(
		Object.entries(extension).filter(([key]) => key !== 'statutory')
	);
	const employerExtension = objectValue(employer?.entity_extension_data ?? {});
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
const CATALOG_OF = {
	leave_catalog_entry: 'leave_catalog',
	claim_catalog_entry: 'claim_catalog',
	adhoc_catalog_entry: 'adhoc_catalog'
} as const;
/** Every row of the people who hold these contracts: a relation, so it needs no read of its own. */
const sameEmployee = (ids: readonly string[]) => ({
	employee_id: { is: { employee_contract: { some: { id: { in: ids } } } } }
});
/**
 * What a batch of entries reads, all in one request: the people's contracts, entries of this kind and balances, what
 * those entries posted, and the catalog rows and law the entries were made under. Every check and the posting read it.
 */
export type Known = {
	readonly contract: ReadonlyMap<string, JsonObject>;
	/** The lineage (`settings_code`) of each entity the people's contracts name, for their service start. */
	readonly lineage: ReadonlyMap<string, string>;
	/** The people whose service counts every stint (`cumulative_service`). */
	readonly cumulative: ReadonlySet<string>;
	readonly catalog: ReadonlyMap<string, JsonObject>;
	readonly setting: ReadonlyMap<string, JsonObject>;
	readonly rows: ReadonlyMap<string, readonly JsonObject[]>;
	readonly balance: ReadonlyMap<string, JsonObject>;
	readonly entries: readonly JsonObject[];
	/** Each stored entry's catalog code, whichever version of the law it was made under. */
	readonly codes: ReadonlyMap<string, string>;
	readonly posted: readonly JsonObject[];
	readonly runs: readonly JsonObject[];
	readonly captures: ReadonlyMap<string, readonly JsonObject[]>;
	/** Entity payment schedules, for the closed-period check. */
	/** Each pay group's schedule, and each contract's pay group. */
	readonly schedule: ReadonlyMap<string, JsonObject>;
	readonly payGroup: ReadonlyMap<string, string>;
};
const known = Effect.fn('ledger.known')(function* (
	read: Reader,
	model: Entries,
	entries: readonly JsonObject[]
) {
	const catalog = CATALOG_OF[model];
	const people = sameEmployee(uniqueIds(entries, 'employment_id'));
	const entered = { [catalog]: { some: { id: { in: uniqueIds(entries, 'catalog_id') } } } };
	const found = yield* queryAllRows(read, {
		employee_contract: {
			where: people,
			fields: [
				'employee_id',
				'entity_id',
				'pay_group_id',
				'status',
				'effective_range',
				'service_started_on',
				'terms',
				'events',
				'family',
				'employee_extension_data'
			],
			limit: 10000
		},
		'employee_contract.entity_id': { fields: ['settings_code'] },
		'employee_contract.employee_id': { fields: ['cumulative_service'] },
		[catalog]: {
			where: { settings_id: { is: entered } },
			fields: [
				'code',
				'lookup',
				'settings_id',
				...(model === LEAVE ? (['paid_share', 'payout'] as const) : [])
			],
			limit: 10000
		},
		jurisdiction_settings: {
			where: entered,
			fields: ['code', 'tax_year_start_month', 'lookup', 'ledger'],
			limit: 100
		},
		employee_balance: {
			where: people,
			fields: ['employee_id', 'account', 'revision'],
			limit: 10000
		},
		[model]: { where: { employment_id: { is: people } }, limit: 10000 },
		[`${model}.catalog_id`]: { fields: ['code'] },
		ledger_entry: {
			where: { balance_id: { is: people }, source: { like: `${model}:%` } },
			fields: FIELDS,
			limit: 10000
		},
		...(model === 'adhoc_catalog_entry' || model === LEAVE
			? {
					payroll_run: {
						where: { entity_id: { in: uniqueIds(entries, 'entity_id') } },
						fields: ['entity_id', 'pay_group_id', 'period', 'salary_coverage', 'kind'],
						limit: 10000
					}
				}
			: {}),
		...(model === LEAVE
			? {
					pay_group: {
						where: { entity_id: { in: uniqueIds(entries, 'entity_id') } },
						fields: ['payment_schedule'],
						limit: 1000
					}
				}
			: {})
	});
	const familyRows = found[catalog] ?? [];
	const stored = found[model] ?? [];
	// every slot of the person's entries, so a stored reversal's freed days are known too
	const captures =
		model === LEAVE && stored.length > 0
			? ((yield* queryAllRows(read, {
					leave_catalog_entry_day: {
						where: { leave_entry_id: { in: stored.map((row) => String(row.id)) } },
						fields: ['leave_entry_id', 'incurred_on', 'part', 'payroll_run_id'],
						limit: 10000
					}
				})).leave_catalog_entry_day ?? [])
			: [];
	const { chain, lineage, cumulative } = chainOf(found.employee_contract ?? []);
	return {
		contract: new Map(chain.map((row) => [String(row.id), row])),
		lineage,
		cumulative,
		catalog: new Map(familyRows.map((row) => [String(row.id), row])),
		setting: new Map((found.jurisdiction_settings ?? []).map((row) => [String(row.id), row])),
		rows: Map.groupBy(familyRows, (row) => String(row.settings_id)),
		balance: new Map((found.employee_balance ?? []).map((row) => [String(row.employee_id), row])),
		entries: stored.map((row) =>
			jsonObject({
				...row,
				catalog_id: objectValue(row.catalog_id).id ?? row.catalog_id,
				reverses: isJsonObject(row.reverses) ? (row.reverses.id ?? row.reverses) : row.reverses
			})
		),
		codes: new Map(stored.map((row) => [String(row.id), String(objectValue(row.catalog_id).code)])),
		posted: found.ledger_entry ?? [],
		runs: found.payroll_run ?? [],
		schedule: new Map(
			(found.pay_group ?? []).map((row) => [String(row.id), objectValue(row.payment_schedule)])
		),
		payGroup: new Map(
			(found.employee_contract ?? []).map((row) => [String(row.id), String(row.pay_group_id)])
		),
		captures: Map.groupBy(captures, (row) => String(row.leave_entry_id))
	} satisfies Known;
});
/**
 * A batch of entries' one read (`Known`), and with an `operation` its registered rules' validation beside it: both go
 * out together, one crossing.
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

/** What each entry should post, from what its batch read. A record that is gone is not here: its delete inverts it. */
const entryPlans = (
	known: Known,
	family: Family | 'adhoc',
	model: string,
	entries: readonly JsonObject[]
): readonly Plan[] => {
	if (entries.length === 0) return [];
	const original = new Map(known.entries.map((row) => [String(row.id), row]));
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
		const contract = known.contract.get(String(entry.employment_id));
		const catalog = known.catalog.get(String(entry.catalog_id));
		const balance = known.balance.get(String(contract?.employee_id));
		if (contract === undefined || catalog === undefined || balance === undefined) return [];
		const settings = known.setting.get(String(catalog.settings_id));
		const subject = {
			scope: String(settings?.code),
			started: startsOf(
				contract,
				[...known.contract.values()],
				known.lineage,
				known.cumulative.has(String(contract.employee_id))
			).service_started_on,
			events: eventsOf(contract),
			taxYearStart: Number(settings?.tax_year_start_month ?? 1)
		};
		const row = rowOfCatalog(catalog);
		const rowOf = (code: string) => {
			const found = known.rows.get(String(catalog.settings_id))?.find((item) => item.code === code);
			return found === undefined ? undefined : rowOfCatalog(found);
		};
		const first = original.get(String(entry.reverses));
		// the child slots are the truth: a stored entry carries them in `captures`, a batch's own entry on `days`
		const withSlots = (row: JsonObject) =>
			family === 'leave'
				? jsonObject({
						...row,
						// stored children and the row's own days can name the same slot: a slot counts once
						days: [
							...new Map(
								[
									...(known.captures.get(String(row.id)) ?? []),
									...(Array.isArray(row.days) ? row.days : [])
								]
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
			if (entry.reverses != null)
				return first === undefined
					? Number(entry.quantity ?? 0)
					: Math.abs(drew(`${model}:${String(entry.reverses)}`));
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
						Number(objectValue(contract.terms).normal_hours_per_day ?? 0),
						first
					)
				: family === 'claim'
					? claimWanted(entry, row, subject, first, left)
					: adhocWanted(
							entry,
							row,
							{ ...subject, scope: totalsScope(settings ?? {}, entry.entity_id) },
							first
						);
		if (family === 'claim')
			for (const item of wanted) {
				const key = `${String(balance.id)}/${row.code}/${item.period}`;
				inBatch.set(key, (inBatch.get(key) ?? 0) + item.amount - drew(source));
			}
		return [{ source: `${model}:${String(entry.id)}`, balance_id: String(balance.id), wanted }];
	});
};

const UNOPENED =
	"This person's balance is not open yet. It opens when the ledger sync after their contract finishes; try again then.";

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
		const contract = known.contract.get(String(entry.employment_id));
		return contract !== undefined && !known.balance.has(String(contract.employee_id));
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

/** What runs post from their payslips: those a create makes (`payslips`), else the stored ones. */
export const runPostings = Effect.fn('ledger.runPostings')(function* (
	read: Reader,
	runs: readonly {
		readonly id: string;
		readonly pay_date: string;
		readonly payslips?: readonly JsonObject[];
	}[]
) {
	const made = runs.every((run) => run.payslips !== undefined);
	const slips = made
		? runs.flatMap((run) =>
				(run.payslips ?? []).map((slip) => jsonObject({ ...slip, payroll_run_id: run.id }))
			)
		: ((yield* queryRows(read, {
				payslip: {
					where: { payroll_run_id: { in: runs.map((run) => run.id) } },
					fields: [
						'payroll_run_id',
						'employee_id',
						'employment_id',
						'entity_id',
						'settings_id',
						'breakdown'
					],
					limit: 10000
				}
			})).payslip ?? []);
	const {
		jurisdiction_settings: settings = [],
		subtotal: subtotals = [],
		statutory_contribution_catalog: statutory = [],
		leave_catalog: leaves = [],
		employee_contract: contracts = [],
		employee_balance: balances = [],
		ledger_entry: posted = []
	} = yield* queryAllRows(read, {
		jurisdiction_settings: {
			where: { id: { in: uniqueIds(slips, 'settings_id') } },
			fields: ['code', 'tax_year_start_month', 'lookup', 'ledger'],
			limit: 100
		},
		subtotal: {
			where: { settings_id: { in: uniqueIds(slips, 'settings_id') } },
			fields: ['settings_id', 'code', 'balance_window'],
			limit: 10000
		},
		statutory_contribution_catalog: {
			where: { settings_id: { in: uniqueIds(slips, 'settings_id') } },
			fields: ['settings_id', 'code', 'balance_window'],
			limit: 10000
		},
		leave_catalog: {
			where: { settings_id: { in: uniqueIds(slips, 'settings_id') } },
			fields: ['settings_id', 'code'],
			limit: 10000
		},
		employee_contract: {
			where: { id: { in: uniqueIds(slips, 'employment_id') } },
			fields: ['effective_range'],
			limit: 10000
		},
		employee_balance: {
			where: { employee_id: { in: uniqueIds(slips, 'employee_id') } },
			fields: ['employee_id', 'account', 'revision'],
			limit: 10000
		},
		// a run just made has posted nothing
		...(made
			? {}
			: {
					ledger_entry: {
						where: { source: { in: runs.map((run) => `payroll_run:${run.id}`) } },
						fields: FIELDS,
						limit: 10000
					}
				})
	});
	const payDate = new Map(runs.map((run) => [run.id, run.pay_date]));
	const setting = new Map(settings.map((row) => [String(row.id), row]));
	const contract = new Map(contracts.map((row) => [String(row.id), row]));
	const balance = new Map(balances.map((row) => [String(row.employee_id), String(row.id)]));
	// the catalog rows own the posting window: a monthly checkpoint or scheme posts to the month as well as the year
	const monthly = new Map<string, string[]>();
	for (const row of subtotals)
		if (row.balance_window === 'MONTH') {
			const id = String(row.settings_id);
			monthly.set(id, [...(monthly.get(id) ?? []), String(row.code)]);
		}
	for (const row of statutory)
		if (row.balance_window === 'MONTH') {
			const id = String(row.settings_id);
			monthly.set(id, [
				...(monthly.get(id) ?? []),
				`${String(row.code)}.employee`,
				`${String(row.code)}.employer`
			]);
		}
	// the ledger write boundary: a payslip may only post a code its sealed version declares
	const known = new Map<string, Set<string>>();
	for (const row of [...subtotals, ...statutory]) {
		const id = String(row.settings_id);
		known.set(id, (known.get(id) ?? new Set()).add(String(row.code)));
	}
	const leaveCodes = new Set(leaves.map((row) => `${String(row.settings_id)}/${String(row.code)}`));
	for (const slip of slips) {
		const codes = known.get(String(slip.settings_id)) ?? new Set<string>();
		for (const key of ['checkpoints', 'statutory', 'time_off']) {
			const rows = objectValue(slip.breakdown)[key];
			for (const row of Array.isArray(rows) ? rows : [])
				if (
					isJsonObject(row) &&
					!(key === 'time_off'
						? leaveCodes.has(`${String(slip.settings_id)}/${String(row.code)}`)
						: codes.has(String(row.code)))
				)
					return yield* Effect.fail(
						new Refusal({ message: `${String(row.code)}: not a code of this sealed version.` })
					);
		}
	}
	// a payslip with no balance row would be paid with nothing on the ledger
	if (slips.some((slip) => !balance.has(String(slip.employee_id))))
		return yield* Effect.fail(new Refusal({ message: UNOPENED }));
	const plans = slips.flatMap((slip) => {
		const balance_id = String(balance.get(String(slip.employee_id)));
		const run = String(slip.payroll_run_id);
		const own = setting.get(String(slip.settings_id));
		const employment = contract.get(String(slip.employment_id));
		if (own === undefined || employment === undefined) return [];
		const byMonth = monthly.get(String(slip.settings_id)) ?? [];
		return [
			{
				source: `payroll_run:${run}`,
				balance_id,
				wanted: payslipWanted(objectValue(slip.breakdown), String(payDate.get(run)), {
					scope: totalsScope(own, slip.entity_id),
					// a payslip posts to calendar windows, which no service start moves
					started: String(payDate.get(run)),
					events: [],
					taxYearStart: Number(own.tax_year_start_month ?? 1),
					byMonth
				})
			}
		];
	});
	return carry(plans, posted, balances);
});

const LEAVE = 'leave_catalog_entry';
const sourceOf = (row: JsonObject) => `${LEAVE}:${String(row.id)}`;

/**
 * The check before a leave entry commits: each window it draws on has the days, from what its batch read. The balance
 * does not show an entry held for approval, so a held one counts here. Reversals take nothing, and are not checked.
 */
export const assertLeft = Effect.fn('ledger.assertLeft')(function* (
	known: Known,
	entries: readonly JsonObject[],
	today: string,
	replaced: readonly JsonObject[] = []
) {
	if (entries.every((row) => row.reverses != null)) return;
	const taking = entries.filter((row) => row.reverses == null && row.encashment !== true);
	const ids = uniqueIds(entries, 'employment_id');
	const held = known.entries;
	const person = new Map([...known.contract].map(([id, row]) => [id, String(row.employee_id)]));
	// a stored entry's slots are its captured children; an entry in this batch carries them on `days`
	const slots = (row: JsonObject) => [
		...new Set(
			[...(known.captures.get(String(row.id)) ?? []), ...(Array.isArray(row.days) ? row.days : [])]
				.filter(isJsonObject)
				.map(
					(day) =>
						`${person.get(String(row.employment_id))}/${String(day.date ?? day.incurred_on)}/${String(day.part)}`
				)
		)
	];
	// a reversal frees exactly the slots its child rows name on the original
	const freed = new Map<string, Set<string>>();
	for (const row of held) {
		if (typeof row.reverses !== 'string') continue;
		const set = freed.get(row.reverses) ?? new Set<string>();
		for (const slot of slots(row)) set.add(slot);
		freed.set(row.reverses, set);
	}
	const gone = new Set(replaced.map((row) => String(row.id)));
	const taken = new Set(
		held
			.filter((row) => row.reverses == null && row.encashment !== true && !gone.has(String(row.id)))
			.flatMap((row) => slots(row).filter((slot) => freed.get(String(row.id))?.has(slot) !== true))
	);
	for (const slot of taking.flatMap(slots)) {
		if (taken.has(slot))
			return yield* Effect.fail(
				new Refusal({ message: `Leave already covers ${slot.split('/')[1]}.` })
			);
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
	if (plans.length === 0) return;
	const limited = new Map<string, boolean>();
	const opened = new Set<string>();
	for (const rows of known.rows.values())
		for (const row of rows) {
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
		if (Number((remaining - amount).toFixed(8)) < 0)
			return yield* Effect.fail(new Refusal({ message: `${row.code}: insufficient balance.` }));
	}
});

/**
 * An entry on a row whose `paid_share` is set is dated in the period that will pay it. A period already run is closed: the correction is a
 * reversal entry dated in the next period to run. This is the template's paid-run lock, never jurisdiction law.
 */
export const assertOpenPeriod = Effect.fn('ledger.assertOpenPeriod')(function* (
	known: Known,
	entries: readonly JsonObject[]
) {
	for (const entry of entries) {
		if (entry.reverses != null) continue;
		const catalog = known.catalog.get(String(entry.catalog_id));
		if (catalog === undefined || !sharesPay(catalog)) continue;
		// the person's own pay group: its runs close its periods, on its schedule
		const group = known.payGroup.get(String(entry.employment_id)) ?? '';
		const ran = new Set(
			known.runs
				.filter((run) => String(run.pay_group_id) === group && run.kind !== 'OFF_CYCLE')
				.map((run) => String(run.period))
		);
		if (ran.size === 0) continue;
		const schedule = known.schedule.get(group) ?? {};
		const days = (Array.isArray(entry.days) ? entry.days : [])
			.filter(isJsonObject)
			.filter((day) => day.payroll_run_id == null);
		const closed = days.find((day) => ran.has(payPeriodOf(String(day.date), schedule)));
		if (closed !== undefined)
			return yield* Effect.fail(
				new Refusal({
					message: `${String(closed.date)} is in a period that has already run. Date this entry in the next period to run, and that run takes it.`
				})
			);
	}
});

const sizeOf = (model: Entries, entry: JsonObject) =>
	model === LEAVE
		? (Array.isArray(entry.days) ? entry.days : []).length
		: Math.abs(Number(entry.quantity ?? 0));

/** A cash-out pays its row's `payout`: a row that declares none has nothing a run could pay for the days drawn. */
export const assertCashable = Effect.fn('ledger.assertCashable')(function* (
	known: Known,
	entries: readonly JsonObject[]
) {
	const bare = entries.find((entry) => {
		const payout = known.catalog.get(String(entry.catalog_id))?.payout;
		return entry.encashment === true && (typeof payout !== 'string' || payout.trim() === '');
	});
	if (bare !== undefined)
		return yield* Effect.fail(
			new Refusal({
				message: `${String(known.catalog.get(String(bare.catalog_id))?.code ?? 'This leave')} has no payout, so its days cannot be cashed out. Take them as leave, or give the row a payout.`
			})
		);
});

/** A reversal undoes one sealed entry of the same person and catalog item, once, for no more than it held. */
export const assertReversals = Effect.fn('ledger.assertReversals')(function* (
	known: Known,
	model: Entries,
	entries: readonly JsonObject[]
) {
	const reversals = entries.filter((entry) => typeof entry.reverses === 'string');
	if (reversals.length === 0) return;
	const person = (contract: unknown) => known.contract.get(String(contract))?.employee_id;
	const original = new Map(known.entries.map((row) => [String(row.id), row]));
	const leaveSlots = (entry: JsonObject) =>
		new Set(
			(Array.isArray(entry.days) ? entry.days : []).flatMap((day) =>
				isJsonObject(day) ? [`${String(day.date)}:${String(day.part)}`] : []
			)
		);
	const fits = (entry: JsonObject, first: JsonObject | undefined) => {
		if (
			first === undefined ||
			first.reverses != null ||
			person(entry.employment_id) !== person(first.employment_id) ||
			known.catalog.get(String(entry.catalog_id))?.code !== known.codes.get(String(first.id))
		)
			return false;
		if (model !== LEAVE)
			return first.payroll_run_id != null && sizeOf(model, entry) <= sizeOf(model, first);
		// a cash-out is undone as a cash-out: days that came back without their money would be paid twice. (The other
		// way round is the take-back of leave taken past what was earned: a cash-out that reverses ordinary leave.)
		if (first.encashment === true && entry.encashment !== true) return false;
		// only a slot a run has priced is reversible; an unpriced one is corrected by deletion
		const original = new Set(
			(known.captures.get(String(first.id)) ?? [])
				.filter((row) => row.payroll_run_id != null)
				.map((row) => `${String(row.incurred_on)}:${String(row.part)}`)
		);
		if (original.size === 0) return false;
		const days = leaveSlots(entry);
		if (days.size !== (Array.isArray(entry.days) ? entry.days.length : 0)) return false;
		for (const slot of days) if (!original.has(slot)) return false;
		return true;
	};
	if (!reversals.every((entry) => fits(entry, original.get(String(entry.reverses)))))
		return yield* Effect.fail(
			new Refusal({
				message:
					'A reversal undoes a sealed entry of the same person and catalog item, for no more than it held, and a cash-out is reversed as a cash-out. An entry no run has sealed is deleted instead.'
			})
		);
});

/**
 * A statutory adjustment corrects a month a run has closed. Dated in an open month, that month's own row counts it as
 * already paid and charges that much less, so nothing would move.
 */
export const assertAdjustmentsClosed = Effect.fn('ledger.assertAdjustmentsClosed')(function* (
	known: Known,
	entries: readonly JsonObject[]
) {
	const dated = entries.filter((entry) => typeof entry.reverses !== 'string');
	if (dated.length === 0) return;
	const statutory = new Set(
		[...known.catalog.values()]
			.filter((row) => {
				const { accounts } = objectValue(row.lookup);
				return (
					Array.isArray(accounts) &&
					accounts.some((item) => objectValue(item).account === 'statutory')
				);
			})
			.map((row) => String(row.id))
	);
	const closed = new Set(
		known.runs.map(
			(run) =>
				`${String(run.entity_id)}/${String(objectValue(run.salary_coverage).from).slice(0, 7)}`
		)
	);
	const open = dated.some(
		(entry) =>
			statutory.has(String(entry.catalog_id)) &&
			!closed.has(`${String(entry.entity_id)}/${String(entry.incurred_on).slice(0, 7)}`)
	);
	if (open)
		return yield* Effect.fail(
			new Refusal({
				message:
					'A statutory adjustment corrects a month a run has closed. Date it in the month it corrects.'
			})
		);
});

/** The check before a contract seals: a fact it drops must not leave days taken under it with nothing behind them. */
export const assertFactsHold = Effect.fn('ledger.assertFactsHold')(function* (
	read: Reader,
	contracts: readonly JsonObject[]
) {
	const sealing = contracts.filter((row) => row.status === 'SEALED');
	if (sealing.length === 0) return;
	// each contract answers to the law in force on its first day
	const law = yield* lawOn(
		read,
		sealing.map((row) => ({ entity: row.entity_id, on: startOf(row) }))
	);
	const settingsIds = [
		...new Set(law.flatMap((version) => (version === undefined ? [] : [String(version.id)])))
	];
	const {
		leave_catalog: rows = [],
		employee_balance: balances = [],
		ledger_entry: manualRows = [],
		entity_profile_version: employerRows = [],
		employee_contract: stored = []
	} = yield* queryRows(read, {
		leave_catalog: {
			where: { settings_id: { in: settingsIds } },
			fields: ['settings_id', 'code', 'lookup'],
			limit: 10000
		},
		employee_contract: {
			where: { employee_id: { in: uniqueIds(sealing, 'employee_id') }, status: { eq: 'SEALED' } },
			fields: ['employee_id', 'status', 'effective_range', 'entity_id'],
			limit: 10000
		},
		'employee_contract.entity_id': { fields: ['settings_code'] },
		'employee_contract.employee_id': { fields: ['cumulative_service'] },
		employee_balance: {
			where: { employee_id: { in: uniqueIds(sealing, 'employee_id') } },
			fields: ['employee_id', 'account'],
			limit: 10000
		},
		ledger_entry: {
			where: {
				...MANUAL,
				balance_id: { is: { employee_id: { in: uniqueIds(sealing, 'employee_id') } } }
			},
			fields: FIELDS,
			limit: 10000
		},
		entity_profile_version: {
			where: { entity_id: { in: uniqueIds(sealing, 'entity_id') }, status: { eq: 'SEALED' } },
			fields: ['entity_id', 'entity_extension_data'],
			limit: 10000
		}
	});
	const manual = manualOf(manualRows);
	const employers = new Map(employerRows.map((row) => [String(row.entity_id), row]));
	const rowsOf = Map.groupBy(rows, (row) => String(row.settings_id));
	const balance = new Map(balances.map((row) => [String(row.employee_id), row]));
	const held = chainOf(stored);
	const lineage = new Map([
		...held.lineage,
		...sealing.flatMap((row, index) => {
			const code = law[index]?.code;
			return typeof code === 'string' ? [[String(row.entity_id), code] as const] : [];
		})
	]);
	for (const [index, contract] of sealing.entries()) {
		const settingsId = String(law[index]?.id);
		const starts = startsOf(
			contract,
			held.chain,
			lineage,
			held.cumulative.has(String(contract.employee_id))
		);
		const subject = {
			scope: String(law[index]?.code),
			started: starts.service_started_on,
			events: eventsOf(contract)
		};
		const own = balance.get(String(contract.employee_id));
		const leave = accountsOf(own?.account).leave ?? {};
		const added = manual.get(String(own?.id))?.leave ?? {};
		for (const row of rowsOf.get(settingsId) ?? []) {
			const { code, lookup } = rowOfCatalog(row);
			const grants = grantsOf(
				lookup,
				subject,
				personOf(contract, starts, employers.get(String(contract.entity_id)))
			);
			for (const period of eventPeriods(leave[code], subject.scope)) {
				const used = leave[code]?.[period]?.used ?? 0;
				const grant = grants.get(period);
				const behind = (grant?.days ?? 0) + (added[code]?.[period]?.entitled ?? 0);
				if (used > 0 && (grant === undefined || (!unlimited(lookup) && used > behind)))
					return yield* Effect.fail(
						new Refusal({
							message: `${code}: days taken stand on a fact this version removes or moves. Where only its date moved, give the old date as Leave from.`
						})
					);
			}
		}
	}
});

/** Sync: everyone's entitlements on a day, from the rows in force and the facts on their contracts. */
export const syncEntitlements = Effect.fn('ledger.syncEntitlements')(function* (
	ctx: Ctx,
	employees?: readonly string[]
) {
	if (employees !== undefined) {
		const { employee_balance: held = [] } = yield* queryAllRows(ctx.query, {
			employee_balance: {
				where: { employee_id: { in: [...employees] } },
				fields: ['employee_id'],
				limit: 1000
			}
		});
		const has = new Set(held.map((row) => String(row.employee_id)));
		const missing = [...new Set(employees)].filter((id) => !has.has(id));
		if (missing.length > 0)
			yield* ctx.act.checked([
				{
					callable: 'employee_balance.create',
					input: missing.map((employee_id) => ({ employee_id, account: {} }))
				}
			]);
	}
	const day = String(ctx.today);
	const read = yield* queryAllRows(ctx.query, {
		employee_contract: {
			where: { status: { eq: 'SEALED' } },
			fields: [
				'employee_id',
				'status',
				'effective_range',
				'service_started_on',
				'entity_id',
				'engagement',
				'payroll',
				'terms',
				'events',
				'family',
				'employee_extension_data'
			],
			limit: 1000
		},
		entity: { fields: ['id', 'settings_code'], limit: 1000 },
		// the people whose service counts every stint
		employee_profile: {
			where: { cumulative_service: { eq: true } },
			fields: ['id'],
			limit: 1000
		},
		entity_profile_version: {
			where: { status: { eq: 'SEALED' } },
			fields: ['entity_id', 'effective_range', 'entity_extension_data'],
			limit: 1000
		},
		jurisdiction_settings: {
			where: { status: { eq: 'SEALED' } },
			fields: ['code', 'effective_range'],
			limit: 1000
		},
		work_event_catalog: { fields: ['id', 'code'], limit: 10000 },
		work_event: {
			fields: ['id', 'entity_id', 'employment_id', 'catalog_id', 'from', 'to', 'location'],
			limit: 10000
		},
		employee_balance: {
			...(employees === undefined ? {} : { where: { employee_id: { in: [...employees] } } }),
			fields: ['employee_id', 'account'],
			limit: 1000
		},
		ledger_entry: { where: MANUAL, fields: FIELDS, limit: 1000 }
	});
	const manual = manualOf(read.ledger_entry ?? []);
	const covers = (range: unknown, on = day) => {
		const { from, to } = objectValue(range);
		return String(from) <= on && (typeof to !== 'string' || on <= to);
	};
	const versions = read.jurisdiction_settings ?? [];
	// a contract's law is its entity's lineage in force on the day
	const lineage = new Map(
		(read.entity ?? []).map((row) => [String(row.id), String(row.settings_code)])
	);
	const lawIn = (entity: unknown, on: string) =>
		versionOn(versions, lineage.get(String(entity)), on);
	// the law in force, and the version before it, which a window that just closed ends under
	// ponytail: a window that closed under an older version stays as last synced; read further back if syncs lag that far
	const ids = [
		...new Set(
			[...new Set(lineage.values())].flatMap((code) => {
				const row = versionOn(versions, code, day);
				if (row === undefined) return [];
				const from = String(objectValue(row.effective_range).from);
				const before = versionOn(versions, code, String(addDays(from, -1)));
				return [String(row.id), ...(before === undefined ? [] : [String(before.id)])];
			})
		)
	];
	const { leave_catalog: leave = [], claim_catalog: claims = [] } = yield* queryAllRows(ctx.query, {
		leave_catalog: {
			where: { settings_id: { in: ids } },
			fields: ['settings_id', 'code', 'lookup'],
			limit: 1000
		},
		claim_catalog: {
			where: { settings_id: { in: ids } },
			fields: ['settings_id', 'code', 'lookup'],
			limit: 1000
		}
	});
	const entitled = (account: string, rows: readonly JsonObject[]) =>
		rows.map((row) => ({
			settings: String(row.settings_id),
			account,
			code: String(row.code),
			lookup: objectValue(row.lookup)
		}));
	const rowsOf = Map.groupBy(
		[...entitled('leave', leave), ...entitled('claim', claims)],
		(row) => row.settings
	);
	const current = new Map(
		(read.employee_contract ?? [])
			.filter((row) => covers(row.effective_range))
			.toSorted((left, right) =>
				String(objectValue(left.effective_range).from).localeCompare(
					String(objectValue(right.effective_range).from)
				)
			)
			.map((row) => [String(row.employee_id), row])
	);
	const workCatalog = new Map((read.work_event_catalog ?? []).map((row) => [String(row.id), row]));
	const workEvents = (read.work_event ?? []).flatMap((row) => {
		const catalog = workCatalog.get(String(row.catalog_id));
		if (catalog === undefined) return [];
		return [
			{
				code: String(catalog.code),
				entity_id: String(row.entity_id),
				employment_id: row.employment_id == null ? null : String(row.employment_id),
				from: String(row.from),
				to: row.to == null ? null : String(row.to),
				location: row.location ?? null
			}
		];
	});
	const eventsFor = (contract: JsonObject) =>
		workEvents.filter(
			(event) =>
				event.entity_id === String(contract.entity_id) &&
				(event.employment_id == null || event.employment_id === String(contract.id))
		);
	const chains = Map.groupBy(read.employee_contract ?? [], (row) => String(row.employee_id));
	const cumulative = new Set((read.employee_profile ?? []).map((row) => String(row.id)));
	const employerOn = (entity: unknown, on: string) =>
		(read.entity_profile_version ?? []).find(
			(row) => row.entity_id === entity && covers(row.effective_range, on)
		);
	const plans: Plan[] = [];
	let boundary: string | undefined;
	for (const balance of read.employee_balance ?? []) {
		const contract = current.get(String(balance.employee_id));
		if (contract === undefined) continue;
		const version = lawIn(contract.entity_id, day);
		const rows = rowsOf.get(String(version?.id)) ?? [];
		const chain = chains.get(String(contract.employee_id)) ?? [];
		const starts = startsOf(contract, chain, lineage, cumulative.has(String(contract.employee_id)));
		const subject = {
			scope: String(version?.code),
			started: starts.service_started_on,
			events: eventsOf(contract)
		};
		const personOn = (held: JsonObject, on: string) =>
			personOf(held, starts, employerOn(held.entity_id, on), eventsFor(held));
		plans.push(
			...entitlementPlans(
				rows,
				personOn(contract, day),
				subject,
				String(balance.id),
				accountsOf(balance.account),
				day,
				// a window that closed settles under the law and the contract of its last day
				({ code }, on) => {
					const held = chain.find((row) => covers(row.effective_range, on)) ?? contract;
					const row = rowsOf
						.get(String(lawIn(held.entity_id, on)?.id))
						?.find((item) => item.code === code);
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
	const { employee_balance: rows = [] } = yield* queryAllRows(ctx.query, {
		employee_balance: { fields: ['account', 'revision'], limit: 1000 }
	});
	const today = String(ctx.today);
	const due = rows.flatMap((balance) => {
		const movements = expired(accountsOf(balance.account), today, YEARS_HELD);
		return movements.length === 0 ? [] : [{ balance, movements }];
	});
	for (let at = 0; at < due.length; at += BATCH) {
		const batch = due.slice(at, at + BATCH);
		yield* ctx.act.checked([
			{
				callable: 'ledger_entry.create',
				input: batch.flatMap(({ balance, movements }) =>
					// `REMOVE` only drops the emptied key from the balance: the ledger keeps the movement that emptied it
					movements
						.filter((row) => row.operation !== 'REMOVE')
						.map((row) => jsonObject({ ...row, balance_id: String(balance.id) }))
				)
			},
			{
				callable: 'employee_balance.update',
				input: batch.map(({ balance, movements }) => ({
					target: String(balance.id),
					set: { account: apply(accountsOf(balance.account), movements) }
				})),
				observed: Object.fromEntries(
					batch.map(({ balance }) => [String(balance.id), Number(balance.revision)])
				)
			}
		]);
	}
});

/** A leave posting or a manual adjustment dated before this year can change what carried since: its people sync again. */
export const syncLate = Effect.fn('ledger.syncLate')(function* (
	ctx: Pick<EffectCtx, 'query' | 'schedule' | 'today'>,
	rows: readonly JsonObject[]
) {
	const year = String(ctx.today).slice(0, 4);
	const late = rows.filter(
		(row) =>
			(String(row.source).startsWith('leave_catalog_entry:') ||
				String(row.source).startsWith('manual:') ||
				(String(row.source).startsWith('payroll_run:') && row.account === 'leave')) &&
			String(row.effective_on).slice(0, 4) < year
	);
	if (late.length === 0) return;
	const { employee_balance: balances = [] } = yield* queryRows(ctx.query, {
		employee_balance: {
			where: { id: { in: uniqueIds(late, 'balance_id') } },
			fields: ['employee_id'],
			limit: 1000
		}
	});
	yield* ctx.schedule('ledger', {
		employees: uniqueIds(balances, 'employee_id').map((id) => idOf('employee_profile', id))
	});
});

/**
 * The models whose writes post: what they post rides in their own write (`onApproved`). A manual adjustment's ledger
 * row carries its own balance move.
 */
const POSTS = [
	'leave_catalog_entry',
	'claim_catalog_entry',
	'adhoc_catalog_entry',
	'payroll_run',
	'ledger_entry'
];
/** Who writes the ledger and the balance: the write of a record that posts, and sync (`payroll_execution`). */
export const writesLedger = (ctx: {
	readonly policies: readonly string[];
	readonly carriedBy: string | null;
}) => ctx.policies.includes('payroll_execution') || POSTS.includes(ctx.carriedBy ?? '');

/** A sync that failed for good raises a task, so nothing is lost in silence. */
export const raiseFailure = Effect.fn('ledger.raiseFailure')(function* (
	ctx: Ctx,
	label: string,
	reason: string,
	title = 'Ledger sync failed'
) {
	const { entity: entities = [] } = yield* queryRows(ctx.query, {
		entity: { fields: ['id'], limit: 1 }
	});
	const first = entities[0];
	if (first === undefined) return;
	yield* ctx.act.checked([
		{
			callable: 'obligation.create',
			input: [
				{
					entity_id: String(first.id),
					title: `${title}: ${label}. ${reason}`,
					occurrence_key: `ledger-failure:${String(ctx.today)}:${label}`
				}
			]
		}
	]);
});
