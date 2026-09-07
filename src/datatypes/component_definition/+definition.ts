import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';
import { instantRangeValueSchema } from '@norbital-ai/bolt/authoring';

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
	/** One CEL expression over the person context (`payroll_runs/lib/eligibility.ts`); '' is everyone. */
	eligibility: Schema.String,
	authority: Schema.NonEmptyString,
	award: capAwardSchema,
	reimbursement_percentage: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 100 })),
	effective_range: instantRangeValueSchema
} as const;
const capLayerSchema = Schema.Union([
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
		merge: Schema.Literal('MAX_WITH_COMPANY_LAYERS'),
		// At least one layer: an empty matrix is not "no cap", it is a cap every claim exceeds.
		layers: Schema.Array(capLayerSchema).check(Schema.isMinLength(1))
	}),
	on_exceed: Schema.Literals(['BLOCK', 'ALLOW'])
});

/**
 * How a component produces its amount.
 *
 * - `ENTRY`     — a person or an import supplies the number (claims, allowances, ad-hoc pay).
 * - `FORMULA`   — a CEL expression over the payslip context.
 * - `SCHEDULE`  — the contracted amount from `employment_terms` (basic salary).
 *
 * - `DERIVED_OVERTIME` — priced by the jurisdiction's regime, never entered. The `OVERTIME` and
 *   `OVERTIME_EXCESS` catalogue rows carry it so the scheme treatments of derived overtime live
 *   where every other treatment does; the multiple itself comes from statute
 *   (`statutory_regime.overtime_rules`), never from this row.
 *
 * There is deliberately NO statutory information here: chargeability is reachable only via
 * `component_catalogue.contribution_treatments`.
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
	}),
	/**
	 * Money the leave ledger says is owed: the COMMUTED and ENCASHED lines the run owns, priced at
	 * the statute's basis and the terms in force on each line's date. Nobody types it; the component
	 * only says how it is treated and reported.
	 */
	Schema.Struct({ source: Schema.Literal('LEAVE_PAYOUT'), unit: Schema.Literal('MONEY') }),
	/** Derived overtime: the regime prices it from work days; nobody types it and no formula reads it. */
	Schema.Struct({ source: Schema.Literal('DERIVED_OVERTIME'), unit: Schema.Literal('MONEY') })
]);

export type ComponentDefinition = Schema.Schema.Type<typeof componentDefinitionValueSchema>;

/** Strict standard view: a key no arm declares is refused rather than stripped. */
export const componentDefinitionSchema = Schema.toStandardSchemaV1(componentDefinitionValueSchema, {
	parseOptions: { onExcessProperty: 'error' }
});

export default defineCustomType({
	name: 'component_definition',
	description:
		'How a component gets its number — typed in as an entry under a layered claim cap, computed from a formula, taken from the contracted salary, priced from the leave ledger, or derived from work days by the overtime regime.',
	schema: componentDefinitionSchema
});
