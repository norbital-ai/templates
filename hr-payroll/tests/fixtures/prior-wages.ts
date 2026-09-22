// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import { COMPANY_ID } from './statutory-world.ts';
import type { PayrollWorld } from './memory-payroll-api.ts';

/**
 * Earlier payslips of one person, one BASIC line a month — the wage history a separation payment
 * that reads wages received (`employment.earned_monthly_average`, `average_monthly_wage`) needs.
 * `months` maps `YYYY-MM` to that month's paid wage; each month gets its own prior run.
 */
export function priorWages(
	world: PayrollWorld,
	key: string,
	months: Readonly<Record<string, number>>
): void {
	const employment = world.employments.find((row) => row.employee_number === key)!;
	for (const [month, amount] of Object.entries(months)) {
		const runId = `prior-wages-${month}`;
		if (!world.payroll_runs.some((run) => run.id === runId))
			world.payroll_runs.push({ id: runId, company_id: COMPANY_ID, period: month });
		world.payslips.push({
			id: `${runId}-${employment.id}`,
			payroll_run_id: runId,
			employment_id: employment.id,
			status: 'PAID',
			paid_at: `${month}-28T00:00:00.000Z`,
			base: [{ component_code: 'BASIC', amount }],
			proration: [],
			adjustments: [],
			statutory: []
		});
	}
}

/** Every month from `from` through `to` (`YYYY-MM`), each at the same wage. */
export function monthsAt(from: string, to: string, amount: number): Record<string, number> {
	const months: Record<string, number> = {};
	let [year, month] = from.split('-').map(Number);
	for (;;) {
		const key = `${year}-${String(month).padStart(2, '0')}`;
		months[key] = amount;
		if (key === to) return months;
		[year, month] = month === 12 ? [year + 1, 1] : [year, month + 1];
	}
}
