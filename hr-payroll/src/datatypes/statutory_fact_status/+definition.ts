import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';
import { calendarDay } from '../../lib/iso-day.js';

/**
 * A person's dated registration and declarations for a statutory contribution.
 * `rate_override` replaces a percentage award (e.g. voluntary EPF), or replaces a progressive
 * scheme with a flat award on current remuneration (e.g. non-resident PCB); `null` = use the band.
 *
 * `since` records current-employer registration; `first_contribution_due_on` includes prior
 * employers. Scheme rules read the dates and declared elections. Directed instalments, such as
 * Form CP38, are added after the scheme's calculated charge.
 */
export const statutoryFactInstalmentSchema = Schema.Struct({
	/** The amount withheld each month of the window. */
	amount: Schema.Finite,
	/** First month the direction covers, `YYYY-MM`. */
	from: Schema.String,
	/** Last month the direction covers, `YYYY-MM`. */
	to: Schema.String,
	/** The authority's own reference for the direction. */
	reference: Schema.String
});

/**
 * What an earlier employer paid and withheld under this scheme in a tax year, as the person
 * declared it on joining (MY Form TP3: accumulated remuneration, EPF and PCB paid; PH BIR 2316:
 * the prior employer's income and tax withheld). Read as an opening balance of
 * `scheme.year_to_date` and `year.months_employed` for that year; nothing else in the tenant can
 * see a previous employer.
 */
const statutoryFactOpeningSchema = Schema.Struct({
	/** The tax year the figures belong to, as the version's `tax_year_start_month` labels it (`YYYY`). */
	year: Schema.String.check(Schema.isMinLength(4)),
	/** The base the earlier employer charged this scheme on in that year to the join date. */
	base: Schema.Finite,
	/** What the earlier employer withheld from the employee under this scheme. */
	employee: Schema.Finite,
	/** What the earlier employer contributed under this scheme. */
	employer: Schema.Finite,
	/** Earlier-employer rebatable payments for this tax year, such as TP3 zakat. */
	rebate: Schema.optionalKey(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))),
	/** The ordinary part of `base`, where the scheme states `ordinary_on`. */
	ordinary: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
	/** Months employed elsewhere in that year before joining. */
	months: Schema.optionalKey(Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)))),
	/** Prior payroll periods represented by the opening, expressed in the stated cadence. */
	payroll_periods: Schema.optionalKey(
		Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)))
	),
	payroll_frequency: Schema.optionalKey(
		Schema.NullOr(Schema.Literals(['MONTHLY', 'SEMI_MONTHLY', 'WEEKLY']))
	),
	/** The form the figures come from (TP3, 2316 …). */
	reference: Schema.String
});

/** Tax-year child-relief declarations; family records alone do not establish a tax claim. */
const statutoryChildClaimSchema = Schema.Struct({
	year: Schema.String,
	relief_class: Schema.String,
	full_count: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
	half_count: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
	reference: Schema.String
});

/** Employer-accepted deductions, including prior-employer declarations and signed corrections. */
const statutoryDeductionClaimSchema = Schema.Struct({
	period: Schema.String,
	category: Schema.String,
	amount: Schema.Finite,
	source: Schema.Literals(['EMPLOYEE', 'PRIOR_EMPLOYER']),
	reference: Schema.String,
	/** Stable event identity across the original claim and separately referenced corrections. */
	event_reference: Schema.optionalKey(Schema.String)
});
export type StatutoryDeductionClaim = Schema.Schema.Type<typeof statutoryDeductionClaimSchema>;

const statutoryFactStatusValueSchema = Schema.Union([
	Schema.Struct({
		kind: Schema.Literal('REGISTERED'),
		reference_number: Schema.String.check(Schema.isMinLength(1)),
		rate_override: Schema.NullOr(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))),
		/** The day the employment registered with the scheme; empty when unrecorded. */
		since: Schema.optionalKey(Schema.NullOr(Schema.String)),
		/** First statutory contribution liability, including earlier employers; not the payment date. */
		first_contribution_due_on: Schema.optionalKey(Schema.NullOr(calendarDay)),
		/** Directed instalments the authority names, added after the scheme's own ladder. */
		instalments: Schema.optionalKey(Schema.Array(statutoryFactInstalmentSchema)),
		/** The employment's elections under this scheme; keys the scheme row declares. */
		elections: Schema.optionalKey(
			Schema.Record(Schema.String, Schema.Union([Schema.Boolean, Schema.Finite, Schema.String]))
		),
		/** Earlier employers' figures under this scheme, by tax year, declared on joining. */
		opening: Schema.optionalKey(Schema.Array(statutoryFactOpeningSchema)),
		/** Eligible child counts at full or half entitlement, by tax year and relief class. */
		child_claims: Schema.optionalKey(Schema.Array(statutoryChildClaimSchema)),
		/** Monthly approved claims; expense eligibility is established by the referenced declaration. */
		deduction_claims: Schema.optionalKey(Schema.Array(statutoryDeductionClaimSchema))
	}),
	Schema.Struct({
		kind: Schema.Literal('NOT_REGISTERED'),
		reason: Schema.String.check(Schema.isMinLength(1))
	})
]);

export type StatutoryFactStatus = Schema.Schema.Type<typeof statutoryFactStatusValueSchema>;

/** Strict standard view: a key no arm declares is refused rather than stripped. */
export const statutoryFactStatusSchema = Schema.toStandardSchemaV1(statutoryFactStatusValueSchema, {
	parseOptions: { onExcessProperty: 'error' }
});

export default defineCustomType({
	name: 'statutory_fact_status',
	description:
		'A person’s statutory registration, current-employer registration date, first contribution liability date, declared elections, prior-employer balances and directed instalments, or the reason for exclusion.',
	schema: statutoryFactStatusSchema
});
