/**
 * The formula language.
 *
 * `pay_components.definition` on its `FORMULA` arm carries a CEL expression, evaluated by Reckon —
 * the same declarative, auditable engine the statutory rules use. Nothing here is bespoke: the
 * expression is data, its dependencies are named, and its result is a number.
 *
 * Three properties of CEL shape how the context is built, and getting any of them wrong shows up as
 * a run that throws rather than a number that is wrong:
 *
 * - **there is no `?.`** — every optional value must be present as a real key;
 * - **a missing key throws `no_such_key`** — so the context is emitted complete, with zeros rather
 *   than absences, for every component, entry and fact the catalogue mentions;
 * - **numeric literals need a decimal point** when mixed with doubles: `26` is an int, `26.0` a
 *   double, and `x / 26` where `x` is a double is a type error.
 *
 * Each formula is evaluated as its own one-expression computation, in `pay_components.sequence`
 * order. That is deliberate: `component('HOURLY_RATE')` is an opaque op call, so Reckon's
 * AST-derived topological sort cannot see through it, and evaluating the whole catalogue as one
 * graph would silently read a component before it was measured. Sequence order is the contract the
 * type list already states, so it is the one used.
 */

import { Effect, Schema } from 'effect';
import { createReckonEngine, type ComputationDefinition } from '@norbital-ai/std/reckon';

/** Everything a formula may read. Every map is complete; a missing key is a bug, not an absence. */
const scalarValue = Schema.Union([Schema.Number, Schema.String, Schema.Boolean]);
const numericMap = Schema.Record(Schema.String, Schema.Number);
const FormulaContextSchema = Schema.Struct({
	/** Amounts of components already measured this payslip, keyed by component code. */
	components: numericMap,
	/** Entry amounts for this employment this period, keyed by component code. */
	entries: numericMap,
	/** `${CONTRIBUTION_CODE}.${key}` → the employment's statutory fact. */
	facts: Schema.Record(Schema.String, scalarValue),
	/** Settled leave days taken in the window, keyed by leave code. */
	leaveDays: numericMap,
	/** Settled leave balance at the period end, keyed by leave code. */
	leaveBalances: numericMap,
	terms: Schema.Record(Schema.String, Schema.Union([Schema.Number, Schema.String])),
	derived: numericMap,
	period: Schema.Record(Schema.String, Schema.Union([Schema.Number, Schema.String])),
	jurisdiction: Schema.Record(Schema.String, Schema.Union([Schema.Number, Schema.String]))
});
export type FormulaContext = Schema.Schema.Type<typeof FormulaContextSchema>;

/**
 * One evaluator owns the context slot its custom ops read.
 *
 * Reckon ops are plain functions with no per-call state, and `runComputation` is synchronous, so
 * the context is set immediately before the call and cleared immediately after. Nothing can
 * interleave between those two statements — which is true only for one evaluator's own slot, so
 * the slot lives in the evaluator and not at module scope where two runs would share one.
 */
function createFormulaEvaluator(): (options: {
	readonly code: string;
	readonly expr: string;
	readonly context: FormulaContext;
}) => number {
	let active: FormulaContext | null = null;

	const context = (): FormulaContext => {
		if (active == null)
			throw new Error('A pay component formula was evaluated outside a payslip context.');
		return active;
	};

	function readMap(map: Readonly<Record<string, number>>, key: unknown, what: string): number {
		const code = String(key);
		const value = map[code];
		if (value == null)
			throw new Error(
				`A formula asked for ${what} "${code}", which this payslip does not have. ` +
					'Every code a formula names must exist in the catalogue.'
			);
		return value;
	}

	const engine = createReckonEngine()
		.registerFunction('component', 'component(string): double', (code) =>
			readMap(context().components, code, 'component')
		)
		.registerFunction('entry', 'entry(string): double', (code) =>
			readMap(context().entries, code, 'entry')
		)
		.registerFunction('fact', 'fact(string, string): dyn', (contribution, key) => {
			const composite = `${String(contribution)}.${String(key)}`;
			const value = context().facts[composite];
			if (value == null)
				throw new Error(
					`A formula asked for statutory fact "${composite}", which this employment does not carry.`
				);
			return value;
		})
		.registerFunction('leaveDays', 'leaveDays(string): double', (code) =>
			readMap(context().leaveDays, code, 'leave type')
		)
		.registerFunction('leaveBalance', 'leaveBalance(string): double', (code) =>
			readMap(context().leaveBalances, code, 'leave type')
		);

	return (options): number => {
		const name = exprName(options.code);
		const definition: ComputationDefinition = {
			id: `pay_component:${options.code}`,
			tables: {},
			exprs: { [name]: options.expr },
			outputs: [name]
		};
		const input = {
			terms: options.context.terms,
			derived: options.context.derived,
			period: options.context.period,
			jurisdiction: options.context.jurisdiction,
			components: options.context.components,
			entries: options.context.entries,
			facts: options.context.facts
		};
		// The slot is a resource: acquired for exactly the duration of one synchronous evaluation
		// and released whether the engine returns a number or throws a definition fault. Modeling
		// it as acquire/use/release keeps the release out of the error path.
		const run = Effect.acquireUseRelease(
			Effect.sync(() => {
				active = options.context;
			}),
			() =>
				Effect.try({
					try: () => {
						const { outputs } = engine.runComputation<typeof input, Record<string, unknown>>(
							definition,
							input
						);
						const value = outputs[name];
						if (typeof value !== 'number' || !Number.isFinite(value))
							throw new Error(
								`Pay component ${options.code} produced ${JSON.stringify(value)} rather than a number.`
							);
						return value;
					},
					// Same error, unchanged: a formula fault must surface as the statement it is,
					// not as a wrapper whose message says where it was intercepted.
					catch: (error) => error
				}),
			() =>
				Effect.sync(() => {
					active = null;
				})
		);
		return Effect.runSync(run);
	};
}

const evaluateFormulaOnce = createFormulaEvaluator();

/** Evaluate one component's formula. Returns a number; anything else is a definition fault. */
export function evaluateFormula(options: {
	readonly code: string;
	readonly expr: string;
	readonly context: FormulaContext;
}): number {
	return evaluateFormulaOnce(options);
}

/** A CEL identifier derived from a component code, stable and collision-free enough to name an expr. */
function exprName(code: string): string {
	const cleaned = code.replaceAll(/[^A-Za-z0-9_]/g, '_');
	return /^[A-Za-z_]/.test(cleaned) ? cleaned : `c_${cleaned}`;
}
