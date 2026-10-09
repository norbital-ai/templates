import type { Context as CelContext } from '@marcbachmann/cel-js';
import type { Act } from '@norbital-ai/bolt';
import { monthOf } from '@norbital-ai/std/date';
import { Effect, Result, Schema } from 'effect';
import {
	actBehaviourWrites,
	type Behaviour,
	type BehaviourWrite,
	behavioursOf,
	effectWrites,
	planBehaviours,
	resolveWhere,
	triggerMatches
} from './behaviours.js';
import {
	type HostMember,
	type HostRead,
	type HostReadQuery,
	type HostRow,
	type ReadableName,
	isJsonObject,
	type Json,
	moneyNumber,
	Reads,
	batchedRead,
	joinedSetOf,
	type JoinedMember,
	plainRows,
	readJoined,
	readSetOf,
	readsFrom,
	type Selection,
	type Refusal,
	stableJson
} from './foundation.js';
import { chainStarts, leaveBalances } from './leave.js';
import {
	type ContractRow,
	leaveState,
	leaveStateMembers,
	payrollRules,
	SETTINGS,
	type SettingsRow,
	STAFFING,
	staffingFrom,
	versionOn
} from './services.js';

export type Row = Readonly<Record<string, unknown>>;
const Record_ = Schema.Record(Schema.String, Schema.Unknown);
export const rowOf = (value: unknown): Row | undefined =>
	Schema.is(Record_)(value) ? value : undefined;
const isString = Schema.is(Schema.String);
export const text = (value: unknown): string | null =>
	isString(value) && value !== '' ? value : null;

/** Who a trigger row is about: the entity whose jurisdiction it settles under, and the employment and person. */
export type Subject = {
	readonly company_id: string;
	readonly employment_id: string | null;
	readonly employee_id: string | null;
};

/** An entry collection's catalogue. */
const CATALOGS = {
	leave_catalog_entry: 'leave_catalog',
	claim_catalog_entry: 'claim_catalog',
	adhoc_catalog_entry: 'adhoc_catalog',
	loan_catalog_entry: 'loan_catalog'
} as const;
const isEntry = (collection: string): collection is keyof typeof CATALOGS => collection in CATALOGS;

/** The approved time off a task reads (`leaveTaken`) as one keyed read member: each movement with its class's code. */
export const leaveMember = (
	where: Readonly<Record<string, unknown>>,
	since?: string
): HostMember => ({
	collection: 'leave_catalog_entry',
	where: {
		...where,
		activity: { eq: 'TIME_OFF' },
		approval_id: { isNull: true },
		...(since === undefined ? {} : { occurred_on: { gte: since } })
	},
	select: {
		id: true,
		employment_id: true,
		catalog_id: { select: { code: true } },
		occurred_on: true,
		from: true,
		to: true,
		days: true,
		facts: true
	},
	all: true
});

/** `leaveMember`'s rows by employment, as `leaveTaken` answers them. */
export const leaveFrom = async (
	read: HostRead,
	rows: readonly Row[]
): Promise<ReadonlyMap<string, readonly Row[]>> => {
	// A reader that answers the key alone (a fixture) has the codes read beside it.
	const bare = [
		...new Set(
			rows
				.filter((held) => rowOf(held['catalog']) == null)
				.map((held) => text(held['catalog_id']))
				.filter((id) => id != null)
		)
	];
	const codes = new Map(
		bare.length === 0
			? []
			: (
					await read('leave_catalog', {
						where: { id: { in: bare } },
						select: { id: true, code: true },
						all: true
					})
				).rows.map((held) => [String(held['id']), text(held['code']) ?? ''])
	);
	// the class rides its movement: a relation arm (`catalog`), the key's own row on a host, else read beside it
	const codeOf = (held: Row) =>
		text(rowOf(held['catalog'])?.['code']) ??
		text(rowOf(held['catalog_id'])?.['code']) ??
		codes.get(String(held['catalog_id'])) ??
		'';
	const fromOf = (held: Row) => text(held['from']) ?? text(held['occurred_on']) ?? '';
	const chains = chainStarts(
		rows.map((held) => ({
			id: String(held['id']),
			key: `${String(held['employment_id'])}:${codeOf(held)}`,
			from: fromOf(held),
			to: text(held['to']) ?? fromOf(held)
		}))
	);
	const out = new Map<string, Row[]>();
	for (const held of rows.toSorted((left, right) => fromOf(left).localeCompare(fromOf(right)))) {
		const employment = String(held['employment_id']);
		const from = fromOf(held);
		out.set(employment, [
			...(out.get(employment) ?? []),
			{
				id: String(held['id']),
				code: codeOf(held),
				from,
				to: text(held['to']) ?? from,
				chain_from: chains.get(String(held['id'])) ?? from,
				days: moneyNumber(held['days']) ?? 0,
				facts: rowOf(held['facts']) ?? {}
			}
		]);
	}
	return out;
};

/**
 * Each employment's approved time off as a task reads it (`row.leave[]` of a contract or calendar row): `code` (its
 * class's), `from`, `to`, `chain_from` (the first day of the back-to-back rows of its class it continues), `days`,
 * `facts`, by employment. `since` bounds the movements read by their day. One read.
 */
export const leaveTaken = async (
	read: HostRead,
	where: Readonly<Record<string, unknown>>,
	since?: string
): Promise<ReadonlyMap<string, readonly Row[]>> => {
	const { collection, ...query } = leaveMember(where, since);
	return leaveFrom(read, (await read(collection, query)).rows);
};

/** One employment's leave balances on a day (`services.leaveState`), each with its class's `attendance` when it reads
 * one; none when the state cannot be read. */
export const leaveBalancesOn = async (
	read: HostRead,
	employment_id: string,
	day: string
): Promise<readonly unknown[]> => {
	const outcome = await engine(leaveState(employment_id, day), read);
	return Result.isFailure(outcome) ? [] : leaveBalances(outcome.success);
};

/**
 * Many employments' leave balances, each on its own day, from one read (`leaveStateMembers`); an employment whose state
 * cannot be read has none. The reads its classes' attendance needs cross together, over one batched reader.
 */
export const leaveBalancesFor = async (
	read: HostRead,
	wants: readonly { readonly employment_id: string; readonly asOf: string }[],
	/** A contract event's balances: without the unpaid movements its exit raised (`exit:<contract>:…`), which the
	 * event withdraws and raises again for the exit as it now stands (a moved exit encashes what it would have). */
	options: { readonly withoutExitEffects?: boolean } = {}
): Promise<readonly (readonly unknown[])[]> => {
	if (wants.length === 0) return [];
	const batched = batchedRead(read);
	const prefetched = await joinedSetOf(read)(leaveStateMembers(wants));
	const raisedByExit = (contract: Row, movement: unknown) => {
		const held = rowOf(movement);
		return (
			held != null &&
			held['payslip_id'] == null &&
			String(held['reference'] ?? '').startsWith(`exit:${String(contract['id'])}:`)
		);
	};
	const contracts = prefetched<Row>('employment').map((contract): Row => ({
		...contract,
		leave_catalog_entry: (Array.isArray(contract['leave_catalog_entry'])
			? contract['leave_catalog_entry']
			: []
		).filter((movement) => !raisedByExit(contract, movement))
	}));
	const got = !options.withoutExitEffects
		? prefetched
		: <T>(key: string): readonly T[] =>
				key === 'employment' ? (contracts as readonly T[]) : prefetched<T>(key);
	return Promise.all(
		wants.map(async ({ employment_id, asOf }) => {
			const outcome = await engine(leaveState(employment_id, asOf, got), batched);
			return Result.isFailure(outcome) ? [] : leaveBalances(outcome.success);
		})
	);
};

/** The terms a contract write added or changed: those of `facts` its `before.facts` did not hold. */
const termsWritten = (row: Row): unknown[] => {
	const terms = (facts: unknown) => {
		const held = rowOf(facts)?.['contract_terms'];
		return Array.isArray(held) ? held : [];
	};
	const before = rowOf(row['before']);
	if (before == null || !('facts' in before)) return [];
	const prior = new Set(terms(before['facts']).map(stableJson));
	return terms(row['facts']).filter((term) => !prior.has(stableJson(term)));
};

/**
 * A trigger row as the rules read it (`event.row`): a contract carries its employment's time off (`leave[]`) and the
 * terms its write added or changed (`terms_written[]`); a payslip carries the day it was paid (`paid_on`, the UTC day of
 * `paid_at`), its line codes (`line_codes`, base and adjustments) and its run's `pay_date` and `pay_due_date` (a
 * late payment's days and interest); an entry carries its class (`catalog_code`, and the class row as `catalog`).
 */
export const describeTrigger = async (
	collection: string,
	trigger: Row,
	read: HostRead
): Promise<Row> => (await describeTriggers(collection, [trigger], read))[0]!;

/**
 * What `describeTriggers` reads for the rows of one collection, as keyed read members over the member `rows` names
 * (or the rows in hand): each slip's lines and run, a contract's time off, an entry's employment's time off and
 * its class. A caller folds them into its own keyed read; `describeFrom` assembles them.
 */
export const describeMembers = (
	collection: string,
	rows: string | readonly Row[]
): Readonly<Record<string, HostMember>> => {
	// a member's rows by reference, or rows in hand by their values
	const ref = (field: string) =>
		Schema.is(Schema.String)(rows)
			? { in: { member: rows, field } }
			: { in: [...new Set(rows.map((row) => text(row[field])).filter((id) => id != null))] };
	if (collection === 'payslip')
		return {
			describe_lines: {
				collection: 'payslip',
				where: { id: ref('id') },
				select: {
					base: true,
					adjustments: true,
					payroll_run_id: { select: { pay_date: true, pay_due_date: true } }
				},
				all: true
			}
		};
	if (collection === 'employment_contract')
		return { describe_leave: leaveMember({ employment_id: ref('id') }) };
	return {
		...(collection === 'leave_catalog_entry'
			? { describe_leave: leaveMember({ employment_id: ref('employment_id') }) }
			: {}),
		...(isEntry(collection)
			? {
					describe_catalog: {
						collection: CATALOGS[collection],
						where: { id: ref('catalog_id') },
						all: true
					}
				}
			: {})
	};
};

/** The trigger rows as the rules read them, from `describeMembers`' rows (`got`). */
export const describeFrom = async (
	collection: string,
	triggers: readonly Row[],
	got: { readonly [key: string]: readonly Row[] },
	read: HostRead
): Promise<readonly Row[]> => {
	if (collection === 'payslip') {
		const lines = new Map((got['describe_lines'] ?? []).map((held) => [String(held['id']), held]));
		// a reader that answers the run's key alone (a fixture) has the runs read beside it
		const bare = [...lines.values()]
			.map((held) => text(held['payroll_run_id']))
			.filter((id) => id != null);
		const runs = new Map(
			bare.length === 0
				? []
				: (
						await read('payroll_run', {
							where: { id: { in: [...new Set(bare)] } },
							select: { pay_date: true, pay_due_date: true },
							all: true
						})
					).rows.map((held) => [String(held['id']), rowOf(held)])
		);
		return triggers.map((row) => {
			const paid = text(row['paid_at']);
			const held = lines.get(String(row['id']));
			// the run rides its key: a fixture reader answers the key alone
			const run = rowOf(held?.['payroll_run_id']) ?? runs.get(text(held?.['payroll_run_id']) ?? '');
			const codes = [held?.['base'], held?.['adjustments']]
				.flatMap((list) => (Array.isArray(list) ? list : []))
				.map((line) => text(rowOf(line)?.['component_code']))
				.filter((code) => code != null);
			return {
				...row,
				line_codes: [...new Set(codes)],
				pay_date: text(run?.['pay_date']),
				pay_due_date: text(run?.['pay_due_date']),
				...(paid == null ? {} : { paid_on: paid.slice(0, 10) })
			};
		});
	}
	const leave =
		got['describe_leave'] === undefined
			? new Map<string, readonly Row[]>()
			: await leaveFrom(read, got['describe_leave']);
	if (collection === 'employment_contract')
		return triggers.map((row) => ({
			...row,
			leave: leave.get(String(row['id'])) ?? [],
			terms_written: termsWritten(row)
		}));
	let rows = triggers;
	// A leave entry sees its employment's time off and its own chain start: a continuation is not a first leave.
	if (collection === 'leave_catalog_entry')
		rows = triggers.map((row) => {
			const held = leave.get(text(row['employment_id']) ?? '') ?? [];
			const own = held.find((movement) => movement['id'] === row['id']);
			return { ...row, leave: held, chain_from: own?.['chain_from'] ?? text(row['from']) ?? null };
		});
	if (!isEntry(collection)) return rows;
	const catalogs = new Map(
		(got['describe_catalog'] ?? []).map((held) => [String(held['id']), rowOf(held)])
	);
	return rows.map((row) => {
		const catalogId = text(row['catalog_id']);
		if (catalogId == null) return row;
		const catalog = catalogs.get(catalogId);
		return { ...row, catalog_code: catalog?.['code'] ?? null, catalog: catalog ?? null };
	});
};

/** `describeTrigger` for many rows of one collection: one keyed read for them all. */
export const describeTriggers = async (
	collection: string,
	triggers: readonly Row[],
	read: HostRead
): Promise<readonly Row[]> => {
	const members = describeMembers(collection, triggers);
	if (Object.keys(members).length === 0) return triggers;
	const got = await readSetOf(read)(members);
	return describeFrom(collection, triggers, got, read);
};

/** A `where` clause over an empty list: it matches nothing. */
const emptyIn = (clause: unknown): boolean =>
	isJsonObject(clause) && Array.isArray(clause['in']) && clause['in'].length === 0;

const engine = <A>(effect: Effect.Effect<A, Refusal, Reads>, read: HostRead) =>
	Effect.runPromise(Effect.result(effect.pipe(Effect.provideService(Reads, readsFrom(read)))));

/** One entity as a rule run reads it: its lineage's sealed versions and its approved contracts (its staffing). */
type EntityHeld = {
	readonly settings_code: string | null;
	readonly versions: readonly SettingsRow[];
	readonly contracts: readonly ContractRow[];
};

/** A `readJoinedSet` answer: each member's rows by key. */
export type Joined = <T>(key: string) => readonly T[];

/**
 * What a rule run reads of the entities `where` names: the entities with their approved contracts (the relation arm:
 * their staffing, plus `contracts`' fields and arms) and `entity`'s own arms, and the sealed versions their
 * `settings_code` names (no relation reaches them: a member reference, the same statement) with `versions`' arms.
 */
export const entityMembers = (
	where: Readonly<Record<string, unknown>>,
	arms: {
		readonly entity?: Selection;
		readonly contracts?: Selection;
		readonly versions?: Selection;
	} = {}
): { readonly entities: JoinedMember; readonly versions: JoinedMember } => ({
	entities: {
		collection: 'entity',
		where,
		selection: {
			id: true,
			settings_code: true,
			...arms.entity,
			employment_contract: {
				many: { ...STAFFING, ...arms.contracts },
				where: { approval_id: { isNull: true } }
			}
		}
	},
	versions: {
		collection: 'jurisdiction_settings',
		where: {
			code: { in: { member: 'entities', field: 'settings_code' } },
			approval_id: { isNull: true },
			voided_at: { isNull: true },
			sealed_at: { isNull: false }
		},
		// the PAYROLL rule tables, every rule context's `rules` (a caller naming its own `rule_set` arm includes them)
		selection: {
			...SETTINGS,
			rule_set: {
				many: { family: true, code: true, rules: true },
				where: { family: { eq: 'PAYROLL' } }
			},
			...arms.versions
		}
	}
});

const heldFrom = (got: Joined, id: string): EntityHeld => {
	const entity = got<Row>('entities').find((row) => row['id'] === id);
	const settings_code = text(entity?.['settings_code']);
	return {
		settings_code,
		versions: plainRows<SettingsRow>(
			got<Row>('versions').filter((version) => version['code'] === settings_code)
		),
		contracts: plainRows<ContractRow>(
			Array.isArray(entity?.['employment_contract']) ? entity['employment_contract'] : []
		)
	};
};

/**
 * Every entity a batch asks for, in one read per batch (`entityMembers`). Entities asked for together (one microtask)
 * share the read; each is read once per reader, and a caller that read them in its own read primes it.
 */
type Loader = ((company_id: string) => Promise<EntityHeld>) & {
	readonly prime: (got: Joined) => void;
};
const entityLoader = (read: HostRead): Loader => {
	const held = new Map<string, Promise<EntityHeld>>();
	let waiting: Map<string, (outcome: Promise<EntityHeld>) => void> | undefined;
	const flush = () => {
		const batch = waiting ?? new Map();
		waiting = undefined;
		const answer = joinedSetOf(read)(entityMembers({ id: { in: [...batch.keys()] } }));
		for (const [id, settle] of batch) settle(answer.then((got) => heldFrom(got, id)));
	};
	const load = (company_id: string): Promise<EntityHeld> => {
		const known = held.get(company_id);
		if (known !== undefined) return known;
		const next = new Promise<EntityHeld>((resolve) => {
			if (waiting === undefined) {
				waiting = new Map();
				setTimeout(flush, 0);
			}
			waiting.set(company_id, resolve);
		});
		held.set(company_id, next);
		return next;
	};
	const loader: Loader = Object.assign(load, {
		prime: (got: Joined) => {
			for (const entity of got<Row>('entities')) {
				const id = String(entity['id']);
				if (!held.has(id)) held.set(id, Promise.resolve(heldFrom(got, id)));
			}
		}
	});
	return loader;
};

/** A version lookup and the entity reads it shares with a `staffingLookup` made from it. */
export type VersionFor = ((company_id: string, day: string) => Promise<Row | null>) & {
	readonly entities?: Loader;
};

/** Seeds a `versionLookup` (and the staffing made from it) from an `entityMembers` read already made. */
export const primeEntities = (versionFor: VersionFor, got: Joined): void =>
	versionFor.entities?.prime(got);

/** The version governing one entity on one day: every entity's lineage is read once per reader, in one batch. */
export const versionLookup = (read: HostRead): VersionFor => {
	const load = entityLoader(read);
	return Object.assign(
		async (company_id: string, day: string): Promise<Row | null> => {
			const { settings_code, versions } = await load(company_id);
			if (settings_code == null) return null;
			const outcome = Effect.runSync(Effect.result(versionOn(versions, settings_code, day)));
			return Result.isFailure(outcome) ? null : (rowOf(outcome.success) ?? null);
		},
		{ entities: load }
	);
};

export type Staffing = {
	readonly headcount: number;
	readonly headcount_permanent: number;
	readonly headcount_by_worksite: Readonly<Record<string, number>>;
	readonly headcount_permanent_by_worksite: Readonly<Record<string, number>>;
	readonly headcount_months: readonly unknown[];
	readonly separations: readonly unknown[];
};

/**
 * The entity's staffing on a day (`services.staffingFrom`), its contracts read with its lineage (`versionLookup`'s
 * batch). A failed read refuses: a headcount of nothing would silently skip a levy threshold or a mass-layoff duty.
 */
export const staffingLookup = (from: HostRead | VersionFor) => {
	const load = ('entities' in from ? from.entities : undefined) ?? entityLoader(from as HostRead);
	return async (company_id: string, day: string): Promise<Staffing> =>
		staffingFrom((await load(company_id)).contracts, day);
};

/**
 * What a run's payslips add up to: the gross, net and employer cost, and each scheme's two shares and base
 * (`totals.schemes`); and `statutory.<SCHEME>` — the same with `charged_base` (each slip's insured or assessed amount,
 * summed) and `parts.<part>`, so a unit-level premium is priced on the run's insured total, not on the slips' shares.
 */
export const runTotals = (slips: readonly Row[]) => {
	const cents = (value: unknown) => Math.round((moneyNumber(value) ?? 0) * 100);
	type Sum = {
		employee: number;
		employer: number;
		base: number;
		charged_base: number;
		parts: Record<string, number>;
	};
	const schemes: Record<string, Sum> = {};
	let gross = 0;
	let net = 0;
	let employer_cost = 0;
	for (const slip of slips) {
		gross += cents(slip['gross']);
		net += cents(slip['net']);
		employer_cost += cents(slip['employer_cost']);
		const lines = slip['statutory'];
		for (const line of Array.isArray(lines) ? lines : []) {
			const held = rowOf(line);
			const code = text(held?.['scheme_code']);
			if (held == null || code == null) continue;
			const sum = schemes[code] ?? {
				employee: 0,
				employer: 0,
				base: 0,
				charged_base: 0,
				parts: {}
			};
			const parts = { ...sum.parts };
			for (const [part, value] of Object.entries(rowOf(held['parts']) ?? {}))
				parts[part] = (parts[part] ?? 0) + cents(value);
			schemes[code] = {
				employee: sum.employee + cents(held['employee_amount']),
				employer: sum.employer + cents(held['employer_amount']),
				base: sum.base + cents(held['base_amount']),
				charged_base: sum.charged_base + cents(held['charged_base']),
				parts
			};
		}
	}
	const units = (value: number) => value / 100;
	return {
		totals: {
			gross: units(gross),
			net: units(net),
			employer_cost: units(employer_cost),
			schemes: Object.fromEntries(
				Object.entries(schemes).map(([code, sum]) => [
					code,
					{ employee: units(sum.employee), employer: units(sum.employer), base: units(sum.base) }
				])
			)
		},
		statutory: Object.fromEntries(
			Object.entries(schemes).map(([code, sum]) => [
				code,
				{
					base: units(sum.base),
					charged_base: units(sum.charged_base),
					employee: units(sum.employee),
					employer: units(sum.employer),
					parts: Object.fromEntries(
						Object.entries(sum.parts).map(([part, value]) => [part, units(value)])
					)
				}
			])
		)
	};
};

/** One trigger row of a batch: its day, subjects, extra fields and the run or balances it carries. */
export type BehaviourEvent = {
	readonly row: Row;
	readonly day: string;
	readonly subjects: readonly Subject[];
	/** The trigger row's extra fields the rules name, as the trigger collection carries them. */
	readonly fields: (names: readonly string[]) => Promise<Row>;
	readonly run?: unknown;
	readonly leave_balances?: readonly unknown[];
};

type Shared = {
	readonly collection: string;
	readonly action: string;
	readonly versionFor: VersionFor;
	readonly read: HostRead;
	readonly act: Act;
	/** A shared `staffingLookup`, so a tick reads each entity's contracts once. */
	readonly staffing?: (company_id: string, day: string) => Promise<Staffing>;
};

/**
 * One trigger row through the governing version's behaviour rules, for each of its subjects: plan the rules whose
 * trigger is this collection and event, evaluate each `when`, load its declared reads and apply the writes its
 * `effect` returns, in order. Every `entity` row a rule reads carries its `headcount` on the event day, as does
 * `event`, beside the entity's `separations`. Nothing here knows what any behaviour means; the row taps and the daily
 * tick share it.
 */
export const runBehaviours = (input: Shared & BehaviourEvent): Promise<void> =>
	runBehaviourEvents({ ...input, events: [input] });

/** A declared read's clause that pins one subject: `{ eq: x }` or `{ in: [...] }` over plain values. */
const pinned = (clause: Json | undefined): readonly Json[] | undefined => {
	if (!isJsonObject(clause)) return undefined;
	const keys = Object.keys(clause);
	if (keys.length !== 1) return undefined;
	const operand = clause[keys[0]!];
	if (keys[0] === 'eq' && operand !== undefined && !isJsonObject(operand)) return [operand];
	if (keys[0] === 'in' && Array.isArray(operand)) return operand;
	return undefined;
};

/**
 * One declared read for many subjects at once. Identical `where`s share one read; `where`s differing only in one
 * field's `eq`/`in` read once over the union and split by that field; anything else reads per subject.
 */
const readFor = async (
	read: HostRead,
	declared: { readonly collection: string; readonly select?: readonly string[] | undefined },
	wheres: readonly (Json | undefined)[]
): Promise<readonly (readonly Row[])[]> => {
	const once = async (where: Json | undefined, extra?: string) =>
		(
			await read(declared.collection as Parameters<HostRead>[0], {
				...(where !== undefined && isJsonObject(where) ? { where } : {}),
				...(declared.select === undefined
					? {}
					: {
							select: Object.fromEntries(
								[...declared.select, ...(extra === undefined ? [] : [extra])].map((field) => [
									field,
									true
								])
							)
						}),
				all: true
			})
		).rows as readonly Row[];
	const out: (readonly Row[])[] = wheres.map(() => []);
	const live = wheres.flatMap((where, i) =>
		isJsonObject(where) && Object.values(where).some(emptyIn) ? [] : [i]
	);
	const first = wheres[live[0] ?? -1];
	if (live.length === 0) return out;
	const keys = [
		...new Set(live.flatMap((i) => (isJsonObject(wheres[i]) ? Object.keys(wheres[i]) : [])))
	];
	const varying = keys.filter(
		(key) =>
			new Set(live.map((i) => stableJson(isJsonObject(wheres[i]) ? wheres[i][key] : undefined)))
				.size > 1
	);
	if (varying.length === 0) {
		const rows = await once(first);
		for (const i of live) out[i] = rows;
		return out;
	}
	const [key] = varying;
	const values = live.map((i) => {
		const where = wheres[i];
		return pinned(isJsonObject(where) && key !== undefined ? where[key] : undefined);
	});
	// The split field must come back: a default projection carries a scalar, a narrowed one gains it.
	if (varying.length === 1 && key !== undefined && values.every((held) => held !== undefined)) {
		const union = [...new Set(values.flatMap((held) => held ?? []))];
		// `id` always comes back; another split field a narrowed select lacks is added and taken off again
		const added =
			key !== 'id' && declared.select !== undefined && !declared.select.includes(key)
				? key
				: undefined;
		const rows = await once({ ...(isJsonObject(first) ? first : {}), [key]: { in: union } }, added);
		if (rows.every((held) => key in held)) {
			live.forEach((i, at) => {
				const wanted = new Set<unknown>(values[at]);
				out[i] = rows
					.filter((held) => wanted.has(held[key]))
					.map((held) => {
						if (added === undefined) return held;
						const { [key]: _split, ...rest } = held;
						return rest;
					});
			});
			return out;
		}
	}
	await Promise.all(live.map(async (i) => (out[i] = await once(wheres[i]))));
	return out;
};

/** Two plain values as the stored order compares them: numbers as numbers, else their text. */
const compare = (left: unknown, right: unknown): number => {
	const [a, b] = [Number(left), Number(right)];
	if (
		Number.isFinite(a) &&
		Number.isFinite(b) &&
		String(left).trim() !== '' &&
		String(right).trim() !== ''
	)
		return a - b;
	return String(left).localeCompare(String(right));
};

/**
 * Whether a row written earlier in the run meets a declared read's resolved `where`, so a later rule or subject sees
 * it as the database would: `eq`, `ne`, `in`, `nin`, `lt(e)`, `gt(e)` and `isNull` on the row's own fields. A clause on
 * a field the write does not name, or any other operator, is taken as met (the write is the rule's own, so it names
 * the fields its duty is keyed on).
 */
const meets = (row: Row, where: Json | undefined): boolean =>
	!isJsonObject(where) ||
	Object.entries(where).every(([field, clause]) => {
		if (!(field in row)) return true;
		const value = row[field];
		if (!isJsonObject(clause)) return value === clause;
		return Object.entries(clause).every(([op, operand]) => {
			const same = (other: unknown) =>
				value != null && other != null && compare(value, other) === 0;
			switch (op) {
				case 'eq':
					return operand == null ? value == null : same(operand);
				case 'ne':
					return !same(operand);
				case 'in':
					return Array.isArray(operand) && operand.some(same);
				case 'nin':
					return !(Array.isArray(operand) && operand.some(same));
				case 'isNull':
					return operand === true ? value == null : value != null;
				case 'lt':
					return value != null && compare(value, operand) < 0;
				case 'lte':
					return value != null && compare(value, operand) <= 0;
				case 'gt':
					return value != null && compare(value, operand) > 0;
				case 'gte':
					return value != null && compare(value, operand) >= 0;
				default:
					return true;
			}
		});
	});

/** A declared read's rows with the run's earlier writes applied: updates merged by id, deletes dropped, creates that
 * meet it added. */
const overlaid = (
	rows: readonly Row[],
	collection: string,
	where: Json | undefined,
	writes: readonly BehaviourWrite[]
): readonly Row[] => {
	const mine = writes.filter((write) => write.collection === collection);
	if (mine.length === 0) return rows;
	let out = [...rows];
	for (const write of mine) {
		const data = write.data as Row;
		if (write.operation === 'delete') {
			const targets = new Set([data['target']].flat().map(String));
			out = out.filter((row) => !targets.has(String(row['id'])));
		} else if (write.operation === 'update') {
			const targets = new Set([data['target']].flat().map(String));
			const set = rowOf(data['set']) ?? {};
			out = out.flatMap((row) => {
				if (!targets.has(String(row['id']))) return [row];
				const next = { ...row, ...set };
				return meets(next, where) ? [next] : [];
			});
		} else if (meets(data, where)) out.push(data);
	}
	return out;
};

/**
 * Many trigger rows of one collection and event through their governing versions' rules (`runBehaviours` for each).
 * Every operation reads up front: the entities and versions of every subject (one keyed read), then every declared
 * read of every rule planned for any subject in any round — the union, read once per shape — in one crossing. Rules
 * run in their declared order; each sees the writes of the rules (and subjects) before it, applied to what it read,
 * and the run's writes are acted at the end, one act per callable.
 */
export const runBehaviourEvents = (
	input: Shared & { readonly events: readonly BehaviourEvent[] }
): Promise<void> =>
	runBehaviourGroups({
		...input,
		groups: [{ collection: input.collection, action: input.action, events: input.events }]
	});

/** One collection and event's trigger rows, for `runBehaviourGroups`. */
export type BehaviourGroup = {
	readonly collection: string;
	readonly action: string;
	readonly events: readonly BehaviourEvent[];
};

/**
 * `runBehaviourEvents` for several collections and events at once (the daily tick's entity calendar, open cases,
 * employments in force and ended ones): one prefetch for every group, the groups' rules applied in group order (a
 * later group sees an earlier one's writes) and every write acted at the end.
 */
export const runBehaviourGroups = async (
	input: Omit<Shared, 'collection' | 'action'> & { readonly groups: readonly BehaviourGroup[] }
): Promise<void> => {
	const staffing =
		input.staffing ??
		staffingLookup(input.versionFor.entities === undefined ? input.read : input.versionFor);
	// Identical declared reads share one answer.
	type Page = { readonly rows: readonly unknown[]; readonly next?: unknown };
	const held = new Map<string, Promise<Page>>();
	const read = Object.assign(
		<C extends ReadableName>(name: C, query: HostReadQuery) => {
			const key = stableJson([name, query]);
			const known =
				held.get(key) ??
				(() => {
					const page = input.read(name, query);
					held.set(key, page);
					return page;
				})();
			return known as Promise<{ readonly rows: readonly HostRow<C>[]; readonly next?: unknown }>;
		},
		input.read.set === undefined ? {} : { set: input.read.set }
	) satisfies HostRead;
	// Every subject's version and staffing at once: one keyed read across the entities.
	const pairs = input.groups.flatMap((group, g) =>
		group.events.flatMap((event) => event.subjects.map((subject) => ({ g, event, subject })))
	);
	const triggers = input.groups.map(({ collection, action }) => ({
		kind: 'row' as const,
		collection,
		event: action
	}));
	const resolved = await Promise.all(
		pairs.map(async ({ g, event, subject }) => ({
			g,
			event,
			subject,
			version: await input.versionFor(subject.company_id, event.day),
			staffed: await staffing(subject.company_id, event.day)
		}))
	);
	// Each planning subject's extra trigger fields, all at once.
	const candidatesOf = (version: Row | null, g: number) => {
		const behaviours = behavioursOf(version?.['behaviours']);
		return behaviours == null
			? []
			: behaviours.rules.filter((rule) => triggerMatches(rule, triggers[g]!));
	};
	const extras = await Promise.all(
		resolved.map(({ g, event, version }) => {
			const extra = [...new Set(candidatesOf(version, g).flatMap((rule) => rule.fields ?? []))];
			return extra.length === 0 ? Promise.resolve({}) : event.fields(extra);
		})
	);
	const planned: {
		readonly g: number;
		readonly context: CelContext;
		readonly rules: readonly Behaviour[];
		readonly day: string;
	}[] = [];
	for (const [n, { g, event, subject, version, staffed }] of resolved.entries()) {
		const behaviours = behavioursOf(version?.['behaviours']);
		if (version == null || behaviours == null || candidatesOf(version, g).length === 0) continue;
		const { day } = event;
		const { collection, action } = input.groups[g]!;
		const context = {
			event: {
				collection,
				action,
				row: { ...event.row, ...extras[n] },
				settings_id: version['id'],
				// the governing version's PAYROLL rule tables: the duties' `rules`
				rules: payrollRules(version),
				day,
				...staffed,
				leave_balances: event.leave_balances ?? [],
				period: {
					key: day.slice(0, 7),
					from: String(monthOf(day).from),
					to: String(monthOf(day).to)
				},
				...subject
			},
			...(event.run === undefined ? {} : { run: event.run })
		};
		planned.push({ g, context, rules: planBehaviours(behaviours, triggers[g]!, context), day });
	}
	// The steps in order: each group's rounds, each round's rules with the subjects that planned them.
	const steps: { readonly rule: Behaviour; readonly subjects: (typeof planned)[number][] }[] = [];
	for (const g of input.groups.keys()) {
		const mine = planned.filter((one) => one.g === g);
		const rounds = Math.max(0, ...mine.map((one) => one.rules.length));
		for (let round = 0; round < rounds; round++) {
			const byRule = new Map<Behaviour, (typeof planned)[number][]>();
			for (const one of mine) {
				const rule = one.rules[round];
				if (rule === undefined) continue;
				const group = byRule.get(rule);
				if (group === undefined) byRule.set(rule, [one]);
				else group.push(one);
			}
			for (const [rule, subjects] of byRule) steps.push({ rule, subjects });
		}
	}
	// Every declared read of every step, at once: one crossing for the whole run.
	const prepared = await Promise.all(
		steps.map(async ({ rule, subjects }) => {
			const declared = Object.entries(rule.reads ?? {});
			const wheres = declared.map(([, spec]) =>
				subjects.map((one) => resolveWhere(spec.where, one.context, rule))
			);
			const loaded = await Promise.all(
				declared.map(([, spec], n) => readFor(read, spec, wheres[n]!))
			);
			return { declared, wheres, loaded };
		})
	);
	// An entity a rule reads carries its headcount on the subject's day: every one read at once (one batch).
	const headcounts = new Map<string, number>();
	await Promise.all(
		steps.flatMap(({ subjects }, s) =>
			prepared[s]!.declared.flatMap(([, spec], n) =>
				spec.collection !== 'entity'
					? []
					: subjects.flatMap((one, i) =>
							prepared[s]!.loaded[n]![i]!.map(async (entity) => {
								const id = String(entity['id']);
								headcounts.set(`${id}:${one.day}`, (await staffing(id, one.day)).headcount);
							})
						)
			)
		)
	);
	const writes: BehaviourWrite[] = [];
	for (const [s, { rule, subjects }] of steps.entries()) {
		const { declared, wheres, loaded } = prepared[s]!;
		for (const [i, one] of subjects.entries()) {
			const reads: Record<string, unknown> = {};
			for (const [n, [name, spec]] of declared.entries()) {
				const rows = overlaid(loaded[n]![i]!, spec.collection, wheres[n]![i], writes);
				reads[name] =
					spec.collection !== 'entity'
						? rows
						: rows.map((entity) => ({
								...entity,
								headcount: headcounts.get(`${String(entity['id'])}:${one.day}`) ?? 0
							}));
			}
			writes.push(...effectWrites(rule, { ...one.context, ...reads }));
		}
	}
	// One act per callable, in the order each first appears; a callable's writes keep their order.
	const order = [...new Set(writes.map((write) => write.callable))];
	await actBehaviourWrites(
		input.act,
		order.flatMap((callable) => writes.filter((write) => write.callable === callable))
	);
};
