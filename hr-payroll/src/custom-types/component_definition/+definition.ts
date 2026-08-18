import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';
import { eligibilityRulesValueSchema } from '../eligibility_rules/+definition.js';
import { dateRangeValueSchema } from '../date_range/+definition.js';

/**
 * `Finite` rather than `Number` throughout this file: `Number` admits `NaN` and `Infinity`, and the
 * numeric zod schemas these replaced admitted neither. Money and percentages that can be `NaN` fail
 * no later check and raise no error — they travel to the payslip and read as a blank cell.
 */
const capAwardSchema = Schema.Union([
	Schema.Struct({
		kind: Schema.Literal('FIXED'),
		amount: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))
	}),
	Schema.Struct({ kind: Schema.Literal('FORMULA'), expr: Schema.NonEmptyString })
]);
const capLayer = {
	eligibility: eligibilityRulesValueSchema,
	authority: Schema.NonEmptyString,
	award: capAwardSchema,
	reimbursement_percentage: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 100 })),
	effective_range: dateRangeValueSchema
} as const;
const capLayerSchema = Schema.Union([
	Schema.Struct({ level: Schema.Literal('STATUTORY'), ...capLayer }),
	Schema.Struct({ level: Schema.Literal('ORGANISATION'), ...capLayer }),
	Schema.Struct({
		level: Schema.Literal('EMPLOYEE'),
		employment_id: Schema.String.check(Schema.isUUID()),
		...capLayer
	})
]);

/** Layered cap applied to a claimable or allowance ENTRY component. */
export const componentCapSchema = Schema.Struct({
	period: Schema.Literals(['CALENDAR_YEAR', 'LEAVE_YEAR', 'MONTH', 'LIFETIME', 'PER_EVENT']),
	matrix: Schema.Struct({
		merge: Schema.Literal('MAX_WITH_STATUTORY_FLOOR'),
		// At least one layer: an empty matrix is not "no cap", it is a cap every claim exceeds.
		layers: Schema.Array(capLayerSchema).check(Schema.isMinLength(1))
	}),
	on_exceed: Schema.Literals(['BLOCK', 'ALLOW'])
});

export type ComponentCap = typeof componentCapSchema.Type;

/**
 * How a pay component produces its amount.
 *
 * - `ENTRY`     — a person or an import supplies the number (claims, allowances, ad-hoc pay).
 * - `FORMULA`   — a CEL expression over the payslip context.
 * - `SCHEDULE`  — the contracted amount from `employment_terms` (basic salary).
 *
 * There is deliberately NO overtime source. Overtime is derived from `time_entries` priced against
 * the jurisdiction's `statutory_regime.overtime_rules`, and an overtime multiple comes from statute
 * rather than from tenant configuration — modelling it here let two companies in one jurisdiction
 * disagree about what the law says. Its statutory treatment lives on the scheme that charges it,
 * `statutory_contributions.overtime_treatments`.
 *
 * There is deliberately NO statutory information here either: chargeability is reachable only via
 * `pay_components.policy.statutory_treatments`.
 */
export const componentDefinitionValueSchema = Schema.Union([
	Schema.Struct({
		source: Schema.Literal('ENTRY'),
		unit: Schema.Literals(['MONEY', 'DAYS', 'HOURS']),
		evidence: Schema.Literals(['NONE', 'OPTIONAL', 'REQUIRED']),
		cap: Schema.NullOr(componentCapSchema),
		settlement: Schema.Literals(['PAYROLL', 'COMPANY_DIRECT'])
	}),
	Schema.Struct({
		source: Schema.Literal('FORMULA'),
		unit: Schema.Literals(['MONEY', 'DAYS', 'HOURS', 'RATE']),
		expr: Schema.NonEmptyString
	}),
	Schema.Struct({
		source: Schema.Literal('SCHEDULE'),
		unit: Schema.Literal('MONEY'),
		reducible: Schema.Boolean
	})
]);

export type ComponentDefinition = Schema.Schema.Type<typeof componentDefinitionValueSchema>;

/** Strict standard view: a key no arm declares is refused rather than stripped. */
export const componentDefinitionSchema = Schema.toStandardSchemaV1(componentDefinitionValueSchema, {
	parseOptions: { onExcessProperty: 'error' }
});

export default defineCustomType({
	name: 'component_definition',
	description:
		'How a pay component gets its number — typed in as an entry under a layered claim cap, computed from a formula, or taken from the contracted salary.',
	schema: componentDefinitionSchema
});
