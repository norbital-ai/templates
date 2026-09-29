import type { Decimal } from '@norbital-ai/std/decimal';
import { dateKey, isCalendarDate } from '../iso-day.js';
import { addDays, daysBetween, monthDay } from '../payroll/run/dates.js';
import { refuse } from '../refuse.js';
import { decodeNumber } from '../wire.js';

type Amount = number | string | Decimal;

type Case = {
	readonly employment_id: string;
	readonly application_on: string;
	readonly event_kind?: string | null;
	readonly event_on?: string | null;
	readonly expected_delivery_on?: string | null;
	readonly solo_parent_claimed?: boolean | null;
	readonly solo_parent_document_kind?: string | null;
	readonly solo_parent_document_issued_on?: string | null;
	readonly solo_parent_document_valid_from?: string | null;
	readonly solo_parent_document_valid_through?: string | null;
	readonly solo_parent_document_reference?: string | null;
	readonly solo_parent_document_issuer_lgu?: string | null;
	readonly solo_parent_document_file?: unknown;
	readonly solo_parent_social_worker_signature_seen?: boolean | null;
	readonly solo_parent_mayor_signature_seen?: boolean | null;
	readonly solo_parent_certificate_details_checked?: boolean | null;
	readonly solo_parent_first_time?: boolean | null;
	readonly leave_from?: string | null;
	readonly leave_through?: string | null;
	readonly sss_award_amount?: Amount | null;
};
type Entry = {
	readonly id: string;
	readonly employment_id: string;
	readonly leave_code: string;
	readonly approval_id?: string | null;
	readonly as_adjustment_entry?: boolean | null;
	readonly reversal_of_id?: string | null;
	readonly event_kind?: string | null;
	readonly event_date?: string | null;
	readonly charges?: readonly { readonly date: string; readonly days: number }[] | null;
	readonly payslip_id?: string | null;
};
type Slip = {
	readonly id: string;
	readonly employment_id: string;
	readonly paid_at?: string | null;
};
type Movement = {
	readonly kind: 'SSS_ADVANCE' | 'SALARY_DIFFERENTIAL' | 'SSS_REIMBURSEMENT';
	readonly paid_on: string;
	readonly amount: Amount;
};

/** A birth-specific claim needs the LGU file and dates SSS asks for. */
export function hasPhSoloParentDocument(caseRow: Case): boolean {
	const eventDay = dateKey(caseRow.event_on);
	const soloIssued = dateKey(caseRow.solo_parent_document_issued_on);
	const soloFrom = dateKey(caseRow.solo_parent_document_valid_from);
	const soloThrough = dateKey(caseRow.solo_parent_document_valid_through);
	return (
		caseRow.event_kind === 'BIRTH' &&
		caseRow.solo_parent_claimed === true &&
		['SOLO_PARENT_ID', 'ELIGIBILITY_CERTIFICATE'].includes(
			caseRow.solo_parent_document_kind ?? ''
		) &&
		(caseRow.solo_parent_document_reference ?? '').trim() !== '' &&
		(caseRow.solo_parent_document_issuer_lgu ?? '').trim() !== '' &&
		caseRow.solo_parent_document_file != null &&
		caseRow.solo_parent_social_worker_signature_seen === true &&
		caseRow.solo_parent_mayor_signature_seen === true &&
		(caseRow.solo_parent_document_kind !== 'ELIGIBILITY_CERTIFICATE' ||
			caseRow.solo_parent_certificate_details_checked === true) &&
		isCalendarDate(eventDay) &&
		isCalendarDate(soloIssued) &&
		isCalendarDate(soloFrom) &&
		isCalendarDate(soloThrough) &&
		soloThrough >= soloFrom &&
		soloIssued >= soloFrom &&
		soloIssued <= soloThrough &&
		((soloIssued <= eventDay && soloFrom <= eventDay && eventDay <= soloThrough) ||
			(caseRow.solo_parent_first_time === true &&
				soloIssued >= eventDay &&
				soloIssued <=
					monthDay(
						Number.parseInt(eventDay.slice(0, 4), 10),
						Number.parseInt(eventDay.slice(5, 7), 10) - 1 + 6,
						Number.parseInt(eventDay.slice(8, 10), 10)
					)))
	);
}

/** Reconciles saved evidence only. It never treats SSS reimbursement as employee pay. */
export function reconcilePhMaternity(input: {
	readonly maternity_case: Case;
	readonly entries: readonly Entry[];
	readonly payslips: readonly Slip[];
	readonly movements: readonly Movement[];
	readonly as_of: string;
}) {
	const { maternity_case: caseRow } = input;
	const asOf = dateKey(input.as_of);
	const application = dateKey(caseRow.application_on);
	if (!isCalendarDate(asOf) || !isCalendarDate(application))
		refuse('Maternity reconciliation needs a real as-of and application date.');
	const due = addDays(application, 30);
	const award = caseRow.sss_award_amount == null ? null : decodeNumber(caseRow.sss_award_amount);
	const sum = (kind: Movement['kind'], through?: string) =>
		input.movements
			.filter((row) => row.kind === kind && (through == null || dateKey(row.paid_on) <= through))
			.reduce((total, row) => total + Math.round(decodeNumber(row.amount) * 100), 0) / 100;
	const advance = sum('SSS_ADVANCE', asOf);
	const advanceByDue = sum('SSS_ADVANCE', due < asOf ? due : asOf);
	const reimbursement = sum('SSS_REIMBURSEMENT', asOf);
	const differential = sum('SALARY_DIFFERENTIAL', asOf);
	const reversed = new Set(
		input.entries.flatMap((row) =>
			row.approval_id == null && row.as_adjustment_entry && row.reversal_of_id != null
				? [row.reversal_of_id]
				: []
		)
	);
	const eventDay = dateKey(caseRow.event_on);
	const from = dateKey(caseRow.leave_from);
	const through = dateKey(caseRow.leave_through);
	const documentedSoloParent = hasPhSoloParentDocument(caseRow);
	const matched = input.entries.filter(
		(row) =>
			row.employment_id === caseRow.employment_id &&
			row.leave_code === 'MATERNITY_LEAVE' &&
			row.approval_id == null &&
			!row.as_adjustment_entry &&
			!reversed.has(row.id) &&
			row.event_kind === caseRow.event_kind &&
			dateKey(row.event_date) === eventDay &&
			eventDay !== ''
	);
	const charges = matched.flatMap((row) => row.charges ?? []);
	const expected =
		isCalendarDate(from) && isCalendarDate(through) && through >= from
			? daysBetween(from, through)
			: [];
	const counted = new Map<string, number>();
	for (const charge of charges)
		counted.set(dateKey(charge.date), (counted.get(dateKey(charge.date)) ?? 0) + charge.days);
	const complete =
		isCalendarDate(eventDay) &&
		(caseRow.event_kind === 'BIRTH'
			? expected.length === (caseRow.solo_parent_claimed === true ? 120 : 105) &&
				caseRow.solo_parent_claimed != null &&
				(caseRow.solo_parent_claimed === false || documentedSoloParent)
			: caseRow.event_kind === 'MISCARRIAGE' || caseRow.event_kind === 'EMERGENCY_TERMINATION'
				? expected.length === 60
				: false) &&
		(caseRow.event_kind === 'BIRTH'
			? eventDay >= from && eventDay <= through && daysBetween(eventDay, through).length >= 60
			: from === eventDay) &&
		charges.length === expected.length &&
		expected.every((day) => counted.get(day) === 1);
	const slips = new Map(input.payslips.map((row) => [row.id, row]));
	const captured = matched.filter(
		(row) =>
			row.payslip_id != null && slips.get(row.payslip_id)?.employment_id === caseRow.employment_id
	);
	const paid = captured.filter((row) => {
		const paidAt = slips.get(row.payslip_id!)?.paid_at;
		return paidAt != null && dateKey(paidAt) <= asOf;
	});
	return {
		leave: {
			status: complete ? 'COMPLETE_APPROVED_SPAN' : 'INCOMPLETE_OR_UNPROVEN',
			solo_parent_status:
				caseRow.event_kind !== 'BIRTH'
					? 'NOT_APPLICABLE'
					: caseRow.solo_parent_claimed == null
						? 'UNDECLARED'
						: caseRow.solo_parent_claimed === false
							? 'NOT_CLAIMED'
							: documentedSoloParent
								? 'DOCUMENTED_FOR_EVENT'
								: 'DOCUMENT_MISSING_OR_OUTSIDE_EVENT',
			expected_days: expected.length,
			approved_days: charges.length,
			entry_ids: matched.map((row) => row.id),
			missing_dates: expected.filter((day) => counted.get(day) !== 1)
		},
		payroll: {
			status:
				advance + differential > 0 && paid.length > 0
					? 'CASH_AND_PAID_PAYROLL_UNRECONCILED'
					: complete && paid.length === matched.length
						? 'CAPTURED_AND_PAID_WAGE_UNASSESSED'
						: 'UNSETTLED_OR_UNPROVEN',
			captured_entries: captured.length,
			paid_entries: paid.length,
			wage_basis: 'UNASSESSED'
		},
		sss: {
			advance_due_on: due,
			award_amount: award,
			advance_paid: advance,
			advance_paid_by_due: advanceByDue,
			advance_status:
				award == null
					? 'AWARD_NOT_RECORDED'
					: advanceByDue >= award
						? 'PROVEN_BY_DUE_DATE'
						: asOf > due
							? 'NOT_PROVEN_BY_DUE_DATE'
							: 'PENDING',
			reimbursement_received_by_employer: reimbursement,
			reimbursement_status:
				award != null && reimbursement > Math.min(award, advance)
					? 'EXCEEDS_RECORDED_ADVANCE_OR_AWARD'
					: 'RECORDED_SEPARATELY_FROM_EMPLOYEE_PAY'
		},
		salary_differential: {
			paid_to_employee: differential,
			status: 'UNASSESSED_FULL_WAGE_AND_13TH_MONTH_BASIS'
		}
	};
}
