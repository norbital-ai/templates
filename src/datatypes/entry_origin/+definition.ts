import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';
import { instantRangeValueSchema } from '@norbital-ai/bolt/authoring';

/**
 * A calendar day in the payroll timezone, as `2026-04-02`.
 *
 * The pattern fixes the grammar and the filter fixes the calendar, for the same reason the platform's
 * instant schema pairs them: the pattern alone admits `2026-02-30`, which `Date` rolls forward to
 * March, so a claim would be recorded as incurred on a day that does not exist.
 */
const calendarDay = Schema.String.check(
	Schema.isPattern(/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/),
	Schema.makeFilter(
		(value: string) =>
			new Date(`${value}T00:00:00Z`).toISOString().startsWith(value) ||
			'must name a day that exists',
		{ title: 'realCalendarDay' }
	)
);

/**
 * Why a component entry exists. This replaces every "source" side table — one entry
 * stream, one origin variant.
 *
 * A variant cannot be a foreign key: `evidence_file`, `agreement_id`,
 * `reverses_entry_id` are validated in `+hooks.ts`, not by a constraint.
 *
 * `onExcessProperty: 'error'` is applied by the authoring surface to every custom-type value, so a
 * stray key is reported rather than stripped, which is how a value of the wrong shape reaches
 * storage and only surfaces as a column reading null.
 */
export const entryOriginValueSchema = Schema.Union([
	Schema.Struct({
		kind: Schema.Literal('RECURRING'),
		cadence: Schema.Literal('PAY_PERIOD'),
		effective_range: instantRangeValueSchema
	}),
	Schema.Struct({ kind: Schema.Literal('ONE_OFF'), note: Schema.String }),
	Schema.Struct({
		kind: Schema.Literal('CLAIM'),
		evidence_file: Schema.NullOr(Schema.String.check(Schema.isUUID())),
		incurred_on: calendarDay
	}),
	Schema.Struct({
		kind: Schema.Literal('LOAN_INSTALMENT'),
		agreement_id: Schema.String.check(Schema.isUUID()),
		// `isGreaterThan(0)`, not `Schema.Natural`: instalment 0 of 0 is not an instalment, and
		// `Natural` admits zero where the `z.positive()` this replaced did not.
		sequence: Schema.Int.check(Schema.isGreaterThan(0)),
		of: Schema.Int.check(Schema.isGreaterThan(0))
	}),
	Schema.Struct({
		kind: Schema.Literal('REVERSAL'),
		reverses_entry_id: Schema.String.check(Schema.isUUID()),
		reason: Schema.NonEmptyString
	}),
	Schema.Struct({
		kind: Schema.Literal('ARREARS'),
		covers_periods: Schema.Array(Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}$/))).check(
			Schema.isMinLength(1)
		),
		reason: Schema.NonEmptyString
	}),
	Schema.Struct({
		kind: Schema.Literal('MANUAL_ADJUSTMENT'),
		note: Schema.String
	})
]);

export type EntryOrigin = Schema.Schema.Type<typeof entryOriginValueSchema>;

/** Strict standard view: a key no arm declares is refused rather than stripped. */
export const entryOriginSchema = Schema.toStandardSchemaV1(entryOriginValueSchema, {
	parseOptions: { onExcessProperty: 'error' }
});

export default defineCustomType({
	name: 'entry_origin',
	description:
		'Why a component entry exists — a recurring allowance, a one-off, a claim with its evidence and incurred date, a numbered loan instalment, a reversal of an earlier entry, arrears covering named past periods, or a manual adjustment with its note.',
	schema: entryOriginSchema
});
