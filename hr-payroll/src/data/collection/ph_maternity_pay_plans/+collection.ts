import { collection } from '@norbital-ai/bolt';
import { dateKey, isCalendarDate } from '../../../lib/iso-day.js';
import {
	calculateSssMaternityBenefit,
	snapshotSssContributionMonths
} from '../../../lib/ph/maternity-benefit.js';
import { hasPhSoloParentDocument } from '../../../lib/ph/maternity-reconciliation.js';
import { addDays } from '../../../lib/payroll/run/dates.js';
import { refuse } from '../../../lib/refuse.js';
import { decodeNumber } from '../../../lib/wire.js';

const c = collection('ph_maternity_pay_plans', {
	read: { fields: 'all' },
	create: {
		input: {
			columns: [
				'ph_maternity_case_id',
				'basis_method',
				'monthly_full_pay_basis',
				'qualifying_allowances_assessed',
				'basis_reference',
				'basis_file'
			]
		}
	},
	queries: {
		advance_status: {
			description:
				'Compare a frozen prebirth SSS candidate with actual employee advance timing and any later actual SSS award; this never declares reimbursement or payroll settlement.',
			input: { plan_id: { kind: 'id', of: 'ph_maternity_pay_plans' }, as_of: { kind: 'date' } },
			output: { kind: 'json' }
		}
	}
});
export default c;

/** A `YYYY-MM-DD` key as a date column reads it. */
const on = (date: string) => date as `${number}-${number}-${number}`;

/** Creating a plan freezes the paid-month evidence; no collection update path rewrites it. */
c.transform(async (inputs, ctx) => {
	const { db, today } = ctx;
	// An explicitly typed alias, so a refusal narrows what follows it (TS control flow).
	const refuse: (message: string, at?: { field?: string }) => never = (message, at) =>
		ctx.refuse(message, at as never);
	const caseIds = [
		...new Set(inputs.map((row) => row.ph_maternity_case_id).filter((id) => id != null))
	];
	if (caseIds.length !== inputs.length)
		refuse('Create at most one PH maternity pay-plan revision per case in one write.');
	const cases = caseIds.length
		? (await db.read('ph_maternity_cases', { where: { id: { in: caseIds } }, all: true })).rows
		: [];
	const caseById = new Map(cases.map((row) => [row.id, row]));
	const priorPlans = caseIds.length
		? (
				await db.read('ph_maternity_pay_plans', {
					where: { ph_maternity_case_id: { in: caseIds } },
					all: true
				})
			).rows
		: [];
	const cash = caseIds.length
		? (
				await db.read('ph_maternity_movements', {
					where: {
						ph_maternity_case_id: { in: caseIds },
						kind: { in: ['SSS_ADVANCE', 'SALARY_DIFFERENTIAL'] }
					},
					all: true
				})
			).rows
		: [];
	const employeeIds = [...new Set(cases.map((row) => row.employee_id))];
	const months = employeeIds.length
		? (
				await db.read('sss_contribution_months', {
					where: { employee_id: { in: employeeIds } },
					all: true
				})
			).rows
		: [];
	return inputs.map((input) => {
		const caseRow = caseById.get(input.ph_maternity_case_id!);
		if (caseRow == null) refuse('A PH maternity pay plan needs an existing case.');
		if (cash.some((row) => row.ph_maternity_case_id === caseRow.id))
			refuse(
				'A PH maternity pay plan cannot be created or superseded after employee cash; reconcile the frozen payment first.'
			);
		const prior = priorPlans
			.filter((row) => row.ph_maternity_case_id === caseRow.id)
			.toSorted((left, right) => (right.plan_number ?? 0) - (left.plan_number ?? 0))[0];
		if (input.basis_method !== 'DOCUMENTED_MONTHLY_EQUIVALENT')
			refuse('The documented monthly-equivalent wage basis is required.');
		const monthly = decodeNumber(input.monthly_full_pay_basis);
		if (
			!Number.isFinite(monthly) ||
			monthly <= 0 ||
			Math.abs(monthly * 100 - Math.round(monthly * 100)) > 1e-7 ||
			input.qualifying_allowances_assessed !== true ||
			!(input.basis_reference ?? '').trim() ||
			input.basis_file == null
		)
			refuse(
				'PH maternity monthly full pay needs a referenced document and assessed qualifying allowances.'
			);
		const application = dateKey(caseRow.application_on);
		if (!isCalendarDate(application))
			refuse('A maternity advance needs the dated leave application.');
		const actual = caseRow.event_kind != null && isCalendarDate(dateKey(caseRow.event_on));
		const basisDay = actual ? dateKey(caseRow.event_on) : dateKey(caseRow.expected_delivery_on);
		if (!isCalendarDate(basisDay))
			refuse('A prebirth SSS candidate needs an expected delivery date.');
		if (!actual && caseRow.solo_parent_claimed === true)
			refuse(
				'A prebirth solo-parent extension needs an event-valid LGU document before its candidate can be sealed.'
			);
		if (actual && caseRow.solo_parent_claimed === true && !hasPhSoloParentDocument(caseRow))
			refuse('A solo-parent SSS candidate needs event-valid LGU document evidence.');
		const history = months.filter((row) => row.employee_id === caseRow.employee_id);
		const candidate = calculateSssMaternityBenefit({
			contingency_date: basisDay,
			contingency: actual ? caseRow.event_kind! : 'BIRTH',
			solo_parent: actual && caseRow.solo_parent_claimed === true,
			months: history
		});
		if (candidate.qualifying_window.through >= dateKey(today).slice(0, 7))
			refuse(
				'The SSS candidate qualifying window has not fully elapsed when this advance plan is made.'
			);
		if (
			history.some(
				(row) =>
					row.coverage_month >= candidate.qualifying_window.from &&
					row.coverage_month <= candidate.qualifying_window.through &&
					row.paid_on != null &&
					dateKey(row.paid_on) > dateKey(today)
			)
		)
			refuse('An SSS advance plan cannot count a contribution paid after the plan date.');
		if (!candidate.contribution_qualified || candidate.candidate_benefit <= 0)
			refuse('The documented SSS months do not establish a positive maternity advance candidate.');
		const snapshot = snapshotSssContributionMonths(
			history,
			candidate.qualifying_window.from,
			candidate.qualifying_window.through
		);
		return {
			...input,
			plan_number: (prior?.plan_number ?? 0) + 1,
			...(prior == null ? {} : { supersedes_plan_id: prior.id }),
			plan_created_on: on(dateKey(today)),
			application_on_at_plan: on(application),
			advance_due_on: on(addDays(application, 30)),
			contingency_basis_kind: actual ? ('ACTUAL_EVENT' as const) : ('EXPECTED_BIRTH' as const),
			contingency_basis_on: on(basisDay),
			candidate_sss_amount: candidate.candidate_benefit,
			candidate_compensable_days: candidate.compensable_days,
			candidate_qualifying_from: candidate.qualifying_window.from,
			candidate_qualifying_through: candidate.qualifying_window.through,
			sss_history_snapshot: snapshot
		};
	});
});

c.query('advance_status', async (input, ctx) => {
	const asOf = dateKey(input.as_of);
	if (!isCalendarDate(asOf)) refuse('The maternity advance status needs a real as-of date.');
	const plans = await ctx.read('ph_maternity_pay_plans', {
		where: { id: { eq: input.plan_id } },
		all: true
	});
	const plan = plans.rows[0];
	if (plan == null || plan.candidate_sss_amount == null || plan.advance_due_on == null)
		refuse('The frozen PH maternity advance plan is unavailable or incomplete.');
	if (!isCalendarDate(dateKey(plan.plan_created_on)) || asOf < dateKey(plan.plan_created_on))
		refuse('The maternity advance assessment cannot precede its frozen plan.');
	const versions = await ctx.read('ph_maternity_pay_plans', {
		where: { ph_maternity_case_id: { eq: plan.ph_maternity_case_id } },
		all: true
	});
	if (versions.rows.some((row) => (row.plan_number ?? 0) > (plan.plan_number ?? 0)))
		refuse(
			'This PH maternity advance plan was superseded before cash and cannot establish payment status.'
		);
	const cases = await ctx.read('ph_maternity_cases', {
		where: { id: { eq: plan.ph_maternity_case_id } },
		all: true
	});
	const caseRow = cases.rows[0];
	if (caseRow == null || dateKey(caseRow.application_on) !== dateKey(plan.application_on_at_plan))
		refuse(
			'The maternity application changed after its advance plan; reconcile it before payment.'
		);
	if (
		plan.contingency_basis_kind === 'EXPECTED_BIRTH' &&
		caseRow.event_on == null &&
		dateKey(caseRow.expected_delivery_on) !== dateKey(plan.contingency_basis_on)
	)
		refuse(
			'The expected delivery changed after its SSS candidate plan; create a corrected revision before payment.'
		);
	const currentMonths = await ctx.read('sss_contribution_months', {
		where: { employee_id: { eq: caseRow.employee_id } },
		all: true
	});
	if (
		plan.candidate_qualifying_from == null ||
		plan.candidate_qualifying_through == null ||
		plan.sss_history_snapshot == null ||
		snapshotSssContributionMonths(
			currentMonths.rows,
			plan.candidate_qualifying_from,
			plan.candidate_qualifying_through
		) !== plan.sss_history_snapshot
	)
		refuse(
			'The PH maternity advance candidate has stale SSS source months; create a corrected plan revision.'
		);
	// A file is a heavy field: the status needs the proof file named, so it is selected.
	const movements = await ctx.read('ph_maternity_movements', {
		where: { ph_maternity_case_id: { eq: caseRow.id }, kind: { eq: 'SSS_ADVANCE' } },
		select: { paid_on: true, amount: true, evidence_file: true, ph_maternity_pay_plan_id: true },
		all: true
	});
	const amount = (through: string, provedOnly: boolean) =>
		Math.round(
			movements.rows
				.filter(
					(row) =>
						dateKey(row.paid_on) <= through &&
						dateKey(row.paid_on) <= asOf &&
						(!provedOnly || (row.evidence_file != null && row.ph_maternity_pay_plan_id === plan.id))
				)
				.reduce((sum, row) => sum + decodeNumber(row.amount), 0) * 100
		) / 100;
	const candidate = decodeNumber(plan.candidate_sss_amount);
	const paidByDue = amount(dateKey(plan.advance_due_on), true);
	const totalPaid = amount(asOf, true);
	const unprovedOrUnlinked = amount(asOf, false) - totalPaid;
	const actualAward =
		caseRow.sss_award_amount == null ? null : decodeNumber(caseRow.sss_award_amount);
	return {
		status:
			paidByDue >= candidate
				? 'CANDIDATE_ADVANCE_RECORDED_WITH_DOCUMENT_BY_DUE_DATE'
				: asOf > dateKey(plan.advance_due_on)
					? 'OVERDUE_OR_SHORT_CANDIDATE_ADVANCE'
					: 'CANDIDATE_ADVANCE_PENDING',
		advance_due_on: dateKey(plan.advance_due_on),
		candidate_sss_amount: candidate,
		paid_by_due: paidByDue,
		paid_total: totalPaid,
		unproved_or_unlinked_recorded_cash: unprovedOrUnlinked,
		actual_sss_award: actualAward,
		actual_award_minus_advance:
			actualAward == null ? null : Math.round((actualAward - totalPaid) * 100) / 100,
		actual_award_status:
			actualAward == null
				? 'AWARD_NOT_RECORDED'
				: actualAward > totalPaid
					? 'ADDITIONAL_ADVANCE_AND_DIFFERENTIAL_RECALCULATION_REQUIRED'
					: actualAward < totalPaid
						? 'EXCESS_ADVANCE_REVIEW_AND_DIFFERENTIAL_RECALCULATION_REQUIRED'
						: 'AWARD_MATCHES_ADVANCE_DIFFERENTIAL_STILL_UNASSESSED',
		contingency_basis_kind: plan.contingency_basis_kind,
		contingency_basis_on: dateKey(plan.contingency_basis_on),
		status_is_payment_authorisation: false
	};
});
