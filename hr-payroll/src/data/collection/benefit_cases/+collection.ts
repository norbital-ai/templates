import { collection } from '@norbital-ai/bolt';
import { dateKey, isCalendarDate } from '../../../lib/iso-day.js';
import { governed } from '../../../lib/jurisdiction_settings.js';
import { readRange } from '../../../lib/payroll/run/effective.js';
import {
	assessCase,
	calculateBenefitCandidate,
	caseFactsFault,
	positiveCents,
	previousCases,
	readCaseEarnings,
	windowCredits,
	readCaseEvidence,
	readCaseLineages
} from '../../../lib/benefit-cases/benefit.js';
import { reconcileBenefitCase } from '../../../lib/benefit-cases/reconciliation.js';
import { readAll, type Reads } from '../../../lib/reads.js';
import { refuse } from '../../../lib/refuse.js';
import type { WorkspaceRow } from '../../../lib/rows.js';
import { decodeNumber } from '../../../lib/wire.js';

const columns = [
	'expected_event_on',
	'event_kind',
	'event_on',
	'leave_from',
	'leave_through',
	'facts',
	'notified_on',
	'notification_reference',
	'award_amount',
	'awarded_on',
	'award_reference',
	'award_file'
] as const;

const cases = collection('benefit_cases', {
	read: { fields: 'all' },
	queries: {
		credit_candidate: {
			description:
				'Calculate a nonauthoritative award candidate from saved paid contribution months for this event.',
			input: { case_id: { kind: 'id', of: 'benefit_cases' } },
			output: { kind: 'json' }
		},
		reconcile: {
			description:
				'Compare a benefit case with approved leave, paid payslips and dated cash evidence without booking the employer’s refund as employee pay.',
			input: { case_id: { kind: 'id', of: 'benefit_cases' }, as_of: { kind: 'date' } },
			output: { kind: 'json' }
		},
		assess: {
			description:
				'Price every phase of the case from saved inputs — its days, the scheme award, the pay it replaces, what the employer itself owes and what a third party refunds it — and the employer’s outlay and net cost. Nonauthoritative: the scheme’s recorded award governs cash.',
			input: { case_id: { kind: 'id', of: 'benefit_cases' } },
			output: { kind: 'json' }
		},
		assess_cash_evidence: {
			description:
				'Require an actual award, exact full-span wage evidence and complete approved leave before reviewing recorded benefit cash; this does not allocate or pay it.',
			input: { case_id: { kind: 'id', of: 'benefit_cases' }, as_of: { kind: 'date' } },
			output: { kind: 'json' }
		}
	},
	create: {
		input: {
			columns: [
				'employee_id',
				'employment_id',
				'case_type',
				'case_reference',
				'application_on',
				...columns
			]
		}
	},
	update: { input: { columns: [...columns] } }
});
export default cases;

/** A case may open before its event; an actual award and every declared fact carry their own checks. */
cases.transform(async (inputs, { existing, db, refuse }) => {
	const rows = inputs.map((input, index) => ({ ...existing[index], ...input }));
	const changedFundedCases = rows.flatMap((row, index) => {
		const prior = existing[index];
		if (prior == null) return [];
		const eventChanged =
			(prior.event_kind != null && row.event_kind !== prior.event_kind) ||
			(prior.event_on != null && dateKey(row.event_on) !== dateKey(prior.event_on));
		const applicationChanged =
			dateKey(row.application_on) !== dateKey(prior.application_on) ||
			row.case_reference !== prior.case_reference;
		const expectedChanged = dateKey(row.expected_event_on) !== dateKey(prior.expected_event_on);
		const spanChanged = (['leave_from', 'leave_through'] as const).some(
			(field) => prior[field] != null && dateKey(row[field]) !== dateKey(prior[field])
		);
		return eventChanged || spanChanged || applicationChanged || expectedChanged
			? [
					{
						id: prior.id,
						eventChanged,
						spanChanged,
						applicationChanged,
						expectedChanged,
						eventRecorded: prior.event_on != null
					}
				]
			: [];
	});
	if (changedFundedCases.length > 0) {
		const funded = await db.read('benefit_case_movements', {
			where: {
				benefit_case_id: { in: changedFundedCases.map((row) => row.id) },
				direction: { eq: 'EMPLOYEE_PAYMENT' }
			},
			all: true
		});
		for (const change of changedFundedCases) {
			const payments = funded.rows.filter((row) => row.benefit_case_id === change.id);
			if (payments.length > 0 && change.applicationChanged)
				refuse('A funded benefit application date or reference cannot change.');
			if (payments.length > 0 && change.expectedChanged)
				refuse('A funded benefit expected event cannot change after its advance.');
			if (
				payments.length > 0 &&
				(change.eventChanged ||
					(change.spanChanged &&
						(change.eventRecorded ||
							payments.some((row) => row.planned_leave_span_at_payment == null))))
			)
				refuse('A funded benefit event or unsnapshotted leave span cannot change.');
		}
	}
	const changedRecordedAwards = rows.flatMap((row, index) => {
		const prior = existing[index];
		if (prior?.award_amount == null) return [];
		return decodeNumber(row.award_amount) !== decodeNumber(prior.award_amount) ||
			dateKey(row.awarded_on) !== dateKey(prior.awarded_on) ||
			row.award_reference !== prior.award_reference ||
			JSON.stringify(row.award_file) !== JSON.stringify(prior.award_file)
			? [prior.id]
			: [];
	});
	if (changedRecordedAwards.length > 0) {
		const cash = await db.read('benefit_case_movements', {
			where: {
				benefit_case_id: { in: changedRecordedAwards },
				direction: { eq: 'EMPLOYEE_PAYMENT' }
			},
			all: true
		});
		if (cash.rows.length > 0)
			refuse(
				'A recorded award cannot be rewritten after employee benefit cash; record an evidenced adjustment instead.'
			);
	}
	const lineages = await readCaseLineages(
		db,
		rows.map((row) => row.employment_id)
	);
	const day = (value: string | null | undefined) => {
		const date = dateKey(value);
		return isCalendarDate(date) ? date : null;
	};
	for (const row of rows) {
		if (lineages.employment(row.employment_id)?.employee_id !== row.employee_id)
			refuse('A benefit case must name this employee’s employment.', { field: 'employment_id' });
		const type = lineages.typeOf(row);
		if (!(row.case_reference ?? '').trim())
			refuse('A benefit case needs a stable application reference.', { field: 'case_reference' });
		if (day(row.application_on) == null)
			refuse('A benefit case needs its application date.', { field: 'application_on' });
		if (row.expected_event_on != null && day(row.expected_event_on) == null)
			refuse('The expected event must be a real calendar date.', { field: 'expected_event_on' });
		if ((row.event_kind == null) !== (row.event_on == null))
			refuse('Record the actual event kind and date together.', { field: 'event_on' });
		if (row.event_on != null && day(row.event_on) == null)
			refuse('The event must name a real calendar date.', { field: 'event_on' });
		if (row.event_kind != null && !type.event_kinds.includes(row.event_kind))
			refuse(`${type.case_type} records one of these events: ${type.event_kinds.join(', ')}.`, {
				field: 'event_kind'
			});
		if (row.event_on == null && row.expected_event_on == null)
			refuse('An application needs an expected or actual event date.', {
				field: 'expected_event_on'
			});
		if ((row.leave_from == null) !== (row.leave_through == null))
			refuse('Record both ends of the planned leave span.', { field: 'leave_from' });
		if (
			row.leave_from != null &&
			(day(row.leave_from) == null ||
				day(row.leave_through) == null ||
				day(row.leave_through)! < day(row.leave_from)!)
		)
			refuse('The planned leave span needs ordered calendar dates.', { field: 'leave_through' });
		if (
			row.event_on != null &&
			row.leave_from != null &&
			(day(row.event_on)! < day(row.leave_from)! || day(row.event_on)! > day(row.leave_through)!)
		)
			refuse('The actual event must fall inside the planned leave span.', { field: 'event_on' });
		const hasNotice = row.notified_on != null || row.notification_reference != null;
		if (hasNotice && (day(row.notified_on) == null || !(row.notification_reference ?? '').trim()))
			refuse('A scheme notification needs its date and receipt reference together.', {
				field: 'notification_reference'
			});
		const hasAward =
			row.award_amount != null || row.awarded_on != null || row.award_reference != null;
		if (
			hasAward &&
			(row.event_on == null ||
				Number.isNaN(positiveCents(row.award_amount)) ||
				day(row.awarded_on) == null ||
				!(row.award_reference ?? '').trim())
		)
			refuse(
				'An actual award needs the event, a positive amount to the cent, its date and reference.',
				{
					field: 'award_amount'
				}
			);
		const fault = caseFactsFault(type, row);
		if (fault != null) refuse(fault, { field: 'facts' });
	}
	return inputs;
});

/** One case, its type, its lineage's currency and its evidence; a missing case refuses. */
async function readCase(db: Reads, caseId: string) {
	// A file is a heavy field: the cash assessment names the award document, so the row is read whole.
	const [caseRow] = await readAll<WorkspaceRow<'benefit_cases'>>(db, 'benefit_cases', {
		id: { eq: caseId }
	});
	if (caseRow == null) refuse('The benefit case is unavailable.');
	const [lineages, evidence] = await Promise.all([
		readCaseLineages(db, [caseRow.employment_id]),
		readCaseEvidence(db, [caseId])
	]);
	return {
		caseRow,
		type: lineages.typeOf(caseRow),
		currency: lineages.currencyOf(caseRow),
		evidence
	};
}

cases.query('reconcile', async (input, ctx) => {
	const { caseRow, type, evidence } = await readCase(ctx, input.case_id);
	const [entries, payslips, movements] = await Promise.all([
		ctx.read('leave_entries', {
			where: { employment_id: { eq: caseRow.employment_id } },
			all: true
		}),
		ctx.read('payslips', { where: { employment_id: { eq: caseRow.employment_id } }, all: true }),
		ctx.read('benefit_case_movements', {
			where: { benefit_case_id: { eq: input.case_id } },
			all: true
		})
	]);
	return reconcileBenefitCase({
		case_type: type,
		benefit_case: caseRow,
		evidence,
		entries: entries.rows,
		payslips: payslips.rows,
		movements: movements.rows,
		as_of: input.as_of
	});
});

cases.query('assess_cash_evidence', async (input, ctx) => {
	const { caseRow, type, currency, evidence } = await readCase(ctx, input.case_id);
	const from = dateKey(caseRow.leave_from);
	const through = dateKey(caseRow.leave_through);
	if (!isCalendarDate(from) || !isCalendarDate(through) || through < from)
		refuse('Benefit cash assessment needs the complete planned leave span.');
	if (
		caseRow.award_amount == null ||
		!isCalendarDate(dateKey(caseRow.awarded_on)) ||
		!(caseRow.award_reference ?? '').trim() ||
		caseRow.award_file == null
	)
		refuse('Benefit cash assessment needs the actual award amount, date, reference and document.');
	const [wages, entries, payslips, movements] = await Promise.all([
		ctx.read('employment_wage_periods', {
			where: { employment_id: { eq: caseRow.employment_id } },
			all: true
		}),
		ctx.read('leave_entries', {
			where: { employment_id: { eq: caseRow.employment_id } },
			all: true
		}),
		ctx.read('payslips', { where: { employment_id: { eq: caseRow.employment_id } }, all: true }),
		ctx.read('benefit_case_movements', {
			where: { benefit_case_id: { eq: input.case_id } },
			all: true
		})
	]);
	const exactWages = wages.rows.filter((row) => {
		const span = readRange(row.period);
		return span != null && dateKey(span.start) === from && dateKey(span.end) === through;
	});
	if (
		exactWages.length !== 1 ||
		exactWages[0]!.currency !== currency ||
		exactWages[0]!.normal_wages == null ||
		!(exactWages[0]!.reference ?? '').trim() ||
		!Number.isFinite(decodeNumber(exactWages[0]!.normal_wages))
	)
		refuse(
			`Benefit cash assessment needs one referenced ${currency} normal-wage record for the exact complete leave span.`
		);
	const reconciliation = reconcileBenefitCase({
		case_type: type,
		benefit_case: caseRow,
		evidence,
		entries: entries.rows,
		payslips: payslips.rows,
		movements: movements.rows,
		as_of: input.as_of
	});
	if (reconciliation.leave.status !== 'COMPLETE_APPROVED_SPAN')
		refuse('Benefit cash assessment needs the complete approved continuous leave span.');
	if (reconciliation.payroll.paid_entries > 0)
		refuse('Paid benefit payslips lack a saved award, full-wage and prior-cash allocation.');
	return {
		status: 'ALLOCATION_UNASSESSED',
		full_span_normal_wages: decodeNumber(exactWages[0]!.normal_wages),
		wage_reference: exactWages[0]!.reference,
		award_amount: reconciliation.award.award_amount,
		award_reference: caseRow.award_reference,
		advance_paid: reconciliation.award.advance_paid,
		salary_differential_paid: reconciliation.differential.paid_to_employee,
		reimbursement_received_by_employer: reconciliation.award.reimbursement_received_by_employer
	};
});

cases.query('credit_candidate', async (input, ctx) => {
	const { caseRow, type, currency, evidence } = await readCase(ctx, input.case_id);
	if (caseRow.event_kind == null || caseRow.event_on == null)
		refuse('Record the actual event before estimating an award.');
	if (type.credits == null) refuse(`${type.case_type} prices no contribution credits.`);
	const months = await ctx.read('contribution_statement_months', {
		where: { employee_id: { eq: caseRow.employee_id }, scheme_code: { eq: type.credits.scheme } },
		all: true
	});
	return {
		...calculateBenefitCandidate({
			case_type: type,
			benefit_case: caseRow,
			evidence,
			months: months.rows,
			currency
		}),
		status: 'CANDIDATE_NOT_AWARD'
	};
});

cases.query('assess', async (input, ctx) => {
	const { caseRow, type, currency, evidence } = await readCase(ctx, input.case_id);
	const eventOn = dateKey(caseRow.event_on);
	if (caseRow.event_kind == null || !isCalendarDate(eventOn))
		refuse('Record the actual event before assessing the case.');
	const [terms, earlier, months, earnings] = await Promise.all([
		readAll<{ readonly effective_range: unknown; readonly base_salary: unknown }>(
			ctx,
			'employment_terms',
			{ employment_id: { eq: caseRow.employment_id }, approval_id: { isNull: true } },
			undefined,
			{ effective_range: true, base_salary: true }
		),
		readAll<WorkspaceRow<'benefit_cases'>>(
			ctx,
			'benefit_cases',
			{ employee_id: { eq: caseRow.employee_id } },
			undefined,
			{ id: true, case_type: true, event_on: true, leave_from: true, leave_through: true }
		),
		type.credits == null
			? null
			: readAll<Parameters<typeof windowCredits>[3][number]>(ctx, 'contribution_statement_months', {
					employee_id: { eq: caseRow.employee_id },
					scheme_code: { eq: type.credits.scheme }
				}),
		type.earnings == null
			? undefined
			: readCaseEarnings(ctx, caseRow.employment_id, eventOn, type.earnings.months)
	]);
	const inForce = terms.find((row) => {
		const span = governed(row.effective_range);
		return span != null && span.from <= eventOn && (span.to == null || eventOn <= span.to);
	});
	const award = decodeNumber(caseRow.award_amount);
	return {
		...assessCase({
			case_type: type,
			benefit_case: caseRow,
			evidence,
			currency,
			inputs: {
				...(months == null
					? {}
					: { credits: windowCredits(type, caseRow, evidence, months).credits }),
				earnings,
				previous: previousCases(caseRow.id, dateKey(caseRow.leave_from) || eventOn, earlier),
				award: Number.isFinite(award) ? award : 0,
				salary: inForce == null ? 0 : decodeNumber(inForce.base_salary) || 0
			}
		}),
		status: caseRow.award_amount == null ? 'ASSESSED_NOT_AWARDED' : 'ASSESSED_WITH_RECORDED_AWARD'
	};
});
