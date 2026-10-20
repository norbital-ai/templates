import { Predicate } from 'effect';
import type { Context as CelContext } from '@marcbachmann/cel-js';
import type { Act, DeclaredQuery, Id, MemberWhere, Page, Row as BoltRow } from '@norbital-ai/bolt';
import { monthOf, PlainDate } from '@norbital-ai/std/date';
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
	type Read,
	type ReadError,
	type StoredWhere,
	fieldValue,
	isJsonObject,
	type Json,
	moneyNumber,
	Reads,
	readsFrom,
	Refusal,
	stableJson
} from './foundation.js';
import { chainStarts, leaveBalances } from './leave.js';
import {
	leaveState,
	leaveStateMembers,
	loadLeaveState,
	type LeaveStateRead,
	payrollRules,
	versionOn
} from './payslip/context.js';
import { CATALOG, CONTRACT, LEAVE_CLASS, SETTINGS, RULE_SET } from './rows.js';
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
/** An entry collection's catalogue. */
const CATALOGS = {
	leave_catalog_entry: 'leave_catalog',
	claim_catalog_entry: 'claim_catalog',
	adhoc_catalog_entry: 'adhoc_catalog',
	loan_catalog_entry: 'loan_catalog'
} as const;
const DESCRIBE_CATALOG = {
	adhoc_catalog_entry: {
		collection: 'adhoc_catalog',
		select: { ...CATALOG.adhoc_catalog, authority: true }
	},
	claim_catalog_entry: {
		collection: 'claim_catalog',
		select: { ...CATALOG.claim_catalog, authority: true }
	},
	leave_catalog_entry: {
		collection: 'leave_catalog',
		select: {
			...CATALOG.leave_catalog,
			...LEAVE_CLASS,
			description: true,
			authority: true,
			unit: true,
			encash_on_exit: true,
			encash_at_window_end: true
		}
	},
	loan_catalog_entry: {
		collection: 'loan_catalog',
		select: { ...CATALOG.loan_catalog, authority: true }
	}
} as const;
const isEntry = (collection: string): collection is keyof typeof CATALOGS => collection in CATALOGS;
/** Stored time-off fields; catalogue codes are loaded by their actual foreign keys. */
const leaveMember = (
	where: StoredWhere<'leave_catalog_entry'> | MemberWhere<'leave_catalog_entry'>,
	since?: string
) =>
	({
		collection: 'leave_catalog_entry',
		where: {
			...where,
			activity: { eq: 'TIME_OFF' },
			...(since === undefined ? {} : { occurred_on: { gte: PlainDate(since) } })
		},
		select: {
			id: true,
			employment_id: true,
			catalog_id: true,
			occurred_on: true,
			from: true,
			to: true,
			days: true,
			facts: true
		},
		all: true
	}) as const;
export const leaveMembers = (
	where: StoredWhere<'leave_catalog_entry'> | MemberWhere<'leave_catalog_entry'>,
	since?: string
) =>
	({
		describe_leave: leaveMember(where, since),
		describe_leave_catalog: {
			collection: 'leave_catalog',
			where: { id: { in: { member: 'describe_leave', field: 'catalog_id' } } },
			select: { id: true, code: true },
			all: true
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
		(yield* read('leave_catalog', {
			where: { id: { in: [...new Set(rows.map((row) => row.catalog_id))] } },
			select: { id: true, code: true },
			all: true
		})).rows;
	const codes = new Map(classes.map((row) => [row.id, row.code]));
	const fromOf = (row: LeaveEntry) => row.from ?? row.occurred_on;
	const coded: { readonly row: LeaveEntry; readonly code: string }[] = [];
	for (const row of rows) {
		const code = codes.get(row.catalog_id);
		if (code === undefined)
			return yield* Effect.fail(
				new Refusal({ message: 'A leave movement needs its actual approved catalogue.' })
			);
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
				days: moneyNumber(row.days) ?? 0,
				facts: row.facts
			}
		]);
	}
	return out;
});
/** One native keyed read supplies each approved movement and its catalogue code. */
export const leaveTaken = Effect.fnUntraced(function* (
	read: Read,
	where: StoredWhere<'leave_catalog_entry'>,
	since?: string
) {
	const got = yield* read(leaveMembers(where, since));
	return yield* leaveFrom(read, got.describe_leave.rows, got.describe_leave_catalog.rows);
});
/** One employment's leave balances on a day (`services.leaveState`), each with its class's `attendance` when it reads
 * one; none when the state cannot be read. */
export const leaveBalancesOn = Effect.fnUntraced(function* (
	read: Read,
	employment_id: Parameters<typeof leaveState>[0],
	day: string
) {
	return yield* leaveState(employment_id, day).pipe(
		Effect.provideService(Reads, readsFrom(read)),
		Effect.map(leaveBalances),
		Effect.catchTag('Refusal', () => Effect.succeed([]))
	);
});
/**
 * Many employments' leave balances, each on its own day, from one read (`leaveStateMembers`); an employment whose state
 * cannot be read has none. The reads its classes' attendance needs cross together, over one batched reader.
 */
export const leaveBalancesFor = Effect.fnUntraced(function* (
	read: Read,
	wants: Parameters<typeof leaveStateMembers>[0],
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
type DescribeRows = {
	payslip: Row & Pick<BoltRow<'payslip'>, 'id'>;
	employment_contract: Row & Pick<BoltRow<'employment_contract'>, 'id'>;
	adhoc_catalog_entry: Row & Pick<BoltRow<'adhoc_catalog_entry'>, 'catalog_id'>;
	claim_catalog_entry: Row & Pick<BoltRow<'claim_catalog_entry'>, 'catalog_id'>;
	leave_catalog_entry: Row & Pick<BoltRow<'leave_catalog_entry'>, 'catalog_id' | 'employment_id'>;
	loan_catalog_entry: Row & Pick<BoltRow<'loan_catalog_entry'>, 'catalog_id'>;
};
type DescribeInput = {
	[C in keyof DescribeRows]: { readonly collection: C; readonly rows: readonly DescribeRows[C][] };
}[keyof DescribeRows];
type DescribeTriggerInput = {
	[C in keyof DescribeRows]: { readonly collection: C; readonly row: DescribeRows[C] };
}[keyof DescribeRows];
export const describeTrigger = Effect.fnUntraced(function* (
	input: DescribeTriggerInput,
	read: Read
) {
	const rows =
		input.collection === 'payslip'
			? yield* describeTriggers({ collection: input.collection, rows: [input.row] }, read)
			: input.collection === 'employment_contract'
				? yield* describeTriggers({ collection: input.collection, rows: [input.row] }, read)
				: input.collection === 'adhoc_catalog_entry'
					? yield* describeTriggers({ collection: input.collection, rows: [input.row] }, read)
					: input.collection === 'claim_catalog_entry'
						? yield* describeTriggers({ collection: input.collection, rows: [input.row] }, read)
						: input.collection === 'leave_catalog_entry'
							? yield* describeTriggers({ collection: input.collection, rows: [input.row] }, read)
							: yield* describeTriggers({ collection: input.collection, rows: [input.row] }, read);
	const [described] = rows;
	if (described === undefined)
		return yield* Effect.fail(new Refusal({ message: 'The trigger enrichment returned no row.' }));
	return described;
});
/** Native members for trigger enrichment, using direct member field predicates. */
export const describeMembers = (collection: string, member: string) => {
	const ref = (field: string) => ({ in: { member, field } });
	const none = { in: [] };
	const catalog = isEntry(collection)
		? DESCRIBE_CATALOG[collection]
		: DESCRIBE_CATALOG.leave_catalog_entry;
	return {
		describe_lines: {
			collection: 'payslip',
			where: { id: collection === 'payslip' ? ref('id') : none },
			select: { id: true, base: true, adjustments: true, payroll_run_id: true },
			all: true
		},
		describe_runs: {
			collection: 'payroll_run',
			where: { id: { in: { member: 'describe_lines', field: 'payroll_run_id' } } },
			select: { id: true, pay_date: true, pay_due_date: true },
			all: true
		},
		...leaveMembers({
			employment_id:
				collection === 'employment_contract'
					? ref('id')
					: collection === 'leave_catalog_entry'
						? ref('employment_id')
						: none
		}),
		describe_catalog: {
			...catalog,
			where: { id: isEntry(collection) ? ref('catalog_id') : none },
			all: true
		}
	} as const;
};
/** In-hand triggers carry their collection's native IDs; no text leaf is turned back into a branded predicate. */
const describeInHand = (input: DescribeInput) => {
	const employment =
		input.collection === 'employment_contract'
			? input.rows.map((row) => row.id)
			: input.collection === 'leave_catalog_entry'
				? input.rows.flatMap((row) => (row.employment_id === null ? [] : [row.employment_id]))
				: [];
	const common = {
		describe_lines: {
			collection: 'payslip',
			where: { id: { in: input.collection === 'payslip' ? input.rows.map((row) => row.id) : [] } },
			select: { id: true, base: true, adjustments: true, payroll_run_id: true },
			all: true
		},
		describe_runs: {
			collection: 'payroll_run',
			where: { id: { in: { member: 'describe_lines', field: 'payroll_run_id' } } },
			select: { id: true, pay_date: true, pay_due_date: true },
			all: true
		},
		...leaveMembers({ employment_id: { in: employment } })
	} as const;
	if (input.collection === 'adhoc_catalog_entry')
		return {
			...common,
			describe_catalog: {
				...DESCRIBE_CATALOG.adhoc_catalog_entry,
				where: { id: { in: input.rows.map((row) => row.catalog_id) } },
				all: true
			}
		} as const;
	if (input.collection === 'claim_catalog_entry')
		return {
			...common,
			describe_catalog: {
				...DESCRIBE_CATALOG.claim_catalog_entry,
				where: { id: { in: input.rows.map((row) => row.catalog_id) } },
				all: true
			}
		} as const;
	if (input.collection === 'loan_catalog_entry')
		return {
			...common,
			describe_catalog: {
				...DESCRIBE_CATALOG.loan_catalog_entry,
				where: { id: { in: input.rows.map((row) => row.catalog_id) } },
				all: true
			}
		} as const;
	return {
		...common,
		describe_catalog: {
			...DESCRIBE_CATALOG.leave_catalog_entry,
			where: {
				id: {
					in:
						input.collection === 'leave_catalog_entry'
							? input.rows.map((row) => row.catalog_id)
							: []
				}
			},
			all: true
		}
	} as const;
};
const readDescribe = (read: Read, input: DescribeInput) => read(describeInHand(input));
type DescribeRead = Effect.Success<ReturnType<typeof readDescribe>>;
/** Enrichment keeps native selected fields intact and attaches the actual related domain values. */
export const describeFrom = Effect.fnUntraced(function* <
	Catalog extends Pick<DescribeRead['describe_catalog']['rows'][number], 'id' | 'code'>
>(
	collection: string,
	triggers: readonly Row[],
	got: Omit<DescribeRead, 'describe_catalog'> & { readonly describe_catalog: Page<Catalog> },
	read: Read
) {
	if (collection === 'payslip') {
		const lines = new Map<string, DescribeRead['describe_lines']['rows'][number]>(
			got.describe_lines.rows.map((row) => [row.id, row])
		);
		const runs = new Map(got.describe_runs.rows.map((row) => [row.id, row]));
		return triggers.map((row) => {
			const paid = text(row['paid_at']);
			const held = lines.get(String(row['id']));
			const run = held === undefined ? undefined : runs.get(held.payroll_run_id);
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
	const leave = yield* leaveFrom(read, got.describe_leave.rows, got.describe_leave_catalog.rows);
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
	const catalogues = new Map<string, Catalog>(
		got.describe_catalog.rows.map((row) => [row.id, row])
	);
	return rows.map((row) => {
		const catalog = catalogues.get(text(row['catalog_id']) ?? '') ?? null;
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
const describeTriggers = Effect.fnUntraced(function* (input: DescribeInput, read: Read) {
	const got = yield* readDescribe(read, input);
	return yield* describeFrom<DescribeRead['describe_catalog']['rows'][number]>(
		input.collection,
		input.rows,
		got,
		read
	);
});
/** A `where` clause over an empty list: it matches nothing. */
const emptyIn = (clause: unknown): boolean =>
	isJsonObject(clause) && Array.isArray(clause['in']) && clause['in'].length === 0;
/** Entities, their approved contracts, their lineage versions and those versions' rules in one native statement. */
export const entityMembers = (where: StoredWhere<'entity'> | MemberWhere<'entity'>) =>
	({
		entities: { collection: 'entity', where, select: { id: true, settings_code: true }, all: true },
		contracts: {
			collection: 'employment_contract',
			where: { company_id: { in: { member: 'entities', field: 'id' } } },
			select: CONTRACT,
			all: true
		},
		versions: {
			collection: 'jurisdiction_settings',
			where: {
				code: { in: { member: 'entities', field: 'settings_code' } },
				voided_at: { isNull: true },
				sealed_at: { isNull: false }
			},
			select: SETTINGS,
			all: true
		},
		rules: {
			collection: 'rule_set',
			where: {
				settings_id: { in: { member: 'versions', field: 'id' } },
				family: { eq: 'PAYROLL' }
			},
			select: RULE_SET,
			all: true
		}
	}) as const;
const readEntities = (read: Read, where: StoredWhere<'entity'>) => read(entityMembers(where));
type EntityRead = Effect.Success<ReturnType<typeof readEntities>>;
type BehaviourVersion = EntityRead['versions']['rows'][number] & {
	readonly rule_set: EntityRead['rules']['rows'];
};
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
		versions: got.versions.rows
			.filter((row) => row.code === settings_code)
			.map((row) => ({
				...row,
				rule_set: got.rules.rows.filter((rule) => rule.settings_id === row.id)
			})),
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
			from
				.entities(company_id)
				.pipe(Effect.flatMap(({ contracts }) => Effect.fromResult(staffingFrom(contracts, day)))),
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
	const cents = (value: unknown) => Math.round((moneyNumber(value) ?? 0) * 100);
	const statutoryCents = (value: unknown) =>
		Math.round((Schema.is(Schema.Finite)(value) ? value : 0) * 100);
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
				parts[part] = (parts[part] ?? 0) + statutoryCents(value);
			schemes[code] = {
				employee: sum.employee + statutoryCents(held['employee_amount']),
				employer: sum.employer + statutoryCents(held['employer_amount']),
				base: sum.base + statutoryCents(held['base_amount']),
				charged_base: sum.charged_base + statutoryCents(held['charged_base']),
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
	readonly fields: (names: readonly string[]) => Effect.Effect<Row, Refusal>;
	readonly run?: unknown;
	readonly leave_balances?: readonly unknown[];
};
type Shared = {
	readonly collection: string;
	readonly action: string;
	readonly versionFor: VersionFor;
	readonly read: Read;
	readonly act: Pick<Act, 'many'>;
	/** A shared `staffingLookup`, so a tick computes each entity and day's staffing once. */
	readonly staffing?: (company_id: Id<'entity'>, day: string) => Effect.Effect<Staffing, ReadError>;
};
/**
 * One trigger row through the governing version's behaviour rules, for each of its subjects: plan the rules whose
 * trigger is this collection and event, evaluate each `when`, load its declared reads and apply the writes its
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
	if (op === 'in' && Array.isArray(operand)) return operand;
	return undefined;
};
type DeclaredRead = (
	collection: BehaviourRead['collection'],
	query: DeclaredQuery
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
		const query = {
			mode: 'declared',
			...(where === undefined ? {} : { where }),
			...(declared.select === undefined
				? {}
				: {
						select: [...declared.select, ...(extra === undefined ? [] : [extra])]
					}),
			all: true
		} as const;
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
	in: (value, operand) => Array.isArray(operand) && operand.some((other) => same(value, other)),
	nin: (value, operand) => !(Array.isArray(operand) && operand.some((other) => same(value, other))),
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
					return yield* Effect.fail(
						new Refusal({ message: 'The behaviour read did not answer every planning subject.' })
					);
				subjects.set(one, { one, rows, where: wheres[index] });
			}
			return { name, spec, subjects, companies: loaded.companies };
		}),
		{ concurrency: 'unbounded' }
	);
	return { ...step, reads };
});
/**
 * Many trigger rows of one collection and event through their governing versions' rules (`runBehaviours` for each).
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
/** One collection and event's trigger rows, for `runBehaviourGroups`. */
type BehaviourGroup = {
	readonly collection: string;
	readonly action: string;
	readonly events: readonly BehaviourEvent[];
};
/**
 * `runBehaviourEvents` for several collections and events at once (the daily tick's entity calendar, open cases,
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
			Effect.all(
				{
					version: input.versionFor(subject.company_id, event.day),
					staffed: staffing(subject.company_id, event.day)
				},
				{ concurrency: 'unbounded' }
			).pipe(
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
		{ readonly collection: BehaviourRead['collection']; readonly query: DeclaredQuery }
	>();
	const pages = yield* Cache.make({
		lookup: (key: string) =>
			Effect.gen(function* () {
				const request = queries.get(key);
				if (request === undefined)
					return yield* Effect.fail(
						new Refusal({ message: 'The behaviour read needs its declared native query.' })
					);
				if (request.collection === 'entity') {
					const page = yield* input.read('entity', request.query);
					return {
						rows: page.rows,
						companies: page.rows.map((entity) => [entity.id, entity.id] as const)
					};
				}
				const page = yield* input.read(request.collection, request.query);
				return { rows: page.rows, companies: [] };
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
					return yield* Effect.fail(
						new Refusal({ message: 'The behaviour read did not answer its planning subject.' })
					);
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
