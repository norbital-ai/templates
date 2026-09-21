import { isEligible, type PersonContext } from '../collections/payroll_runs/lib/eligibility.js';
import { refuse } from '@norbital-ai/bolt/authoring';
import { factValueFault, type FactKey } from '../datatypes/fact_keys/+definition.js';
import { coversDate } from '../collections/payroll_runs/lib/effective.js';
import { EMPTY_OF } from './expressions/compile.js';
import { evaluateBoolean, expressionEngine } from './expressions/evaluate.js';

/** Validate supplied values without inventing a declaration for missing data. */
export function factValuesFault(
	fields: readonly FactKey[],
	values: Readonly<Record<string, unknown>>,
	complete = false,
	when?: (expression: string) => boolean
): string | null {
	for (const field of fields) {
		const value = Object.hasOwn(values, field.key) ? values[field.key] : undefined;
		if (
			complete &&
			(value === undefined || (typeof value === 'string' && value.trim() === '')) &&
			(field.required || (field.required_when != null && when?.(field.required_when)))
		)
			return `${field.label?.trim() || field.key} is required before calculation.`;
		if (value !== undefined) {
			const fault = factValueFault(field, value);
			if (fault != null) return fault;
			if (field.valid_when != null && when != null && !when(field.valid_when))
				return (
					field.validation_message?.trim() ||
					`${field.label?.trim() || field.key} is not valid in this context.`
				);
		}
	}
	return null;
}

export function requireFactValues(
	fields: readonly FactKey[],
	values: Readonly<Record<string, unknown>>,
	scope: string,
	when?: (expression: string) => boolean
): void {
	const fault = factValuesFault(fields, values, true, when);
	if (fault != null) refuse(`${scope}: ${fault}`);
}

/** One dated revision of an entity's declared facts. */
export type CompanyFactRevision = {
	readonly facts: Readonly<Record<string, string | number | boolean>>;
	readonly effective_range: unknown;
};

/**
 * Keep raw presence separate from expression defaults when checking entity requirements.
 *
 * A dated revision in force on `asOf` supplies the values for that day; without one the company
 * row's current facts are the standing record, which is what an undated caller reads.
 */
export function resolveCompanyFacts(
	fields: readonly FactKey[],
	company: {
		readonly name?: string;
		readonly settings_code: string;
		readonly region: string | null;
		readonly pay_frequency: string;
		readonly facts?: Readonly<Record<string, string | number | boolean>> | null;
	},
	options?: {
		readonly asOf?: string;
		readonly revisions?: readonly CompanyFactRevision[];
	}
): Record<string, string | number | boolean> {
	const revision =
		options?.asOf == null
			? undefined
			: (options.revisions ?? []).find((row) => coversDate(row.effective_range, options.asOf!));
	const raw = revision?.facts ?? company.facts ?? {};
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
	requireFactValues(fields, raw, scope, (expression) =>
		evaluateBoolean(expressionEngine, expression, context)
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
	const fault = factValuesFault(fields, values, complete);
	if (fault != null) refuse(`${scope}: ${fault}`);
	return Object.fromEntries(
		fields.map((field) => [
			field.key,
			Object.hasOwn(values, field.key)
				? values[field.key]
				: (field.default_value ?? EMPTY_OF[field.type])
		])
	);
}

/** Validate departure declarations against the final-service-day person before selecting or pricing an exit payment. */
export function resolveExitFacts(
	fields: readonly FactKey[],
	values: Readonly<Record<string, string | number | boolean>>,
	person: PersonContext
): PersonContext {
	const resolved = {
		...person,
		employment: {
			...person.employment,
			exit_facts: resolveFactValues(fields, values, 'Departure', false),
			exit_fact_keys: Object.keys(values)
		}
	};
	requireFactValues(fields, values, 'Departure', (expression) => isEligible(expression, resolved));
	return resolved;
}
