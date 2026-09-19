import { Effect } from 'effect';
import { defineCollection, refuse } from '@norbital-ai/bolt/authoring';
import model from './+model.js';
import { memoryReads } from '../../lib/memory-reads.js';
import { dayInstant } from '../../lib/iso-day.js';
import type { PayrollReadApi } from './lib/api.js';
import {
	buildPayrollRun,
	CALCULATION_VERSION,
	gatherPayrollRun,
	type PreparedRun
} from './lib/engine.js';
import { payrollRunPayload } from './lib/graph.js';
import { assertPayrollPeriodAvailable } from './lib/period.js';
import { payrollRunPrecheck } from './lib/precheck.js';
import { preloadPayrollWorlds } from './lib/preload.js';
import { describeIssues } from './lib/validate.js';

/**
 * What a person actually chooses when creating a run: a company and a period. Everything else on
 * the record is derived by the transform, so the declared input is exactly those two columns and
 * a caller has no way to assert the pay date, the window or a single figure.
 *
 * The population is not a choice: the run covers every eligible employment in the period.
 * Individual cases are held per payslip (`ON_HOLD`), not excluded from the run.
 *
 * A run is a frozen container: every column is derived, payment lives on the payslips, and a
 * correction is an entry in a later run. It declares no `update`. Deleting a run is the
 * settlement lock's release, and the only one: the payslips cascade, and the database's
 * `ON DELETE SET NULL` releases every source they pinned. The delete grant's `authorize`
 * (`lib/policy_grants.ts`) refuses a run with a paid slip or a later sibling.
 */
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])(-[12])?$/;

/**
 * The run's own derived columns, from the facts the gather resolved.
 *
 * `settings_id` is the jurisdiction settings version the configuration was picked under, the
 * version that governed this calculation, captured atomically beside the configuration it is one
 * half of. `calculation_version` is the engine identity that interpreted both.
 */
const derivedColumns = (prepared: PreparedRun) => ({
	configuration_hash: prepared.configuration.hash,
	holidays: prepared.configuration.holidaySnapshots,
	settings_id: prepared.configuration.jurisdiction.id,
	calculation_version: CALCULATION_VERSION,
	pay_date: dayInstant(prepared.window.payDate),
	attendance_from: dayInstant(prepared.window.attendance.start),
	attendance_to: dayInstant(prepared.window.attendance.end)
});

export default defineCollection({
	model,
	create: { input: { columns: { company_id: true, period: true } } },
	delete: {},
	transform: (inputs, { db }) =>
		Effect.gen(function* () {
			const runs = inputs.map((input) => {
				const period = String(input.period ?? '');
				if (!PERIOD.test(period))
					refuse(
						'Payroll period must be YYYY-MM, or YYYY-MM-1 / YYYY-MM-2 at a semi-monthly company.'
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
			// Two concurrent waves, then every engine question is answered from memory.
			const worlds = yield* preloadPayrollWorlds(db, runs);
			const payloads = [];
			for (const run of runs) {
				const world = worlds.get(`${run.company_id}:${run.period}`)!;
				assertPayrollPeriodAvailable(
					world.payroll_runs as ReadonlyArray<{ readonly period: string }>,
					run.period
				);
				const api = memoryReads(world) as unknown as PayrollReadApi;
				const gatherStarted = Date.now();
				const facts = yield* gatherPayrollRun({
					api,
					companyId: run.company_id,
					period: run.period
				});
				const precheckStarted = Date.now();
				const blocking = payrollRunPrecheck({
					configuration: facts.configuration,
					window: facts.window,
					bundles: facts.gathered.bundles
				});
				if (blocking.length > 0) refuse(describeIssues(blocking));
				const buildStarted = Date.now();
				const built = buildPayrollRun(facts);
				if (built.warnings.length > 0)
					yield* Effect.logWarning(`[payroll-warnings] ${run.period} ${built.warnings.join(' ')}`);
				yield* Effect.log(
					`[payroll-result] ${run.period} payslips=${built.payslipCount} ` +
						`base=${built.baseCount} adjustments=${built.adjustmentCount} ` +
						`captured=${built.capturedCount} | ${facts.readLog.logString()}`
				);
				// Wall time per phase from inside the guest: the compute budget is the isolate's own
				// meter, and a host-side profile of the same run under-counted it threefold.
				yield* Effect.log(
					`[payroll-timing] ${run.period} gather=${precheckStarted - gatherStarted}ms ` +
						`precheck=${buildStarted - precheckStarted}ms build=${Date.now() - buildStarted}ms`
				);
				payloads.push({
					...run,
					...derivedColumns(facts),
					calculation_trace: built.calculation_trace,
					company_charges: built.company_charges,
					warnings: built.warnings.join('\n'),
					payslip_payroll_run: { create: payrollRunPayload(built) }
				});
			}
			return payloads;
		})
});
