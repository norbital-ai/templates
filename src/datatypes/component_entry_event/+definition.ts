import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';
import { calendarDay } from '../../lib/iso-day.js';

/**
 * Why a component entry exists, and the arm-specific scalar payload it carries.
 *
 * The five arms are deliberately five business facts, not one polymorphic "money" concept: a claim,
 * a standing allowance, a bonus, an arrears settlement and a manual correction have different
 * authors, different rules and different payslip semantics, and only their common shape — an
 * employment, a pay component, a positive magnitude and a date — is shared. That common shape lives
 * in real columns on `component_entries`; this union owns only what one arm can say and the others
 * cannot.
 *
 * Two facts stay OUT of the union on purpose:
 *
 * - `corrects_adjustment_id` must be a real foreign key, and the database cannot enforce a foreign
 *   key inside a jsonb blob — so it is a column beside the event, permitted only for
 *   `MANUAL_ADJUSTMENT`.
 * - a claim's evidence file is a platform `file()` column on the row, not a storage key in a blob:
 *   the platform owns upload, storage key and mime type, and a workspace that spells a file as a
 *   uuid string is a workspace where nothing can fetch, validate or clean it up.
 *
 * Direction is never stated here. An amount is a positive magnitude and the referenced pay
 * component's policy decides where it settles; the one exception is a `REVERSAL` correction, which
 * the engine settles in the opposite bucket of the adjustment it corrects — the sign is derived
 * there, from the settled output, never carried here.
 */
export const componentEntryEventValueSchema = Schema.Union([
	Schema.Struct({
		kind: Schema.Literal('CLAIM'),
		/** The day the expense was incurred, which is not the day it was entered. */
		incurred_on: calendarDay,
		description: Schema.NullOr(Schema.String)
	}),
	Schema.Struct({
		kind: Schema.Literal('ALLOWANCE')
		/**
		 * Deliberately empty. An allowance's cadence is the payslip period and its window is the
		 * row's own `effective_range` column; stating a cadence literal here would be a constant
		 * written into every row, which is a fact-shaped decoration rather than a fact.
		 */
	}),
	Schema.Struct({
		kind: Schema.Literal('BONUS'),
		note: Schema.NullOr(Schema.String)
	}),
	Schema.Struct({
		kind: Schema.Literal('ARREARS'),
		/** The past pay periods this entry settles, as `YYYY-MM`. */
		covers_periods: Schema.Array(Schema.String).check(Schema.isMinLength(1)),
		reason: Schema.NonEmptyString
	}),
	Schema.Struct({
		kind: Schema.Literal('MANUAL_ADJUSTMENT'),
		/**
		 * `CORRECTION` settles under the referenced component's own policy and supersedes the
		 * settled output it names; `REVERSAL` settles in the opposite bucket of that output.
		 */
		operation: Schema.Literals(['CORRECTION', 'REVERSAL']),
		reason: Schema.NonEmptyString
	})
]);

export type ComponentEntryEvent = Schema.Schema.Type<typeof componentEntryEventValueSchema>;

/** Strict standard view: a key no arm declares is refused rather than stripped. */
export const componentEntryEventSchema = Schema.toStandardSchemaV1(componentEntryEventValueSchema, {
	parseOptions: { onExcessProperty: 'error' }
});

export default defineCustomType({
	name: 'component_entry_event',
	description:
		'Why a component entry exists — a claim with its incurred date, a standing allowance, a bonus, an arrears settlement naming the periods it covers, or a manual correction pointing at the settled output it fixes.',
	schema: componentEntryEventSchema
});
