import { isEligible, scalarFacts, type PersonContext } from '../lib/payroll/run/eligibility.js';
import { refuse } from './refuse.js';
import {
	factScalar,
	factValueFault,
	parentOf,
	type CodeResolver,
	type FactKey
} from './datatypes/fact_keys.js';
import { coversDate } from '../lib/payroll/run/effective.js';
import { EMPTY_OF } from './expressions/compile.js';
import { evaluateBoolean, expressionEngine } from './expressions/evaluate.js';
import * as Predicate from 'effect/Predicate';

/**
 * Validate supplied values without inventing a declaration for missing data. `complete` is the
 * calculation's check: a required value must be present, and a value whose declaration demands
 * evidence counts only where `evidenced` says its evidence is recorded (no answer is none). With
 * `codes`, a `code` value must be a row of its table in force on the caller's date, under the code
 * its `parent_fact` holds: another value of the list, else the subject record's column (`parents`).
 */
export function factValuesFault(
	fields: readonly FactKey[],
	values: Readonly<Record<string, unknown>>,
	complete = false,
	when?: (expression: string) => boolean,
	evidenced?: (key: string) => boolean,
	codes?: CodeResolver,
	parents?: Readonly<Record<string, unknown>>
): string | null {
	for (const field of fields) {
		const value = Object.hasOwn(values, field.key) ? values[field.key] : undefined;
		if (
			complete &&
			(value === undefined || (Predicate.isString(value) && value.trim() === '')) &&
			(field.required || (field.required_when != null && when?.(field.required_when)))
		)
			return `${field.label?.trim() || field.key} is required before calculation.`;
		if (value !== undefined) {
			const fault = factValueFault(field, value, codes, parentOf(field, values, parents));
			if (fault != null) return fault;
			if (field.valid_when != null && when != null && !when(field.valid_when))
				return (
					field.validation_message?.trim() ||
					`${field.label?.trim() || field.key} is not valid in this context.`
				);
			if (
				complete &&
				field.evidence != null &&
				(field.evidence.when == null || when?.(field.evidence.when) !== false) &&
				evidenced?.(field.key) !== true
			)
				return `${field.label?.trim() || field.key} counts only once its evidence (${field.evidence.kind.toLowerCase().replaceAll('_', ' ')}) is recorded.`;
		}
	}
	return null;
}

export function requireFactValues(
	fields: readonly FactKey[],
	values: Readonly<Record<string, unknown>>,
	scope: string,
	when?: (expression: string) => boolean,
	evidenced?: (key: string) => boolean,
	codes?: CodeResolver
): void {
	const fault = factValuesFault(fields, values, true, when, evidenced, codes);
	if (fault != null) refuse(`${scope}: ${fault}`);
}

/**
 * One dated revision of an entity's declared facts. `evidence_keys` are the keys its `fact_evidence`
 * rows evidence; a rule that relies on an evidenced entity fact reads them (the writer judges the row).
 */
export type CompanyFactRevision = {
	readonly facts: Readonly<Record<string, unknown>>;
	readonly effective_range: unknown;
	readonly evidence_keys?: readonly string[] | undefined;
};

/**
 * A subject's recorded declared input (`terms.facts.<key>` on a terms row), or undefined where it
 * records none: a declared default filled in by the run is not a record.
 */
export function recordedFact(
	row:
		| {
				readonly facts?: Readonly<Record<string, unknown>> | null;
				readonly fact_keys?: readonly string[];
		  }
		| null
		| undefined,
	key: string
): unknown {
	const facts = row?.facts ?? {};
	return (row?.fact_keys ?? Object.keys(facts)).includes(key) ? facts[key] : undefined;
}

/**
 * Keep raw presence separate from expression defaults when checking entity requirements.
 *
 * A dated revision in force on `asOf` supplies the values for that day; without one the company
 * row's current facts are the standing record, which is what an undated caller reads.
 */
export function resolveCompanyFacts(
	fields: readonly FactKey[],
	company: {
		readonly name?: string | undefined;
		readonly settings_code: string;
		readonly region: string | null;
		readonly pay_frequency: string;
		readonly facts?: Readonly<Record<string, unknown>> | null | undefined;
	},
	options?: {
		readonly asOf?: string | undefined;
		readonly revisions?: readonly CompanyFactRevision[] | undefined;
	}
): Record<string, string | number | boolean> {
	const revision =
		options?.asOf == null
			? undefined
			: (options.revisions ?? []).find((row) => coversDate(row.effective_range, options.asOf!));
	const raw = scalarFacts(revision?.facts ?? company.facts);
	const scope = company.name ?? company.settings_code;
	const facts = resolveFactValues(fields, raw, scope);
	const context = {
		company: {
			settings_code: company.settings_code,
			region: company.region ?? '',
			pay_frequency: company.pay_frequency,
			facts,
			fact_keys: Object.keys(raw)
		}
	};
	// Entity-fact evidence is the dated revision's: a rule relying on it reads `evidence_keys`.
	requireFactValues(
		fields,
		raw,
		scope,
		(expression) => evaluateBoolean(expressionEngine, expression, context),
		() => true
	);
	return facts;
}

/** Governing-version checks run before legacy expression placeholders are supplied. */
export function resolveFactValues(
	fields: readonly FactKey[],
	values: Readonly<Record<string, string | number | boolean>>,
	scope: string,
	complete = true
): Record<string, string | number | boolean> {
	// Evidence is the caller's to judge (`requireFactValues`); resolution reads the values alone.
	const fault = factValuesFault(fields, values, complete, undefined, () => true);
	if (fault != null) refuse(`${scope}: ${fault}`);
	return Object.fromEntries(
		fields.map((field) => [
			field.key,
			Object.hasOwn(values, field.key)
				? values[field.key]!
				: (factScalar(field.default_value) ?? EMPTY_OF[field.type])
		])
	);
}

const exitPerson = (
	fields: readonly FactKey[],
	values: Readonly<Record<string, string | number | boolean>>,
	person: PersonContext
): PersonContext => ({
	...person,
	employment: {
		...person.employment,
		exit_facts: resolveFactValues(fields, values, 'Departure', false),
		exit_fact_keys: Object.keys(values)
	}
});

/** Validate departure declarations against the final-service-day person before selecting or pricing an exit payment. */
export function resolveExitFacts(
	fields: readonly FactKey[],
	values: Readonly<Record<string, string | number | boolean>>,
	person: PersonContext
): PersonContext {
	const resolved = exitPerson(fields, values, person);
	requireFactValues(fields, values, 'Departure', (expression) => isEligible(expression, resolved));
	return resolved;
}

/**
 * The departure declaration the final-service-day person owes and has not recorded, as
 * `resolveExitFacts` would name it; null when every recorded value is valid and nothing owed is
 * missing. A recorded value that is invalid is not "missing": the caller's `resolveExitFacts` refuses it.
 */
export function exitFactsMissing(
	fields: readonly FactKey[],
	values: Readonly<Record<string, string | number | boolean>>,
	person: PersonContext
): string | null {
	const resolved = exitPerson(fields, values, person);
	const when = (expression: string) => isEligible(expression, resolved);
	if (factValuesFault(fields, values, false, when) != null) return null;
	return factValuesFault(fields, values, true, when);
}
