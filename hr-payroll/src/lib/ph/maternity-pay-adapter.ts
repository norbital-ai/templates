import type { Decimal } from '@norbital-ai/std/decimal';
import { dateKey, isCalendarDate } from '../iso-day.js';
import { addDays, daysBetween } from '../payroll/run/dates.js';
import { readRange } from '../payroll/run/effective.js';
import { refuse } from '../refuse.js';
import { decodeNumber } from '../wire.js';
import { reconcilePhMaternity } from './maternity-reconciliation.js';
import { allocatePhMaternityPay } from './maternity-pay.js';

type ReconciliationInput = Parameters<typeof reconcilePhMaternity>[0];
type Amount = number | string | Decimal;
type Case = ReconciliationInput['maternity_case'] & {
	readonly id: string;
	readonly sss_awarded_on?: string | null;
	readonly sss_award_reference?: string | null;
	readonly sss_award_file?: unknown;
};
type Entry = ReconciliationInput['entries'][number];
type Movement = ReconciliationInput['movements'][number] & {
	readonly ph_maternity_case_id: string;
};
type Payslip = ReconciliationInput['payslips'][number] & {
	readonly salary_window?: { readonly start: string; readonly end: string } | null;
};

/** Adapt saved PH case evidence into a proposed slip ledger; the payroll write still needs atomic pins. */
export function planPhMaternityPayslips(input: {
	readonly maternity_case: Case;
	readonly entries: readonly Entry[];
	readonly payslips: readonly Payslip[];
	readonly movements: readonly Movement[];
	readonly as_of: string;
	readonly wage_basis: {
		readonly monthly_salary: Amount;
		readonly monthly_salary_reference: string;
		readonly full_span_wage_period: {
			readonly period: unknown;
			readonly currency: string;
			readonly normal_wages: Amount;
			readonly reference: string;
		};
	};
	readonly cutoffs: readonly {
		readonly period: string;
		readonly salary: { readonly start: string; readonly end: string };
		readonly pay_on: string;
		readonly leave_entry_ids: readonly string[];
		readonly employee_premiums: {
			readonly sss: Amount;
			readonly philhealth: Amount;
			readonly pagibig: Amount;
		};
		readonly premium_evidence_reference: string;
	}[];
}) {
	const caseRow = input.maternity_case;
	const from = dateKey(caseRow.leave_from);
	const through = dateKey(caseRow.leave_through);
	const wageSpan = readRange(input.wage_basis.full_span_wage_period.period);
	if (
		!isCalendarDate(from) ||
		!isCalendarDate(through) ||
		wageSpan == null ||
		dateKey(wageSpan.start) !== from ||
		dateKey(wageSpan.end) !== through ||
		input.wage_basis.full_span_wage_period.currency !== 'PHP' ||
		!input.wage_basis.full_span_wage_period.reference.trim() ||
		!input.wage_basis.monthly_salary_reference.trim()
	)
		refuse(
			'PH maternity pay needs referenced monthly salary and exact full-span PHP wage evidence.'
		);
	if (
		caseRow.sss_award_amount == null ||
		!isCalendarDate(dateKey(caseRow.sss_awarded_on)) ||
		dateKey(caseRow.sss_awarded_on) > dateKey(input.as_of) ||
		!(caseRow.sss_award_reference ?? '').trim() ||
		caseRow.sss_award_file == null
	)
		refuse(
			'PH maternity pay needs a current actual SSS award amount, date, reference and document.'
		);
	const reconciliation = reconcilePhMaternity({
		maternity_case: caseRow,
		entries: input.entries,
		payslips: input.payslips,
		movements: input.movements.filter((row) => row.ph_maternity_case_id === caseRow.id),
		as_of: input.as_of
	});
	if (reconciliation.leave.status !== 'COMPLETE_APPROVED_SPAN')
		refuse('PH maternity pay needs the complete approved continuous event-matched leave span.');
	if (reconciliation.payroll.captured_entries > 0)
		refuse('An existing maternity payslip needs its saved case allocation before replanning.');
	const matchedIds = new Set(reconciliation.leave.entry_ids);
	const reversedIds = new Set(
		input.entries.flatMap((entry) =>
			entry.approval_id == null && entry.as_adjustment_entry && entry.reversal_of_id != null
				? [entry.reversal_of_id]
				: []
		)
	);
	for (const entry of input.entries) {
		if (
			entry.employment_id !== caseRow.employment_id ||
			entry.leave_code !== 'MATERNITY_LEAVE' ||
			entry.as_adjustment_entry ||
			reversedIds.has(entry.id)
		)
			continue;
		if (matchedIds.has(entry.id) && entry.payslip_id != null)
			refuse('An existing maternity payslip needs its saved case allocation before replanning.');
		if (
			!matchedIds.has(entry.id) &&
			(entry.charges ?? []).some((charge) => {
				const day = dateKey(charge.date);
				return day >= from && day <= through;
			})
		)
			refuse(
				'Every maternity charge in the case span needs the approved event identity and case allocation.'
			);
	}
	for (const slip of input.payslips) {
		if (slip.employment_id !== caseRow.employment_id || slip.paid_at == null) continue;
		const window = slip.salary_window;
		if (window == null)
			refuse(
				'A prior paid payslip needs its salary window before maternity cash can be allocated.'
			);
		if (dateKey(window.start) <= through && dateKey(window.end) >= from)
			refuse('Prior paid salary overlaps maternity leave without a saved case allocation.');
	}
	const assignedIds = new Set<string>();
	const entries = new Map(input.entries.map((row) => [row.id, row]));
	const cutoffs = input.cutoffs.map((cutoff) => {
		if (!(cutoff.premium_evidence_reference ?? '').trim() || cutoff.leave_entry_ids.length === 0)
			refuse('Each maternity cutoff needs premium evidence and approved leave entries.');
		const salaryFrom = dateKey(cutoff.salary.start);
		const salaryThrough = dateKey(cutoff.salary.end);
		if (!isCalendarDate(salaryFrom) || !isCalendarDate(salaryThrough) || salaryThrough < salaryFrom)
			refuse('A maternity cutoff needs an ordered salary window.');
		const covered = cutoff.leave_entry_ids
			.flatMap((id) => {
				if (!matchedIds.has(id) || assignedIds.has(id))
					refuse('Each approved maternity leave entry must belong to one cutoff.');
				assignedIds.add(id);
				return entries.get(id)?.charges?.map((charge) => dateKey(charge.date)) ?? [];
			})
			.toSorted();
		if (
			covered.length === 0 ||
			covered[0]! < salaryFrom ||
			covered.at(-1)! > salaryThrough ||
			covered.length !== daysBetween(covered[0]!, covered.at(-1)!).length ||
			daysBetween(covered[0]!, covered.at(-1)!).some((day, index) => day !== covered[index])
		)
			refuse('Maternity leave entries must cover exactly this cutoff’s consecutive salary days.');
		return {
			period: cutoff.period,
			from: covered[0]!,
			through: covered.at(-1)!,
			pay_on: cutoff.pay_on,
			employee_premiums: cutoff.employee_premiums
		};
	});
	if (assignedIds.size !== matchedIds.size)
		refuse('Every approved maternity leave entry must be assigned to a cutoff.');
	const employeeCash = input.movements
		.filter(
			(row) =>
				row.ph_maternity_case_id === caseRow.id &&
				(row.kind === 'SSS_ADVANCE' || row.kind === 'SALARY_DIFFERENTIAL')
		)
		.map((row) => ({
			kind: row.kind as 'SSS_ADVANCE' | 'SALARY_DIFFERENTIAL',
			paid_on: row.paid_on,
			amount: row.amount
		}));
	if (employeeCash.some((row) => dateKey(row.paid_on) > dateKey(input.as_of)))
		refuse('Future-dated maternity cash cannot fund a current payroll plan.');
	const allocation = allocatePhMaternityPay({
		leave_from: from,
		leave_through: through,
		monthly_salary: input.wage_basis.monthly_salary,
		actual_sss_award: caseRow.sss_award_amount,
		cutoffs,
		employee_cash: employeeCash
	});
	const advanceDue = addDays(dateKey(caseRow.application_on), 30);
	const firstPayday = dateKey(input.cutoffs[0]!.pay_on);
	const cashDeadline = advanceDue < firstPayday ? advanceDue : firstPayday;
	const cashByDeadline = (kind: 'SSS_ADVANCE' | 'SALARY_DIFFERENTIAL') =>
		Math.round(
			employeeCash
				.filter((row) => row.kind === kind && dateKey(row.paid_on) <= cashDeadline)
				.reduce((total, row) => total + decodeNumber(row.amount), 0) * 100
		) / 100;
	if (
		cashByDeadline('SSS_ADVANCE') < allocation.sss_award ||
		cashByDeadline('SALARY_DIFFERENTIAL') < allocation.employer_differential
	)
		refuse(
			'PH maternity full SSS advance and salary differential need actual employee payment evidence by the statutory deadline and before the first cutoff.'
		);
	if (
		Math.abs(
			decodeNumber(input.wage_basis.full_span_wage_period.normal_wages) - allocation.full_pay
		) > 0.001
	)
		refuse('Recorded full-span wages disagree with the DOLE monthly-salary formula.');
	return Object.freeze({
		case_id: caseRow.id,
		status: 'PROPOSED_NOT_SAVED' as const,
		cutoffs: Object.freeze(
			allocation.cutoffs.map((row, index) =>
				Object.freeze({
					...row,
					leave_entry_ids: Object.freeze([...input.cutoffs[index]!.leave_entry_ids]),
					monthly_salary_reference: input.wage_basis.monthly_salary_reference,
					full_span_wage_reference: input.wage_basis.full_span_wage_period.reference,
					premium_evidence_reference: input.cutoffs[index]!.premium_evidence_reference,
					rank_and_file_13th_basic_by_year: Object.freeze(row.rank_and_file_13th_basic_by_year)
				})
			)
		)
	});
}
