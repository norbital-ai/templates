import { defineCustomType } from '@norbital-ai/pod/authoring';
import { z } from 'zod/mini';

const patternDaySchema = z.strictObject({ roster_code_id: z.uuid() });

const phaseDurationSchema = z.discriminatedUnion('kind', [
	z.strictObject({ kind: z.literal('CONTINUOUS') }),
	z.strictObject({
		kind: z.literal('CALENDAR_MONTHS'),
		months: z.number().check(z.int(), z.positive())
	})
]);

const phaseSchema = z.strictObject({
	duration: phaseDurationSchema,
	day_cycle: z.array(patternDaySchema).check(z.minLength(1))
});

const periodSchema = z.enum(['WEEK', 'MONTH']);

const rosterExpectationSchema = z.discriminatedUnion('kind', [
	z.strictObject({
		kind: z.literal('GUARANTEED_SCHEDULE'),
		period: periodSchema,
		required_work_days: z.number().check(z.positive()),
		required_paid_minutes: z.number().check(z.int(), z.positive())
	}),
	z.strictObject({
		kind: z.literal('AS_ASSIGNED'),
		period: periodSchema,
		maximum_paid_minutes: z.nullable(z.number().check(z.int(), z.positive()))
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
export const workPatternSchema = z.discriminatedUnion('type', [
	z.strictObject({
		type: z.literal('PATTERNED'),
		anchor_date: z.iso.date(),
		phases: z.array(phaseSchema).check(z.minLength(1))
	}),
	z.strictObject({
		type: z.literal('ROSTERED'),
		expectation: rosterExpectationSchema
	})
]);

export type WorkPattern = z.infer<typeof workPatternSchema>;

export default defineCustomType({
	name: 'work_pattern',
	description:
		'The employment schedule term: either generated from one or more repeating phases, or assigned roster by roster under a guaranteed or as-assigned expectation.',
	schema: workPatternSchema
});
