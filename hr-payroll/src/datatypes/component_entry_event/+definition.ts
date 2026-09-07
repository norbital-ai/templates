import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';
import { calendarDay } from '../../lib/iso-day.js';

/**
 * Why a component entry exists, and the arm-specific scalar payload it carries.
 *
 * The five arms are deliberately five business facts, not one polymorphic "money" concept: a claim,
 * a standing allowance, a bonus, an arrears settlement and a manual correction have different
 * authors, different rules and different payslip semantics, and only their common shape — an
 * employment, a component, a positive magnitude and a date — is shared. That common shape lives
 * in real columns on `component_entries`; this union owns only what one arm can say and the others
 * cannot.
 *
 * An allowance's window, by contrast, lives IN the union (`recurrence`), because it is arm payload
 * and nothing else may carry it — as a column beside the event it was a nullable field three arms
 * had to be refused for setting.
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
		kind: Schema.Literal('ALLOWANCE'),
		/**
		 * Whether this allowance is paid once or across a window, and when.
		 *
		 * This used to be an empty arm plus a nullable `effective_range` column that only this arm
		 * was permitted to set — which made two illegal states representable and cost a refusal each
		 * to forbid: a range on a bonus, and an allowance with no range. Both are now unsayable.
		 *
		 * A one-off is a *stated* one-off, not a range that happens to span a single month. That
		 * distinction was previously invisible: `depletes()` reads false for every allowance, so a
		 * one-off written as a one-month range is only one-off by arithmetic accident, and widening
		 * that range later silently turns one payment into many.
		 */
		recurrence: Schema.Union([
			Schema.Struct({
				kind: Schema.Literal('ONE_OFF'),
				/** The single period it is paid in, as `YYYY-MM`. */
				period: Schema.String.check(Schema.isPattern(/^\d{4}-(?:0[1-9]|1[0-2])$/))
			}),
			Schema.Struct({
				kind: Schema.Literal('RECURRING'),
				/** Paid whole in every period this window covers. `to` null is open-ended. */
				from: calendarDay,
				to: Schema.NullOr(calendarDay)
			})
		])
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
