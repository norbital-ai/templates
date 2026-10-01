/**
 * A pay cycle is one company's period: its REGULAR run first, then every other run of the period (OFF_CYCLE, EARLY,
 * FINAL, CORRECTION) in sequence order. A cycle's totals sum each payslip once, and its headcount counts each person
 * once however many of its runs paid them.
 */

type CycleRun = {
	readonly id: string;
	readonly company_id: string;
	readonly period: string;
	readonly kind: string | null;
	readonly sequence: number | null;
};

type CycleSlip = {
	readonly id: string;
	readonly payroll_run_id: string;
	readonly employment_id: string;
	readonly gross: number;
	readonly net: number;
	readonly employer_cost: number;
};

export type CycleTotals = {
	readonly gross: number;
	readonly net: number;
	readonly employerCost: number;
	readonly headcount: number;
	readonly slips: number;
};

const isRegular = (run: CycleRun) => (run.kind ?? 'REGULAR') === 'REGULAR';

/** Each payslip summed once (by id), each person counted once (by employment). */
export function slipTotals(slips: readonly CycleSlip[]): CycleTotals {
	const once = [...new Map(slips.map((slip) => [slip.id, slip])).values()];
	const sum = (pick: (slip: CycleSlip) => number) =>
		once.reduce((total, slip) => total + pick(slip), 0);
	return {
		gross: sum((slip) => slip.gross),
		net: sum((slip) => slip.net),
		employerCost: sum((slip) => slip.employer_cost),
		headcount: new Set(once.map((slip) => slip.employment_id)).size,
		slips: once.length
	};
}

/** The runs grouped by company and period, newest period first; each cycle's REGULAR run leads. */
export function payCycles<R extends CycleRun, S extends CycleSlip>(
	runs: readonly R[],
	slips: readonly S[]
) {
	const slipsOf = Map.groupBy(slips, (slip) => slip.payroll_run_id);
	return [...Map.groupBy(runs, (run) => `${run.company_id}:${run.period}`).values()]
		.map((own) => {
			const ordered = own.toSorted(
				(a, b) =>
					(isRegular(a) === isRegular(b) ? 0 : isRegular(a) ? -1 : 1) ||
					(a.sequence ?? 1) - (b.sequence ?? 1)
			);
			const cycleSlips = ordered.flatMap((run) => slipsOf.get(run.id) ?? []);
			return {
				company_id: ordered[0]!.company_id,
				period: ordered[0]!.period,
				regular: ordered.some(isRegular),
				runs: ordered.map((run) => ({ run, totals: slipTotals(slipsOf.get(run.id) ?? []) })),
				slips: cycleSlips,
				totals: slipTotals(cycleSlips)
			};
		})
		.toSorted((a, b) => b.period.localeCompare(a.period));
}

/**
 * Whether an off-cycle run paying this person now settles their salary early (an EARLY slip): the cycle has no
 * REGULAR run yet, and no EARLY or FINAL run of it has already settled them.
 */
export function settlesSalaryEarly(
	cycleRuns: readonly CycleRun[],
	cycleSlips: readonly CycleSlip[],
	employmentId: string
): boolean {
	if (cycleRuns.some(isRegular)) return false;
	const settled = new Set(
		cycleRuns.filter((run) => run.kind === 'EARLY' || run.kind === 'FINAL').map((run) => run.id)
	);
	return !cycleSlips.some(
		(slip) => slip.employment_id === employmentId && settled.has(slip.payroll_run_id)
	);
}

/**
 * The workbook's sheets with every company and period's runs combined into one sheet: a cycle export lists each
 * payslip once, under its period, and two runs of one period never ask for the same sheet name.
 */
export function combineCycleSheets<
	S extends {
		readonly runId: string;
		readonly period: string;
		readonly payslips: readonly unknown[];
		readonly bank: readonly unknown[];
		readonly skippedEmploymentIds: readonly string[];
	}
>(sheets: readonly S[], companyOf: (runId: string) => string): S[] {
	return [
		...Map.groupBy(
			[...new Map(sheets.map((sheet) => [sheet.runId, sheet])).values()],
			(sheet) => `${companyOf(sheet.runId)}:${sheet.period}`
		).values()
	].map((group) =>
		group.length === 1
			? group[0]!
			: {
					...group[0]!,
					payslips: group.flatMap((sheet) => sheet.payslips),
					bank: group.flatMap((sheet) => sheet.bank),
					skippedEmploymentIds: group.flatMap((sheet) => sheet.skippedEmploymentIds)
				}
	);
}
