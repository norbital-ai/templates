import type { BenefitCaseType } from '../datatypes/payroll_settings.js';
import { dateKey, isCalendarDate } from '../iso-day.js';
import { settingsInForce } from '../jurisdiction_settings.js';
import { addDays } from '../payroll/run/dates.js';
import { readRange } from '../payroll/run/effective.js';
import type { PayrollWorld } from '../payroll/world.js';
import { readAll, type Reads } from '../reads.js';
import { refuse } from '../refuse.js';
import type { WorkspaceRow } from '../rows.js';
import {
	caseSite,
	caseTypesOf,
	compensableDays,
	employeePaymentKinds,
	evidenceOf,
	readCaseEvidence,
	type CaseEvidence
} from './benefit.js';
import { reversedIds } from './reconciliation.js';

type Case = Pick<
	WorkspaceRow<'benefit_cases'>,
	'id' | 'employment_id' | 'case_type' | 'event_kind' | 'event_on' | 'leave_from' | 'leave_through'
> & { readonly facts?: Readonly<Record<string, unknown>> | null };
type Movement = Pick<
	WorkspaceRow<'benefit_case_movements'>,
	'benefit_case_id' | 'kind' | 'planned_leave_span_at_payment'
>;
type Evidence = CaseEvidence & { readonly subject: unknown };
type Paying = {
	readonly employment_id: string;
	readonly salary: { readonly start: string; readonly end: string };
};
type Entries = PayrollWorld['leave_entries'];

/**
 * Recheck historical approvals of a case type's leave against event identity, continuous single
 * days and the event's compensable days, which the matching case's facts decide (an extension
 * counts only with its qualification proven); an event without a case reads the declared defaults.
 */
export function benefitLeaveUnsafe(input: {
	readonly case_types: readonly BenefitCaseType[];
	readonly entries: Entries;
	readonly cases: readonly Case[];
	readonly evidence?: readonly Evidence[] | undefined;
	readonly paying: readonly Paying[];
}): boolean {
	const typeOf = new Map(input.case_types.map((row) => [row.case_type, row]));
	const reversed = reversedIds(input.entries);
	const events = new Map<
		string,
		{
			readonly type: BenefitCaseType;
			readonly employmentId: string;
			readonly kind: string;
			readonly day: string;
			readonly dates: Map<string, { count: number; days: number }>;
		}
	>();
	for (const entry of input.entries) {
		const type = typeOf.get(entry.leave_code);
		if (
			type == null ||
			entry.approval_id != null ||
			entry.as_adjustment_entry ||
			reversed.has(entry.id)
		)
			continue;
		const eventDay = dateKey(entry.event_date);
		if (!type.event_kinds.includes(entry.event_kind ?? '') || !isCalendarDate(eventDay)) {
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
		const key = `${entry.employment_id}:${entry.leave_code}:${entry.event_kind}:${eventDay}`;
		const event = events.get(key) ?? {
			type,
			employmentId: entry.employment_id,
			kind: entry.event_kind!,
			day: eventDay,
			dates: new Map<string, { count: number; days: number }>()
		};
		for (const charge of entry.charges) {
			const day = dateKey(charge.date);
			const prior = event.dates.get(day) ?? { count: 0, days: 0 };
			event.dates.set(day, { count: prior.count + 1, days: prior.days + charge.days });
		}
		events.set(key, event);
	}
	for (const pay of input.paying) {
		for (const event of events.values()) {
			if (event.employmentId !== pay.employment_id) continue;
			const ordered = [...event.dates.keys()].toSorted();
			const inSalary = (day: string) => day >= pay.salary.start && day <= pay.salary.end;
			if (
				ordered.some((day) => {
					const charge = event.dates.get(day)!;
					return inSalary(day) && (charge.count !== 1 || charge.days !== 1);
				}) ||
				ordered.some(
					(day, index) => index > 0 && inSalary(day) && day !== addDays(ordered[index - 1]!, 1)
				)
			)
				return true;
			const caseRow = input.cases.find(
				(row) =>
					row.employment_id === event.employmentId &&
					row.case_type === event.type.case_type &&
					row.event_kind === event.kind &&
					dateKey(row.event_on) === event.day
			);
			const site = caseSite(
				event.type,
				caseRow ?? { event_kind: event.kind, event_on: event.day },
				caseRow == null ? [] : evidenceOf(input.evidence ?? [], caseRow.id)
			);
			const days = compensableDays(event.type, site);
			// Leave that must all fall after the event starts on it.
			if (
				event.type.min_days_after_event >= days &&
				ordered.some(inSalary) &&
				ordered[0] !== event.day
			)
				return true;
			if (ordered.slice(days).some(inSalary)) return true;
		}
	}
	return false;
}

/** A prior benefit cash transfer cannot be added to the unchanged full BASIC payslip. */
export function benefitCashConflictsWithPayroll(input: {
	readonly case_types: readonly BenefitCaseType[];
	readonly entries: Entries;
	readonly cases: readonly Case[];
	readonly movements: readonly Movement[];
	readonly paying: readonly Paying[];
}): boolean {
	const paidKinds = new Map(
		input.case_types.map((type) => [type.case_type, new Set(employeePaymentKinds(type))])
	);
	const caseById = new Map(input.cases.map((row) => [row.id, row]));
	const cash = input.movements.filter((row) => {
		const caseRow = caseById.get(row.benefit_case_id);
		return caseRow != null && paidKinds.get(caseRow.case_type)?.has(row.kind) === true;
	});
	const cashCaseIds = new Set(cash.map((row) => row.benefit_case_id));
	if (cashCaseIds.size === 0) return false;
	const reversed = reversedIds(input.entries);
	const charged = input.entries.filter(
		(row) =>
			paidKinds.has(row.leave_code) &&
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
						if (row.benefit_case_id !== caseRow.id) return false;
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
						entry.leave_code === caseRow.case_type &&
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

/** Ordinary BASIC cannot settle an approved case-type day without its case-priced allocation. */
export function unallocatedBenefitLeave(input: {
	readonly case_types: readonly BenefitCaseType[];
	readonly entries: Entries;
	readonly paying: readonly Paying[];
}): boolean {
	const codes = new Set(input.case_types.map((type) => type.case_type));
	const reversed = reversedIds(input.entries);
	return input.entries.some(
		(entry) =>
			codes.has(entry.leave_code) &&
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

/**
 * The case types in force for this run's salary windows; a lineage that declares none reads no
 * case and stores no movement, so its payroll is untouched.
 */
export async function assertBenefitCasePayrollCashSafe(
	db: Reads,
	world: PayrollWorld,
	paying: readonly Paying[]
): Promise<void> {
	const company = world.companies[0];
	if (company == null || paying.length === 0) return;
	const caseTypes = [
		...new Map(
			paying
				.flatMap((pay) =>
					caseTypesOf(
						settingsInForce(world.jurisdiction_settings, company.settings_code, pay.salary.start)
					)
				)
				.map((type) => [type.case_type, type] as const)
		).values()
	];
	if (caseTypes.length === 0) return;
	const employmentIds = [...new Set(paying.map((row) => row.employment_id))];
	const cases = await readAll<Case>(db, 'benefit_cases', {
		employment_id: { in: employmentIds },
		case_type: { in: caseTypes.map((type) => type.case_type) }
	});
	const evidence = await readCaseEvidence(
		db,
		cases.map((row) => row.id)
	);
	if (
		benefitLeaveUnsafe({
			case_types: caseTypes,
			entries: world.leave_entries,
			cases,
			evidence,
			paying
		})
	)
		refuse(
			'Benefit-case leave cannot settle missing event evidence, duplicate, fractional or gapped calendar charges, days beyond the event’s compensable days, or an extension its case does not prove.'
		);
	if (unallocatedBenefitLeave({ case_types: caseTypes, entries: world.leave_entries, paying }))
		refuse(
			'Benefit-case leave needs a saved case-priced award and salary-differential allocation before ordinary BASIC can settle its days.'
		);
	if (cases.length === 0) return;
	const movements = await readAll<Movement>(db, 'benefit_case_movements', {
		benefit_case_id: { in: cases.map((row) => row.id) }
	});
	if (
		benefitCashConflictsWithPayroll({
			case_types: caseTypes,
			entries: world.leave_entries,
			cases,
			movements,
			paying
		})
	)
		refuse(
			'Benefit-case cash was already paid outside payroll. Record the planned leave span and reconcile that cash with full BASIC before this payroll can settle.'
		);
}
