import { Effect, Schema } from 'effect';
import { id_of, type CarriedWrites, type EffectCtx, type Id } from '@norbital-ai/bolt';
import { Refusal, isJsonObject, type JsonObject } from '../../../../../lib/foundation.js';
import { idOf, idsOf, objectValue, queryRows, type Reader } from '../../../../../lib/reads.js';
import {
	accountsOf,
	apply,
	diff,
	measureOf,
	periodOf,
	eventsOf,
	periodOn,
	type Accounts,
	type Movement,
	type PeriodKey,
	type Unit,
	type Wanted
} from './core.js';
import {
	PARAMETER_FIELDS,
	PROFILE_FIELDS,
	STINT_FIELDS,
	TERM_FIELDS,
	chainOf,
	employmentOn,
	partsIn,
	startsOf
} from '../../service/person.js';
import { lawsAt } from '../../../jurisdiction/service/law.js';

export const LEAVE = 'leave_catalog_entry';

export const uniqueIds = (rows: readonly JsonObject[], field: string) => [
	...new Set(rows.flatMap((row) => (typeof row[field] === 'string' ? [row[field]] : [])))
];

/** A check's verdict as the write's refusal: the check says why in its own words. */
export const refuse = (problem: string | undefined) =>
	problem === undefined ? Effect.void : Effect.fail(new Refusal({ message: problem }));

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
export type Ctx = Pick<EffectCtx, 'act' | 'query' | 'today'>;

export const BATCH = 50;
export const FIELDS = [
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
export const unitOf = (value: unknown): Unit | undefined =>
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
export const MANUAL = {
	or: [
		{ source: { like: 'manual:%' } },
		{ account: { eq: 'leave' }, source: { like: 'payroll_run:%' } }
	]
} as const;
/** What each balance's manual adjustments and owed time off hold, by balance id. */
export const manualOf = (rows: readonly JsonObject[]): ReadonlyMap<string, Accounts> =>
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
export const stintsRead = (people: readonly Id<'employee_profile'>[]) =>
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
/** The laws the companies of these stints follow (`stintsRead` reads each stint's company code): reuses the invocation cache. */
export const lawsFrom = (read: Reader, stints: readonly JsonObject[]) =>
	lawsAt(
		read,
		stints.flatMap((row) =>
			isJsonObject(row.entity_id) ? [String(row.entity_id.settings_code)] : []
		)
	);
/**
 * What `stintsRead` found: each stint with its rows, the law code of each company they name, and the people whose
 * service counts every stint.
 */
export const stintsOf = (found: Readonly<Record<string, readonly JsonObject[] | undefined>>) => {
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
export const covers = (range: unknown, on: string) => {
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
		const balanceId = balanceIdOf(String(row.id));
		carried.ledger_entry.create.push(...movements.map((move) => ledgerRow(balanceId, move)));
		carried.employee_balance.update.push({
			target: { id: balanceId, revision: Number(row.revision) },
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
const FORMAT_AMOUNT = new Intl.NumberFormat('en', {
	useGrouping: false,
	maximumFractionDigits: 100
});
const balanceIdOf = Schema.decodeUnknownSync(id_of('employee_balance'));
const ledgerRow = (balance: Id<'employee_balance'>, row: Movement): LedgerRow => ({
	balance_id: balance,
	operation: row.operation === 'DEDUCT' ? 'DEDUCT' : 'ADD',
	account: row.account,
	code: row.code,
	period: row.period,
	measure: row.measure,
	amount: FORMAT_AMOUNT.format(`${row.amount}` as const),
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
		const chunkSet = new Set(chunk);
		return { chunk, due: plans.filter((plan) => chunkSet.has(plan.balance_id)) };
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
export const inverted = (posted: readonly JsonObject[], balances: readonly JsonObject[]) =>
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
		moves.set(held.id, [
			...(moves.get(held.id) ?? []),
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
