import { companyPeriods, periodInCompanyGrammar } from './calendar.js';
import { shiftPeriod } from '../payroll/run/dates.js';

/** The recorded regular history anchors the payroll timeline; ad hoc runs do not complete a cycle. */
export function payrollCycleScope(input: {
	readonly today: string;
	readonly frequency: string;
	readonly commencement?: string;
	readonly evidenceDate?: string;
	readonly runs: readonly { id: string; period: string; kind: string | null }[];
	readonly slips: readonly { payroll_run_id: string; status: unknown }[];
}) {
	const regular = input.runs.filter((run) => (run.kind ?? 'REGULAR') === 'REGULAR');
	const evidencePeriod =
		input.evidenceDate == null
			? []
			: [
					periodInCompanyGrammar(
						input.evidenceDate.slice(0, 7),
						input.frequency,
						input.evidenceDate
					)
				];
	const first =
		[...regular.map((run) => run.period), ...evidencePeriod].toSorted()[0] ??
		periodInCompanyGrammar(
			(input.evidenceDate ?? input.commencement ?? input.today).slice(0, 7),
			input.frequency,
			input.evidenceDate ?? input.commencement ?? input.today
		);
	const lastMonth = [
		first.slice(0, 7),
		shiftPeriod(input.today.slice(0, 7), 12),
		...input.runs.map((run) => run.period.slice(0, 7))
	]
		.toSorted()
		.at(-1)!;
	const months: string[] = [];
	for (let month = first.slice(0, 7); month <= lastMonth; month = shiftPeriod(month, 1))
		months.push(month);
	const periods = companyPeriods(months, input.frequency).filter((period) => period >= first);
	const complete = new Set(
		regular
			.filter((run) => {
				const own = input.slips.filter((slip) => slip.payroll_run_id === run.id);
				return own.length > 0 && own.every((slip) => slip.status === 'PAID');
			})
			.map((run) => run.period)
	);
	const recorded = new Set(regular.map((run) => run.period));
	return {
		periods,
		next: periods.find((period) => !complete.has(period)) ?? first,
		available: periods.filter((period) => !recorded.has(period))
	};
}
