import { Array as EffectArray } from 'effect';
import { Predicate } from 'effect';
import type { Context as CelContext } from '@marcbachmann/cel-js';
import type { Act, ModelName } from '@norbital-ai/bolt';
import { Effect, Result, Schema } from 'effect';
import { evaluateStrict } from './expressions.js';
import {
	type Json,
	type JsonObject,
	getErrorMessage,
	isJsonObject,
	Refusal
} from './foundation.js';
/** Models a CEL effect is allowed to write: the pin targets, leave encashment, holds, obligations, tasks and
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
] as const satisfies readonly ModelName[];
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
type WriteCollection = (typeof WRITE_COLLECTIONS)[number] | 'loan_repayment_entry';
type WriteOperation = (typeof WRITE_OPERATIONS)[number] | 'delete';
type WriteCallable =
	| `${(typeof WRITE_COLLECTIONS)[number]}.${(typeof WRITE_OPERATIONS)[number]}`
	| `${(typeof DELETE_COLLECTIONS)[number]}.delete`
	| 'loan_repayment_entry.update';
/** Authored models a behaviour may name in a declared read. */
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
	'loan_repayment_entry',
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
	'suspension_catalog',
	'work_suspension',
	'workplace_case'
] as const satisfies readonly ModelName[];
/**
 * One declared read: a model, a `where` whose every string leaf is a CEL expression over the event context, and
 * the fields beyond the scalar default to select (a stored `json` field must be named to come back).
 */
export const BehaviourRead = Schema.Struct({
	collection: Schema.Literals(READ_COLLECTIONS),
	where: Schema.optional(Schema.Json),
	select: Schema.optional(Schema.Array(Schema.String))
});
export type BehaviourRead = typeof BehaviourRead.Type;
/**
 * One jurisdiction behaviour row: which row event it answers (`target_collection` and `events`), its CEL `when`, the
 * rows it reads and the CEL `effect` that returns its writes. The effect is the whole behaviour: it maps the context —
 * the trigger row, its declared reads and the row itself (`behaviour`) — to act-shaped writes; nothing here names a
 * function. An obligation or task row carries the one duty it raises as `definition`.
 */
export const Behaviour = Schema.Struct({
	code: Schema.String,
	name: Schema.optional(Schema.NullOr(Schema.String)),
	references: Schema.optional(Schema.Unknown),
	order: Schema.Number,
	target_collection: Schema.optional(Schema.NullOr(Schema.String)),
	events: Schema.Array(Schema.String),
	when: Schema.optional(Schema.NullOr(Schema.String)),
	/** Extra fields beyond the scalar default to read on the trigger row (a stored `json` field must be named). */
	fields: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
	reads: Schema.optional(Schema.NullOr(Schema.Record(Schema.String, BehaviourRead))),
	effect: Schema.optional(Schema.NullOr(Schema.String)),
	definition: Schema.optional(Schema.NullOr(Schema.Json))
});
export type Behaviour = typeof Behaviour.Type;
/**
 * The version's one program per duty kind (events `[]`: it never fires itself): the `when`, `fields`, `reads` and
 * `effect` every duty row of that kind runs. A task's `definition` has a `trigger`; an obligation's does not.
 */
const programOf = (definition: Behaviour['definition']) =>
	isJsonObject(definition) && definition['trigger'] !== undefined
		? 'task-program'
		: 'obligation-program';
/**
 * A version's behaviour rows in run order (`order`, then `code`), each duty row (a `definition` without its own
 * `effect`) completed from its kind's program row; a row the runner cannot run refuses them all.
 */
export const behavioursOf = (
	rows: readonly unknown[] | undefined
): Result.Result<readonly Behaviour[], Refusal> => {
	const held: Behaviour[] = [];
	for (const row of rows ?? []) {
		if (!Schema.is(Behaviour)(row))
			return Result.fail(
				new Refusal({
					message: `Behaviour ${String(isJsonObject(row) ? row['code'] : '')} names an event, read or write the runner cannot run.`
				})
			);
		held.push(row);
	}
	const programs = new Map(held.map((row) => [row.code, row]));
	const completed: Behaviour[] = [];
	for (const row of held) {
		if (row.definition == null || row.effect != null) {
			completed.push(row);
			continue;
		}
		const program = programs.get(programOf(row.definition));
		if (program === undefined)
			return Result.fail(
				new Refusal({
					message: `Behaviour ${row.code} raises a duty its version has no ${programOf(row.definition)} for.`
				})
			);
		completed.push({
			...row,
			when: program.when,
			fields: program.fields,
			reads: program.reads,
			effect: program.effect
		});
	}
	return Result.succeed(
		completed.toSorted((a, b) => a.order - b.order || a.code.localeCompare(b.code))
	);
};
/** One write an effect returned: the target model, a native verb, and the act input verbatim. */
export type BehaviourWrite = {
	readonly callable: WriteCallable;
	readonly collection: WriteCollection;
	readonly operation: WriteOperation;
	readonly data: JsonObject;
};
/** Which row event a rule set is planned for. */
type BehaviourTrigger = {
	readonly kind: 'row';
	readonly collection: string;
	readonly event: string;
};
/**
 * Whether one rule answers one trigger, before its `when` — what the executor reads the trigger row's fields for. A
 * rule without `target_collection` answers its events on every model the taps fire for.
 */
export function triggerMatches(rule: Behaviour, trigger: BehaviourTrigger): boolean {
	return (
		rule.events.includes(trigger.event) &&
		(rule.target_collection ?? trigger.collection) === trigger.collection
	);
}
/** The rule's own row in its `when` and `effect`: `behaviour.code`, `.name`, `.references` and `.definition`. */
const own = (rule: Behaviour, context: CelContext): CelContext => ({
	...context,
	behaviour: {
		code: rule.code,
		name: rule.name ?? null,
		references: rule.references ?? null,
		definition: rule.definition ?? null
	}
});
/** The behaviours one trigger selects, in run order, whose `when` holds against the context. */
export function planBehaviours(
	behaviours: readonly Behaviour[],
	trigger: BehaviourTrigger,
	context: CelContext
): readonly Behaviour[] {
	return behaviours
		.filter((rule) => triggerMatches(rule, trigger))
		.filter((rule) => rule.when == null || evaluate(rule, rule.when, own(rule, context)) === true);
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
		if (Predicate.isString(value))
			return rule === undefined ? evaluateStrict(value, context) : evaluate(rule, value, context);
		if (Schema.is(Schema.Array(Schema.Json))(value)) return value.map(walk);
		if (isJsonObject(value))
			return Object.fromEntries(
				Object.entries(value).map(([key, entry]): [string, Json] => [key, walk(entry)])
			);
		return value;
	};
	return walk(where);
}
/** One returned write before it is judged: the model, the native verb and the act input. */
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
	}),
	Schema.Struct({
		collection: Schema.Literal('loan_repayment_entry'),
		operation: Schema.Literal('update'),
		data: Schema.Record(Schema.String, Schema.Json)
	})
]);
const writeFrom = (entry: typeof Write.Type): BehaviourWrite => {
	const callable: WriteCallable =
		entry.collection === 'loan_repayment_entry'
			? 'loan_repayment_entry.update'
			: entry.operation === 'delete'
				? `${entry.collection}.delete`
				: `${entry.collection}.${entry.operation}`;
	// Sealed older snapshots generated this unused leave column; keep their effects valid after its model removal.
	const data =
		entry.collection === 'leave_catalog_entry' && entry.operation === 'create'
			? Object.fromEntries(Object.entries(entry.data).filter(([key]) => key !== 'incurred_on'))
			: entry.data;
	return {
		callable,
		collection: entry.collection,
		operation: entry.operation,
		data
	};
};
/** One effect value as writes: null/false is a no-op, an object is one write, a list is many, in order. */
export function effectWrites(rule: Behaviour, context: CelContext): readonly BehaviourWrite[] {
	if (rule.effect == null) return [];
	const value = evaluate(rule, rule.effect, own(rule, context));
	if (value === null || value === false) return [];
	const list = Schema.is(Schema.Array(Schema.Json))(value) ? value : [value];
	return list.map((entry) =>
		Schema.is(Write)(entry)
			? writeFrom(entry)
			: refuse(rule, 'a write whose collection, operation or data is not actual')
	);
}
/**
 * A rule's writes through the automation act surface, in order. Updates of one model go as one act over every
 * target — consecutive ones, or all of them when the rule only updates (a run's pins move thousands of rows across
 * the entry and roster models: one statement and one transform each, not one per row). Consecutive creates of
 * one model go as one act too (a year's holiday calendar is one statement); a review then covers the batch. The
 * whole list is one native act: the batch's writes planned together and committed as one statement.
 */
export function actBehaviourWrites(act: Pick<Act, 'checked'>, writes: readonly BehaviourWrite[]) {
	return Effect.fnUntraced(function* () {
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
		const acts = runs.flatMap((run): Parameters<Act['checked']>[0] => {
			const [first] = run;
			if (first === undefined) return [];
			// Malformed delete inputs must reach the native validator verbatim.
			if (
				first.operation === 'delete' &&
				run.some(
					({ data }) =>
						data['target'] === undefined || Object.keys(data).some((key) => key !== 'target')
				)
			)
				return run.map(({ callable, data }) => ({ callable, input: [data] }));
			// Every generated write is a batch: one row per create, `{ target, set }` per update, `{ target }` per delete.
			return [
				{
					callable: first.callable,
					input:
						first.operation === 'delete'
							? run.flatMap(({ data }): JsonObject[] => {
									const target = data['target'];
									return (
										target === undefined
											? []
											: EffectArray.isArray<typeof target>(target)
												? target
												: [target]
									).map((id) => ({ target: id }));
								})
							: run.flatMap(({ data }): JsonObject[] => {
									const target = data['target'];
									return first.operation === 'update' && EffectArray.isArray<typeof target>(target)
										? target.map((id) => ({ ...data, target: id }))
										: [data];
								})
				}
			];
		});
		if (acts.length > 0) yield* act.checked(acts);
	})();
}
/**
 * One of a rule's expressions, strictly: any failure in it or in a record expression it evaluates (`configured_eval`
 * of a duty's `when`, `due`, …) refuses, naming the rule, the record row whose expression failed (the declared read's
 * row carrying it in `rules`) and the evaluator's message — so the tap run fails instead of reading it as no.
 */
const evaluate = (rule: Behaviour, expression: string, context: CelContext): Json => {
	const evaluated = Result.try(() => evaluateStrict(expression, context));
	if (Result.isSuccess(evaluated)) return evaluated.success;
	const cause = evaluated.failure;
	const failed = cause instanceof Refusal ? cause.detail : undefined;
	const owner = Object.values(context)
		.flatMap((value) => (EffectArray.isArray(value) ? value : []))
		.find(
			(row) =>
				isJsonObject(row) &&
				isJsonObject(row['rules']) &&
				Object.values(row['rules']).includes(failed ?? '')
		);
	const code = isJsonObject(owner) ? ` on ${String(owner['code'])}` : '';
	return refuse(rule, `an evaluation failure${code}: ${getErrorMessage(cause)}`);
};
const refuse = (rule: Behaviour, message: string): never => {
	throw new Refusal({ message: `Behaviour ${rule.code} returned ${message}.` });
};
