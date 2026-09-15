import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';
import { compileExpression } from '../../lib/expressions/compile.js';

/**
 * When a catalogue row whose `source` is SCHEDULE falls due.
 *
 * One occurrence per calendar hit per employment: a 13th month every 24 December, a THR on the
 * version's own date, a company AWS every December. The run whose salary window holds the day
 * materialises the occurrence as a request row nobody keyed, and the band's `amount` prices it
 * over the entry context, year axis included. `when` narrows who is owed it on that day; empty is
 * everyone. `from_service_months` is the qualifying service on the day. `on_separation` owes the
 * year's occurrence, on the exit date, to a leaver whose final period closes before the day.
 * `every: SEPARATION` has no calendar: the occurrence is the exit date itself, once per stint —
 * termination pay, retirement pay, notice in lieu, leave commutation.
 */
export const catalogueScheduleValueSchema = Schema.Struct({
	every: Schema.Literals(['YEAR', 'MONTH', 'SEPARATION']),
	/** 1–12; read on a yearly schedule only. */
	month: Schema.NullOr(
		Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 12 }))
	),
	/** 1–31, clamped to the month's length. */
	day: Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 31 })),
	when: Schema.String,
	from_service_months: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
	on_separation: Schema.Boolean
}).check(
	Schema.makeFilter((schedule) => {
		if (schedule.every === 'YEAR' && schedule.month == null)
			return 'A yearly schedule names its month.';
		const fault = compileExpression({ expression: schedule.when, site: 'person', type: 'boolean' });
		return fault == null || `Schedule coverage: ${fault}`;
	})
);

export type CatalogueSchedule = Schema.Schema.Type<typeof catalogueScheduleValueSchema>;

export const DEFAULT_SCHEDULE: CatalogueSchedule = {
	every: 'YEAR',
	month: 12,
	day: 24,
	when: '',
	from_service_months: 0,
	on_separation: false
};

export default defineCustomType({
	name: 'catalogue_schedule',
	description:
		'When a scheduled catalogue row falls due: yearly on a month and day, monthly on a day, or on separation; who is owed it on that day, the qualifying service, and whether a leaver is owed a yearly occurrence early.',
	schema: Schema.toStandardSchemaV1(catalogueScheduleValueSchema, {
		parseOptions: { onExcessProperty: 'error' }
	})
});
