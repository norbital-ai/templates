import { collection } from '@norbital-ai/bolt';
import { dateKey, isCalendarDate } from '../../../lib/iso-day.js';
import {
	calculateBenefitCandidate,
	positiveCents,
	readCaseEvidence,
	readCaseLineages,
	snapshotContributionMonths,
	evidenceOf
} from '../../../lib/benefit-cases/benefit.js';
import { addDays } from '../../../lib/payroll/run/dates.js';
import { refuse } from '../../../lib/refuse.js';
import { decodeNumber } from '../../../lib/wire.js';

const c = collection('benefit_case_plans', {
	read: { fields: 'all' },
	create: {
		input: {
			columns: [
				'benefit_case_id',
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
				'Compare a frozen pre-event award candidate with actual employee advance timing and any later actual award; this never declares reimbursement or payroll settlement.',
			input: { plan_id: { kind: 'id', of: 'benefit_case_plans' }, as_of: { kind: 'date' } },
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
	const caseIds = [...new Set(inputs.map((row) => row.benefit_case_id).filter((id) => id != null))];
	if (caseIds.length !== inputs.length)
		refuse('Create at most one benefit pay-plan revision per case in one write.');
	const cases = caseIds.length
		? (await db.read('benefit_cases', { where: { id: { in: caseIds } }, all: true })).rows
		: [];
	const caseById = new Map(cases.map((row) => [row.id, row]));
	const priorPlans = caseIds.length
		? (
				await db.read('benefit_case_plans', {
					where: { benefit_case_id: { in: caseIds } },
					all: true
				})
			).rows
		: [];
	const cash = caseIds.length
		? (
				await db.read('benefit_case_movements', {
					where: { benefit_case_id: { in: caseIds }, direction: { eq: 'EMPLOYEE_PAYMENT' } },
					all: true
				})
			).rows
		: [];
	const employeeIds = [...new Set(cases.map((row) => row.employee_id))];
	const [months, lineages, evidence] = await Promise.all([
		employeeIds.length
			? db
					.read('contribution_statement_months', {
						where: { employee_id: { in: employeeIds } },
						all: true
					})
					.then((page) => page.rows)
			: [],
		readCaseLineages(
			db,
			cases.map((row) => row.employment_id)
		),
		readCaseEvidence(db, caseIds)
	]);
	return inputs.map((input) => {
		const caseRow = caseById.get(input.benefit_case_id!);
		if (caseRow == null) refuse('A benefit pay plan needs an existing case.');
		const type = lineages.typeOf(caseRow);
		if (cash.some((row) => row.benefit_case_id === caseRow.id))
			refuse(
				'A benefit pay plan cannot be created or superseded after employee cash; reconcile the frozen payment first.'
			);
		const prior = priorPlans
			.filter((row) => row.benefit_case_id === caseRow.id)
			.toSorted((left, right) => (right.plan_number ?? 0) - (left.plan_number ?? 0))[0];
		if (input.basis_method !== 'DOCUMENTED_MONTHLY_EQUIVALENT')
			refuse('The documented monthly-equivalent wage basis is required.');
		if (
			Number.isNaN(positiveCents(input.monthly_full_pay_basis)) ||
			input.qualifying_allowances_assessed !== true ||
			!(input.basis_reference ?? '').trim() ||
			input.basis_file == null
		)
			refuse('Monthly full pay needs a referenced document and assessed qualifying allowances.');
		const application = dateKey(caseRow.application_on);
		if (!isCalendarDate(application)) refuse('A benefit advance needs the dated application.');
		const actual = caseRow.event_kind != null && isCalendarDate(dateKey(caseRow.event_on));
		const basisDay = actual ? dateKey(caseRow.event_on) : dateKey(caseRow.expected_event_on);
		if (!isCalendarDate(basisDay)) refuse('A pre-event candidate needs an expected event date.');
		// A claim is proven for an actual event only; before it, the candidate seals none.
		const claimed = (type.qualifications ?? []).find((q) => caseRow.facts?.[q.claim] === true);
		if (!actual && claimed != null) refuse(claimed.message);
		const history = months.filter(
			(row) => row.employee_id === caseRow.employee_id && row.scheme_code === type.credit_scheme
		);
		const candidate = calculateBenefitCandidate({
			case_type: type,
			benefit_case: actual
				? caseRow
				: {
						event_kind: type.event_kinds[0]!,
						event_on: basisDay,
						facts: {
							...Object.fromEntries((type.qualifications ?? []).map((q) => [q.claim, false])),
							...caseRow.facts
						}
					},
			evidence: evidenceOf(evidence, caseRow.id),
			months: history
		});
		if (candidate.qualifying_window.through >= dateKey(today).slice(0, 7))
			refuse(
				'The candidate qualifying window has not fully elapsed when this advance plan is made.'
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
			refuse('An advance plan cannot count a contribution paid after the plan date.');
		if (!candidate.contribution_qualified || candidate.candidate_benefit <= 0)
			refuse('The documented contribution months do not establish a positive advance candidate.');
		return {
			...input,
			plan_number: (prior?.plan_number ?? 0) + 1,
			...(prior == null ? {} : { supersedes_plan_id: prior.id }),
			plan_created_on: on(dateKey(today)),
			application_on_at_plan: on(application),
			advance_due_on: on(addDays(application, type.advance_due_days)),
			event_basis_kind: actual ? ('ACTUAL_EVENT' as const) : ('EXPECTED_EVENT' as const),
			event_basis_on: on(basisDay),
			candidate_amount: candidate.candidate_benefit,
			candidate_compensable_days: candidate.compensable_days,
			candidate_window_from: candidate.qualifying_window.from,
			candidate_window_through: candidate.qualifying_window.through,
			history_snapshot: snapshotContributionMonths(
				history,
				candidate.qualifying_window.from,
				candidate.qualifying_window.through
			)
		};
	});
});

c.query('advance_status', async (input, ctx) => {
	const asOf = dateKey(input.as_of);
	if (!isCalendarDate(asOf)) refuse('The advance status needs a real as-of date.');
	const plans = await ctx.read('benefit_case_plans', {
		where: { id: { eq: input.plan_id } },
		all: true
	});
	const plan = plans.rows[0];
	if (plan == null || plan.candidate_amount == null || plan.advance_due_on == null)
		refuse('The frozen advance plan is unavailable or incomplete.');
	if (!isCalendarDate(dateKey(plan.plan_created_on)) || asOf < dateKey(plan.plan_created_on))
		refuse('The advance assessment cannot precede its frozen plan.');
	const versions = await ctx.read('benefit_case_plans', {
		where: { benefit_case_id: { eq: plan.benefit_case_id } },
		all: true
	});
	if (versions.rows.some((row) => (row.plan_number ?? 0) > (plan.plan_number ?? 0)))
		refuse('This advance plan was superseded before cash and cannot establish payment status.');
	const cases = await ctx.read('benefit_cases', {
		where: { id: { eq: plan.benefit_case_id } },
		all: true
	});
	const caseRow = cases.rows[0];
	if (caseRow == null || dateKey(caseRow.application_on) !== dateKey(plan.application_on_at_plan))
		refuse('The application changed after its advance plan; reconcile it before payment.');
	if (
		plan.event_basis_kind === 'EXPECTED_EVENT' &&
		caseRow.event_on == null &&
		dateKey(caseRow.expected_event_on) !== dateKey(plan.event_basis_on)
	)
		refuse(
			'The expected event changed after its candidate plan; create a corrected revision before payment.'
		);
	const [currentMonths, lineages] = await Promise.all([
		ctx.read('contribution_statement_months', {
			where: { employee_id: { eq: caseRow.employee_id } },
			all: true
		}),
		readCaseLineages(ctx, [caseRow.employment_id])
	]);
	const type = lineages.typeOf(caseRow);
	if (
		plan.candidate_window_from == null ||
		plan.candidate_window_through == null ||
		plan.history_snapshot == null ||
		snapshotContributionMonths(
			currentMonths.rows.filter((row) => row.scheme_code === type.credit_scheme),
			plan.candidate_window_from,
			plan.candidate_window_through
		) !== plan.history_snapshot
	)
		refuse(
			'The advance candidate has stale contribution-statement months; create a corrected plan revision.'
		);
	// A file is a heavy field: the status needs the proof file named, so it is selected.
	const movements = await ctx.read('benefit_case_movements', {
		where: { benefit_case_id: { eq: caseRow.id }, direction: { eq: 'EMPLOYEE_PAYMENT' } },
		select: {
			kind: true,
			paid_on: true,
			amount: true,
			evidence_file: true,
			benefit_case_plan_id: true
		},
		all: true
	});
	const advances = movements.rows.filter(
		(row) =>
			type.movement_kinds.find((kind) => kind.code === row.kind)?.component ===
			type.components.award
	);
	const amount = (through: string, provedOnly: boolean) =>
		Math.round(
			advances
				.filter(
					(row) =>
						dateKey(row.paid_on) <= through &&
						dateKey(row.paid_on) <= asOf &&
						(!provedOnly || (row.evidence_file != null && row.benefit_case_plan_id === plan.id))
				)
				.reduce((sum, row) => sum + decodeNumber(row.amount), 0) * 100
		) / 100;
	const candidate = decodeNumber(plan.candidate_amount);
	const paidByDue = amount(dateKey(plan.advance_due_on), true);
	const totalPaid = amount(asOf, true);
	const unprovedOrUnlinked = amount(asOf, false) - totalPaid;
	const actualAward = caseRow.award_amount == null ? null : decodeNumber(caseRow.award_amount);
	return {
		status:
			paidByDue >= candidate
				? 'CANDIDATE_ADVANCE_RECORDED_WITH_DOCUMENT_BY_DUE_DATE'
				: asOf > dateKey(plan.advance_due_on)
					? 'OVERDUE_OR_SHORT_CANDIDATE_ADVANCE'
					: 'CANDIDATE_ADVANCE_PENDING',
		advance_due_on: dateKey(plan.advance_due_on),
		candidate_amount: candidate,
		paid_by_due: paidByDue,
		paid_total: totalPaid,
		unproved_or_unlinked_recorded_cash: unprovedOrUnlinked,
		actual_award: actualAward,
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
		event_basis_kind: plan.event_basis_kind,
		event_basis_on: dateKey(plan.event_basis_on),
		status_is_payment_authorisation: false
	};
});
