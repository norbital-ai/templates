import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';
import { calendarDay } from '../../lib/iso-day.js';

const patternDayValueSchema = Schema.Struct({
	roster_code_id: Schema.String.check(Schema.isUUID())
});

const phaseDurationValueSchema = Schema.Union([
	Schema.Struct({ kind: Schema.Literal('CONTINUOUS') }),
	Schema.Struct({
		kind: Schema.Literal('CALENDAR_MONTHS'),
		months: Schema.Int.check(Schema.isGreaterThan(0))
	})
]);

const phaseValueSchema = Schema.Struct({
	duration: phaseDurationValueSchema,
	day_cycle: Schema.Array(patternDayValueSchema).check(Schema.isMinLength(1))
});

const periodSchema = Schema.Literals(['WEEK', 'MONTH']);

const rosterExpectationValueSchema = Schema.Union([
	Schema.Struct({
		kind: Schema.Literal('GUARANTEED_SCHEDULE'),
		period: periodSchema,
		required_work_days: Schema.Finite.check(Schema.isGreaterThan(0)),
		required_paid_minutes: Schema.Int.check(Schema.isGreaterThan(0))
	}),
	Schema.Struct({
		kind: Schema.Literal('AS_ASSIGNED'),
		period: periodSchema,
		maximum_paid_minutes: Schema.NullOr(Schema.Int.check(Schema.isGreaterThan(0)))
	})
]);

/**
 * The employment's one canonical schedule term.
 *
 * PATTERNED covers a fixed week, a short crew rotation and long alternating phases with the same
 * shape. One continuous phase repeats its day cycle forever; two or more calendar-month phases
 * repeat as an outer sequence (for example three months of days, then three months of nights).
 *
 * ROSTERED is reserved for assignments that cannot be generated. Its expectation exists only
 * because there is no cycle from which a guaranteed amount or contractual cap could be derived.
 */
export const workPatternValueSchema = Schema.Union([
	Schema.Struct({
		type: Schema.Literal('PATTERNED'),
		anchor_date: calendarDay,
		phases: Schema.Array(phaseValueSchema).check(Schema.isMinLength(1))
	}),
	Schema.Struct({
		type: Schema.Literal('ROSTERED'),
		expectation: rosterExpectationValueSchema
	})
]);

export type WorkPattern = Schema.Schema.Type<typeof workPatternValueSchema>;

/** Strict standard view: a key no arm declares is refused rather than stripped. */
export const workPatternSchema = Schema.toStandardSchemaV1(workPatternValueSchema, {
	parseOptions: { onExcessProperty: 'error' }
});

export default defineCustomType({
	name: 'work_pattern',
	description:
		'The employment schedule term: either generated from one or more repeating phases, or assigned roster by roster under a guaranteed or as-assigned expectation.',
	schema: workPatternSchema
});
