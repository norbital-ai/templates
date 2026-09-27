import { collection } from '@norbital-ai/bolt';
import { readPayrollWorlds } from '../../../lib/payroll/world.js';
import { plain } from '../../../lib/wire.js';
import { readAll } from '../../../lib/reads.js';
import { dateKey } from '../../../lib/iso-day.js';
import { configurationSnapshot } from '../../../lib/payroll/run/configuration.js';
import {
	buildPayrollRun,
	CALCULATION_VERSION,
	gatherPayrollRun,
	type PreparedRun
} from '../../../lib/payroll/run/engine.js';
import { payrollRunPayload } from '../../../lib/payroll/run/graph.js';
import {
	assertPayrollPeriodAvailable,
	assertPayrollRunDeletable
} from '../../../lib/payroll/run/period.js';
import { payrollRunPrecheck } from '../../../lib/payroll/run/precheck.js';
import { describeIssues } from '../../../lib/payroll/run/validate.js';
import { refuse } from '../../../lib/refuse.js';

/**
 * A run is one write: a person chooses a company and a period, and the transform derives everything else — the
 * pay date, the windows, the governing settings version, every payslip and the pin on every source each slip
 * consumed — so a caller has no way to assert a single figure. The population is not a choice: the run covers
 * every eligible employment; individual cases are held per payslip (`ON_HOLD`).
 *
 * A run is a frozen container (L-TPL-hr-payroll-131): no `update`, no state. Deleting a run is the settlement
 * lock's release, and the only one: its payslips go with it (owned) and their pins are released by `setNull`.
 * The delete guard below keeps a run with a paid slip, and unwinds drafts newest first.
 */
const c = collection('payroll_runs', {
	read: { fields: 'all' },
	create: { input: { columns: ['company_id', 'period'] } },
	delete: { transform: true }
});

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])(-[12])?$/;

/** The run's own derived columns, from the facts the gather resolved. */
const derivedColumns = async (prepared: PreparedRun) => ({
	configuration_hash: [
		...new Uint8Array(
			await crypto.subtle.digest(
				'SHA-256',
				new TextEncoder().encode(
					JSON.stringify(configurationSnapshot(prepared.configuration, prepared.period))
				)
			)
		)
	]
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join(''),
	holidays: prepared.configuration.holidaySnapshots,
	// The sealed version that governed this calculation, captured beside the configuration it is one half of.
	settings_id: prepared.configuration.jurisdiction.id,
	calculation_version: CALCULATION_VERSION,
	pay_date: dateKey(prepared.window.payDate),
	attendance_from: dateKey(prepared.window.attendance.start),
	attendance_to: dateKey(prepared.window.attendance.end)
});

c.transform(async (inputs, ctx) => {
	// Delete guard: drafts are unwound newest first, or a later run would cite inputs this delete releases.
	if (inputs.some((input) => '$delete' in input)) {
		const deleting = ctx.existing.flatMap((row) => (row == null ? [] : [plain(row) as Stored]));
		const companies = [...new Set(deleting.map((row) => row.company_id))];
		const siblings = await readAll<Stored>(ctx.db, 'payroll_runs', {
			company_id: { in: companies }
		});
		const gone = new Set(deleting.map((row) => row.id));
		const [paid] = await readAll<{ readonly payroll_run_id: string }>(ctx.db, 'payslips', {
			payroll_run_id: { in: [...gone] },
			status: { eq: 'PAID' }
		});
		if (paid != null)
			ctx.refuse(
				'Someone in this payroll run has been paid, so the run is kept. Correct it in a later run.'
			);
		for (const run of deleting)
			assertPayrollRunDeletable(
				siblings.filter((other) => other.company_id === run.company_id && !gone.has(other.id)),
				run.period
			);
		return inputs;
	}

	// A batch is one verb: past the delete guard every input is a create.
	const creates = inputs.flatMap((input) => ('$delete' in input ? [] : [input]));
	const runs = creates.map((input) => {
		const period = input.period ?? '';
		if (!PERIOD.test(period))
			return ctx.refuse(
				'Payroll period must be YYYY-MM, or YYYY-MM-1 / YYYY-MM-2 at a semi-monthly company.',
				{ field: 'period' }
			);
		return { company_id: String(input.company_id), period };
	});
	const companies = new Set<string>();
	for (const run of runs) {
		if (companies.has(run.company_id))
			refuse(
				'Create one payroll per company at a time so every run observes its prior settlement.'
			);
		companies.add(run.company_id);
	}
	// Two read waves, then every engine question is answered from memory.
	const worlds = await readPayrollWorlds(ctx.db, runs);
	return Promise.all(
		runs.map(async (run) => {
			const world = worlds.get(`${run.company_id}:${run.period}`)!;
			assertPayrollPeriodAvailable(world.payroll_runs, run.period);
			const facts = gatherPayrollRun({ world, companyId: run.company_id, period: run.period });
			const blocking = payrollRunPrecheck({
				configuration: facts.configuration,
				window: facts.window,
				bundles: facts.gathered.bundles
			});
			if (blocking.length > 0) refuse(describeIssues(blocking));
			const built = buildPayrollRun(facts);
			console.log(
				`[payroll-result] ${run.period} payslips=${built.payslipCount} base=${built.baseCount} ` +
					`adjustments=${built.adjustmentCount} captured=${built.capturedCount}`
			);
			return {
				...run,
				...(await derivedColumns(facts)),
				calculation_trace: built.calculation_trace,
				company_charges: built.company_charges,
				company_remittances: built.company_remittances,
				warnings: built.warnings.join('\n'),
				payslips: { create: payrollRunPayload(built) }
			} as never;
		})
	);
});

type Stored = { readonly id: string; readonly company_id: string; readonly period: string };

export default c;
