import { dateKey, isCalendarDate } from '../iso-day.js';
import { addDays } from '../payroll/run/dates.js';
import { readRange } from '../payroll/run/effective.js';
import type { PayrollWorld } from '../payroll/world.js';
import { readAll, type Reads } from '../reads.js';
import { refuse } from '../refuse.js';
import type { WorkspaceRow } from '../rows.js';
import { hasPhSoloParentDocument } from './maternity-reconciliation.js';

type Case = WorkspaceRow<'ph_maternity_cases'>;
type Movement = Pick<
	WorkspaceRow<'ph_maternity_movements'>,
	'ph_maternity_case_id' | 'kind' | 'planned_leave_span_at_payment'
>;
type Paying = {
	readonly employment_id: string;
	readonly salary: { readonly start: string; readonly end: string };
};

/** Recheck historical maternity approvals against event identity, continuous days and the solo-parent extension. */
export function phMaternityLeaveUnsafe(input: {
	readonly entries: PayrollWorld['leave_entries'];
	readonly cases: readonly Case[];
	readonly paying: readonly Paying[];
}): boolean {
	const reversed = new Set(
		input.entries.flatMap((row) =>
			row.approval_id == null && row.as_adjustment_entry && row.reversal_of_id != null
				? [row.reversal_of_id]
				: []
		)
	);
	const events = new Map<string, Map<string, { count: number; days: number }>>();
	for (const entry of input.entries) {
		if (
			entry.leave_code !== 'MATERNITY_LEAVE' ||
			entry.approval_id != null ||
			entry.as_adjustment_entry ||
			reversed.has(entry.id)
		)
			continue;
		const eventDay = dateKey(entry.event_date);
		if (
			!['BIRTH', 'MISCARRIAGE', 'EMERGENCY_TERMINATION'].includes(entry.event_kind ?? '') ||
			!isCalendarDate(eventDay)
		) {
			if (
				input.paying.some(
					(pay) =>
						pay.employment_id === entry.employment_id &&
						entry.charges.some(
							(charge) => charge.date >= pay.salary.start && charge.date <= pay.salary.end
						)
				)
			)
				return true;
			continue;
		}
		const key = `${entry.employment_id}:${entry.event_kind}:${eventDay}`;
		const dates = events.get(key) ?? new Map<string, { count: number; days: number }>();
		for (const charge of entry.charges) {
			const day = dateKey(charge.date);
			const prior = dates.get(day) ?? { count: 0, days: 0 };
			dates.set(day, { count: prior.count + 1, days: prior.days + charge.days });
		}
		events.set(key, dates);
	}
	for (const pay of input.paying) {
		for (const [key, dates] of events) {
			const split = key.lastIndexOf(':');
			const kindSplit = key.lastIndexOf(':', split - 1);
			const employmentId = key.slice(0, kindSplit);
			const eventKind = key.slice(kindSplit + 1, split);
			const eventDay = key.slice(split + 1);
			if (employmentId !== pay.employment_id) continue;
			const ordered = [...dates.keys()].toSorted();
			const inSalary = (day: string) => day >= pay.salary.start && day <= pay.salary.end;
			if (
				ordered.some((day) => {
					const charge = dates.get(day)!;
					return inSalary(day) && (charge.count !== 1 || charge.days !== 1);
				}) ||
				ordered.some(
					(day, index) => index > 0 && inSalary(day) && day !== addDays(ordered[index - 1]!, 1)
				)
			)
				return true;
			if (eventKind !== 'BIRTH') {
				if (ordered.some(inSalary) && ordered[0] !== eventDay) return true;
				if (ordered.slice(60).some(inSalary)) return true;
				continue;
			}
			if (ordered.slice(120).some(inSalary)) return true;
			if (!ordered.slice(105, 120).some(inSalary)) continue;
			const caseRow = input.cases.find(
				(row) =>
					row.employment_id === employmentId &&
					row.event_kind === 'BIRTH' &&
					dateKey(row.event_on) === eventDay
			);
			if (caseRow == null || !hasPhSoloParentDocument(caseRow)) return true;
		}
	}
	return false;
}

/** A prior maternity cash transfer cannot be added to the unchanged full BASIC payslip. */
export function maternityCashConflictsWithPayroll(input: {
	readonly entries: PayrollWorld['leave_entries'];
	readonly cases: readonly Case[];
	readonly movements: readonly Movement[];
	readonly paying: readonly Paying[];
}): boolean {
	const cash = input.movements.filter(
		(row) => row.kind === 'SSS_ADVANCE' || row.kind === 'SALARY_DIFFERENTIAL'
	);
	const cashCaseIds = new Set(cash.map((row) => row.ph_maternity_case_id));
	if (cashCaseIds.size === 0) return false;
	const reversed = new Set(
		input.entries.flatMap((row) =>
			row.approval_id == null && row.as_adjustment_entry && row.reversal_of_id != null
				? [row.reversal_of_id]
				: []
		)
	);
	const charged = input.entries.filter(
		(row) =>
			row.leave_code === 'MATERNITY_LEAVE' &&
			row.approval_id == null &&
			row.payslip_id == null &&
			!row.as_adjustment_entry &&
			!reversed.has(row.id)
	);
	return input.cases.some(
		(caseRow) =>
			cashCaseIds.has(caseRow.id) &&
			input.paying.some((pay) => {
				if (pay.employment_id !== caseRow.employment_id) return false;
				const from = dateKey(caseRow.leave_from);
				const through = dateKey(caseRow.leave_through);
				if (from === '' || through === '') return true;
				if (
					(from <= pay.salary.end && through >= pay.salary.start) ||
					cash.some((row) => {
						if (row.ph_maternity_case_id !== caseRow.id) return false;
						const snapshot = readRange(row.planned_leave_span_at_payment);
						return (
							snapshot != null &&
							dateKey(snapshot.start) <= pay.salary.end &&
							dateKey(snapshot.end) >= pay.salary.start
						);
					})
				)
					return true;
				return charged.some(
					(entry) =>
						entry.employment_id === caseRow.employment_id &&
						entry.event_kind != null &&
						entry.event_kind === caseRow.event_kind &&
						dateKey(entry.event_date) !== '' &&
						dateKey(entry.event_date) === dateKey(caseRow.event_on) &&
						entry.charges.some(
							(charge) => charge.date >= pay.salary.start && charge.date <= pay.salary.end
						)
				);
			})
	);
}

/** Ordinary BASIC cannot settle an approved maternity day without its case-priced allocation. */
export function unallocatedPhMaternityLeave(input: {
	readonly entries: PayrollWorld['leave_entries'];
	readonly paying: readonly Paying[];
}): boolean {
	const reversed = new Set(
		input.entries.flatMap((row) =>
			row.approval_id == null && row.as_adjustment_entry && row.reversal_of_id != null
				? [row.reversal_of_id]
				: []
		)
	);
	return input.entries.some(
		(entry) =>
			entry.leave_code === 'MATERNITY_LEAVE' &&
			entry.approval_id == null &&
			entry.payslip_id == null &&
			!entry.as_adjustment_entry &&
			!reversed.has(entry.id) &&
			input.paying.some(
				(pay) =>
					pay.employment_id === entry.employment_id &&
					entry.charges.some((charge) => {
						const day = dateKey(charge.date);
						return day >= pay.salary.start && day <= pay.salary.end;
					})
			)
	);
}

/** Read only PH cash evidence; no other jurisdiction pays or stores these movements. */
export async function assertPhMaternityPayrollCashSafe(
	db: Reads,
	world: PayrollWorld,
	paying: readonly Paying[]
): Promise<void> {
	if (world.companies[0]?.settings_code !== 'PH') return;
	const employmentIds = [...new Set(paying.map((row) => row.employment_id))];
	if (employmentIds.length === 0) return;
	const cases = await readAll<WorkspaceRow<'ph_maternity_cases'>>(db, 'ph_maternity_cases', {
		employment_id: { in: employmentIds }
	});
	if (phMaternityLeaveUnsafe({ entries: world.leave_entries, cases, paying }))
		refuse(
			'PH maternity leave cannot settle missing event evidence, duplicate, fractional or gapped calendar charges, excess days, or a birth extension without a matching solo-parent LGU document.'
		);
	if (unallocatedPhMaternityLeave({ entries: world.leave_entries, paying }))
		refuse(
			'PH maternity leave needs a saved case-priced SSS and salary-differential allocation before ordinary BASIC can settle its days.'
		);
	if (cases.length === 0) return;
	const movements = await readAll<WorkspaceRow<'ph_maternity_movements'>>(
		db,
		'ph_maternity_movements',
		{ ph_maternity_case_id: { in: cases.map((row) => row.id) } }
	);
	if (
		maternityCashConflictsWithPayroll({
			entries: world.leave_entries,
			cases,
			movements,
			paying
		})
	)
		refuse(
			'PH maternity cash was already paid outside payroll. Record the planned leave span and reconcile that cash with full BASIC before this payroll can settle.'
		);
}
