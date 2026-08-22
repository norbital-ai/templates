import { defineModel, reference, text, uuid } from '@norbital-ai/bolt/authoring';

/**
 * The attendance and leave records consumed by a payslip.
 *
 * `source` is required and globally unique, so one concrete input can belong to only one payslip.
 * Deleting a draft run cascades through its payslips to these rows; paid runs cannot be deleted.
 */
export default defineModel(
	{
		payslip_id: uuid().notNull(),
		source: reference({
			TIME_ENTRY: 'time_entries',
			LEAVE_REQUEST: 'leave_requests'
		})
			.notNull()
			.unique(),
		/**
		 * The run's period, copied at the moment the claim is taken.
		 *
		 * Denormalized on purpose. The refusal message has to name the period that owns the record, and
		 * it is composed inside a `before` hook under the editing person's own subject — a supervisor
		 * has no `payroll_runs` read grant, so joining to the run to fetch its period would turn an
		 * explanation into an access denial. The value cannot drift: `payroll_runs/+hooks.ts` lists
		 * `period` among the engine-owned columns and refuses to let anybody edit it.
		 */
		period: text().notNull()
	},
	{
		description:
			'One source record consumed by one payslip. Taken when the run persists, released when the payslip (and so the run) is deleted; a PAID run is never deleted, so its claims are permanent and corrections use adjustment entries.',
		recordLabel: ['period'],
		icon: 'lucide:link',
		indexes: [{ columns: ['payslip_id'] }]
	}
);
