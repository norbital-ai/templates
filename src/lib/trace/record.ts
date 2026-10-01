/**
 * The evaluation trace of one payslip line: every stored expression evaluated while the line was
 * priced, with the settings version, the value it produced, the inputs it read (with the revision
 * date and evidence the caller knows), the table rows it looked up and each rounding step. It is
 * the "why is this number" of a line, recorded as the engine ran — a copy of what it did, never a
 * second calculation.
 *
 * The recorder is ambient, in two scopes. The run opens `collectLineTraces` around one payslip's
 * build; each line producer wraps its pricing in `traceLine(line, …, price)`, which is a plain call
 * outside a collection, so producers wrap unconditionally and pay nothing in a preview. Inside, the
 * one evaluation choke point (`expressions/evaluate.ts` `run`) hands every evaluation to
 * `evaluationObserver()` (`./observer.ts`). The observer substitutes a recording `tables` and `round` on the engine and delegates to the
 * originals, so a traced evaluation returns exactly what an untraced one does.
 */

import { roundStep, type RoundMode } from '../payroll/run/rounding.js';
import { tablesIn, type TableLookup, type TableRowMap } from '../expressions/functions/tables.js';
import { expressionReads } from '../rule-map/reads.js';
import { observeEvaluations, type EvaluationObserver } from './observer.js';
import { getErrorMessage } from '../refuse.js';
import * as Predicate from 'effect/Predicate';

/** The payslip line a trace explains: an adjustment by component and source, or a scheme charge. */
export type TracedLine = {
	/** Whose payslip: a run-wide collection splits its traces by it (`tracesForEmployment`). */
	readonly employment_id?: string | null;
	readonly kind: 'ADJUSTMENT' | 'STATUTORY';
	/** The adjustment's `component_code`, or the charge's `scheme_code`. */
	readonly code: string;
	/** The adjustment's `source_id`; absent on a scheme charge. */
	readonly source_id?: string | null;
	/** Which part of the line, where one source prices several (a work day's overtime bands). */
	readonly part?: string | null;
};

/** Where an input's value came from, where the caller knows: the revision in force and its evidence. */
export type ReadProvenance = {
	readonly effective_from?: string | null;
	readonly evidence?: string | null;
};

export type TraceStep = {
	readonly expression: string;
	/** The result, as text (`true`, `1234.5`, `2026-03-01`), or empty where it threw. */
	readonly value: string;
	readonly error?: string | null;
	readonly reads: readonly ({ readonly path: string; readonly value: string } & ReadProvenance)[];
	readonly tables: readonly {
		readonly fn: 'table' | 'band' | 'bands';
		readonly name: string;
		readonly keys: string;
		/** The looked-up value of a band lookup. */
		readonly value?: string | null;
		/** The row(s) found, as JSON text; empty where none matched. */
		readonly row: string;
	}[];
	readonly rounding: readonly {
		readonly value: number;
		readonly step: number;
		readonly mode: string;
		readonly result: number;
	}[];
};

export type LineTrace = {
	readonly line: TracedLine;
	/** The settings version whose expressions priced it. */
	readonly settings_id: string;
	readonly steps: readonly TraceStep[];
	/** Evaluations that returned false (a rule ladder's rungs passed over), counted, not kept. */
	readonly skipped: number;
	/** Evaluations past `STEP_CAP`, counted, not kept. */
	readonly omitted: number;
};

/** The engine members the recorder substitutes (`ExpressionEngine`'s, structurally). */
type EngineHooks = {
	readonly tables?: TableLookup | undefined;
	readonly round?:
		| ((value: number, rounding: { readonly step: number; readonly mode: RoundMode }) => number)
		| undefined;
};

// ponytail: caps keep one slip's explanation to a few tens of KB; raise them if a line needs more.
const STEP_CAP = 24;
const READ_CAP = 32;
const CALL_CAP = 12;
const TEXT_CAP = 160;

const text = (value: unknown): string => {
	const written = Predicate.isString(value)
		? value
		: Predicate.isBigInt(value)
			? String(value)
			: (JSON.stringify(value, (_key, item) => (Predicate.isBigInt(item) ? String(item) : item)) ??
				String(value));
	return written.length > TEXT_CAP ? `${written.slice(0, TEXT_CAP - 1)}…` : written;
};

/** A path's value on the context, or on the person it carries (`person.<path>`); undefined where absent. */
function valueAt(context: object, path: string): unknown {
	const walk = (root: unknown) =>
		path
			.split('.')
			.reduce<unknown>(
				(value, key) => (Predicate.isObjectOrArray(value) ? Reflect.get(value, key) : undefined),
				root
			);
	const own = walk(context);
	return own !== undefined ? own : walk((context as { readonly person?: unknown }).person);
}

let collected: Map<string, LineTrace> | null = null;

const keyOf = (line: TracedLine) =>
	[line.employment_id ?? '', line.kind, line.code, line.source_id ?? '', line.part ?? ''].join(
		'\u0000'
	);

/**
 * Every line trace recorded while `build` runs, one per line (a line priced again — a second
 * candidate, a re-assessment — replaces its earlier trace, since the last pricing is the one kept).
 */
export function collectLineTraces<T>(build: () => T): {
	readonly result: T;
	readonly traces: readonly LineTrace[];
} {
	const previous = collected;
	const traces = new Map<string, LineTrace>();
	collected = traces;
	try {
		const result = build();
		return { result, traces: [...traces.values()] };
	} finally {
		collected = previous;
	}
}

/**
 * Price one line, recording every evaluation inside `price` when a collection is open; outside one,
 * just price it. `provenance` answers, for a read path (`terms.facts.<key>`, `employee.facts.<key>`),
 * the revision it came from and its evidence. Scopes nest: a line priced inside another's scope
 * records into its own trace, and the outer resumes.
 */
export function traceLine<T>(
	line: TracedLine,
	options: {
		readonly settingsId: string;
		readonly provenance?: ((path: string) => ReadProvenance | null | undefined) | undefined;
	},
	price: () => T
): T {
	const into = collected;
	if (into == null) return price();
	const steps: TraceStep[] = [];
	let skipped = 0;
	let omitted = 0;
	const observe: EvaluationObserver = (engine, expression, context, evaluate) => {
		const hooks = engine as EngineHooks;
		const tables: TraceStep['tables'][number][] = [];
		const rounding: TraceStep['rounding'][number][] = [];
		const lookup = hooks.tables ?? tablesIn(context);
		const note = (entry: TraceStep['tables'][number]) => {
			if (tables.length < CALL_CAP) tables.push(entry);
		};
		const recording: TableLookup | undefined =
			lookup == null
				? undefined
				: {
						table: (name, keys) => {
							const row = lookup.table(name, keys);
							note({ fn: 'table', name, keys: text(keys), row: row == null ? '' : text(row) });
							return row;
						},
						band: (name, value, keys) => {
							const row = lookup.band(name, value, keys);
							note({
								fn: 'band',
								name,
								keys: text(keys),
								value: String(value),
								row: row == null ? '' : text(row)
							});
							return row;
						},
						bands: (name, keys) => {
							const rows: readonly TableRowMap[] = lookup.bands(name, keys);
							note({
								fn: 'bands',
								name,
								keys: text(keys),
								row: rows.length === 0 ? '' : text(rows)
							});
							return rows;
						}
					};
		const own = hooks.round;
		const round = (value: number, step: { readonly step: number; readonly mode: RoundMode }) => {
			const result = own != null ? own(value, step) : roundStep(value, step.step, step.mode);
			if (rounding.length < CALL_CAP) rounding.push({ value, ...step, result });
			return result;
		};
		const record = (value: unknown, error: string | null) => {
			if (value === false && error == null) {
				skipped++;
				return;
			}
			if (steps.length >= STEP_CAP) {
				omitted++;
				return;
			}
			steps.push({
				expression,
				value: error == null ? text(value) : '',
				...(error == null ? {} : { error }),
				reads: expressionReads(expression)
					.paths.slice(0, READ_CAP)
					.map((path) => ({
						path,
						value: text(valueAt(context, path) ?? null),
						...(options.provenance?.(path) ?? {})
					})),
				tables,
				rounding
			});
		};
		try {
			const value = evaluate({ ...engine, tables: recording ?? hooks.tables, round });
			record(value, null);
			return value;
		} catch (cause) {
			record(undefined, getErrorMessage(cause));
			throw cause;
		}
	};
	const previous = observeEvaluations(observe);
	try {
		return price();
	} finally {
		observeEvaluations(previous);
		into.set(keyOf(line), { line, settings_id: options.settingsId, steps, skipped, omitted });
	}
}

/** One payslip's share of a run-wide collection. */
export const tracesForEmployment = (
	traces: readonly LineTrace[],
	employmentId: string
): readonly LineTrace[] => traces.filter((trace) => trace.line.employment_id === employmentId);

/** The traces of one payslip line among a slip's (each part of it, in pricing order). */
export function tracesOf(
	traces: readonly LineTrace[],
	line: Omit<TracedLine, 'part' | 'employment_id'>
): readonly LineTrace[] {
	return traces.filter(
		(trace) =>
			trace.line.kind === line.kind &&
			trace.line.code === line.code &&
			(line.kind === 'STATUTORY' || (trace.line.source_id ?? null) === (line.source_id ?? null))
	);
}
