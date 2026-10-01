import { collection } from '@norbital-ai/bolt';
import { readPayrollWorlds } from '../../../lib/payroll/world.js';
import { plain } from '../../../lib/wire.js';
import { readAll } from '../../../lib/reads.js';
import { dateKey, isCalendarDate } from '../../../lib/iso-day.js';
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
	assertPayrollRunDeletable,
	nextRunSequence,
	RUN_KINDS,
	type RunKind
} from '../../../lib/payroll/run/period.js';
import { payrollRunPrecheck } from '../../../lib/payroll/run/precheck.js';
import { describeIssues } from '../../../lib/payroll/run/validate.js';
import { refuse } from '../../../lib/refuse.js';
import { assertBenefitCasePayrollCashSafe } from '../../../lib/benefit-cases/payroll-guard.js';

/**
 * A run is one write: a person chooses a company, a period, a kind, and optionally its contractual pay due
 * date (else the version's pay calendar dates it) and, for an OFF_CYCLE or CORRECTION run, the requests it pays. The transform derives the settlement date, the windows, the governing settings version, every payslip and the pin on every source each slip
 * consumed — so a caller has no way to assert a single figure. The population follows the kind (`population` in
 * `engine.ts`): a REGULAR run covers every eligible employment; individual cases are held per payslip (`ON_HOLD`).
 * The sequence is derived: one past the period's highest.
 *
 * A run is a frozen container (L-TPL-hr-payroll-131): no `update`, no state. Deleting a run is the settlement
 * lock's release, and the only one: its payslips go with it (owned) and their pins are released by `setNull`.
 * The delete guard below keeps a run with a paid slip, and unwinds drafts newest first.
 */
const c = collection('payroll_runs', {
	read: { fields: 'all' },
	create: { input: { columns: ['company_id', 'period', 'pay_due_date', 'kind', 'sources'] } },
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
	pay_due_date: dateKey(prepared.window.payDueDate),
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
		const slips = await readAll<{ readonly id: string }>(ctx.db, 'payslips', {
			payroll_run_id: { in: [...gone] }
		});
		const tranches = await readAll<{ readonly id: string }>(ctx.db, 'payable_tranches', {
			settlement: { payslips: { in: slips.map((row) => row.id) } }
		});
		const [allocated] = await readAll<{ readonly id: string }>(ctx.db, 'payment_allocations', {
			payable_tranche_id: { in: tranches.map((row) => row.id) }
		});
		if (allocated != null)
			ctx.refuse(
				'Someone in this payroll run has a partial payment, so the run is kept. Correct it in a later run.'
			);
		for (const run of deleting)
			assertPayrollRunDeletable(
				siblings.filter((other) => other.company_id === run.company_id && !gone.has(other.id)),
				run
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
		const payDueDate =
			input.pay_due_date == null || input.pay_due_date === ''
				? undefined
				: dateKey(input.pay_due_date);
		if (payDueDate !== undefined && !isCalendarDate(payDueDate))
			return ctx.refuse('Pay due date must be a real calendar day.', { field: 'pay_due_date' });
		const kind = (input.kind ?? 'REGULAR') as RunKind;
		if (!RUN_KINDS.includes(kind))
			return ctx.refuse(`Run kind must be one of ${RUN_KINDS.join(', ')}.`, { field: 'kind' });
		const sources = [...new Set(input.sources ?? [])];
		if (sources.length > 0 && (kind === 'REGULAR' || kind === 'FINAL'))
			return ctx.refuse(`A ${kind} run pays by its population, not by selected requests.`, {
				field: 'sources'
			});
		return { company_id: String(input.company_id), period, payDueDate, kind, sources };
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
			assertPayrollPeriodAvailable(world.payroll_runs, run.period, run.kind);
			const facts = gatherPayrollRun({
				world,
				companyId: run.company_id,
				period: run.period,
				payDueDate: run.payDueDate,
				kind: run.kind,
				sources: run.sources
			});
			await assertBenefitCasePayrollCashSafe(
				ctx.db,
				world,
				facts.gathered.bundles.flatMap((bundle) =>
					bundle.wageDays == null
						? []
						: [{ employment_id: bundle.employment.id, salary: bundle.window.salary }]
				)
			);
			const blocking = payrollRunPrecheck({
				configuration: facts.configuration,
				window: facts.window,
				bundles: facts.gathered.bundles
			});
			if (blocking.length > 0) refuse(describeIssues(blocking));
			const built = buildPayrollRun(facts);
			console.log(
				`[payroll-result] ${run.period} ${run.kind} payslips=${built.payslipCount} base=${built.baseCount} ` +
					`adjustments=${built.adjustmentCount} captured=${built.capturedCount}`
			);
			return {
				company_id: run.company_id,
				period: run.period,
				kind: run.kind,
				sequence: nextRunSequence(world.payroll_runs, run.period),
				...(run.sources.length === 0 ? {} : { sources: run.sources }),
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

type Stored = {
	readonly id: string;
	readonly company_id: string;
	readonly period: string;
	readonly sequence: number | null;
};

export default c;
