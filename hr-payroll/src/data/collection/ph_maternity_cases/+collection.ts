import { collection } from '@norbital-ai/bolt';
import { dateKey, isCalendarDate } from '../../../lib/iso-day.js';
import { readRange } from '../../../lib/payroll/run/effective.js';
import { calculateSssMaternityBenefit } from '../../../lib/ph/maternity-benefit.js';
import {
	hasPhSoloParentDocument,
	reconcilePhMaternity
} from '../../../lib/ph/maternity-reconciliation.js';
import { refuse } from '../../../lib/refuse.js';
import { decodeNumber } from '../../../lib/wire.js';

const maternityCases = collection('ph_maternity_cases', {
	read: { fields: 'all' },
	queries: {
		sss_candidate: {
			description:
				'Calculate a nonauthoritative SSS maternity cash candidate from saved paid contribution months for this event.',
			input: { case_id: { kind: 'id', of: 'ph_maternity_cases' } },
			output: { kind: 'json' }
		},
		reconcile: {
			description:
				'Compare a PH maternity case with approved leave, paid payslips and dated cash evidence without booking employer reimbursement as employee pay.',
			input: { case_id: { kind: 'id', of: 'ph_maternity_cases' }, as_of: { kind: 'date' } },
			output: { kind: 'json' }
		},
		assess_cash_evidence: {
			description:
				'Require an actual SSS award, exact full-span wage evidence and complete approved leave before reviewing recorded maternity cash; this does not allocate or pay it.',
			input: { case_id: { kind: 'id', of: 'ph_maternity_cases' }, as_of: { kind: 'date' } },
			output: { kind: 'json' }
		}
	},
	create: {
		input: {
			columns: [
				'employee_id',
				'employment_id',
				'case_reference',
				'application_on',
				'expected_delivery_on',
				'event_kind',
				'event_on',
				'solo_parent_claimed',
				'solo_parent_document_kind',
				'solo_parent_document_issued_on',
				'solo_parent_document_valid_from',
				'solo_parent_document_valid_through',
				'solo_parent_document_reference',
				'solo_parent_document_issuer_lgu',
				'solo_parent_document_file',
				'solo_parent_social_worker_signature_seen',
				'solo_parent_mayor_signature_seen',
				'solo_parent_certificate_details_checked',
				'solo_parent_first_time',
				'leave_from',
				'leave_through',
				'sss_notified_on',
				'sss_notification_reference',
				'sss_award_amount',
				'sss_awarded_on',
				'sss_award_reference',
				'sss_award_file',
				'exemption_kind',
				'exemption_effective_range',
				'exemption_approved_on',
				'exemption_reference',
				'exemption_file'
			]
		}
	},
	update: {
		input: {
			columns: [
				'expected_delivery_on',
				'event_kind',
				'event_on',
				'solo_parent_claimed',
				'solo_parent_document_kind',
				'solo_parent_document_issued_on',
				'solo_parent_document_valid_from',
				'solo_parent_document_valid_through',
				'solo_parent_document_reference',
				'solo_parent_document_issuer_lgu',
				'solo_parent_document_file',
				'solo_parent_social_worker_signature_seen',
				'solo_parent_mayor_signature_seen',
				'solo_parent_certificate_details_checked',
				'solo_parent_first_time',
				'leave_from',
				'leave_through',
				'sss_notified_on',
				'sss_notification_reference',
				'sss_award_amount',
				'sss_awarded_on',
				'sss_award_reference',
				'sss_award_file',
				'exemption_kind',
				'exemption_effective_range',
				'exemption_approved_on',
				'exemption_reference',
				'exemption_file'
			]
		}
	}
});
export default maternityCases;

/** A case may open before delivery; an actual SSS award and exemption require their own evidence. */
maternityCases.transform(async (inputs, { existing, db, refuse }) => {
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
		const expectedChanged =
			dateKey(row.expected_delivery_on) !== dateKey(prior.expected_delivery_on);
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
		const funded = await db.read('ph_maternity_movements', {
			where: {
				ph_maternity_case_id: { in: changedFundedCases.map((row) => row.id) },
				kind: { in: ['SSS_ADVANCE', 'SALARY_DIFFERENTIAL'] }
			},
			all: true
		});
		for (const change of changedFundedCases) {
			const payments = funded.rows.filter((row) => row.ph_maternity_case_id === change.id);
			if (payments.length > 0 && change.applicationChanged)
				refuse('A funded maternity application date or reference cannot change.');
			if (payments.length > 0 && change.expectedChanged)
				refuse('A funded maternity expected contingency cannot change after its advance.');
			if (
				payments.length > 0 &&
				(change.eventChanged ||
					(change.spanChanged &&
						(change.eventRecorded ||
							payments.some((row) => row.planned_leave_span_at_payment == null))))
			)
				refuse('A funded maternity event or unsnapshotted leave span cannot change.');
		}
	}
	const changedRecordedAwards = rows.flatMap((row, index) => {
		const prior = existing[index];
		if (prior?.sss_award_amount == null) return [];
		return decodeNumber(row.sss_award_amount) !== decodeNumber(prior.sss_award_amount) ||
			dateKey(row.sss_awarded_on) !== dateKey(prior.sss_awarded_on) ||
			row.sss_award_reference !== prior.sss_award_reference ||
			JSON.stringify(row.sss_award_file) !== JSON.stringify(prior.sss_award_file)
			? [prior.id]
			: [];
	});
	if (changedRecordedAwards.length > 0) {
		const cash = await db.read('ph_maternity_movements', {
			where: {
				ph_maternity_case_id: { in: changedRecordedAwards },
				kind: { in: ['SSS_ADVANCE', 'SALARY_DIFFERENTIAL'] }
			},
			all: true
		});
		if (cash.rows.length > 0)
			refuse(
				'A recorded SSS award cannot be rewritten after employee maternity cash; record an evidenced adjustment instead.'
			);
	}
	const employmentIds = [
		...new Set(rows.map((row) => row.employment_id).filter((id) => id != null))
	];
	const employments = employmentIds.length
		? (
				await db.read('employments', {
					where: { id: { in: employmentIds } },
					all: true
				})
			).rows
		: [];
	const companyIds = [...new Set(employments.map((row) => row.company_id))];
	const companies = companyIds.length
		? (await db.read('companies', { where: { id: { in: companyIds } }, all: true })).rows
		: [];
	const employmentById = new Map(employments.map((row) => [row.id, row]));
	const companyById = new Map(companies.map((row) => [row.id, row]));
	const day = (value: string | null | undefined) => {
		const date = dateKey(value);
		return isCalendarDate(date) ? date : null;
	};
	for (const row of rows) {
		const employment = employmentById.get(row.employment_id!);
		if (employment?.employee_id !== row.employee_id)
			refuse('A PH maternity case must name this employee’s employment.', {
				field: 'employment_id'
			});
		if (employment == null || companyById.get(employment.company_id)?.settings_code !== 'PH')
			refuse('A PH maternity case requires a Philippine employment.', {
				field: 'employment_id'
			});
		if (!(row.case_reference ?? '').trim())
			refuse('A maternity case needs a stable application reference.', {
				field: 'case_reference'
			});
		if (day(row.application_on) == null)
			refuse('A maternity case needs its application date.', { field: 'application_on' });
		if (row.expected_delivery_on != null && day(row.expected_delivery_on) == null)
			refuse('Expected delivery must be a real calendar date.', {
				field: 'expected_delivery_on'
			});
		if ((row.event_kind == null) !== (row.event_on == null))
			refuse('Record the actual maternity event kind and date together.', { field: 'event_on' });
		if (row.event_on != null && day(row.event_on) == null)
			refuse('The maternity event must name a real calendar date.', { field: 'event_on' });
		if (row.event_on == null && row.expected_delivery_on == null)
			refuse('An application needs an expected delivery or actual event date.', {
				field: 'expected_delivery_on'
			});
		if ((row.leave_from == null) !== (row.leave_through == null))
			refuse('Record both ends of the planned maternity leave span.', { field: 'leave_from' });
		if (
			row.leave_from != null &&
			(day(row.leave_from) == null ||
				day(row.leave_through) == null ||
				day(row.leave_through)! < day(row.leave_from)!)
		)
			refuse('The planned maternity leave span needs ordered calendar dates.', {
				field: 'leave_through'
			});
		if (
			row.event_on != null &&
			row.leave_from != null &&
			(day(row.event_on)! < day(row.leave_from)! || day(row.event_on)! > day(row.leave_through)!)
		)
			refuse('The actual maternity event must fall inside the planned leave span.', {
				field: 'event_on'
			});
		const hasNotice = row.sss_notified_on != null || row.sss_notification_reference != null;
		if (
			hasNotice &&
			(day(row.sss_notified_on) == null || !(row.sss_notification_reference ?? '').trim())
		)
			refuse('SSS notification needs its date and receipt reference together.', {
				field: 'sss_notification_reference'
			});
		const hasAward =
			row.sss_award_amount != null || row.sss_awarded_on != null || row.sss_award_reference != null;
		if (hasAward) {
			const amount = row.sss_award_amount == null ? NaN : decodeNumber(row.sss_award_amount);
			if (
				row.event_on == null ||
				!Number.isFinite(amount) ||
				amount <= 0 ||
				Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-7 ||
				day(row.sss_awarded_on) == null ||
				!(row.sss_award_reference ?? '').trim()
			)
				refuse(
					'An actual SSS award needs the event, positive peso amount, date and SSS reference.',
					{
						field: 'sss_award_amount'
					}
				);
		}
		const hasExemption =
			row.exemption_kind != null ||
			row.exemption_effective_range != null ||
			row.exemption_approved_on != null ||
			row.exemption_reference != null;
		if (hasExemption) {
			const range = readRange(row.exemption_effective_range);
			if (
				row.exemption_kind == null ||
				range?.end == null ||
				day(range.start) == null ||
				day(range.end) == null ||
				day(range.end)! < day(range.start)! ||
				day(row.exemption_approved_on) == null ||
				!(row.exemption_reference ?? '').trim()
			)
				refuse(
					'A claimed DOLE exemption needs its category, finite dates, approval and reference.',
					{
						field: 'exemption_reference'
					}
				);
		}
		if (row.event_kind === 'BIRTH' && row.event_on != null && row.solo_parent_claimed == null)
			refuse(
				'Record whether the mother claims the solo-parent maternity extension for this birth.',
				{
					field: 'solo_parent_claimed'
				}
			);
		if (row.event_kind != null && row.event_kind !== 'BIRTH' && row.solo_parent_claimed === true)
			refuse('The solo-parent maternity extension applies to live birth only.', {
				field: 'solo_parent_claimed'
			});
		const hasSoloDocument =
			[
				row.solo_parent_document_kind,
				row.solo_parent_document_issued_on,
				row.solo_parent_document_valid_from,
				row.solo_parent_document_valid_through,
				row.solo_parent_document_reference,
				row.solo_parent_document_issuer_lgu,
				row.solo_parent_document_file
			].some((value) => value != null) ||
			row.solo_parent_social_worker_signature_seen === true ||
			row.solo_parent_mayor_signature_seen === true ||
			row.solo_parent_certificate_details_checked === true ||
			row.solo_parent_first_time === true;
		if (hasSoloDocument) {
			const issued = day(row.solo_parent_document_issued_on);
			const from = day(row.solo_parent_document_valid_from);
			const through = day(row.solo_parent_document_valid_through);
			if (
				row.solo_parent_claimed !== true ||
				row.solo_parent_document_kind == null ||
				issued == null ||
				from == null ||
				through == null ||
				through < from ||
				issued < from ||
				issued > through ||
				!(row.solo_parent_document_reference ?? '').trim() ||
				!(row.solo_parent_document_issuer_lgu ?? '').trim() ||
				row.solo_parent_document_file == null ||
				row.solo_parent_social_worker_signature_seen !== true ||
				row.solo_parent_mayor_signature_seen !== true ||
				(row.solo_parent_document_kind === 'ELIGIBILITY_CERTIFICATE' &&
					row.solo_parent_certificate_details_checked !== true)
			)
				refuse(
					'A solo-parent extension needs the LGU document file, type, issue and validity dates, issuer, reference and checked signatures/details.',
					{ field: 'solo_parent_document_reference' }
				);
		}
	}
	return inputs;
});

maternityCases.query('reconcile', async (input, ctx) => {
	const { case_id, as_of } = input;
	const cases = await ctx.read('ph_maternity_cases', {
		where: { id: { eq: case_id } },
		all: true
	});
	const maternityCase = cases.rows[0];
	if (maternityCase == null) refuse('The PH maternity case is unavailable.');
	const [entries, payslips, movements] = await Promise.all([
		ctx.read('leave_entries', {
			where: { employment_id: { eq: maternityCase.employment_id } },
			all: true
		}),
		ctx.read('payslips', {
			where: { employment_id: { eq: maternityCase.employment_id } },
			all: true
		}),
		ctx.read('ph_maternity_movements', {
			where: { ph_maternity_case_id: { eq: case_id } },
			all: true
		})
	]);
	return reconcilePhMaternity({
		maternity_case: maternityCase,
		entries: entries.rows,
		payslips: payslips.rows,
		movements: movements.rows,
		as_of
	});
});

maternityCases.query('assess_cash_evidence', async (input, ctx) => {
	// A file is a heavy field: the reconciliation needs the award document named, so it is selected.
	const cases = await ctx.read('ph_maternity_cases', {
		where: { id: { eq: input.case_id } },
		select: {
			employment_id: true,
			application_on: true,
			event_kind: true,
			event_on: true,
			expected_delivery_on: true,
			leave_from: true,
			leave_through: true,
			sss_award_amount: true,
			sss_awarded_on: true,
			sss_award_reference: true,
			sss_award_file: true
		},
		all: true
	});
	const caseRow = cases.rows[0];
	if (caseRow == null) refuse('The PH maternity case is unavailable.');
	const from = dateKey(caseRow.leave_from);
	const through = dateKey(caseRow.leave_through);
	if (!isCalendarDate(from) || !isCalendarDate(through) || through < from)
		refuse('Maternity cash assessment needs the complete planned leave span.');
	if (
		caseRow.sss_award_amount == null ||
		!isCalendarDate(dateKey(caseRow.sss_awarded_on)) ||
		!(caseRow.sss_award_reference ?? '').trim() ||
		caseRow.sss_award_file == null
	)
		refuse(
			'Maternity cash assessment needs the actual SSS award amount, date, reference and document.'
		);
	const [wages, entries, payslips, movements] = await Promise.all([
		ctx.read('employment_wage_periods', {
			where: { employment_id: { eq: caseRow.employment_id } },
			all: true
		}),
		ctx.read('leave_entries', {
			where: { employment_id: { eq: caseRow.employment_id } },
			all: true
		}),
		ctx.read('payslips', {
			where: { employment_id: { eq: caseRow.employment_id } },
			all: true
		}),
		ctx.read('ph_maternity_movements', {
			where: { ph_maternity_case_id: { eq: input.case_id } },
			all: true
		})
	]);
	const exactWages = wages.rows.filter((row) => {
		const span = readRange(row.period);
		return span != null && dateKey(span.start) === from && dateKey(span.end) === through;
	});
	if (
		exactWages.length !== 1 ||
		exactWages[0]!.currency !== 'PHP' ||
		exactWages[0]!.normal_wages == null ||
		!(exactWages[0]!.reference ?? '').trim() ||
		!Number.isFinite(decodeNumber(exactWages[0]!.normal_wages))
	)
		refuse(
			'Maternity cash assessment needs one referenced PHP normal-wage record for the exact complete leave span.'
		);
	const reconciliation = reconcilePhMaternity({
		maternity_case: caseRow,
		entries: entries.rows,
		payslips: payslips.rows,
		movements: movements.rows,
		as_of: input.as_of
	});
	if (reconciliation.leave.status !== 'COMPLETE_APPROVED_SPAN')
		refuse('Maternity cash assessment needs the complete approved continuous leave span.');
	if (reconciliation.payroll.paid_entries > 0)
		refuse('Paid maternity payslips lack a saved SSS, full-wage and prior-cash allocation.');
	return {
		status: 'ALLOCATION_UNASSESSED',
		full_span_normal_wages: decodeNumber(exactWages[0]!.normal_wages),
		wage_reference: exactWages[0]!.reference,
		sss_award_amount: reconciliation.sss.award_amount,
		sss_award_reference: caseRow.sss_award_reference,
		advance_paid: reconciliation.sss.advance_paid,
		salary_differential_paid: reconciliation.salary_differential.paid_to_employee,
		sss_reimbursement_received_by_employer: reconciliation.sss.reimbursement_received_by_employer
	};
});

maternityCases.query('sss_candidate', async (input, ctx) => {
	const cases = await ctx.read('ph_maternity_cases', {
		where: { id: { eq: input.case_id } },
		all: true
	});
	const caseRow = cases.rows[0];
	if (caseRow == null) refuse('The PH maternity case is unavailable.');
	if (caseRow.event_kind == null || caseRow.event_on == null)
		refuse('Record the actual maternity event before estimating an SSS benefit.');
	if (caseRow.event_kind === 'BIRTH' && caseRow.solo_parent_claimed == null)
		refuse('Record whether this birth claims the solo-parent extension.');
	if (caseRow.solo_parent_claimed === true && !hasPhSoloParentDocument(caseRow))
		refuse('The solo-parent SSS candidate needs event-valid LGU document evidence.');
	const months = await ctx.read('sss_contribution_months', {
		where: { employee_id: { eq: caseRow.employee_id } },
		all: true
	});
	return {
		...calculateSssMaternityBenefit({
			contingency_date: caseRow.event_on,
			contingency: caseRow.event_kind,
			solo_parent: caseRow.solo_parent_claimed === true,
			months: months.rows
		}),
		status: 'CANDIDATE_NOT_SSS_AWARD'
	};
});
