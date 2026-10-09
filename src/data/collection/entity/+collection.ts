import { collection, type TransformCtx } from '@norbital-ai/bolt';
import { beforeOf } from '../../../lib/payroll_engine/foundation.js';
import { payScheduleRefusal, SALARY_RUNS } from '../../../lib/payroll_engine/services.js';

const create_columns = [
	'settings_code',
	'name',
	'registration_number',
	'pay_cutoff_day',
	'late_arrival_grace_minutes',
	'pay_frequency',
	'pay_frequency_changes',
	'risk_class',
	'region',
	'facts',
	'time_zone',
	'disbursement_account',
	'effective_range'
] as const;
const update_columns = [
	'settings_code',
	'name',
	'registration_number',
	'pay_cutoff_day',
	'late_arrival_grace_minutes',
	'pay_frequency',
	'pay_frequency_changes',
	'risk_class',
	'region',
	'facts',
	'time_zone',
	'disbursement_account',
	'effective_range'
] as const;

const c = collection('entity', {
	read: { fields: 'all' },
	create: { input: { columns: create_columns } },
	update: { input: { columns: update_columns } }
});
export default c;

/**
 * An update records what it changed (never the disbursement account), so a duty can answer a re-registration. A pay
 * schedule change is history: refused when it would rewrite a period a salary run paid (`payScheduleRefusal`), the
 * entities' runs read once, only when a write touches the schedule.
 */
const SCHEDULE = ['pay_frequency', 'pay_frequency_changes'];
/** Whether a write changes the pay schedule. */
const reschedules = (existing: object | undefined, input: object) =>
	Object.keys(beforeOf(existing, input)).some((field) => SCHEDULE.includes(field));

c.transform(async (inputs, ctx: TransformCtx<'entity'>) => {
	const touched = inputs.flatMap((input, i) => {
		const existing = ctx.existing[i];
		if (existing === undefined || '$delete' in input) return [];
		return reschedules(existing, input) ? [existing.id] : [];
	});
	const runs =
		touched.length === 0
			? []
			: (
					await ctx.db.read('payroll_run', {
						where: { company_id: { in: touched }, kind: { in: [...SALARY_RUNS] } },
						select: { company_id: true, salary_to: true },
						all: true
					})
				).rows;
	return inputs.map((input, i) => {
		const existing = ctx.existing[i];
		if (existing === undefined || '$delete' in input) return input;
		if (reschedules(existing, input)) {
			const lastPaid =
				runs
					.filter((run) => run.company_id === existing.id && run.salary_to != null)
					.map((run) => String(run.salary_to).slice(0, 10))
					.toSorted()
					.at(-1) ?? null;
			const refusal = payScheduleRefusal(
				existing,
				{ ...existing, ...input } as typeof existing,
				lastPaid
			);
			if (refusal !== undefined) ctx.refuse(refusal);
		}
		const { disbursement_account: _account, ...before } = beforeOf(existing, input);
		return { ...input, before };
	});
});
