import { Array as EffectArray } from 'effect';
import { Predicate } from 'effect';
import type { Context as CelContext } from '@marcbachmann/cel-js';
import type { Act, Id, ReadableName, Row as BoltRow, Where } from '@norbital-ai/bolt';
import { inputSchema } from '@norbital-ai/std/kind';
import { monthOf, PlainDate } from '@norbital-ai/std/date';
import { Decimal } from '@norbital-ai/std/decimal';
import { Cache, Duration, Effect, Exit, Request, RequestResolver, Result, Schema } from 'effect';
import {
	actBehaviourWrites,
	type Behaviour,
	type BehaviourRead,
	type BehaviourWrite,
	behavioursOf,
	effectWrites,
	planBehaviours,
	resolveWhere,
	triggerMatches
} from './behaviours.js';
import {
	declaredRead,
	type JsonRead,
	type Read,
	type ReadError,
	fieldValue,
	isJsonObject,
	type Json,
	type JsonObject,
	payrollSetting,
	Reads,
	readsFrom,
	Refusal,
	stableJson
} from './foundation.js';
import { chainStarts, leaveBalances } from './leave.js';
import {
	idsOf,
	leaveState,
	loadLeaveState,
	type LeaveStateRead,
	payrollRules,
	versionOn
} from './payslip/context.js';
import { CATALOG_DETAILS, CONTRACT, SETTINGS, RULE_SET } from './rows.js';
import { staffingFrom } from './admit.js';
export type Row = Readonly<Record<string, unknown>>;
const Record_ = Schema.Record(Schema.String, Schema.Unknown);
export const rowOf = (value: unknown): Row | undefined =>
	Schema.is(Record_)(value) ? value : undefined;
export const text = (value: unknown): string | null =>
	Predicate.isString(value) && value !== '' ? value : null;
/** Who a trigger row is about: the entity whose jurisdiction it settles under, and the employment and person. */
export type Subject = {
	readonly company_id: Id<'entity'>;
	readonly employment_id: Id<'employment_contract'> | null;
	readonly employee_id: Id<'employment_profile'> | null;
};
/** An entry model's catalogue. */
const CATALOGS = {
	leave_catalog_entry: 'leave_catalog',
	claim_catalog_entry: 'claim_catalog',
	adhoc_catalog_entry: 'adhoc_catalog',
	loan_catalog_entry: 'loan_catalog'
} as const;
const isEntry = (collection: string): collection is keyof typeof CATALOGS => collection in CATALOGS;
/** The ids of `of` among stored values a trigger row carries: the next read's literal `{ in: [...] }`. */
export const idsAs = <C extends ReadableName>(of: C, values: readonly unknown[]): Id<C>[] => {
	const is = Schema.is(inputSchema({ kind: 'id', of }));
	return [...new Set(values.filter((value): value is Id<C> => is(value)))];
};
/** Stored time-off movements; their catalogue codes are read by `leaveFrom` through their actual foreign keys. */
export const leaveRequest = (where: Where<'leave_catalog_entry'>, since?: string) =>
	({
		leave_catalog_entry: {
			where: {
				...where,
				activity: { eq: 'TIME_OFF' },
				...(since === undefined ? {} : { occurred_on: { gte: PlainDate(since) } })
			},
			fields: ['employment_id', 'catalog_id', 'occurred_on', 'from', 'to', 'days', 'facts']
		}
	}) as const;
type LeaveEntry = Pick<
	BoltRow<'leave_catalog_entry'>,
	'id' | 'employment_id' | 'catalog_id' | 'occurred_on' | 'from' | 'to' | 'days' | 'facts'
>;
type LeaveCatalog = Pick<BoltRow<'leave_catalog'>, 'id' | 'code'>;
/** Movement chains are ordinary domain values assembled from actual stored entries and catalogues. */
export const leaveFrom = Effect.fnUntraced(function* (
	read: Read,
	rows: readonly LeaveEntry[],
	catalogues?: readonly LeaveCatalog[]
) {
	const classes =
		catalogues ??
		(yield* read({
			leave_catalog: {
				where: { id: { in: [...new Set(rows.map((row) => row.catalog_id))] } },
				fields: ['code']
			}
		})).leave_catalog.rows;
	const codes = new Map(classes.map((row) => [row.id, row.code]));
	const fromOf = (row: LeaveEntry) => row.from ?? row.occurred_on;
	const coded: { readonly row: LeaveEntry; readonly code: string }[] = [];
	for (const row of rows) {
		const code = codes.get(row.catalog_id);
		if (code === undefined)
			return yield* new Refusal({
				message: 'A leave movement needs its actual approved catalogue.'
			});
		coded.push({ row, code });
	}
	const chains = chainStarts(
		coded.map(({ row, code }) => ({
			id: row.id,
			key: `${row.employment_id}:${code}`,
			from: fromOf(row),
			to: row.to ?? fromOf(row)
		}))
	);
	const out = new Map<string, Row[]>();
	for (const { row, code } of coded.toSorted((left, right) =>
		fromOf(left.row).localeCompare(fromOf(right.row))
	)) {
		if (row.employment_id === null) continue;
		const from = fromOf(row);
		out.set(row.employment_id, [
			...(out.get(row.employment_id) ?? []),
			{
				id: row.id,
				code,
				from,
				to: row.to ?? from,
				chain_from: chains.get(row.id) ?? from,
				days: row.days?.toNumber() ?? 0,
				facts: row.facts
			}
		]);
	}
	return out;
});
/**
 * Many employments' leave balances, each on its own day, from one leave-state read (`loadLeaveState`); an employment whose state
 * cannot be read has none. The reads its classes' attendance needs cross together, over one batched reader.
 */
export const leaveBalancesFor = Effect.fnUntraced(function* (
	read: Read,
	wants: Parameters<typeof loadLeaveState>[1],
	options: {
		readonly withoutExitEffects?: boolean | undefined;
		readonly prefetched?: LeaveStateRead | undefined;
	} = {}
) {
	if (wants.length === 0) return [];
	const prefetched = options.prefetched ?? (yield* loadLeaveState(read, wants));
	const got = !options.withoutExitEffects
		? prefetched
		: {
				...prefetched,
				entries: {
					...prefetched.entries,
					rows: prefetched.entries.rows.filter(
						(movement) =>
							movement.payslip_id !== null ||
							!String(movement.reference ?? '').startsWith(`exit:${movement.employment_id}:`)
					)
				}
			};
	return yield* Effect.forEach(
		wants,
		({ employment_id, asOf }) =>
			leaveState(employment_id, asOf, got).pipe(
				Effect.provideService(Reads, readsFrom(read)),
				Effect.map(leaveBalances),
				Effect.catchTag('Refusal', () => Effect.succeed([]))
			),
		{ concurrency: 'unbounded' }
	);
});
/** The terms a contract write added or changed: those of `facts` its `before.facts` did not hold. */
const termsWritten = (row: Row): unknown[] => {
	const terms = (facts: unknown) => {
		const held = rowOf(facts)?.['contract_terms'];
		return EffectArray.isArray(held) ? held : [];
	};
	const before = rowOf(row['before']);
	if (before == null || !('facts' in before)) return [];
	const prior = new Set(terms(before['facts']).map(stableJson));
	return terms(row['facts']).filter((term) => !prior.has(stableJson(term)));
};
/**
 * Trigger rows as the rules read them (`event.row`): a contract carries its employment's time off (`leave[]`) and the
 * terms its write added or changed (`terms_written[]`); a payslip carries the day it was paid (`paid_on`, the UTC day of
 * `paid_at`), its line codes (`line_codes`, base and adjustments) and its run's `pay_date` and `pay_due_date` (a
 * late payment's days and interest); an entry carries its class (`catalog_code`, and the class row as `catalog`).
 * Each enrichment is its own dependent read over the rows' actual foreign keys.
 */
export const describeRows = Effect.fnUntraced(function* (
	read: Read,
	collection: string,
	triggers: readonly Row[]
) {
	if (collection === 'payslip') {
		const { payslip } = yield* read({
			payslip: {
				where: {
					id: {
						in: idsAs(
							'payslip',
							triggers.map((row) => row['id'])
						)
					}
				},
				fields: ['base', 'adjustments', 'payroll_run_id']
			}
		});
		const { payroll_run } = yield* read({
			payroll_run: {
				where: { id: { in: idsOf(payslip.rows.map((row) => row.payroll_run_id)) } },
				fields: ['pay_date', 'pay_due_date']
			}
		});
		const lines = new Map<string, (typeof payslip.rows)[number]>(
			payslip.rows.map((row) => [row.id, row])
		);
		const runs = new Map<string, (typeof payroll_run.rows)[number]>(
			payroll_run.rows.map((row) => [row.id, row])
		);
		return triggers.map((row) => {
			const paid = text(row['paid_at']);
			const held = lines.get(String(row['id']));
			const run = held === undefined ? undefined : runs.get(String(held.payroll_run_id));
			const codes = [...(held?.base ?? []), ...(held?.adjustments ?? [])].map(
				(line) => line.component_code
			);
			const details = {
				line_codes: [...new Set(codes)],
				pay_date: run?.pay_date ?? null,
				pay_due_date: run?.pay_due_date ?? null,
				...(paid === null ? {} : { paid_on: paid.slice(0, 10) })
			};
			const described: Row & typeof details = { ...row, ...details };
			return described;
		});
	}
	const employment =
		collection === 'employment_contract'
			? idsAs(
					'employment_contract',
					triggers.map((row) => row['id'])
				)
			: collection === 'leave_catalog_entry'
				? idsAs(
						'employment_contract',
						triggers.map((row) => row['employment_id'])
					)
				: [];
	const leave =
		employment.length === 0
			? new Map<string, Row[]>()
			: yield* leaveFrom(
					read,
					(yield* read(leaveRequest({ employment_id: { in: employment } }))).leave_catalog_entry
						.rows
				);
	if (collection === 'employment_contract')
		return triggers.map((row) => {
			const details = {
				leave: leave.get(String(row['id'])) ?? [],
				terms_written: termsWritten(row)
			};
			const described: Row & typeof details = { ...row, ...details };
			return described;
		});
	const rows: readonly Row[] =
		collection === 'leave_catalog_entry'
			? triggers.map((row) => {
					const held = leave.get(text(row['employment_id']) ?? '') ?? [];
					const own = held.find((movement) => movement['id'] === row['id']);
					return { ...row, leave: held, chain_from: own?.['chain_from'] ?? text(row['from']) };
				})
			: triggers;
	if (!isEntry(collection)) return rows;
	const ids = triggers.map((row) => row['catalog_id']);
	const catalogues: readonly { readonly id: string; readonly code: unknown }[] =
		collection === 'leave_catalog_entry'
			? (yield* read({
					leave_catalog: {
						where: { id: { in: idsAs('leave_catalog', ids) } },
						fields: CATALOG_DETAILS.leave_catalog
					}
				})).leave_catalog.rows
			: collection === 'claim_catalog_entry'
				? (yield* read({
						claim_catalog: {
							where: { id: { in: idsAs('claim_catalog', ids) } },
							fields: CATALOG_DETAILS.claim_catalog
						}
					})).claim_catalog.rows
				: collection === 'adhoc_catalog_entry'
					? (yield* read({
							adhoc_catalog: {
								where: { id: { in: idsAs('adhoc_catalog', ids) } },
								fields: CATALOG_DETAILS.adhoc_catalog
							}
						})).adhoc_catalog.rows
					: (yield* read({
							loan_catalog: {
								where: { id: { in: idsAs('loan_catalog', ids) } },
								fields: CATALOG_DETAILS.loan_catalog
							}
						})).loan_catalog.rows;
	const byId = new Map(catalogues.map((row) => [row.id, row]));
	return rows.map((row) => {
		const catalog = byId.get(text(row['catalog_id']) ?? '') ?? null;
		const details = { catalog_code: catalog?.code ?? null, catalog };
		const described: Row & typeof details = {
			...row,
			...details,
			// Older sealed JP emergency-payment rules name the removed column; use only the actual advance date.
			...(collection === 'loan_catalog_entry'
				? { occurred_on: row['advance_made_on'] ?? null }
				: {})
		};
		return described;
	});
});
/** A `where` clause over an empty list: it matches nothing. */
const emptyIn = (clause: unknown): boolean =>
	isJsonObject(clause) && EffectArray.isArray(clause['in']) && clause['in'].length === 0;
/**
 * Entities, their contracts, their lineage versions (named by the entity's code: no relation) and those versions'
 * PAYROLL rules: two dependent reads.
 */
export const readEntities = Effect.fnUntraced(function* (read: Read, where: Where<'entity'>) {
	const first = yield* read({ entity: { where, fields: ['settings_code'] } });
	const entityIds = first.entity.rows.map((row) => row.id);
	const second = yield* read({
		employment_contract: { where: { company_id: { in: entityIds } }, fields: CONTRACT },
		jurisdiction_settings: {
			where: {
				code: { in: idsOf(first.entity.rows.map((row) => row.settings_code)) },
				voided_at: { isNull: true },
				sealed_at: { isNull: false }
			},
			fields: SETTINGS
		},
		'jurisdiction_settings.rule_set': { where: { family: { eq: 'PAYROLL' } }, fields: RULE_SET }
	});
	return {
		entities: first.entity,
		contracts: second.employment_contract,
		versions: second.jurisdiction_settings
	};
});
type EntityRead = Effect.Success<ReturnType<typeof readEntities>>;
type BehaviourVersion = EntityRead['versions']['rows'][number];
type EntityHeld = {
	readonly settings_code: EntityRead['entities']['rows'][number]['settings_code'] | null;
	readonly versions: readonly BehaviourVersion[];
	readonly contracts: EntityRead['contracts']['rows'];
};
const heldFrom = (got: EntityRead, id: Id<'entity'>): EntityHeld => {
	const entity = got.entities.rows.find((row) => row.id === id);
	const settings_code = entity?.settings_code ?? null;
	return {
		settings_code,
		versions: got.versions.rows.filter((row) => row.code === settings_code),
		contracts: got.contracts.rows.filter((row) => row.company_id === id)
	};
};
type Loader = ((company_id: Id<'entity'>) => Effect.Effect<EntityHeld, ReadError>) & {
	readonly prime: (got: EntityRead) => Effect.Effect<void>;
};
/** The cache and its single zero-delay resolver belong to this invocation. */
const entityLoader = Effect.fnUntraced(function* (read: Read) {
	interface EntityRequest extends Request.Request<EntityHeld, ReadError> {
		readonly company_id: Id<'entity'>;
	}
	const EntityRequest = Request.of<EntityRequest>();
	const resolver = RequestResolver.make<EntityRequest>((entries) =>
		readEntities(read, { id: { in: entries.map((entry) => entry.request.company_id) } }).pipe(
			Effect.result,
			Effect.map((answer) => {
				for (const entry of entries)
					entry.completeUnsafe(
						Result.isFailure(answer)
							? Exit.fail(answer.failure)
							: Exit.succeed(heldFrom(answer.success, entry.request.company_id))
					);
			})
		)
	).pipe(RequestResolver.setDelayEffect(Effect.yieldNow));
	const cache = yield* Cache.make({
		lookup: (company_id: Id<'entity'>) => Effect.request(EntityRequest({ company_id }), resolver),
		capacity: Number.MAX_SAFE_INTEGER,
		timeToLive: Duration.infinity
	});
	return Object.assign((company_id: Id<'entity'>) => Cache.get(cache, company_id), {
		prime: (got: EntityRead) =>
			Effect.forEach(
				got.entities.rows,
				(entity) =>
					Cache.has(cache, entity.id).pipe(
						Effect.flatMap((known) =>
							known ? Effect.void : Cache.set(cache, entity.id, heldFrom(got, entity.id))
						)
					),
				{ discard: true }
			)
	}) satisfies Loader;
});
export type VersionFor = ((
	company_id: Id<'entity'>,
	day: string
) => Effect.Effect<BehaviourVersion | null, ReadError>) & { readonly entities: Loader };
export const primeEntities = (versionFor: VersionFor, got: EntityRead) =>
	versionFor.entities.prime(got);
export const versionLookup = Effect.fnUntraced(function* (read: Read) {
	const load = yield* entityLoader(read);
	return Object.assign(
		(company_id: Id<'entity'>, day: string) =>
			load(company_id).pipe(
				Effect.map(({ settings_code, versions }) => {
					if (settings_code === null) return null;
					const outcome = versionOn(versions, settings_code, day);
					return Result.isFailure(outcome)
						? null
						: (versions.find((row) => row.id === outcome.success.id) ?? null);
				})
			),
		{ entities: load }
	) satisfies VersionFor;
});
type Staffing = {
	readonly headcount: number;
	readonly headcount_permanent: number;
	readonly headcount_by_worksite: Readonly<Record<string, number>>;
	readonly headcount_permanent_by_worksite: Readonly<Record<string, number>>;
	readonly headcount_months: readonly unknown[];
	readonly previous_year_headcount_months?: readonly unknown[];
	readonly separations: readonly unknown[];
};
/**
 * The entity's staffing on a day (`services.staffingFrom`), its contracts read with its lineage (`versionLookup`'s
 * batch). A failed read refuses: a headcount of nothing would silently skip a levy threshold or a mass-layoff duty.
 * This invocation shares each entity/day calculation before any group's writes are acted.
 */
export const staffingLookup = Effect.fnUntraced(function* (from: VersionFor) {
	const cache = yield* Cache.make({
		lookup: ({ company_id, day }: { readonly company_id: Id<'entity'>; readonly day: string }) =>
			from.entities(company_id).pipe(
				Effect.flatMap(({ settings_code, versions, contracts }) =>
					Effect.fromResult(
						Result.gen(function* () {
							// Permanent headcount is the governing version's `payroll.permanent_when`.
							const version = yield* versionOn(versions, settings_code, day);
							const payroll = yield* fieldValue(version.payroll, 'jurisdiction_settings.payroll');
							return yield* staffingFrom(
								contracts,
								day,
								yield* payrollSetting(version.code, payroll, 'permanent_when')
							);
						})
					)
				)
			),
		capacity: Number.MAX_SAFE_INTEGER,
		timeToLive: Duration.infinity
	});
	return (company_id: Id<'entity'>, day: string) => Cache.get(cache, { company_id, day });
});
/**
 * What a run's payslips add up to: the gross, net and employer cost, and each scheme's two shares and base
 * (`totals.schemes`); and `statutory.<SCHEME>` — the same with `charged_base` (each slip's insured or assessed amount,
 * summed) and `parts.<part>`, so a unit-level premium is priced on the run's insured total, not on the slips' shares.
 */
export const runTotals = (slips: readonly Row[]) => {
	// Exact decimal sums of the slips' own amounts: no minor-unit scale is assumed. A stored statutory amount is
	// already rounded, so its shortest decimal text is exact.
	const money = (value: unknown) => (value instanceof Decimal ? value : Decimal.of(0));
	const statutoryMoney = (value: unknown) =>
		Decimal.of(String(Schema.is(Schema.Finite)(value) ? value : 0));
	type Sum = {
		employee: Decimal;
		employer: Decimal;
		base: Decimal;
		charged_base: Decimal;
		parts: Record<string, Decimal>;
	};
	const schemes: Record<string, Sum> = {};
	let gross = Decimal.of(0);
	let net = Decimal.of(0);
	let employer_cost = Decimal.of(0);
	for (const slip of slips) {
		gross = gross.plus(money(slip['gross']));
		net = net.plus(money(slip['net']));
		employer_cost = employer_cost.plus(money(slip['employer_cost']));
		const lines = slip['statutory'];
		for (const line of EffectArray.isArray(lines) ? lines : []) {
			const held = rowOf(line);
			const code = text(held?.['scheme_code']);
			if (held == null || code == null) continue;
			const sum = schemes[code] ?? {
				employee: Decimal.of(0),
				employer: Decimal.of(0),
				base: Decimal.of(0),
				charged_base: Decimal.of(0),
				parts: {}
			};
			const parts = { ...sum.parts };
			for (const [part, value] of Object.entries(rowOf(held['parts']) ?? {}))
				parts[part] = (parts[part] ?? Decimal.of(0)).plus(statutoryMoney(value));
			schemes[code] = {
				employee: sum.employee.plus(statutoryMoney(held['employee_amount'])),
				employer: sum.employer.plus(statutoryMoney(held['employer_amount'])),
				base: sum.base.plus(statutoryMoney(held['base_amount'])),
				charged_base: sum.charged_base.plus(statutoryMoney(held['charged_base'])),
				parts
			};
		}
	}
	const units = (value: Decimal) => value.toNumber();
	return {
		totals: {
			gross: units(gross),
			net: units(net),
			employer_cost: units(employer_cost),
			schemes: Object.fromEntries(
				Object.entries(schemes).map(([code, sum]): [string, JsonObject] => [
					code,
					{ employee: units(sum.employee), employer: units(sum.employer), base: units(sum.base) }
				])
			)
		},
		statutory: Object.fromEntries(
			Object.entries(schemes).map(([code, sum]): [string, JsonObject] => [
				code,
				{
					base: units(sum.base),
					charged_base: units(sum.charged_base),
					employee: units(sum.employee),
					employer: units(sum.employer),
					parts: Object.fromEntries(
						Object.entries(sum.parts).map(([part, value]): [string, number] => [part, units(value)])
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
	/** The trigger row's extra fields the rules name, as the trigger model carries them. */
	readonly fields: (names: readonly string[]) => Effect.Effect<Row, Refusal>;
	readonly run?: unknown;
	readonly leave_balances?: readonly unknown[];
};
type Shared = {
	readonly collection: string;
	readonly action: string;
	readonly versionFor: VersionFor;
	readonly read: JsonRead;
	readonly act: Pick<Act, 'checked'>;
	/** A shared `staffingLookup`, so a tick computes each entity and day's staffing once. */
	readonly staffing?: (company_id: Id<'entity'>, day: string) => Effect.Effect<Staffing, ReadError>;
};
/**
 * One trigger row through the governing version's behaviour rules, for each of its subjects: plan the rules whose
 * trigger is this model and event, evaluate each `when`, load its declared reads and apply the writes its
 * `effect` returns, in order. Every `entity` row a rule reads carries its `headcount` on the event day, as does
 * `event`, beside the entity's `separations`. Nothing here knows what any behaviour means; the row taps and the daily
 * tick share it.
 */
export const runBehaviours = (input: Shared & BehaviourEvent) =>
	runBehaviourEvents({ ...input, events: [input] });
/** A declared read's clause that pins one subject: `{ eq: x }` or `{ in: [...] }` over plain values. */
const pinned = (clause: Json | undefined): readonly Json[] | undefined => {
	if (!isJsonObject(clause)) return undefined;
	const [op, ...more] = Object.keys(clause);
	if (op === undefined || more.length !== 0) return undefined;
	const operand = clause[op];
	if (op === 'eq' && operand !== undefined && !isJsonObject(operand)) return [operand];
	if (op === 'in' && EffectArray.isArray<typeof operand>(operand)) return operand;
	return undefined;
};
/** One rule-declared layer: its `where` and `fields` as the rule data states them (JSON, checked by the host). */
type DeclaredLayer = { readonly where?: JsonObject; readonly fields?: readonly string[] };
type DeclaredRead = (
	collection: BehaviourRead['collection'],
	query: DeclaredLayer
) => Effect.Effect<
	{
		readonly rows: readonly Row[];
		readonly companies: readonly (readonly [string, Id<'entity'>])[];
	},
	ReadError
>;
/**
 * One declared read for many subjects at once. Identical `where`s share one read; `where`s differing only in one
 * field's `eq`/`in` read once over the union and split by that field; anything else reads per subject.
 */
const readFor = Effect.fnUntraced(function* (
	read: DeclaredRead,
	declared: BehaviourRead,
	wheres: readonly (Json | undefined)[]
) {
	const collection = declared.collection;
	const companies = new Map<string, Id<'entity'>>();
	const once = (where: Json | undefined, extra?: string) => {
		// `id` always comes back
		const query: DeclaredLayer = {
			...(isJsonObject(where) ? { where } : {}),
			...(declared.select === undefined
				? {}
				: {
						fields: [...declared.select, ...(extra === undefined ? [] : [extra])].filter(
							(field) => field !== 'id'
						)
					})
		};
		return read(collection, query).pipe(
			Effect.map((page) => {
				for (const [key, id] of page.companies) companies.set(key, id);
				return page.rows;
			})
		);
	};
	const out: (readonly Row[])[] = wheres.map(() => []);
	const live = wheres.flatMap((where, i) =>
		isJsonObject(where) && Object.values(where).some(emptyIn) ? [] : [i]
	);
	const first = wheres[live[0] ?? -1];
	if (live.length === 0) return { rows: out, companies };
	const keys = [
		...new Set(live.flatMap((i) => (isJsonObject(wheres[i]) ? Object.keys(wheres[i]) : [])))
	];
	const varying = keys.filter(
		(key) =>
			new Set(live.map((i) => stableJson(isJsonObject(wheres[i]) ? wheres[i][key] : undefined)))
				.size > 1
	);
	if (varying.length === 0) {
		const rows = yield* once(first);
		for (const i of live) out[i] = rows;
		return { rows: out, companies };
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
		const rows = yield* once(
			{ ...(isJsonObject(first) ? first : {}), [key]: { in: union } },
			added
		);
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
		return { rows: out, companies };
	}
	yield* Effect.forEach(
		live,
		(i) =>
			once(wheres[i]).pipe(
				Effect.map((rows) => {
					out[i] = rows;
				})
			),
		{ concurrency: 'unbounded' }
	);
	return { rows: out, companies };
});
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
const same = (value: unknown, other: unknown) =>
	value != null && other != null && compare(value, other) === 0;
/** Each `where` operator the overlay judges, on a written field's value as the database would. */
const OPERATORS = {
	eq: (value, operand) => (operand == null ? value == null : same(value, operand)),
	ne: (value, operand) => !same(value, operand),
	in: (value, operand) =>
		EffectArray.isArray<typeof operand>(operand) && operand.some((other) => same(value, other)),
	nin: (value, operand) =>
		!(EffectArray.isArray<typeof operand>(operand) && operand.some((other) => same(value, other))),
	isNull: (value, operand) => (operand === true ? value == null : value != null),
	lt: (value, operand) => value != null && compare(value, operand) < 0,
	lte: (value, operand) => value != null && compare(value, operand) <= 0,
	gt: (value, operand) => value != null && compare(value, operand) > 0,
	gte: (value, operand) => value != null && compare(value, operand) >= 0
} satisfies Record<string, (value: unknown, operand: Json) => boolean>;
const isOperator = (op: string): op is keyof typeof OPERATORS => Object.hasOwn(OPERATORS, op);
/** One clause of a resolved `where`: the field it reads and whether a value meets it. */
type Clause = {
	readonly field: string;
	readonly test: (value: unknown) => boolean;
};
/**
 * A declared read's resolved `where` as clauses the overlay judges: a literal is the field's own value, an operator one
 * of `OPERATORS`. Any other operator refuses: taking it as met would show a later rule a write the database would not.
 */
const clausesOf = (
	rule: Behaviour,
	collection: string,
	where: Json | undefined
): Result.Result<readonly Clause[], Refusal> => {
	const clauses: Clause[] = [];
	for (const [field, clause] of isJsonObject(where) ? Object.entries(where) : []) {
		if (!isJsonObject(clause)) {
			clauses.push({ field, test: (value) => value === clause });
			continue;
		}
		for (const [op, operand] of Object.entries(clause)) {
			if (!isOperator(op))
				return Result.fail(
					new Refusal({
						message: `Behaviour ${rule.id} reads ${collection} with the operator ${op}, which the run's earlier writes cannot be judged by.`
					})
				);
			clauses.push({ field, test: (value) => OPERATORS[op](value, operand) });
		}
	}
	return Result.succeed(clauses);
};
/**
 * Whether a row written earlier in the run meets a declared read's clauses, so a later rule or subject sees it as the
 * database would. A clause on a field the write does not name is taken as met (the write is the rule's own, so it
 * names the fields its duty is keyed on).
 */
const meets = (row: Row, clauses: readonly Clause[]): boolean =>
	clauses.every(({ field, test }) => !(field in row) || test(row[field]));
/** A declared read's rows with the run's earlier writes applied: updates merged by id, deletes dropped, creates that
 * meet it added. */
const overlaid = (
	rule: Behaviour,
	rows: readonly Row[],
	collection: string,
	where: Json | undefined,
	writes: readonly BehaviourWrite[]
): Result.Result<readonly Row[], Refusal> => {
	const mine = writes.filter((write) => write.collection === collection);
	if (mine.length === 0) return Result.succeed(rows);
	const decoded = clausesOf(rule, collection, where);
	if (Result.isFailure(decoded)) return Result.fail(decoded.failure);
	const clauses = decoded.success;
	let out = [...rows];
	for (const write of mine) {
		const data: Row = { ...write.data };
		if (write.operation === 'delete') {
			const targets = new Set([data['target']].flat().map(String));
			out = out.filter((row) => !targets.has(String(row['id'])));
		} else if (write.operation === 'update') {
			const targets = new Set([data['target']].flat().map(String));
			const set = rowOf(data['set']) ?? {};
			out = out.flatMap((row) => {
				if (!targets.has(String(row['id']))) return [row];
				const next = { ...row, ...set };
				return meets(next, clauses) ? [next] : [];
			});
		} else if (meets(data, clauses)) out.push(data);
	}
	return Result.succeed(out);
};
type PlannedBehaviour = {
	readonly g: number;
	readonly context: CelContext;
	readonly rules: readonly Behaviour[];
	readonly day: string;
};
type BehaviourStep = { readonly rule: Behaviour; readonly subjects: readonly PlannedBehaviour[] };
const prepareStep = Effect.fnUntraced(function* (read: DeclaredRead, step: BehaviourStep) {
	const reads = yield* Effect.forEach(
		Object.entries(step.rule.reads ?? {}),
		Effect.fnUntraced(function* ([name, spec]) {
			const wheres = step.subjects.map((one) => resolveWhere(spec.where, one.context, step.rule));
			const loaded = yield* readFor(read, spec, wheres);
			const subjects = new Map<
				PlannedBehaviour,
				{
					readonly one: PlannedBehaviour;
					readonly rows: readonly Row[];
					readonly where: Json | undefined;
				}
			>();
			for (const [index, one] of step.subjects.entries()) {
				const rows = loaded.rows[index];
				if (rows === undefined)
					return yield* new Refusal({
						message: 'The behaviour read did not answer every planning subject.'
					});
				subjects.set(one, { one, rows, where: wheres[index] });
			}
			return { name, spec, subjects, companies: loaded.companies };
		}),
		{ concurrency: 'unbounded' }
	);
	return { ...step, reads };
});
/**
 * Many trigger rows of one model and event through their governing versions' rules (`runBehaviours` for each).
 * Every operation reads up front: the entities and versions of every subject (one keyed read), then every declared
 * read of every rule planned for any subject in any round — the union, read once per shape — in one crossing. Rules
 * run in their declared order; each sees the writes of the rules (and subjects) before it, applied to what it read,
 * and the run's writes are acted at the end, one act per callable.
 */
export const runBehaviourEvents = (
	input: Shared & {
		readonly events: readonly BehaviourEvent[];
	}
) =>
	runBehaviourGroups({
		...input,
		groups: [{ collection: input.collection, action: input.action, events: input.events }]
	});
/** One model and event's trigger rows, for `runBehaviourGroups`. */
type BehaviourGroup = {
	readonly collection: string;
	readonly action: string;
	readonly events: readonly BehaviourEvent[];
};
/**
 * `runBehaviourEvents` for several models and events at once (the daily tick's entity calendar, open cases,
 * employments in force and ended ones): one prefetch for every group, the groups' rules applied in group order (a
 * later group sees an earlier one's writes) and every write acted at the end.
 */
export const runBehaviourGroups = Effect.fnUntraced(function* (
	input: Omit<Shared, 'collection' | 'action'> & {
		readonly groups: readonly BehaviourGroup[];
	}
) {
	const staffing = input.staffing ?? (yield* staffingLookup(input.versionFor));
	// Every subject's version and staffing at once: one keyed read across the entities.
	const pairs = input.groups.flatMap((group, g) =>
		group.events.flatMap((event) => event.subjects.map((subject) => ({ g, event, subject, group })))
	);
	const resolved = yield* Effect.forEach(
		pairs,
		({ g, group, event, subject }) =>
			// staffing is read only where a version governs the day: a day no version governs runs no rule
			Effect.gen(function* () {
				const version = yield* input.versionFor(subject.company_id, event.day);
				const staffed =
					version == null ? undefined : yield* staffing(subject.company_id, event.day);
				return { version, staffed };
			}).pipe(
				Effect.flatMap(({ version, staffed }) =>
					Effect.fromResult(
						fieldValue(version?.behaviours, 'jurisdiction_settings.behaviours')
					).pipe(
						Effect.map((value) => ({
							g,
							group,
							event,
							subject,
							version,
							staffed,
							behaviours: behavioursOf(value)
						}))
					)
				)
			),
		{ concurrency: 'unbounded' }
	);
	// Each planning subject's extra trigger fields, all at once.
	const candidatesOf = (behaviours: ReturnType<typeof behavioursOf>, group: BehaviourGroup) => {
		return behaviours == null
			? []
			: behaviours.rules.filter((rule) =>
					triggerMatches(rule, { kind: 'row', collection: group.collection, event: group.action })
				);
	};
	const enriched = yield* Effect.forEach(
		resolved,
		(one) => {
			const extra = [
				...new Set(candidatesOf(one.behaviours, one.group).flatMap((rule) => rule.fields ?? []))
			];
			return (extra.length === 0 ? Effect.succeed({}) : one.event.fields(extra)).pipe(
				Effect.map((fields) => ({ ...one, fields }))
			);
		},
		{ concurrency: 'unbounded' }
	);
	const planned: PlannedBehaviour[] = [];
	for (const { g, group, event, subject, version, staffed, behaviours, fields } of enriched) {
		if (version == null || behaviours == null || candidatesOf(behaviours, group).length === 0)
			continue;
		const { day } = event;
		const { collection, action } = group;
		const context = {
			event: {
				collection,
				action,
				row: { ...event.row, ...fields },
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
		planned.push({
			g,
			context,
			rules: planBehaviours(behaviours, { kind: 'row', collection, event: action }, context),
			day
		});
	}
	// The steps in order: each group's rounds, each round's rules with the subjects that planned them.
	const steps: BehaviourStep[] = [];
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
	// Identical declared queries share one native read across every rule and planning subject.
	const queries = new Map<
		string,
		{ readonly collection: BehaviourRead['collection']; readonly query: DeclaredLayer }
	>();
	const pages = yield* Cache.make({
		lookup: (key: string) =>
			Effect.gen(function* () {
				const request = queries.get(key);
				if (request === undefined)
					return yield* new Refusal({
						message: 'The behaviour read needs its declared native query.'
					});
				// the rule data names the model and its JSON `where`/`fields`: a runtime-checked read request
				const declared = yield* Effect.fromResult(
					declaredRead({ [request.collection]: request.query })
				);
				const rows = (yield* input.read(declared))[request.collection]?.rows ?? [];
				return {
					rows,
					companies:
						request.collection === 'entity'
							? idsAs(
									'entity',
									rows.map((entity) => entity.id)
								).map((id) => [id, id] as const)
							: []
				};
			}),
		capacity: Number.MAX_SAFE_INTEGER,
		timeToLive: Duration.infinity
	});
	const read: DeclaredRead = (collection, query) => {
		const key = stableJson([collection, query]);
		queries.set(key, { collection, query });
		return Cache.get(pages, key);
	};
	// Every declared read of every step, at once: one crossing for the whole run.
	const prepared = yield* Effect.forEach(steps, (step) => prepareStep(read, step), {
		concurrency: 'unbounded'
	});
	const headcounts = new Map<string, number>();
	yield* Effect.all(
		prepared.flatMap(({ reads }) =>
			reads.flatMap(({ spec, subjects, companies }) =>
				spec.collection !== 'entity'
					? []
					: [...subjects.values()].flatMap(({ one, rows }) =>
							rows.map((entity) => {
								const id = companies.get(String(entity['id']));
								if (id === undefined)
									return Effect.fail(
										new Refusal({
											message: 'The behaviour read did not answer its planning subject.'
										})
									);
								return staffing(id, one.day).pipe(
									Effect.tap((staffed) =>
										Effect.sync(() => {
											headcounts.set(`${id}:${one.day}`, staffed.headcount);
										})
									)
								);
							})
						)
			)
		),
		{ concurrency: 'unbounded' }
	);
	const writes: BehaviourWrite[] = [];
	for (const { rule, subjects, reads } of prepared) {
		for (const one of subjects) {
			const contextReads: Record<string, unknown> = {};
			for (const { name, spec, subjects: readSubjects } of reads) {
				const loaded = readSubjects.get(one);
				if (loaded === undefined)
					return yield* new Refusal({
						message: 'The behaviour read did not answer its planning subject.'
					});
				const overlay = overlaid(rule, loaded.rows, spec.collection, loaded.where, writes);
				if (Result.isFailure(overlay)) return yield* Effect.fail(overlay.failure);
				contextReads[name] =
					spec.collection !== 'entity'
						? overlay.success
						: overlay.success.map((entity) => ({
								...entity,
								headcount: headcounts.get(`${String(entity['id'])}:${one.day}`) ?? 0
							}));
			}
			writes.push(...effectWrites(rule, { ...one.context, ...contextReads }));
		}
	}
	// One act per callable, in the order each first appears; a callable's writes keep their order.
	const order = [...new Set(writes.map((write) => write.callable))];
	yield* actBehaviourWrites(
		input.act,
		order.flatMap((callable) => writes.filter((write) => write.callable === callable))
	);
});
