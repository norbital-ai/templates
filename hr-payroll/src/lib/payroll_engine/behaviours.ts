import type { Context as CelContext } from '@marcbachmann/cel-js';
import type { Act, ActInput, CollectionName } from '@norbital-ai/bolt';
import { Schema } from 'effect';
import { evaluateStrict } from './expressions.js';
import {
	type Json,
	type JsonObject,
	getErrorMessage,
	isJsonObject,
	Refusal
} from './foundation.js';

/** Collections a CEL effect is allowed to write: the pin targets, leave encashment, holds, obligations, tasks and
 * the holidays a version's calendar lists. */
const WRITE_COLLECTIONS = [
	'adhoc_catalog_entry',
	'holiday',
	'payslip',
	'claim_catalog_entry',
	'leave_catalog_entry',
	'loan_catalog_entry',
	'obligation',
	'regulatory_task',
	'roster_entry'
] as const satisfies readonly CollectionName[];
const WRITE_OPERATIONS = ['create', 'update'] as const;
/** The entries, roster days and open obligations an effect may withdraw (`delete`: a moved or undone exit's unpaid
 * encashment, a deleted run's unpaid remittances). */
const DELETE_COLLECTIONS = [
	'adhoc_catalog_entry',
	'obligation',
	'claim_catalog_entry',
	'leave_catalog_entry',
	'loan_catalog_entry',
	'roster_entry'
] as const satisfies readonly WriteCollection[];
type WriteCollection = (typeof WRITE_COLLECTIONS)[number];
type WriteOperation = (typeof WRITE_OPERATIONS)[number] | 'delete';
type WriteCallable =
	| `${WriteCollection}.${(typeof WRITE_OPERATIONS)[number]}`
	| `${(typeof DELETE_COLLECTIONS)[number]}.delete`;

/** Authored collections a behaviour may name in a declared read. */
const READ_COLLECTIONS = [
	'adhoc_catalog',
	'adhoc_catalog_entry',
	'allowance_catalog',
	'claim_catalog',
	'claim_catalog_entry',
	'employment_contract',
	'employment_profile',
	'entity',
	'holiday',
	'jurisdiction_settings',
	'leave_catalog',
	'leave_catalog_entry',
	'loan_catalog',
	'loan_catalog_entry',
	'obligation',
	'payslip',
	'payroll_run',
	'regulatory_task',
	'roster',
	'roster_entry',
	'rule_set',
	'shift_definition',
	'shift_pattern',
	'statutory_contribution_catalog',
	'suspension_kind',
	'work_catalog',
	'work_suspension',
	'workplace_case'
] as const satisfies readonly CollectionName[];

/**
 * One declared read: a collection, a `where` whose every string leaf is a CEL expression over the event context, and
 * the fields beyond the scalar default to select (a stored `json` field must be named to come back).
 */
export const BehaviourRead = Schema.Struct({
	collection: Schema.Literals(READ_COLLECTIONS),
	where: Schema.optional(Schema.Json),
	select: Schema.optional(Schema.Array(Schema.String))
});
export type BehaviourRead = typeof BehaviourRead.Type;

/**
 * One jurisdiction behaviour rule: which trigger it answers (`catalog` for an engine event, `target_collection` for a
 * row event), its CEL `when`, the rows it reads and the CEL `effect` that returns its writes. The effect is the whole
 * behaviour: it maps the context — the trigger row, its declared reads — to act-shaped writes; nothing here names a
 * function.
 */
export const Behaviour = Schema.Struct({
	id: Schema.String,
	catalog: Schema.optional(Schema.String),
	target_collection: Schema.optional(Schema.String),
	events: Schema.Array(Schema.String),
	when: Schema.optional(Schema.String),
	/** Extra fields beyond the scalar default to read on the trigger row (a stored `json` field must be named). */
	fields: Schema.optional(Schema.Array(Schema.String)),
	reads: Schema.optional(Schema.Record(Schema.String, BehaviourRead)),
	effect: Schema.optional(Schema.String)
});
export type Behaviour = typeof Behaviour.Type;

/** A version's behaviours record: its ordered rules. */
export const Behaviours = Schema.Struct({
	version: Schema.Literal(1),
	rules: Schema.Array(Behaviour)
});
export type Behaviours = typeof Behaviours.Type;

/** The stored JSON behaviours field: `undefined` when the value is not a version-1 rule set. */
export const behavioursOf = (value: unknown): Behaviours | undefined =>
	Schema.is(Behaviours)(value) ? value : undefined;

/** One write an effect returned: the target collection, a native verb, and the act input verbatim. */
export type BehaviourWrite = {
	readonly callable: WriteCallable;
	readonly collection: WriteCollection;
	readonly operation: WriteOperation;
	readonly data: ActInput<WriteCallable>;
};

/** Which trigger a rule set is planned for: an engine event or a row event. */
export type BehaviourTrigger =
	| { readonly kind: 'catalog'; readonly catalog: string; readonly event: string }
	| { readonly kind: 'row'; readonly collection: string; readonly event: string };

/**
 * Whether one rule answers one trigger, before its `when` — what the executor reads the trigger row's fields for. A
 * row rule without `target_collection` answers its events on every collection the taps fire for.
 */
export function triggerMatches(rule: Behaviour, trigger: BehaviourTrigger): boolean {
	if (!rule.events.includes(trigger.event)) return false;
	return trigger.kind === 'catalog'
		? rule.catalog === trigger.catalog
		: rule.catalog === undefined &&
				(rule.target_collection ?? trigger.collection) === trigger.collection;
}

/** The behaviours one trigger selects, in their declared order, whose `when` holds against the context. */
export function planBehaviours(
	behaviours: Behaviours,
	trigger: BehaviourTrigger,
	context: CelContext
): readonly Behaviour[] {
	return behaviours.rules
		.filter((rule) => triggerMatches(rule, trigger))
		.filter((rule) => rule.when === undefined || evaluate(rule, rule.when, context) === true);
}

/** Resolve one declared read's `where`: every string leaf is CEL over the event context; everything else is literal. */
export function resolveWhere(
	where: Json | undefined,
	context: CelContext,
	/** The rule the read is declared on, named when a leaf fails. */
	rule?: Behaviour
): Json | undefined {
	if (where === undefined) return undefined;
	const walk = (value: Json): Json => {
		if (Schema.is(Schema.String)(value))
			return rule === undefined ? evaluateStrict(value, context) : evaluate(rule, value, context);
		if (Schema.is(Schema.Array(Schema.Json))(value)) return value.map(walk);
		if (isJsonObject(value))
			return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, walk(entry)]));
		return value;
	};
	return walk(where);
}

/** One returned write before it is judged: the collection, the native verb and the act input. */
const Write = Schema.Union([
	Schema.Struct({
		collection: Schema.Literals(WRITE_COLLECTIONS),
		operation: Schema.Literals(WRITE_OPERATIONS),
		data: Schema.Record(Schema.String, Schema.Json)
	}),
	Schema.Struct({
		collection: Schema.Literals(DELETE_COLLECTIONS),
		operation: Schema.Literal('delete'),
		data: Schema.Record(Schema.String, Schema.Json)
	})
]);

/** CEL JSON as the act input of a write the schema already named. Insert schemas are type-only. */
const actInputOf = <N extends WriteCallable>(
	_callable: N,
	data: (typeof Write.Type)['data'] | readonly JsonObject[]
): ActInput<N> => data as ActInput<N>;

const writeFrom = (entry: typeof Write.Type): BehaviourWrite => {
	const callable: WriteCallable =
		entry.operation === 'delete'
			? `${entry.collection}.delete`
			: `${entry.collection}.${entry.operation}`;
	return {
		callable,
		collection: entry.collection,
		operation: entry.operation,
		data: actInputOf(callable, entry.data)
	};
};

/** One effect value as writes: null/false is a no-op, an object is one write, a list is many, in order. */
export function effectWrites(rule: Behaviour, context: CelContext): readonly BehaviourWrite[] {
	if (rule.effect === undefined) return [];
	const value = evaluate(rule, rule.effect, context);
	if (value === null || value === false) return [];
	const list = Schema.is(Schema.Array(Schema.Json))(value) ? value : [value];
	return list.map((entry) =>
		Schema.is(Write)(entry)
			? writeFrom(entry)
			: refuse(rule, 'a write whose collection, operation or data is not actual')
	);
}

/**
 * A rule's writes through the automation act surface, in order. Updates of one collection go as one act over every
 * target — consecutive ones, or all of them when the rule only updates (a run's pins move thousands of rows across
 * the entry and roster collections: one statement and one transform each, not one per row). Consecutive creates of
 * one collection go as one act too (a year's holiday calendar is one statement); a review then covers the batch. On a
 * host with `act.many` the whole list is one act: the batch's writes planned together and committed as one statement.
 */
export async function actBehaviourWrites(
	act: Act,
	writes: readonly BehaviourWrite[]
): Promise<void> {
	const runs: BehaviourWrite[][] = [];
	if (writes.every((write) => write.operation === 'update')) {
		const by = new Map<string, BehaviourWrite[]>();
		for (const write of writes) {
			const held = by.get(write.callable);
			if (held === undefined) by.set(write.callable, [write]);
			else held.push(write);
		}
		runs.push(...by.values());
	} else
		for (const write of writes) {
			const last = runs.at(-1);
			if (last?.[0]?.callable === write.callable) last.push(write);
			else runs.push([write]);
		}
	const acts = runs.flatMap((run) => {
		const [first] = run;
		if (first === undefined) return [];
		return [
			{
				callable: first.callable,
				input:
					run.length === 1
						? first.data
						: first.operation === 'delete'
							? actInputOf(first.callable, {
									target: run.flatMap(({ data }) => [(data as JsonObject)['target'] ?? []].flat())
								})
							: actInputOf(
									first.callable,
									run.flatMap(({ data }): JsonObject[] => {
										const held = data as JsonObject;
										const target = held['target'];
										return first.operation === 'update' && Array.isArray(target)
											? target.map((id) => ({ ...held, target: id }))
											: [held];
									})
								)
			}
		];
	});
	// every write as ONE act (`act.many`: planned together, one statement); a host without it acts each in turn
	if (acts.length > 1 && act.many != null) {
		await act.many(acts.map(({ callable, input }) => ({ callable, input: input as Json })));
		return;
	}
	for (const { callable, input } of acts) await act(callable, input);
}

/**
 * One of a rule's expressions, strictly: any failure in it or in a record expression it evaluates (`configured_eval`
 * of a duty's `when`, `due`, …) refuses, naming the rule, the record row whose expression failed (the declared read's
 * row carrying it in `rules`) and the evaluator's message — so the tap run fails instead of reading it as no.
 */
const evaluate = (rule: Behaviour, expression: string, context: CelContext): Json => {
	try {
		return evaluateStrict(expression, context);
	} catch (cause) {
		const failed = cause instanceof Refusal ? cause.detail : undefined;
		const owner = Object.values(context)
			.flatMap((value) => (Array.isArray(value) ? value : []))
			.find(
				(row) =>
					isJsonObject(row) &&
					isJsonObject(row['rules']) &&
					Object.values(row['rules']).includes(failed ?? '')
			);
		const code = isJsonObject(owner) ? ` on ${String(owner['code'])}` : '';
		return refuse(rule, `an evaluation failure${code}: ${getErrorMessage(cause)}`);
	}
};

const refuse = (rule: Behaviour, message: string): never => {
	throw new Refusal({ message: `Behaviour ${rule.id} returned ${message}.` });
};
