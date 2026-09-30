import { collection } from '@norbital-ai/bolt';
import { dateKey, isCalendarDate } from '../../../lib/iso-day.js';
import {
	movementKind,
	positiveCents,
	readCaseLineages,
	snapshotContributionMonths
} from '../../../lib/benefit-cases/benefit.js';

const movements = collection('benefit_case_movements', {
	read: { fields: 'all' },
	create: {
		input: {
			columns: [
				'benefit_case_id',
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
export default movements;

/** A declared kind separates money paid to the employee from the scheme's refund to the employer. */
movements.transform(async (inputs, { existing, db, refuse }) => {
	const rows = inputs.map((input, index) => ({ ...existing[index], ...input }));
	const editedIds = existing.flatMap((row) => (row == null ? [] : [row.id]));
	if (editedIds.length > 0) {
		const credits = await db.read('payment_events', {
			where: {
				external_source_kind: { eq: 'BENEFIT_CASE_MOVEMENT' },
				external_source_id: { in: editedIds }
			},
			all: true
		});
		if (credits.rows.length > 0)
			refuse('A benefit cash movement credited by an immutable payment event cannot change.');
	}
	const caseIds = [...new Set(rows.map((row) => row.benefit_case_id).filter((id) => id != null))];
	const cases = caseIds.length
		? (await db.read('benefit_cases', { where: { id: { in: caseIds } }, all: true })).rows
		: [];
	const caseById = new Map(cases.map((row) => [row.id, row]));
	const plans = caseIds.length
		? (
				await db.read('benefit_case_plans', {
					where: { benefit_case_id: { in: caseIds } },
					all: true
				})
			).rows
		: [];
	const months = cases.length
		? (
				await db.read('contribution_statement_months', {
					where: { employee_id: { in: [...new Set(cases.map((row) => row.employee_id))] } },
					all: true
				})
			).rows
		: [];
	const lineages = await readCaseLineages(
		db,
		cases.map((row) => row.employment_id)
	);
	const activePlanByCase = new Map<string, (typeof plans)[number]>();
	for (const plan of plans) {
		const prior = activePlanByCase.get(plan.benefit_case_id);
		if (prior == null || (plan.plan_number ?? 0) > (prior.plan_number ?? 0))
			activePlanByCase.set(plan.benefit_case_id, plan);
	}
	const declared = rows.map((row) => {
		const caseRow = caseById.get(row.benefit_case_id!);
		if (caseRow == null)
			return refuse('A benefit payment needs an existing benefit case.', {
				field: 'benefit_case_id'
			});
		const type = lineages.typeOf(caseRow);
		return { caseRow, type, kind: movementKind(type, row.kind ?? '') };
	});
	for (const [index, row] of rows.entries()) {
		const { caseRow, type, kind } = declared[index]!;
		if (!isCalendarDate(dateKey(row.paid_on)))
			refuse('A benefit payment needs its actual payment date.', { field: 'paid_on' });
		if (Number.isNaN(positiveCents(row.amount)))
			refuse('A benefit payment needs a positive amount to the cent.', { field: 'amount' });
		if (!(row.payment_reference ?? '').trim())
			refuse('A benefit payment needs a bank or scheme receipt reference.', {
				field: 'payment_reference'
			});
		if (
			kind.direction === 'EMPLOYEE_PAYMENT' &&
			row.evidence_file == null &&
			existing[index] == null
		)
			refuse(
				'An employee benefit cash payment needs its bank credit or signed cash voucher file.',
				{
					field: 'evidence_file'
				}
			);
		if (existing[index] == null && kind.direction === 'EMPLOYEE_PAYMENT') {
			const activePlan = activePlanByCase.get(caseRow.id);
			if (
				activePlan != null &&
				(activePlan.candidate_window_from == null ||
					activePlan.candidate_window_through == null ||
					activePlan.history_snapshot == null ||
					snapshotContributionMonths(
						months.filter(
							(month) =>
								month.employee_id === caseRow.employee_id &&
								month.scheme_code === type.credit_scheme
						),
						activePlan.candidate_window_from,
						activePlan.candidate_window_through
					) !== activePlan.history_snapshot)
			)
				refuse(
					'The active advance plan has stale contribution-statement months; create a corrected revision before cash.'
				);
		}
	}
	return inputs.map((input, index) => {
		const { caseRow, kind } = declared[index]!;
		if (existing[index] != null) return input;
		const direction = { ...input, direction: kind.direction };
		if (kind.direction !== 'EMPLOYEE_PAYMENT') return direction;
		const activePlan = activePlanByCase.get(caseRow.id);
		return {
			...direction,
			...(activePlan == null ? {} : { benefit_case_plan_id: activePlan.id }),
			...(caseRow.leave_from == null || caseRow.leave_through == null
				? {}
				: {
						planned_leave_span_at_payment: {
							from: dateKey(caseRow.leave_from) as `${number}-${number}-${number}`,
							to: dateKey(caseRow.leave_through) as `${number}-${number}-${number}`
						}
					})
		};
	});
});
