// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * What a run settled, as the tests read it.
 *
 * A single-use source (work day, claim, payment) carries `settled_payslip_id` and `settled_period`;
 * the run's `after` hook stamps them once the payslips exist, and `buildPayrollRun` hands the same
 * lists back as `captures`. These helpers are the two ends of that: read what a build captured, and
 * put a world into the state a prior run would have left it in.
 */
import { Effect } from 'effect';
import payrollRunHooks from '../../src/collections/payroll_runs/+hooks.ts';
import { memoryPayrollApi } from '../fixtures/memory-payroll-api.ts';

export const NO_CAPTURES = { workDays: [], claims: [], payments: [] };

/** The single-use sources one payslip of a build settled. */
export const capturesOf = (built, slip) =>
	built.captures.find((capture) => capture.payslipId === slip?.id) ?? {
		payslipId: slip?.id,
		...NO_CAPTURES
	};

/** Mark one source row as settled by a payslip, the way a prior run's `after` hook would have. */
export function settle(world, source, id, payslipId, period = '2026-01') {
	const row = world[source].find((candidate) => candidate.id === id);
	if (row == null) throw new Error(`${source} ${id} is not in the world`);
	row.settled_payslip_id = payslipId;
	row.settled_period = period;
}

/** Clear every settlement pin on a source collection, the way deleting the draft run would. */
export function release(world, source) {
	for (const row of world[source]) {
		row.settled_payslip_id = null;
		row.settled_period = null;
	}
}

/** Add an adjustment to a prior payslip, creating the payslip row when the test has not. */
export function adjust(world, payslipId, adjustment, runId = 'prior-run') {
	let slip = world.payslips.find((row) => row.id === payslipId);
	if (slip == null) {
		slip = {
			id: payslipId,
			payroll_run_id: runId,
			employment_id: world.employments[0].id,
			statutory: [],
			adjustments: [],
			approval_id: null
		};
		world.payslips.push(slip);
	}
	slip.adjustments ??= [];
	slip.adjustments.push({
		label: adjustment.family,
		bucket: 'EARNING',
		quantity: null,
		rate: null,
		statutory_rule_key: null,
		...adjustment
	});
}

/** Run the run hook's `after` phase against a world: stamps the sources the create captured. */
export const stampRun = (world, created, runId = 'run') =>
	Effect.runPromise(
		payrollRunHooks.mutate.perRecord.after.handler({
			previous: undefined,
			changes: {},
			record: { id: runId, company_id: created.company_id, period: created.period },
			api: memoryPayrollApi(world)
		})
	);

/** The ids of one source collection a payslip settled, read off the world. */
export const settledBy = (world, source, payslipId) =>
	world[source].filter((row) => row.settled_payslip_id === payslipId).map((row) => row.id);
