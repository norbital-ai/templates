import { collection } from '@norbital-ai/bolt';
import { readPayrollWorlds } from '../../../lib/payroll/world.js';
import { rerunProjection, rerunPayslips } from '../../../lib/payroll/run/rerun.js';
import type { WorkspaceRow } from '../../../lib/rows.js';
import { plain } from '../../../lib/wire.js';
import { readAll } from '../../../lib/reads.js';
import { dateKey, isCalendarDate } from '../../../lib/iso-day.js';
import { configurationSnapshot } from '../../../lib/payroll/run/configuration.js';
import {
	buildPayrollRun,
	CALCULATION_VERSION,
	gatherPayrollRun,
	withBuiltRun,
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
 * An empty update recalculates unpaid payslips on this same run, replacing their captures atomically.
 * Paid payslips retain every field and source pin. Deleting an unpaid run releases its owned payslips
 * and pins; both deletion and recalculation refuse later dependent runs or actual cash allocations.
 */
const c = collection('payroll_runs', {
	read: { fields: 'all' },
	create: { input: { columns: ['company_id', 'period', 'pay_due_date', 'kind', 'sources'] } },
	update: { input: { columns: [] } },
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

	if (ctx.existing.some((row) => row != null)) {
		if (inputs.length !== 1 || ctx.existing[0] == null)
			refuse('Recalculate one existing payroll run at a time.');
		const run = plain(ctx.existing[0]) as WorkspaceRow<'payroll_runs'>;
		const worlds = await readPayrollWorlds(ctx.db, [
			{ company_id: run.company_id, period: run.period }
		]);
		const world = worlds.get(`${run.company_id}:${run.period}`)!;
		const projection = rerunProjection(world, run);
		const ids = projection.unpaid.map((row) => row.id);
		const [wages, tranches, explanations] = await Promise.all([
			readAll<{ id: string; payslip_id: string }>(ctx.db, 'payslip_wage_periods', {
				payslip_id: { in: ids }
			}),
			readAll<{ id: string; settlement: { id: string } }>(ctx.db, 'payable_tranches', {
				settlement: { payslips: { in: ids } }
			}),
			readAll<{ id: string; payslip_id: string }>(
				ctx.db,
				'payslip_explanations',
				{
					payslip_id: { in: ids }
				},
				undefined,
				{ id: true, payslip_id: true }
			)
		]);
		const [allocated] = await readAll<{ id: string }>(ctx.db, 'payment_allocations', {
			payable_tranche_id: { in: tranches.map((row) => row.id) }
		});
		if (allocated != null)
			refuse('A payslip with an actual payment allocation cannot be recalculated.');
		const facts = gatherPayrollRun({
			world: projection.world,
			companyId: run.company_id,
			period: run.period,
			payDueDate: run.pay_due_date == null ? undefined : dateKey(run.pay_due_date),
			kind: run.kind as RunKind,
			sources: run.sources ?? []
		});
		const blocking = payrollRunPrecheck({
			configuration: facts.configuration,
			window: facts.window,
			bundles: facts.gathered.bundles
		});
		if (blocking.length > 0) refuse(describeIssues(blocking));
		await assertBenefitCasePayrollCashSafe(
			ctx.db,
			projection.world,
			facts.gathered.bundles.flatMap((bundle) =>
				bundle.wageDays == null
					? []
					: [{ employment_id: bundle.employment.id, salary: bundle.window.salary }]
			)
		);
		const derived = await derivedColumns(facts);
		if (projection.paid.length > 0 && derived.configuration_hash !== run.configuration_hash)
			refuse(
				'This mixed paid payroll has a different governing configuration. Keep the paid calculation and record a later correction.'
			);
		const built = buildPayrollRun(facts);
		const paidIds = new Set<string>(projection.paid.map((row) => row.employment_id));
		return [
			{
				...derived,
				calculation_trace: [
					...(run.calculation_trace ?? []).filter((row) => paidIds.has(row.employment_id)),
					...built.calculation_trace
				],
				company_charges: built.company_charges,
				company_remittances: built.company_remittances,
				warnings: built.warnings.join('\n'),
				payslips: rerunPayslips(world, projection, built, { wages, tranches, explanations })
			}
		] as never;
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
		if (kind === 'EARLY')
			return ctx.refuse(
				'An EARLY run is written by the off-cycle run that settles salary ahead of the regular one; create that run instead.',
				{ field: 'kind' }
			);
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
			let world = worlds.get(`${run.company_id}:${run.period}`)!;
			assertPayrollPeriodAvailable(world.payroll_runs, run.period, run.kind);
			/** Gather, guard and build one run of the act on `world`. */
			const price = async (kind: RunKind) => {
				const facts = gatherPayrollRun({
					world,
					companyId: run.company_id,
					period: run.period,
					payDueDate: run.payDueDate,
					kind,
					sources: run.sources
				});
				if (kind === 'EARLY' && facts.gathered.bundles.length === 0) return null;
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
					`[payroll-result] ${run.period} ${kind} payslips=${built.payslipCount} base=${built.baseCount} ` +
						`adjustments=${built.adjustmentCount} captured=${built.capturedCount}`
				);
				return { facts, built };
			};
			const row = async (
				{ facts, built }: NonNullable<Awaited<ReturnType<typeof price>>>,
				sequence: number
			) => ({
				company_id: run.company_id,
				period: run.period,
				kind: facts.kind,
				sequence,
				...(run.sources.length === 0 || facts.kind === 'EARLY' ? {} : { sources: run.sources }),
				...(await derivedColumns(facts)),
				calculation_trace: built.calculation_trace,
				company_charges: built.company_charges,
				company_remittances: built.company_remittances,
				warnings: [...built.warnings, ...pushedOvertime(facts)].join('\n'),
				payslips: { create: payrollRunPayload(built) }
			});
			/**
			 * A salary settled before its attendance window has closed fixes the period, so overtime still to be
			 * worked in it is recorded and paid in the next period — possibly after the law's deadline for it.
			 */
			const today = dateKey(String(ctx.today));
			const pushedOvertime = (facts: PreparedRun) =>
				facts.kind !== 'EARLY' || dateKey(facts.window.attendance.end) < today
					? []
					: [
							`EARLY_SETTLEMENT_OVERTIME: ${facts.gathered.bundles
								.map((bundle) => bundle.employment.employee_number)
								.join(
									', '
								)}: ${run.period} salary is settled early, so overtime worked from ${today} ` +
								`to ${dateKey(facts.window.attendance.end)} is paid in the next period. Check that this meets ` +
								'the overtime payment deadline.'
						];
			const sequence = nextRunSequence(world.payroll_runs, run.period);
			// An off-cycle run settles first, in the same act, the salary of everyone it pays whose period no run
			// has settled yet (EARLY, at the regular pay date); its own payments are then priced beside that slip.
			const early = run.kind === 'OFF_CYCLE' ? await price('EARLY') : null;
			if (early != null) world = withBuiltRun(world, early.facts, early.built, sequence);
			const own = await row((await price(run.kind))!, early == null ? sequence : sequence + 1);
			return (
				early == null
					? own
					: { ...own, early_settlements: { create: [await row(early, sequence)] } }
			) as never;
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
