import type { Decimal } from '@norbital-ai/std/decimal';
import type { BenefitCaseType } from '../datatypes/payroll_settings.js';
import { dateKey, isCalendarDate } from '../iso-day.js';
import { addDays, daysBetween } from '../payroll/run/dates.js';
import { refuse } from '../refuse.js';
import { decodeNumber } from '../wire.js';
import {
	caseFactsFault,
	caseSite,
	claimStatuses,
	compensableDays,
	type CaseEvidence,
	type CaseFacts
} from './benefit.js';

type Amount = number | string | Decimal;

type Case = CaseFacts & {
	readonly employment_id: string;
	readonly application_on: string;
	readonly leave_from?: string | null | undefined;
	readonly leave_through?: string | null | undefined;
	readonly award_amount?: Amount | null | undefined;
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
	readonly kind: string;
	readonly paid_on: string;
	readonly amount: Amount;
};

/** The ids a later unapproved adjustment reverses. */
export const reversedIds = (entries: readonly Entry[]) =>
	new Set(
		entries.flatMap((row) =>
			row.approval_id == null && row.as_adjustment_entry && row.reversal_of_id != null
				? [row.reversal_of_id]
				: []
		)
	);

/**
 * A case's complete leave: its compensable days, continuous and approved once each, around the
 * event with at least `min_days_after_event` (capped at the compensable days) on or after it, and
 * every fact the event demands recorded with each claim proven.
 */
function completeSpan(
	type: BenefitCaseType,
	caseRow: Case,
	site: ReturnType<typeof caseSite>,
	expected: readonly string[]
): boolean {
	const eventDay = site.event.date;
	if (
		eventDay === '' ||
		!type.event_kinds.includes(site.event.kind) ||
		caseFactsFault(type, caseRow) != null ||
		Object.values(claimStatuses(type, site)).some(
			(status) => status === 'DOCUMENT_MISSING_OR_OUTSIDE_EVENT'
		)
	)
		return false;
	const days = compensableDays(type, site);
	const from = expected[0];
	const through = expected.at(-1);
	return (
		expected.length === days &&
		from != null &&
		through != null &&
		eventDay >= from &&
		eventDay <= through &&
		daysBetween(eventDay, through).length >= Math.min(type.min_days_after_event, days)
	);
}

/** Reconciles saved evidence only. It never treats a scheme refund to the employer as employee pay. */
export function reconcileBenefitCase(input: {
	readonly case_type: BenefitCaseType;
	readonly benefit_case: Case;
	readonly evidence?: readonly CaseEvidence[] | undefined;
	readonly entries: readonly Entry[];
	readonly payslips: readonly Slip[];
	readonly movements: readonly Movement[];
	readonly as_of: string;
}) {
	const type = input.case_type;
	const caseRow = input.benefit_case;
	const asOf = dateKey(input.as_of);
	const application = dateKey(caseRow.application_on);
	if (!isCalendarDate(asOf) || !isCalendarDate(application))
		refuse('Benefit reconciliation needs a real as-of and application date.');
	const due = addDays(application, type.advance_due_days);
	const award = caseRow.award_amount == null ? null : decodeNumber(caseRow.award_amount);
	const role = (row: Movement) =>
		type.movement_kinds.find((kind) => kind.code === row.kind) ?? null;
	const sum = (
		direction: 'EMPLOYEE_PAYMENT' | 'EMPLOYER_RECEIPT',
		component: string,
		through: string
	) =>
		input.movements
			.filter((row) => {
				const kind = role(row);
				return (
					kind?.direction === direction &&
					kind.component === component &&
					dateKey(row.paid_on) <= through
				);
			})
			.reduce((total, row) => total + Math.round(decodeNumber(row.amount) * 100), 0) / 100;
	const advance = sum('EMPLOYEE_PAYMENT', type.components.award, asOf);
	const advanceByDue = sum('EMPLOYEE_PAYMENT', type.components.award, due < asOf ? due : asOf);
	const reimbursement = sum('EMPLOYER_RECEIPT', type.components.award, asOf);
	const differential = sum('EMPLOYEE_PAYMENT', type.components.differential, asOf);
	const reversed = reversedIds(input.entries);
	const site = caseSite(type, caseRow, input.evidence);
	const eventDay = site.event.date;
	const from = dateKey(caseRow.leave_from);
	const through = dateKey(caseRow.leave_through);
	const matched = input.entries.filter(
		(row) =>
			row.employment_id === caseRow.employment_id &&
			row.leave_code === type.case_type &&
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
		completeSpan(type, caseRow, site, expected) &&
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
			claims: claimStatuses(type, site),
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
		award: {
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
		differential: {
			paid_to_employee: differential,
			status: 'UNASSESSED_FULL_WAGE_AND_13TH_MONTH_BASIS'
		}
	};
}
