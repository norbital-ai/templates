import { refuse } from '../refuse.js';
import { decodeNumber } from '../wire.js';
import type { WorkspaceRow } from '../rows.js';

export type AssessmentFrequency = 'MONTHLY' | 'SEMI_MONTHLY' | 'WEEKLY';

type StatutoryChargeHistory = {
	readonly base: number;
	readonly ordinary: number | null;
	readonly employee: number;
	readonly employer: number;
};

export type StatutoryPeriodHistory = {
	readonly period: string;
	readonly frequency: AssessmentFrequency | null;
	readonly charges: Readonly<Record<string, StatutoryChargeHistory>>;
};

export type StatutoryHistorySummary = {
	readonly periods: number;
	readonly base: number;
	readonly ordinary: number;
	readonly employee: number;
	readonly employer: number;
	readonly triggered: boolean;
	readonly hasOpening: boolean;
	/** Whether every opening states the payroll periods and cadence its amounts represent. */
	readonly periodsRecorded: boolean;
};

type Opening = {
	readonly base: number;
	readonly ordinary?: number | null | undefined;
	readonly employee: number;
	readonly employer: number;
	readonly months?: number | null | undefined;
	readonly payroll_periods?: number | null | undefined;
	readonly payroll_frequency?: AssessmentFrequency | null | undefined;
};


const frequencyOf = (
	period: string,
	frequencies: ReadonlySet<string>
): AssessmentFrequency | null => {
	if (frequencies.size === 1) {
		const value = [...frequencies][0];
		if (value === 'MONTHLY' || value === 'SEMI_MONTHLY' || value === 'WEEKLY') return value;
	}
	return /^\d{4}-\d{2}$/.test(period) ? 'MONTHLY' : null;
};

/** Payroll periods of one cadence in a month; a week's is the version's weeks a month. */
const periodsPerMonth = (
	frequency: AssessmentFrequency,
	weeksPerMonth: (() => number) | undefined
): number =>
	frequency === 'MONTHLY'
		? 1
		: frequency === 'SEMI_MONTHLY'
			? 2
			: (weeksPerMonth ?? refuse('A weekly cadence needs the version’s weeks a month.'))();

const convertPeriods = (
	periods: number,
	from: AssessmentFrequency,
	to: AssessmentFrequency,
	weeksPerMonth: (() => number) | undefined
): number =>
	from === to
		? periods
		: (periods * periodsPerMonth(to, weeksPerMonth)) / periodsPerMonth(from, weeksPerMonth);

/** One paid assessment per person and payroll period, including all concurrent contracts. */
export function buildStatutoryHistory(options: {
	readonly payslips: readonly WorkspaceRow<'payslips'>[];
	readonly periodByRun: ReadonlyMap<string, string>;
	readonly employmentToEmployee: ReadonlyMap<string, string>;
	readonly inTaxYear: ReadonlySet<string>;
}): Map<string, readonly StatutoryPeriodHistory[]> {
	type Period = { charges: Record<string, StatutoryChargeHistory>; frequencies: Set<string> };
	const people = new Map<string, Map<string, Period>>();
	for (const slip of options.payslips) {
		if (slip.status !== 'PAID' || !options.inTaxYear.has(slip.payroll_run_id)) continue;
		const period = options.periodByRun.get(slip.payroll_run_id);
		const employee = options.employmentToEmployee.get(slip.employment_id);
		if (period == null || employee == null) continue;
		let periods = people.get(employee);
		if (!periods) {
			periods = new Map();
			people.set(employee, periods);
		}
		let entry = periods.get(period);
		if (!entry) {
			entry = { charges: {}, frequencies: new Set() };
			periods.set(period, entry);
		}
		for (const line of slip.statutory) {
			if (line.assessment_frequency != null) entry.frequencies.add(line.assessment_frequency);
			const prior = entry.charges[line.scheme_code];
			const ordinary = line.ordinary_amount == null ? null : line.ordinary_amount;
			entry.charges[line.scheme_code] = {
				base: (prior?.base ?? 0) + line.base_amount,
				ordinary:
					prior?.ordinary === null || ordinary === null ? null : (prior?.ordinary ?? 0) + ordinary,
				employee: (prior?.employee ?? 0) + line.employee_amount - (line.directed_amount ?? 0),
				employer: (prior?.employer ?? 0) + line.employer_amount
			};
		}
	}
	return new Map(
		[...people].map(([employee, periods]) => [
			employee,
			[...periods]
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([period, entry]) => ({
					period,
					frequency: frequencyOf(period, entry.frequencies),
					charges: entry.charges
				}))
		])
	);
}

type HistoryTrigger = NonNullable<WorkspaceRow<'statutory_contributions'>['history_trigger']>;

/**
 * Cumulative history, converted to the cadence of the assessment being calculated. `triggered` is
 * set only for a scheme that declares a `history_trigger`, from that scheme's own prior charges.
 */
export function cumulativeHistory(options: {
	readonly periods: readonly StatutoryPeriodHistory[];
	readonly openings: ReadonlyMap<string, Opening>;
	readonly frequency: AssessmentFrequency;
	/** The version's weeks a month (`work_rules.rate_conversions.weekly_to_monthly`), read only to convert a weekly cadence. */
	readonly weeksPerMonth?: (() => number) | undefined;
	/** Codes whose `history.<code>.periods` the catalogue reads; their openings must state a cadence. */
	readonly requirePeriodsFor?: ReadonlySet<string> | undefined;
	/** The schemes that declare a trigger, by code. */
	readonly triggers?: ReadonlyMap<string, HistoryTrigger> | undefined;
}): ReadonlyMap<string, StatutoryHistorySummary> {
	const codes = new Set([
		...options.openings.keys(),
		...options.periods.flatMap((period) => Object.keys(period.charges))
	]);
	const triggeredFor = (code: string): boolean => {
		const trigger = options.triggers?.get(code);
		if (trigger == null) return false;
		let triggered = false;
		for (const period of options.periods) {
			const charge = period.charges[code];
			if (charge == null) continue;
			const frequency = period.frequency;
			if (frequency == null)
				refuse(`${period.period}: record the payroll cadence on the settled statutory assessment.`);
			const deductions = trigger.less_employee_of.reduce(
				(total, other) => total + (period.charges[other]?.employee ?? 0),
				0
			);
			const total = Math.max(0, charge.base - deductions);
			const ordinary = Math.max(0, (charge.ordinary ?? charge.base) - deductions);
			const supplementary = Math.max(0, total - ordinary);
			const threshold = trigger.ordinary_threshold[frequency];
			triggered ||=
				(ordinary <= threshold && supplementary > 0) ||
				(supplementary > 0 && supplementary >= ordinary);
		}
		return triggered;
	};
	return new Map(
		[...codes].map((code) => {
			const opening = options.openings.get(code);
			const needsPeriods = options.requirePeriodsFor?.has(code) ?? false;
			let periods = 0;
			let periodsRecorded = true;
			let base = opening?.base ?? 0;
			let ordinary = opening == null ? 0 : (opening.ordinary ?? opening.base);
			let employee = opening?.employee ?? 0;
			let employer = opening?.employer ?? 0;
			if (opening != null) {
				const sourceFrequency =
					opening.payroll_frequency ?? (opening.months != null ? 'MONTHLY' : null);
				const sourcePeriods = opening.payroll_periods ?? opening.months;
				const usable = sourceFrequency != null && sourcePeriods != null && sourcePeriods > 0;
				periodsRecorded &&= usable;
				if (usable) periods += convertPeriods(
						sourcePeriods,
						sourceFrequency,
						options.frequency,
						options.weeksPerMonth
					);
			}
			for (const period of options.periods) {
				if (needsPeriods) {
					const frequency = period.frequency;
					if (frequency == null)
						refuse(
							`${period.period}: record the payroll cadence on the settled statutory assessment.`
						);
					periods += convertPeriods(1, frequency, options.frequency, options.weeksPerMonth);
				}
				const charge = period.charges[code];
				if (charge == null) continue;
				base += charge.base;
				ordinary += charge.ordinary ?? charge.base;
				employee += charge.employee;
				employer += charge.employer;
			}
			return [
				code,
				{
					periods,
					base,
					ordinary,
					employee,
					employer,
					triggered: triggeredFor(code),
					hasOpening: opening != null,
					periodsRecorded
				}
			] as const;
		})
	);
}
