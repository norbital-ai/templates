import { addDays } from '@norbital-ai/std/date';
import { Effect } from 'effect';
import type { EffectCtx } from '@norbital-ai/bolt';
import {
	Refusal,
	isJsonObject,
	jsonObject,
	type JsonObject
} from '../payroll_engine/foundation.js';
import { dynamicRead } from '@norbital-ai/bolt/protocol';
import { objectValue, queryAllRows, queryRows, type Reader } from '../payroll_engine/reads.js';
import {
	accountsOf,
	apply,
	diff,
	eventsOf,
	expired,
	leftIn,
	nextWindow,
	openedBy,
	opensOn,
	periodKey,
	totalsScope,
	windowOf,
	windowOn,
	windowStart,
	type Accounts,
	type Event,
	type Movement,
	type Unit,
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

/**
 * The only writer of the ledger and the balance. A record says what it should have posted, or a person's facts say what
 * they are owed, and `settle` posts the difference with its balance as one write. Everything else here works out what
 * should stand.
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
	period: String(row.period),
	measure: String(row.measure),
	operation: row.operation === 'DEDUCT' ? 'DEDUCT' : row.operation === 'REMOVE' ? 'REMOVE' : 'ADD',
	amount: Number(row.amount ?? 0),
	unit: unitOf(row.unit),
	effective_on: String(row.effective_on)
});
const planKey = (balance: string, source: string) => `${balance}\u0000${source}`;

/** Posts the difference between what each source should have posted and what it has. Repeating it posts nothing. */
export const settle = Effect.fn('ledger.settle')(function* (ctx: Ctx, plans: readonly Plan[]) {
	const balances = [...new Set(plans.map((plan) => plan.balance_id))];
	for (let at = 0; at < balances.length; at += BATCH) {
		const chunk = new Set(balances.slice(at, at + BATCH));
		const due = plans.filter((plan) => chunk.has(plan.balance_id));
		const { ledger_entry: rows = [] } = yield* queryAllRows(ctx.query, {
			ledger_entry: {
				where: {
					balance_id: { in: [...chunk] },
					source: { in: [...new Set(due.map((plan) => plan.source))] }
				},
				fields: FIELDS,
				limit: 1000
			}
		});
		const posted = Map.groupBy(rows, (row) => planKey(String(row.balance_id), String(row.source)));
		const moves = new Map<string, Movement[]>();
		for (const plan of due) {
			const held = posted.get(planKey(plan.balance_id, plan.source)) ?? [];
			const movements = diff(plan.source, plan.wanted, held.map(movementOf));
			if (movements.length > 0)
				moves.set(plan.balance_id, [...(moves.get(plan.balance_id) ?? []), ...movements]);
		}
		if (moves.size === 0) continue;
		const { employee_balance: stored = [] } = yield* queryRows(ctx.query, {
			employee_balance: {
				where: { id: { in: [...moves.keys()] } },
				fields: ['account', 'revision'],
				limit: 1000
			}
		});
		yield* ctx.act.checked([
			{
				callable: 'ledger_entry.create',
				input: [...moves].flatMap(([balance_id, movements]) =>
					movements.map((row) => jsonObject({ ...row, balance_id }))
				)
			},
			{
				callable: 'employee_balance.update',
				input: stored.map((row) => ({
					target: String(row.id),
					set: { account: apply(accountsOf(row.account), moves.get(String(row.id)) ?? []) }
				})),
				observed: Object.fromEntries(stored.map((row) => [String(row.id), Number(row.revision)]))
			}
		]);
	}
});

/** A source whose record is gone should have posted nothing: what it posted is inverted, exactly. */
export const settleGone = Effect.fn('ledger.settleGone')(function* (
	ctx: Ctx,
	sources: readonly string[]
) {
	if (sources.length === 0) return;
	const { ledger_entry: rows = [] } = yield* queryAllRows(ctx.query, {
		ledger_entry: { where: { source: { in: [...sources] } }, fields: FIELDS, limit: 1000 }
	});
	const plans = new Map(
		rows.map((row) => [
			planKey(String(row.balance_id), String(row.source)),
			{ source: String(row.source), balance_id: String(row.balance_id), wanted: [] }
		])
	);
	yield* settle(ctx, [...plans.values()]);
});

const uniqueIds = (rows: readonly JsonObject[], field: string) => [
	...new Set(rows.flatMap((row) => (typeof row[field] === 'string' ? [row[field]] : [])))
];

export type Subject = {
	readonly scope: string;
	readonly started: string;
	readonly events: readonly Event[];
};
const signOf = (entry: JsonObject) => (entry.is_reversal === true ? -1 : 1);

/** What a leave entry should have posted: half a day at a time, in the window each day falls in. */
export const leaveWanted = (
	entry: JsonObject,
	row: LeaveRow,
	rowOf: (code: string) => LeaveRow | undefined,
	subject: Subject,
	original?: JsonObject
): readonly Wanted[] => {
	const accounts = Array.isArray(row.lookup.accounts) ? row.lookup.accounts : [];
	const target = accounts.find(isJsonObject);
	const code = typeof target?.code === 'string' ? target.code : row.code;
	const counted = rowOf(code) ?? row;
	const days = Array.isArray(entry.days) ? entry.days.filter(isJsonObject) : [];
	// a reversal counts where the entry it reverses counted, whenever it is entered
	const dated = Array.isArray(original?.days) ? original.days.filter(isJsonObject) : days;
	return days.map((day, index) => {
		const date = String((dated[index] ?? dated[0] ?? day).date);
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
			amount: signOf(entry) * 0.5,
			unit: 'DAY',
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
		measure: String(target.measure),
		amount: signOf(entry) * (target.operation === 'DEDUCT' ? -1 : 1) * Number(entry.quantity ?? 0),
		unit: 'MONEY',
		effective_on: date
	}));
};

/** What a paid-out payslip adds: its checkpoints and statutory rows, for the year and where settings say the month. */
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
	const held = (account: string, code: string, measure: string, amount: number): Wanted[] =>
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
	const opens = openedBy(lookup);
	const grants = new Map<string, { from: string; days: number }>();
	for (const event of subject.events) {
		if (!Object.hasOwn(opens, event.kind)) continue;
		const days =
			typeof lookup.entitlement === 'string'
				? (expressed(lookup, person, event.on, event) ?? 0)
				: Number(objectValue(opens[event.kind]).days ?? lookup.grant_days ?? 0);
		const from = opensOn(event);
		const period = periodKey(subject.scope, { kind: 'EVENT', on: from }, from, subject.started);
		grants.set(period, { from, days: (grants.get(period)?.days ?? 0) + days });
	}
	return grants;
};
const eventPeriods = (periods: Accounts[string][string] | undefined, scope: string) =>
	Object.keys(periods ?? {}).filter((period) => period.startsWith(`${scope}.E.`));

/** One person's entitlements on a day, as plans: new law, a new fact and a new window all come to the same call. */
export const entitlementPlans = (
	rows: readonly (LeaveRow & { readonly account: string })[],
	person: LeavePerson,
	subject: Subject,
	balance_id: string,
	accounts: Accounts,
	on: string
): readonly Plan[] =>
	rows.flatMap(({ account, code, lookup }) => {
		const plan = (period: string, measures: Readonly<Record<string, number>>, from: string) => ({
			source: `entitlement:${balance_id}:${code}:${period}`,
			balance_id,
			wanted: Object.entries(measures)
				.filter(([, amount]) => amount !== 0)
				.map(([measure, amount]) => ({
					account,
					code,
					period,
					measure,
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
		const days = entitlementOf(lookup, person, on);
		if (days === null) return [];
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
		const carried = carriedOf(lookup, person, leftIn(held), held?.entitled ?? 0);
		return [plan(period, { entitled: days, carried }, from)];
	});

/** The ledger read a rule needs: what a person has left of a row on a day. A row with no entitlement has no limit. */
export const unlimited = (lookup: JsonObject) =>
	lookup.no_cap === true ||
	(lookup.service_bands == null &&
		lookup.part_time_service_bands == null &&
		lookup.grant_days == null &&
		lookup.annual_limit == null &&
		lookup.opened_by == null &&
		lookup.entitlement == null);

type Family = 'leave' | 'claim';
const CATALOG = { leave: 'leave_catalog', claim: 'claim_catalog' } as const;
const rowOfCatalog = (row: JsonObject): LeaveRow => ({
	code: String(row.code),
	lookup: objectValue(row.lookup)
});
/** The facts a leave row can read about a person, from their contract and their employer's sealed profile. */
const personOf = (contract: JsonObject, employer?: JsonObject): LeavePerson => {
	const payroll = objectValue(contract.payroll);
	const { term_facts: facts } = objectValue(contract.employee_extension_data);
	const extension = objectValue(employer?.entity_extension_data ?? {});
	return {
		started: startedOn(contract),
		partTime: contract.engagement === 'PART_TIME',
		gender: typeof payroll.gender === 'string' ? payroll.gender : null,
		maritalStatus: typeof payroll.marital_status === 'string' ? payroll.marital_status : null,
		terms: objectValue(contract.terms),
		facts: isJsonObject(facts) ? facts : {},
		stateOwned: extension.state_owned === true,
		employment: contract,
		...(employer === undefined ? {} : { employer })
	};
};

/** When the person's service began, which anchors their service windows. */
export const startedOn = (contract: JsonObject) =>
	String(contract.service_started_on ?? objectValue(contract.effective_range).from);

type Read = Record<string, readonly JsonObject[]>;
const subjectRead = (catalogModel: string, entries: readonly JsonObject[]) => ({
	employee_contract: {
		where: { id: { in: uniqueIds(entries, 'employment_id') } },
		fields: [
			'employee_id',
			'effective_range',
			'service_started_on',
			'input_schema_version_id',
			'employee_extension_data'
		],
		limit: 10000
	},
	[catalogModel]: {
		where: { id: { in: uniqueIds(entries, 'catalog_id') } },
		fields: ['code', 'lookup', 'settings_id'],
		limit: 10000
	}
});
const lawRead = (catalogModel: string, first: Read) => {
	const settingsIds = uniqueIds(first[catalogModel] ?? [], 'settings_id');
	return {
		jurisdiction_settings: {
			where: { id: { in: settingsIds } },
			fields: ['code', 'tax_year_start_month', 'lookup'],
			limit: 100
		},
		[catalogModel]: {
			where: { settings_id: { in: settingsIds } },
			fields: ['code', 'lookup', 'settings_id'],
			limit: 10000
		},
		employee_balance: {
			where: { employee_id: { in: uniqueIds(first.employee_contract ?? [], 'employee_id') } },
			fields: ['employee_id', 'account'],
			limit: 10000
		}
	};
};
/** The person a set of entries belongs to, the rows they were entered on, and the law that scopes them. */
const subjectsFrom = (catalogModel: string, first: Read, second: Read) => {
	const family_rows = second[catalogModel] ?? [];
	return {
		contract: new Map((first.employee_contract ?? []).map((row) => [String(row.id), row])),
		catalog: new Map(
			[...family_rows, ...(first[catalogModel] ?? [])].map((row) => [String(row.id), row])
		),
		setting: new Map((second.jurisdiction_settings ?? []).map((row) => [String(row.id), row])),
		rows: Map.groupBy(family_rows, (row) => String(row.settings_id)),
		balance: new Map((second.employee_balance ?? []).map((row) => [String(row.employee_id), row]))
	};
};
const subjectsOf = Effect.fn('ledger.subjectsOf')(function* (
	read: Reader,
	family: Family | 'adhoc',
	entries: readonly JsonObject[]
) {
	const catalogModel = family === 'adhoc' ? 'adhoc_catalog' : CATALOG[family];
	const first = yield* queryRows(read, subjectRead(catalogModel, entries));
	return subjectsFrom(catalogModel, first, yield* queryRows(read, lawRead(catalogModel, first)));
});

/** What each entry should post. A record that is gone is not here: `settleGone` inverts it. */
const entryPlans = Effect.fn('ledger.entryPlans')(function* (
	read: Reader,
	family: Family | 'adhoc',
	model: string,
	entries: readonly JsonObject[],
	subjects?: ReturnType<typeof subjectsFrom>
) {
	if (entries.length === 0) return [];
	const known = subjects ?? (yield* subjectsOf(read, family, entries));
	const reversed = uniqueIds(entries, 'reverses');
	const originals =
		reversed.length === 0
			? []
			: ((yield* queryRows(read, {
					[model]: {
						where: { id: { in: reversed } },
						fields: [family === 'leave' ? 'days' : 'incurred_on'],
						limit: 10000
					}
				}))[model] ?? []);
	const original = new Map(originals.map((row) => [String(row.id), row]));
	const sources = [
		...entries.map((entry) => `${model}:${String(entry.id)}`),
		...reversed.map((id) => `${model}:${id}`)
	];
	const { ledger_entry: own = [] } =
		family === 'claim'
			? yield* queryAllRows(read, {
					ledger_entry: { where: { source: { in: sources } }, fields: FIELDS, limit: 1000 }
				})
			: { ledger_entry: [] };
	const postedBy = Map.groupBy(own, (row) => String(row.source));
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
			started: startedOn(contract),
			events: eventsOf(contract),
			taxYearStart: Number(settings?.tax_year_start_month ?? 1)
		};
		const row = rowOfCatalog(catalog);
		const rowOf = (code: string) => {
			const found = known.rows.get(String(catalog.settings_id))?.find((item) => item.code === code);
			return found === undefined ? undefined : rowOfCatalog(found);
		};
		const first = original.get(String(entry.reverses));
		const source = `${model}:${String(entry.id)}`;
		const left = (period: string) => {
			if (entry.is_reversal === true)
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
				? leaveWanted(entry, row, rowOf, subject, first)
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
});

// a posting dated before this year can change what carried since
const past = (plan: Plan, today: string) =>
	plan.source.startsWith('leave_catalog_entry:') &&
	plan.wanted.some((row) => row.effective_on.slice(0, 4) < today.slice(0, 4));

const FAMILY = {
	leave_catalog_entry: 'leave',
	claim_catalog_entry: 'claim',
	adhoc_catalog_entry: 'adhoc'
} as const;
const isEntryModel = (model: string): model is keyof typeof FAMILY => Object.hasOwn(FAMILY, model);

/** Posts records. It reads each one as it stands now, so a rerun or a late retry can never post a stale copy. */
export const post = Effect.fn('ledger.post')(function* (ctx: Ctx, sources: readonly string[]) {
	const byModel = Map.groupBy(sources, (source) => source.slice(0, source.indexOf(':')));
	const plans: Plan[] = [];
	const gone: string[] = [];
	for (const [model, group] of byModel) {
		const ids = group.map((source) => source.slice(source.indexOf(':') + 1));
		if (model === 'payroll_run') {
			const run = yield* runPlans(ctx.query, ids);
			plans.push(...run.plans);
			gone.push(...run.gone);
			continue;
		}
		if (!isEntryModel(model)) continue;
		const rows =
			(yield* queryRows(ctx.query, {
				[model]: { where: { id: { in: ids } }, limit: 10000 }
			}))[model] ?? [];
		const found = new Set(rows.map((row) => String(row.id)));
		gone.push(...ids.filter((id) => !found.has(id)).map((id) => `${model}:${id}`));
		plans.push(...(yield* entryPlans(ctx.query, FAMILY[model], model, rows)));
	}
	yield* settleGone(ctx, gone);
	yield* settle(ctx, plans);
	return [...new Set(plans.flatMap((plan) => (past(plan, ctx.today) ? [plan.balance_id] : [])))];
});

const runPlans = Effect.fn('ledger.runPlans')(function* (read: Reader, ids: readonly string[]) {
	const { payroll_run: runs = [], payslip: slips = [] } = yield* queryRows(read, {
		payroll_run: { where: { id: { in: [...ids] } }, fields: ['pay_date'], limit: 1000 },
		payslip: {
			where: { payroll_run_id: { in: [...ids] } },
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
	});
	const { jurisdiction_settings: settings = [] } = yield* queryRows(read, {
		jurisdiction_settings: {
			where: { id: { in: uniqueIds(slips, 'settings_id') } },
			fields: ['code', 'tax_year_start_month', 'lookup'],
			limit: 100
		}
	});
	const { employee_contract: contracts = [] } = yield* queryRows(read, {
		employee_contract: {
			where: { id: { in: uniqueIds(slips, 'employment_id') } },
			fields: ['effective_range', 'service_started_on'],
			limit: 10000
		}
	});
	const { employee_balance: balances = [] } = yield* queryRows(read, {
		employee_balance: {
			where: { employee_id: { in: uniqueIds(slips, 'employee_id') } },
			fields: ['employee_id'],
			limit: 10000
		}
	});
	const payDate = new Map(runs.map((row) => [String(row.id), String(row.pay_date)]));
	const setting = new Map(settings.map((row) => [String(row.id), row]));
	const contract = new Map(contracts.map((row) => [String(row.id), row]));
	const balance = new Map(balances.map((row) => [String(row.employee_id), String(row.id)]));
	const found = new Set(runs.map((row) => String(row.id)));
	return {
		gone: ids.filter((id) => !found.has(id)).map((id) => `payroll_run:${id}`),
		plans: slips.flatMap((slip) => {
			const balance_id = balance.get(String(slip.employee_id));
			const run = String(slip.payroll_run_id);
			const own = setting.get(String(slip.settings_id));
			const employment = contract.get(String(slip.employment_id));
			if (balance_id === undefined || own === undefined || employment === undefined) return [];
			const byMonth = objectValue(own.lookup).month_balance;
			return [
				{
					source: `payroll_run:${run}`,
					balance_id,
					wanted: payslipWanted(objectValue(slip.breakdown), String(payDate.get(run)), {
						scope: totalsScope(own, slip.entity_id),
						started: startedOn(employment),
						events: [],
						taxYearStart: Number(own.tax_year_start_month ?? 1),
						byMonth: Array.isArray(byMonth) ? byMonth : []
					})
				}
			];
		})
	};
});

const moved = (slip: JsonObject) =>
	Number(slip.gross_earnings ?? 0) > 0 ||
	Number(slip.employee_statutory ?? 0) !== 0 ||
	Number(slip.employer_statutory ?? 0) !== 0 ||
	Number(slip.tax_withheld ?? 0) !== 0;

/**
 * Has everyone on these runs posted? A run stands on what the last one posted, so an unposted one holds it back. A slip
 * that moved no money posts nothing, and holds nothing back.
 */
export const runPosted = Effect.fn('ledger.runPosted')(function* (
	read: Reader,
	ids: readonly string[]
) {
	const { payslip: slips = [] } = yield* queryRows(read, {
		payslip: {
			where: { payroll_run_id: { in: [...ids] } },
			fields: [
				'employee_id',
				'gross_earnings',
				'employee_statutory',
				'employer_statutory',
				'tax_withheld'
			],
			limit: 10000
		}
	});
	const due = uniqueIds(slips.filter(moved), 'employee_id');
	if (due.length === 0) return true;
	const { employee_balance: balances = [] } = yield* queryRows(read, {
		employee_balance: {
			where: { employee_id: { in: due } },
			fields: ['id'],
			limit: 10000
		}
	});
	// ponytail: pages of 10000 inside a write's ten reads hold about 1,300 people a run; a person's row, if that outgrows it
	const { ledger_entry: rows = [] } = yield* queryAllRows(read, {
		ledger_entry: {
			where: { source: { in: ids.map((id) => `payroll_run:${id}`) } },
			fields: ['balance_id'],
			limit: 10000
		}
	});
	const posted = new Set(rows.map((row) => String(row.balance_id)));
	return balances.every((row) => posted.has(String(row.id)));
});

/**
 * Has a deleted run finished taking back its totals? The newest payslip movement says whose turn it was. Until a deleted
 * run nets to nothing, a new run would count it.
 */
export const runsTakenBack = Effect.fn('ledger.runsTakenBack')(function* (read: Reader) {
	const newest = yield* read(
		dynamicRead({
			ledger_entry: {
				where: { account: { eq: 'pay' } },
				fields: ['source'],
				orderBy: { created_at: 'desc' },
				limit: 1
			}
		})
	);
	const source = newest.ledger_entry?.rows[0]?.source;
	if (typeof source !== 'string' || !source.startsWith('payroll_run:')) return true;
	const { payroll_run: runs = [], ledger_entry: rows = [] } = yield* queryRows(read, {
		payroll_run: {
			where: { id: { eq: source.slice(source.indexOf(':') + 1) } },
			fields: ['id'],
			limit: 1
		},
		ledger_entry: {
			where: { source: { eq: source }, account: { eq: 'pay' } },
			fields: ['operation', 'amount'],
			limit: 10000
		}
	});
	const net = rows.reduce(
		(total, row) => total + (row.operation === 'DEDUCT' ? -1 : 1) * Number(row.amount ?? 0),
		0
	);
	return runs.length > 0 || Math.abs(net) < 1e-6;
});

const LEAVE = 'leave_catalog_entry';
const sourceOf = (row: JsonObject) => `${LEAVE}:${String(row.id)}`;

/**
 * The check before a leave entry commits: each window it draws on has the days. A write allows few reads, so this makes
 * two. The balance does not show an entry on its way to the ledger, so a waiting one counts here.
 */
export const assertLeft = Effect.fn('ledger.assertLeft')(function* (
	read: Reader,
	entries: readonly JsonObject[],
	today: string,
	replaced: readonly JsonObject[] = []
) {
	if (entries.every((row) => row.is_reversal === true)) return;
	const taking = entries.filter((row) => row.is_reversal !== true && row.encashment !== true);
	const ids = uniqueIds(entries, 'employment_id');
	const subject = subjectRead('leave_catalog', entries);
	const first = yield* queryRows(read, {
		...subject,
		employee_contract: { ...subject.employee_contract, where: sameEmployee(ids) },
		[LEAVE]: { where: { employment_id: { is: sameEmployee(ids) } }, limit: 10000 }
	});
	const held = first[LEAVE] ?? [];
	const person = new Map(
		(first.employee_contract ?? []).map((row) => [String(row.id), String(row.employee_id)])
	);
	const slots = (row: JsonObject) =>
		(Array.isArray(row.days) ? row.days : [])
			.filter(isJsonObject)
			.map(
				(day) => `${person.get(String(row.employment_id))}/${String(day.date)}/${String(day.part)}`
			);
	// a reversal frees as many of its original's days as it holds, in order, as it posts them
	const freed = new Map(
		held.flatMap((row) =>
			typeof row.reverses === 'string' ? [[row.reverses, slots(row).length] as const] : []
		)
	);
	const gone = new Set(replaced.map((row) => String(row.id)));
	const taken = new Set(
		held
			.filter(
				(row) => row.is_reversal !== true && row.encashment !== true && !gone.has(String(row.id))
			)
			.flatMap((row) => slots(row).slice(freed.get(String(row.id)) ?? 0))
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
	const second = yield* queryRows(read, {
		...lawRead('leave_catalog', first),
		ledger_entry: {
			where: { source: { in: open.map(sourceOf) } },
			fields: ['source'],
			limit: 10000
		}
	});
	const known = subjectsFrom('leave_catalog', first, second);
	const posted = new Set((second.ledger_entry ?? []).map((row) => String(row.source)));
	const editing = new Set(replaced.map(sourceOf));
	const waiting = open.filter((row) => !posted.has(sourceOf(row)) && !editing.has(sourceOf(row)));
	const undone = replaced.filter((row) => posted.has(sourceOf(row)));
	const plans = yield* entryPlans(read, 'leave', LEAVE, entries, known);
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
	adjust(yield* entryPlans(read, 'leave', LEAVE, waiting, known), 1);
	adjust(yield* entryPlans(read, 'leave', LEAVE, undone, known), -1);
	for (const [key, { row, amount }] of drawn) {
		if (amount <= 0) continue;
		const balance = key.slice(0, key.indexOf('/'));
		const measures = accounts.get(balance)?.[row.account]?.[row.code]?.[row.period];
		// a window no sync has opened yet has nothing to refuse against
		const unopened = opened.has(row.code) && !row.period.includes('.E.');
		if (measures === undefined && row.effective_on > today && !unopened) continue;
		const left = leftIn(measures);
		if (Number((left - amount).toFixed(8)) < 0)
			return yield* Effect.fail(new Refusal({ message: `${row.code}: insufficient balance.` }));
	}
});

type Entries = 'leave_catalog_entry' | 'claim_catalog_entry' | 'adhoc_catalog_entry';
/** Every contract of the people who hold these: one read, so a gate spends one crossing. */
const sameEmployee = (ids: readonly string[]) => ({
	employee_id: { is: { employee_contract: { some: { id: { in: ids } } } } }
});
const sizeOf = (model: Entries, entry: JsonObject) =>
	model === LEAVE
		? (Array.isArray(entry.days) ? entry.days : []).length
		: Math.abs(Number(entry.quantity ?? 0));

/** A reversal undoes one sealed entry of the same person and catalog item, once, for no more than it held. */
export const assertReversals = Effect.fn('ledger.assertReversals')(function* (
	read: Reader,
	model: Entries,
	entries: readonly JsonObject[]
) {
	const reversals = entries.filter((entry) => typeof entry.reverses === 'string');
	if (reversals.length === 0) return;
	const catalog = model.replace('_entry', '');
	const {
		[model]: originals = [],
		employee_contract: chain = [],
		[catalog]: items = []
	} = yield* queryRows(read, {
		[model]: { where: { id: { in: uniqueIds(reversals, 'reverses') } }, limit: 10000 },
		[`${model}.catalog_id`]: { fields: ['code'] },
		employee_contract: {
			where: sameEmployee(uniqueIds(reversals, 'employment_id')),
			fields: ['employee_id'],
			limit: 10000
		},
		[catalog]: {
			where: { id: { in: uniqueIds(reversals, 'catalog_id') } },
			fields: ['code'],
			limit: 10000
		}
	});
	const person = new Map(chain.map((row) => [String(row.id), String(row.employee_id)]));
	const code = new Map(items.map((row) => [String(row.id), String(row.code)]));
	const fits = (entry: JsonObject, original: JsonObject | undefined) =>
		original !== undefined &&
		original.is_reversal !== true &&
		original.payroll_run_id != null &&
		person.get(String(entry.employment_id)) === person.get(String(original.employment_id)) &&
		code.get(String(entry.catalog_id)) === objectValue(original.catalog_id).code &&
		sizeOf(model, entry) <= sizeOf(model, original);
	const original = new Map(originals.map((row) => [String(row.id), row]));
	if (!reversals.every((entry) => fits(entry, original.get(String(entry.reverses)))))
		return yield* Effect.fail(
			new Refusal({
				message:
					'A reversal undoes a sealed entry of the same person and catalog item, for no more than it held. An entry no run has sealed is deleted instead.'
			})
		);
});

/**
 * A statutory adjustment corrects a month a run has closed. Dated in an open month, that month's own row counts it as
 * already paid and charges that much less, so nothing would move.
 */
export const assertAdjustmentsClosed = Effect.fn('ledger.assertAdjustmentsClosed')(function* (
	read: Reader,
	entries: readonly JsonObject[]
) {
	const dated = entries.filter((entry) => typeof entry.reverses !== 'string');
	if (dated.length === 0) return;
	const { adhoc_catalog: rows = [], payroll_run: runs = [] } = yield* queryRows(read, {
		adhoc_catalog: {
			where: { id: { in: uniqueIds(dated, 'catalog_id') } },
			fields: ['lookup'],
			limit: 10000
		},
		payroll_run: {
			where: { entity_id: { in: uniqueIds(dated, 'entity_id') } },
			fields: ['entity_id', 'salary_coverage'],
			limit: 10000
		}
	});
	const statutory = new Set(
		rows
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
		runs.map(
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
	const settingsIds = uniqueIds(sealing, 'input_schema_version_id');
	const {
		leave_catalog: rows = [],
		jurisdiction_settings: settings = [],
		employee_balance: balances = [],
		entity_profile_version: employerRows = []
	} = yield* queryRows(read, {
		leave_catalog: {
			where: { settings_id: { in: settingsIds } },
			fields: ['settings_id', 'code', 'lookup'],
			limit: 10000
		},
		jurisdiction_settings: {
			where: { id: { in: settingsIds } },
			fields: ['code'],
			limit: 100
		},
		employee_balance: {
			where: { employee_id: { in: uniqueIds(sealing, 'employee_id') } },
			fields: ['employee_id', 'account'],
			limit: 10000
		},
		entity_profile_version: {
			where: { entity_id: { in: uniqueIds(sealing, 'entity_id') }, status: { eq: 'SEALED' } },
			fields: ['entity_id', 'entity_extension_data'],
			limit: 10000
		}
	});
	const scope = new Map(settings.map((row) => [String(row.id), String(row.code)]));
	const employers = new Map(employerRows.map((row) => [String(row.entity_id), row]));
	const rowsOf = Map.groupBy(rows, (row) => String(row.settings_id));
	const balance = new Map(balances.map((row) => [String(row.employee_id), row]));
	for (const contract of sealing) {
		const settingsId = String(contract.input_schema_version_id);
		const subject = {
			scope: String(scope.get(settingsId)),
			started: startedOn(contract),
			events: eventsOf(contract)
		};
		const leave = accountsOf(balance.get(String(contract.employee_id))?.account).leave ?? {};
		for (const row of rowsOf.get(settingsId) ?? []) {
			const { code, lookup } = rowOfCatalog(row);
			const grants = grantsOf(
				lookup,
				subject,
				personOf(contract, employers.get(String(contract.entity_id)))
			);
			for (const period of eventPeriods(leave[code], subject.scope)) {
				const used = leave[code]?.[period]?.used ?? 0;
				const grant = grants.get(period);
				if (used > 0 && (grant === undefined || (lookup.no_cap !== true && used > grant.days)))
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
				'effective_range',
				'service_started_on',
				'entity_id',
				'engagement',
				'payroll',
				'terms',
				'employee_extension_data',
				'input_schema_version_id'
			],
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
		employee_balance: {
			...(employees === undefined ? {} : { where: { employee_id: { in: [...employees] } } }),
			fields: ['employee_id', 'account'],
			limit: 1000
		}
	});
	const covers = (range: unknown) => {
		const { from, to } = objectValue(range);
		return String(from) <= day && (typeof to !== 'string' || day <= to);
	};
	const versions = read.jurisdiction_settings ?? [];
	const inForce = new Map(
		versions.map((row) => [
			String(row.id),
			versions.find((other) => other.code === row.code && covers(other.effective_range))
		])
	);
	const ids = [
		...new Set([...inForce.values()].flatMap((row) => (row === undefined ? [] : [String(row.id)])))
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
	const employers = new Map(
		(read.entity_profile_version ?? [])
			.filter((row) => covers(row.effective_range))
			.map((row) => [String(row.entity_id), row])
	);
	const plans: Plan[] = [];
	let boundary: string | undefined;
	for (const balance of read.employee_balance ?? []) {
		const contract = current.get(String(balance.employee_id));
		if (contract === undefined) continue;
		const version = inForce.get(String(contract.input_schema_version_id));
		const rows = rowsOf.get(String(version?.id)) ?? [];
		const subject = {
			scope: String(version?.code),
			started: startedOn(contract),
			events: eventsOf(contract)
		};
		plans.push(
			...entitlementPlans(
				rows,
				personOf(contract, employers.get(String(contract.entity_id))),
				subject,
				String(balance.id),
				accountsOf(balance.account),
				day
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

/** Sync for these balances: a late posting can change what carried. */
export const syncBalances = Effect.fn('ledger.syncBalances')(function* (
	ctx: Ctx,
	balances: readonly string[]
) {
	const { employee_balance: rows = [] } = yield* queryRows(ctx.query, {
		employee_balance: { where: { id: { in: [...balances] } }, fields: ['employee_id'], limit: 1000 }
	});
	yield* syncEntitlements(ctx, uniqueIds(rows, 'employee_id'));
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
					movements.map((row) => jsonObject({ ...row, balance_id: String(balance.id) }))
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

/** A posting that failed for good raises a task, so nothing is lost in silence and the PAID gate is not the only sign. */
export const raiseFailure = Effect.fn('ledger.raiseFailure')(function* (
	ctx: Ctx,
	label: string,
	reason: string,
	title = 'Ledger posting failed'
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
