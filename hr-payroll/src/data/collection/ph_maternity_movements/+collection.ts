import { collection } from '@norbital-ai/bolt';
import { dateKey, isCalendarDate } from '../../../lib/iso-day.js';
import { decodeNumber } from '../../../lib/wire.js';
import { snapshotSssContributionMonths } from '../../../lib/ph/maternity-benefit.js';

const maternityMovements = collection('ph_maternity_movements', {
	read: { fields: 'all' },
	create: {
		input: {
			columns: [
				'ph_maternity_case_id',
				'kind',
				'paid_on',
				'amount',
				'payment_reference',
				'evidence_file'
			]
		}
	},
	update: {
		input: { columns: ['paid_on', 'amount', 'payment_reference', 'evidence_file'] }
	}
});
export default maternityMovements;

/** Kinds separate money paid to the employee from SSS money received by the employer. */
maternityMovements.transform(async (inputs, { existing, db, refuse }) => {
	const rows = inputs.map((input, index) => ({ ...existing[index], ...input }));
	const editedIds = existing.flatMap((row) => (row == null ? [] : [row.id]));
	if (editedIds.length > 0) {
		const credits = await db.read('payment_events', {
			where: {
				external_source_kind: { eq: 'PH_MATERNITY_MOVEMENT' },
				external_source_id: { in: editedIds }
			},
			all: true
		});
		if (credits.rows.length > 0)
			refuse('A PH maternity cash movement credited by an immutable payment event cannot change.');
	}
	const caseIds = [
		...new Set(rows.map((row) => row.ph_maternity_case_id).filter((id) => id != null))
	];
	const cases = caseIds.length
		? (
				await db.read('ph_maternity_cases', {
					where: { id: { in: caseIds } },
					all: true
				})
			).rows
		: [];
	const caseById = new Map(cases.map((row) => [row.id, row]));
	const plans = caseIds.length
		? (
				await db.read('ph_maternity_pay_plans', {
					where: { ph_maternity_case_id: { in: caseIds } },
					all: true
				})
			).rows
		: [];
	const months = cases.length
		? (
				await db.read('sss_contribution_months', {
					where: { employee_id: { in: [...new Set(cases.map((row) => row.employee_id))] } },
					all: true
				})
			).rows
		: [];
	const activePlanByCase = new Map<string, (typeof plans)[number]>();
	for (const plan of plans) {
		const prior = activePlanByCase.get(plan.ph_maternity_case_id);
		if (prior == null || (plan.plan_number ?? 0) > (prior.plan_number ?? 0))
			activePlanByCase.set(plan.ph_maternity_case_id, plan);
	}
	for (const [index, row] of rows.entries()) {
		if (!caseById.has(row.ph_maternity_case_id!))
			refuse('A maternity payment needs an existing PH maternity case.', {
				field: 'ph_maternity_case_id'
			});
		if (!isCalendarDate(dateKey(row.paid_on)))
			refuse('A maternity payment needs its actual payment date.', { field: 'paid_on' });
		const amount = row.amount == null ? NaN : decodeNumber(row.amount);
		if (
			!Number.isFinite(amount) ||
			amount <= 0 ||
			Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-7
		)
			refuse('A maternity payment needs a positive peso amount to centavo precision.', {
				field: 'amount'
			});
		if (!(row.payment_reference ?? '').trim())
			refuse('A maternity payment needs a bank or SSS receipt reference.', {
				field: 'payment_reference'
			});
		if (row.kind !== 'SSS_REIMBURSEMENT' && row.evidence_file == null && existing[index] == null)
			refuse(
				'An employee maternity cash payment needs its bank credit or signed cash voucher file.',
				{
					field: 'evidence_file'
				}
			);
		if (existing[index] == null && row.kind !== 'SSS_REIMBURSEMENT') {
			const activePlan = activePlanByCase.get(row.ph_maternity_case_id!);
			const maternityCase = caseById.get(row.ph_maternity_case_id!);
			if (activePlan != null) {
				if (
					maternityCase == null ||
					activePlan.candidate_qualifying_from == null ||
					activePlan.candidate_qualifying_through == null ||
					activePlan.sss_history_snapshot == null ||
					snapshotSssContributionMonths(
						months.filter((month) => month.employee_id === maternityCase.employee_id),
						activePlan.candidate_qualifying_from,
						activePlan.candidate_qualifying_through
					) !== activePlan.sss_history_snapshot
				)
					refuse(
						'The active PH maternity advance plan has stale SSS source months; create a corrected revision before cash.'
					);
			}
		}
	}
	return inputs.map((input, index) => {
		if (existing[index] != null || rows[index]?.kind === 'SSS_REIMBURSEMENT') return input;
		const maternityCase = caseById.get(rows[index]!.ph_maternity_case_id!);
		const activePlan = activePlanByCase.get(rows[index]!.ph_maternity_case_id!);
		return {
			...input,
			...(activePlan == null ? {} : { ph_maternity_pay_plan_id: activePlan.id }),
			...(maternityCase?.leave_from == null || maternityCase.leave_through == null
				? {}
				: {
						planned_leave_span_at_payment: {
							from: dateKey(maternityCase.leave_from) as `${number}-${number}-${number}`,
							to: dateKey(maternityCase.leave_through) as `${number}-${number}-${number}`
						}
					})
		};
	});
});
