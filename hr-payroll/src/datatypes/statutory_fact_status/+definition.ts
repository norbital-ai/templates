import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';

/**
 * Whether an employment is registered for a statutory contribution.
 * `rate_override` replaces a percentage award (e.g. voluntary EPF), or replaces a progressive
 * scheme with a flat award on current remuneration (e.g. non-resident PCB); `null` = use the band.
 *
 * A registration carries the facts that belong to the employment under that scheme: the day the
 * employment registered (`since`), the authority's directed instalments (a Form CP38 direction),
 * and the elections the scheme row declares (`SHG` opt-out, a withholding-table choice, a PTKP
 * status). They are not rates and no band reads them; a rule reads them as
 * `scheme.since`, `scheme.elections.<key>`, and the engine adds an instalment after the ladder.
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
export const statutoryFactOpeningSchema = Schema.Struct({
	/** The tax year the figures belong to, as the version's `tax_year_start_month` labels it (`YYYY`). */
	year: Schema.String.check(Schema.isMinLength(4)),
	/** The base the earlier employer charged this scheme on in that year to the join date. */
	base: Schema.Finite,
	/** What the earlier employer withheld from the employee under this scheme. */
	employee: Schema.Finite,
	/** What the earlier employer contributed under this scheme. */
	employer: Schema.Finite,
	/** The ordinary part of `base`, where the scheme states `ordinary_on`. */
	ordinary: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
	/** Months employed elsewhere in that year before joining. */
	months: Schema.optionalKey(Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)))),
	/** The form the figures come from (TP3, 2316 …). */
	reference: Schema.String
});

export const statutoryFactStatusValueSchema = Schema.Union([
	Schema.Struct({
		kind: Schema.Literal('REGISTERED'),
		reference_number: Schema.String.check(Schema.isMinLength(1)),
		rate_override: Schema.NullOr(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))),
		/** The day the employment registered with the scheme; empty when unrecorded. */
		since: Schema.optionalKey(Schema.NullOr(Schema.String)),
		/** Directed instalments the authority names, added after the scheme's own ladder. */
		instalments: Schema.optionalKey(Schema.Array(statutoryFactInstalmentSchema)),
		/** The employment's elections under this scheme; keys the scheme row declares. */
		elections: Schema.optionalKey(
			Schema.Record(Schema.String, Schema.Union([Schema.Boolean, Schema.Finite, Schema.String]))
		),
		/** Earlier employers' figures under this scheme, by tax year, declared on joining. */
		opening: Schema.optionalKey(Schema.Array(statutoryFactOpeningSchema))
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
		'Whether an employment is registered with a statutory scheme and under which reference number, with an optional rate that replaces the band’s own, the day the employment registered, the authority’s directed instalments, the employment’s declared elections, or the stated reason it is not registered.',
	schema: statutoryFactStatusSchema
});
