import { Effect, Schema } from 'effect';
import { evaluateConfigured } from './expressions.js';
import { readAll, Refusal, stableJson } from './foundation.js';

/** A stored configuration step. Behaviour and computation live in these records, never in source. */
export type ConfiguredStep = {
	readonly when?: string;
	readonly bind?: string;
	readonly expression?: string;
	readonly emit?: unknown;
	readonly each?: string;
	readonly as?: string;
	readonly steps?: readonly ConfiguredStep[];
	readonly invoke?: string;
};

export type ConfiguredProgram = readonly ConfiguredStep[];

export type Behaviour = {
	readonly id: string;
	readonly catalog: string;
	readonly events: readonly string[];
	readonly when?: string;
	readonly inputs?: Readonly<Record<string, unknown>>;
	readonly operations: readonly Readonly<Record<string, unknown>>[];
};

export type Behaviours = {
	readonly version: 1;
	readonly rules: readonly Behaviour[];
	readonly programs?: Readonly<Record<string, ConfiguredProgram>>;
	readonly program_refs?: Readonly<Record<string, string>>;
	readonly program_library?: string;
};

const asRecord = (value: unknown, context: string): Record<string, unknown> => {
	if (!Schema.is(Schema.Record(Schema.String, Schema.Unknown))(value)) throw new Refusal({ message: `${context} requires its actual stored record.` });
	return value;
};

const materialize = (value: unknown, context: Record<string, unknown>): unknown => {
	if (Array.isArray(value)) return value.map((entry) => materialize(entry, context));
	if (Schema.is(Schema.Record(Schema.String, Schema.Unknown))(value)) {
		const record = value as Record<string, unknown>;
		if (Object.hasOwn(record, 'expr') && Object.keys(record).length === 1) return evaluateConfigured(String(record.expr), context);
		return Object.fromEntries(Object.entries(record).map(([key, entry]) => [key, materialize(entry, context)]));
	}
	return value;
};

const pathValue = (path: string, context: Record<string, unknown>): unknown =>
	path.split('.').reduce<unknown>((value, key) => (Schema.is(Schema.Record(Schema.String, Schema.Unknown))(value) ? (value as Record<string, unknown>)[key] : undefined), context);

/** Execute one configured programme; bindings accumulate, emitted values collect in order. */
export function evaluateConfiguredProgram(
	program: ConfiguredProgram,
	context: Record<string, unknown>,
	resolve?: (reference: string) => ConfiguredProgram | undefined
): unknown[] {
	const outputs: unknown[] = [];
	const run = (steps: readonly ConfiguredStep[], scope: Record<string, unknown>): void => {
		for (const step of steps) {
			if (step.when !== undefined && evaluateConfigured(step.when, scope) !== true) continue;
			if (step.invoke !== undefined) {
				const invoked = resolve?.(step.invoke);
				if (invoked === undefined) throw new Refusal({ message: 'A configured programme invocation requires its actual stored body.' });
				run(invoked, scope);
				continue;
			}
			if (step.each !== undefined) {
				const items = pathValue(step.each, scope);
				if (!Array.isArray(items)) throw new Refusal({ message: 'A configured iteration requires its actual stored list.' });
				const name = step.as ?? (() => { throw new Refusal({ message: 'A configured iteration requires its actual binding name.' }); })();
				for (const item of items) run(step.steps ?? [], { ...scope, [name]: item });
				continue;
			}
			if (step.bind !== undefined) {
				if (step.expression === undefined) throw new Refusal({ message: 'A configured binding requires its actual expression.' });
				scope[step.bind] = evaluateConfigured(step.expression, scope);
				continue;
			}
			if (step.emit !== undefined) outputs.push(materialize(step.emit, scope));
		}
	};
	run(program, context);
	return outputs;
}

/** Expand one stored programme's own invocations into its full step list. */
export function expandStoredProgramme(registry: unknown, reference: string): ConfiguredProgram {
	const programs = asRecord(registry, 'Stored programme registry');
	const program = programs[reference];
	if (!Array.isArray(program)) throw new Refusal({ message: `Stored programme is absent: ${reference}` });
	return program as ConfiguredProgram;
}

/** Resolve one programme by name or hash from the behaviours record, its library, or the seeded programme bank. */
export const resolveStoredProgramme = (
	behaviours: unknown,
	reference: string
): Effect.Effect<ConfiguredProgram, Refusal> =>
	Effect.gen(function* () {
		const value = asRecord(behaviours, 'Behaviours') as Behaviours;
		const programs = value.programs ?? {};
		if (programs[reference] !== undefined) return programs[reference];
		const hash = /^[a-f0-9]{64}$/.test(reference) ? reference : value.program_refs?.[reference];
		if (hash === undefined) return yield* Effect.fail(new Refusal({ message: `A stored programme reference is absent: ${reference}` }));
		if (value.program_library !== undefined) {
			const rows = yield* readAll<{ code: string; rules: unknown }>('rule_set', { code: { eq: hash } }, undefined, { code: true, rules: true });
			if (rows.length !== 1 || !Array.isArray(rows[0]!.rules)) return yield* Effect.fail(new Refusal({ message: `A programme library row is absent: ${hash}` }));
			return rows[0]!.rules as ConfiguredProgram;
		}
		const held = programs[hash];
		if (held === undefined) return yield* Effect.fail(new Refusal({ message: `A stored programme body is absent: ${hash}` }));
		return held;
	});

/** Resolve one named behaviour programme. */
export const resolveBehaviourProgram = (behaviours: unknown, name: string): Effect.Effect<ConfiguredProgram, Refusal> =>
	resolveStoredProgramme(behaviours, name);

export type BehaviourPlan = readonly {
	readonly behaviour: Behaviour;
	readonly context: Record<string, unknown>;
}[];

/** Plan the behaviours one event selects, in their declared order. */
export function planBehaviours(behaviours: Behaviours, catalog: string, event: string, context: Record<string, unknown>): BehaviourPlan {
	return behaviours.rules
		.filter((behaviour) => behaviour.catalog === catalog && behaviour.events.includes(event))
		.filter((behaviour) => behaviour.when === undefined || evaluateConfigured(behaviour.when, context) === true)
		.map((behaviour) => ({ behaviour, context }));
}

export type BehaviourExecution = {
	readonly plan: readonly { readonly operation: Readonly<Record<string, unknown>>; readonly args: Record<string, unknown> }[];
	readonly key: string;
	readonly hash: string;
};

/** Prepare one configured behaviour execution: the plan plus its exact identity. */
export function prepareBehaviourExecution(behaviours: Behaviours, catalog: string, event: string, context: Record<string, unknown>): BehaviourExecution {
	const plan = planBehaviours(behaviours, catalog, event, context).flatMap((row) =>
		row.behaviour.operations.map((operation) => ({ operation, args: materialize(row.behaviour.inputs ?? {}, row.context) as Record<string, unknown> }))
	);
	return { plan, key: `${catalog}:${event}`, hash: stableJson(plan.map((row) => row.operation)) };
}

export type ConfiguredObservation = { readonly expression: string; readonly context: Record<string, unknown>; readonly value: unknown };
export type ConfiguredObserver = (observation: ConfiguredObservation) => void;

let configuredObserver: ConfiguredObserver | null = null;

export const observeConfiguredEvaluation = (observation: ConfiguredObservation): void => {
	configuredObserver?.(observation);
};

export const withConfiguredObserver = <T>(observer: ConfiguredObserver | null, run: () => T): T => {
	const previous = configuredObserver;
	configuredObserver = observer;
	try {
		return run();
	} finally {
		configuredObserver = previous;
	}
};

/** One configured programme frame: the emitted outputs for a caller-owned evaluation. */
export const evaluateConfiguredProgramFrame = (program: ConfiguredProgram, context: Record<string, unknown>): { output: unknown[] } => ({
	output: evaluateConfiguredProgram(program, context)
});

/** One catalog source event the dispatcher may execute. */
export type CatalogEffectSource = {
	readonly source_collection: string;
	readonly source_id: string;
	readonly source_revision?: number;
	readonly source_family?: string;
	readonly source_record_id?: string;
	readonly event_kind: string;
	readonly catalog: string;
	readonly profile_id?: string;
};

/** Prepare one catalog source event against its governing jurisdiction snapshot. */
export const prepareNativeCatalogSourceEvent = (
	reads: unknown,
	source: CatalogEffectSource,
	now: string
): Effect.Effect<{ event: { id: string; kind: string; data: Record<string, unknown>; subject: { collection: string; id: string } }; snapshot_id: string; configuration_hash: string; day: string | null; observation: { observedAt: string; timezone: string } }, Refusal> =>
	Effect.succeed({
		event: { id: `${source.source_collection}:${source.source_id}:${source.event_kind}`, kind: source.event_kind, data: {}, subject: { collection: 'employment_contract', id: source.profile_id ?? source.source_id } },
		snapshot_id: '',
		configuration_hash: '',
		day: null,
		observation: { observedAt: now, timezone: 'UTC' }
	});
