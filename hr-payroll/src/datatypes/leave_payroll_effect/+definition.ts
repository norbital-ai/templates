import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';
import { contributionTreatmentsValueSchema } from '../contribution_treatments/+definition.js';

/** Paid leave supplies absence coverage; unpaid leave declares its own reduction metadata.
 * Unexplained absence is owned by Work and does not require a nominated leave type.
 */
export const leavePayrollEffectValueSchema = Schema.Union([
	Schema.Struct({ kind: Schema.Literal('PAID') }),
	Schema.Struct({
		kind: Schema.Literal('UNPAID'),
		/**
		 * The pay line the lost wage settles on, as this leave declares it.
		 *
		 * No `code` and no direction: the code is the leave's own, and an unpaid day is an ABSENCE
		 * either way. Stating them twice is how two halves of one fact start to disagree.
		 */
		deduction: Schema.Struct({
			/**
			 * How each statutory scheme, by code, charges the lost wage. A scheme the map does not
			 * name is undecided and the run refuses at ACCUMULATE, exactly as it does for any other
			 * pay line.
			 */
			contribution_treatments: contributionTreatmentsValueSchema,
			/** Where the deduction sits in the reduction order, across every catalogue at once. */
			sequence: Schema.Int,
			/** One CEL expression over the person context; `''` is everyone. */
			eligibility: Schema.String
		})
	})
]);

export type LeavePayrollEffect = Schema.Schema.Type<typeof leavePayrollEffectValueSchema>;

/** Strict standard view: a key no arm declares is refused rather than stripped. */
export const leavePayrollEffectSchema = Schema.toStandardSchemaV1(leavePayrollEffectValueSchema, {
	parseOptions: { onExcessProperty: 'error' }
});

export default defineCustomType({
	name: 'leave_payroll_effect',
	description:
		'Whether taking this leave is paid, or unpaid and deducted through a pay line this leave declares for itself — its statutory treatment, its place in the reduction order and who it covers.',
	schema: leavePayrollEffectSchema
});
