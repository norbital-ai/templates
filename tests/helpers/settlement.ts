// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * What a run settled, as the tests read it.
 *
 * A source row carries a nullable `payslip_id`; the run's transform pins it as a `link` action on
 * the payslip in the same write that creates the payslips, and `buildPayrollRun` hands the same
 * lists back as `captures`. These helpers are the two ends of that: read what a build captured,
 * and put a world into the state a prior run would have left it in.
 */
import { Effect } from 'effect';
import payrollRuns from '../../src/collections/payroll_runs/+collection.ts';
import { memoryPayrollApi } from '../fixtures/memory-payroll-api.ts';

/** The run's transform over a world: the payload the runtime would commit, one run at a time. */
export const createRun = (world, period, companyId = world.companies[0].id) =>
	Effect.runPromise(
		payrollRuns.transform([{ company_id: companyId, period }], {
			existing: [undefined],
			db: memoryPayrollApi(world).db
		})
	).then((payloads) => payloads[0]);

/** The relation actions a payslip carries, keyed by the source family they pin or create. */
const PIN_FAMILIES = {
	work_day_payslip: 'work_days',
	claim_request_payslip: 'claim_requests',
	adhoc_request_payslip: 'adhoc_requests',
	leave_entry_payslip: 'leave_entries',
	loan_repayment_payslip: 'loan_repayments'
};

/**
 * Store a run's payload the way the database would hold it: the run row, its payslips and every
 * pinned source stamped with its slip.
 */
export function storeRun(world, payload, runId = crypto.randomUUID()) {
	const { payslip_payroll_run: nested, ...run } = payload;
	const stored = { id: runId, ...run };
	world.payroll_runs.push(stored);
	for (const entry of nested?.create ?? []) {
		const slip = { ...entry, payroll_run_id: runId };
		for (const [relation, source] of Object.entries(PIN_FAMILIES)) {
			const actions = slip[relation] ?? {};
			delete slip[relation];
			for (const { id } of actions.link ?? []) settle(world, source, id, slip.id);
			for (const row of actions.create ?? [])
				(world[source] ??= []).push({ approval_id: null, ...row, payslip_id: slip.id });
		}
		world.payslips.push({ approval_id: null, ...slip });
	}
	return stored;
}

/** The payslips of a payload, as rows without their relation actions. */
export const payslipsOf = (payload) =>
	(payload.payslip_payroll_run?.create ?? []).map((slip) => {
		const row = { ...slip };
		for (const relation of Object.keys(PIN_FAMILIES)) delete row[relation];
		return row;
	});

export const NO_CAPTURES = {
	workDays: [],
	claims: [],
	adhoc: [],
	leave: [],
	loanRepayments: [],
	wagePeriods: []
};

/** The sources one payslip of a build settled. */
export const capturesOf = (built, slip) =>
	built.captures.find((capture) => capture.payslipId === slip?.id) ?? {
		payslipId: slip?.id,
		...NO_CAPTURES
	};

/** Mark one source row as settled by a payslip, the way a prior run's `after` hook would have. */
export function settle(world, source, id, payslipId) {
	const row = world[source].find((candidate) => candidate.id === id);
	if (row == null) throw new Error(`${source} ${id} is not in the world`);
	row.payslip_id = payslipId;
}

/** Clear every settlement pin on a source collection, the way deleting the draft run would. */
export function release(world, source) {
	for (const row of world[source]) row.payslip_id = null;
}

/** Add an adjustment to a prior payslip, creating the payslip row when the test has not. */
export function adjust(world, payslipId, adjustment, runId = 'prior-run') {
	let slip = world.payslips.find((row) => row.id === payslipId);
	if (slip == null) {
		slip = {
			id: payslipId,
			payroll_run_id: runId,
			employment_id: world.employments[0].id,
			status: 'DRAFT',
			base: [],
			proration: [],
			statutory: [],
			adjustments: [],
			approval_id: null
		};
		world.payslips.push(slip);
	}
	slip.adjustments ??= [];
	slip.adjustments.push({
		component_code: adjustment.family,
		label: adjustment.family,
		bucket: 'EARNING',
		quantity: null,
		rate: null,
		statutory_rule_key: null,
		...adjustment
	});
}

/** The ids of one source collection a payslip settled, read off the world. */
export const settledBy = (world, source, payslipId) =>
	world[source].filter((row) => row.payslip_id === payslipId).map((row) => row.id);
