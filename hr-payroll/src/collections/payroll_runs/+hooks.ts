/**
 * The payroll run's lifecycle, and the hook that builds one.
 *
 * ```
 *  DRAFT ──mark paid──► PAID
 *    │
 *    └──── recalculate
 * ```
 *
 * ## The run and its result are one write
 *
 * A `before` hook's return is the record the runtime persists, and it may carry the records that
 * belong to it. So this hook returns the run's columns **and its payslips**, and the whole payroll —
 * the run, every payslip, its inlined base, proration and statutory entries, and every adjustment
 * including the zero-amount settlement locks — lands in the create that asked for it.
 *
 * There is no `after` on this collection, and that is the point rather than a tidy-up. The build
 * used to run there, where the row was already committed and the database facility has no
 * transaction to take it back:
 *
 *  - a refusal left a DRAFT run with no payslips — a record asserting a period had been calculated,
 *    blocking the next period, describing a calculation that never happened;
 *  - the engine's own writes landed on `payroll_runs` as a DRAFT update indistinguishable from a
 *    person pressing recalculate, so `update.after` re-entered the engine until the host refused
 *    with `nesting_limit_exceeded`, and a guard had to be invented to tell the engine apart from a
 *    human; and
 *  - the arrears it wrote were one facility call per employee, which is where a 290-person run spent
 *    eight minutes.
 *
 * All three are gone because the engine cannot write. `create.prepare` reads, `create.before`
 * calculates and returns, and the runtime does the only write there is.
 *
 * ## The settlement lock
 *
 * A run that persists claims every source record it consumed as a `payslip_adjustments` row naming
 * it — including the ones it priced at nothing, whose amount is zero and whose claim is exactly as
 * binding. Deleting the run cascades those rows away with its payslips. Which is why the delete
 * refusal below is not merely tidiness about history: it is what makes a paid period's attendance,
 * obligations and leave permanently immutable. See
 * `src/collections/payslip_adjustments/+model.ts`, `src/lib/settlement_refusals.ts` for the
 * cross-run ceiling the merge traded a database invariant for, and `src/lib/policy_grants.ts` for
 * why this lock is not `approval_id`.
 */

import { Effect } from 'effect';
import { refuse } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';
import type { Hooks } from './$types.js';
import { buildPayrollRun, gatherPayrollRun, type PreparedRun } from './lib/engine.js';
import { configurationSnapshot } from './lib/configuration.js';
import { payrollRunPrecheck } from './lib/precheck.js';
import { describeIssues } from './lib/validate.js';

/**
 * What a person actually chooses when creating a run: a company and a period. Everything else on the
 * record is derived below, so the generated create schema — which requires every non-nullable column,
 * `lifecycle` and the whole resolved window among them — would demand figures the caller has no way
 * to know and no business asserting.
 *
 * It does **not** narrow what a caller may nest, and it is worth being exact about why that is still
 * safe. `create.input` decodes a record's own columns, after the graph path has already split the
 * relationship keys off — so a submitted `payslip_payroll_run` survives this struct. What defeats it
 * is that the hook below always returns that relationship, and a returned relationship replaces the
 * submitted one of the same name. Every payslip that reaches the database was computed by the
 * engine because the engine always states them, not because the caller was prevented from trying.
 */
const createPayrollRunInput = Schema.Struct({
	company_id: Schema.String.check(Schema.isUUID()),
	period: Schema.String.check(
		Schema.isPattern(/^2026-(0[1-9]|1[0-2])$/, {
			message: 'Payroll period must be January–December 2026.'
		})
	)
});

/** Columns the engine owns; a person may not edit them. */
const DERIVED_COLUMNS = [
	'company_id',
	'period',
	'configuration_hash',
	'configuration_snapshot',
	'pay_date',
	'attendance_from',
	'attendance_to'
] as const;

/** The key a prepared run is filed under, so a batch of runs cannot read each other's facts. */
const runKey = (companyId: string, period: string): string => `${companyId}:${period}`;

/** What `create.prepare` hands `create.before`: one entry per run in the batch, keyed by `runKey`. */
type PreparedRuns = ReadonlyMap<string, PreparedRun>;

/** The run's own derived columns, from the facts `prepare` resolved. */
const derivedColumns = (prepared: PreparedRun) => ({
	configuration_hash: prepared.configuration.hash,
	configuration_snapshot: {
		kind: 'CAPTURED' as const,
		configuration_hash: prepared.configuration.hash,
		configuration: configurationSnapshot(prepared.configuration, prepared.period)
	},
	pay_date: prepared.window.payDate,
	attendance_from: prepared.window.attendance.start,
	attendance_to: prepared.window.attendance.end
});

/** Calculate, and hand back the run's columns with every payslip it produced nested under them. */
const buildGraph = (prepared: PreparedRun) =>
	Effect.gen(function* () {
		const built = buildPayrollRun(prepared);
		if (built.warnings.length > 0)
			yield* Effect.logWarning(`[payroll-warnings] ${prepared.period} ${built.warnings.join(' ')}`);
		yield* Effect.log(
			`[payroll-result] ${prepared.period} payslips=${built.payslipCount} ` +
				`base=${built.baseCount} adjustments=${built.adjustmentCount} ` +
				`locks=${built.lockCount} | ${prepared.readLog.logString()}`
		);
		return {
			...derivedColumns(prepared),
			payslip_payroll_run: built.payslip_payroll_run
		};
	});

export const input = createPayrollRunInput;

export default {
	mutate: {
		/**
		 * Every read one payroll run performs, taken before anything decides anything.
		 *
		 * Batched by construction: `prepare` runs once for the whole write, so creating twelve periods
		 * at once reads each one's facts once and `before` decides twelve times over them. Nothing here
		 * refuses — a rule in `prepare` would be a rule that runs a different number of times from the
		 * records it governs.
		 */
		prepare: ({ inputs, api }) =>
			Effect.map(
				Effect.forEach(
					// Only a create states a company and a period; a recalculation names the run by id
					// and gathers its own facts, so there is nothing here to batch for it.
					inputs.flatMap((one) =>
						one.company_id != null && one.period != null
							? [{ companyId: one.company_id, period: one.period }]
							: []
					),
					({ companyId, period }) =>
						Effect.map(
							gatherPayrollRun({ api, companyId, period }),
							(run) => [runKey(companyId, period), run] as const
						)
				),
				(entries) => new Map(entries)
			),
		perRecord: {
			before: {
				description:
					'Refuses a second run for a company and period, refuses one while an earlier period is still a draft, then calculates the whole payroll and returns the run together with every payslip and every adjustment — settlement locks included — it produced.',
				handler: ({ input, existing, prepared, api }) =>
					Effect.gen(function* () {
						// `existing` is undefined on a create and is the only thing that tells the two apart —
						// the same distinction the runtime already makes from the id. Every branch below returns,
						// so the create path is unreachable once this one is taken.
						if (existing !== undefined) {
							for (const column of DERIVED_COLUMNS)
								if (input[column] != null && String(input[column]) !== String(existing[column]))
									refuse(
										`Payroll run ${column} is derived from the period and the configuration, and cannot be edited.`
									);
							const next = input.lifecycle ?? existing.lifecycle;
							if (next !== existing.lifecycle) {
								if (existing.lifecycle === 'PAID')
									refuse(
										'A paid payroll run is immutable. Correct it with a later adjustment entry.'
									);
								return input;
							}
							// A same-state update is only a recalculation while the run is still a draft.
							if (next !== 'DRAFT') return input;
							/**
							 * The rebuild, and the reason there is no `isBuildingRun` guard any more.
							 *
							 * The engine writes nothing, so this hook cannot be triggered by the engine — the
							 * only thing that reaches here is somebody asking for a recalculation. What comes
							 * back replaces the previous build wholesale: `payslip_payroll_run` is an included
							 * relationship, which states the run's complete set of payslips, and the payslips
							 * left out are removed with their adjustments by the same statement.
							 */
							const rebuilt = yield* gatherPayrollRun({
								api,
								companyId: existing.company_id,
								period: existing.period
							});
							return { ...input, ...(yield* buildGraph(rebuilt)) };
						}
						// `refuse` returns `never`, so these two narrow for the rest of the create path. The
						// hook's own `input` schema requires both; this states it where the types can see it.
						const { company_id: companyId, period } = input;
						if (companyId == null || period == null)
							refuse('A payroll run states the company and the period it settles.');
						const facts = prepared.get(runKey(companyId, period));
						if (facts == null)
							refuse(`Payroll ${period} was not prepared. This is a bug, not a data fault.`);
						const duplicate = yield* api.db.payroll_runs.findFirst({
							where: { company_id: { eq: companyId }, period: { eq: period } }
						});
						if (duplicate) {
							const lifecycle = duplicate.lifecycle;
							if (lifecycle == null) refuse(`Payroll ${input.period} already exists.`);
							refuse(
								`Payroll ${input.period} already exists (${lifecycle.toLowerCase()}). ` +
									'Open that run, or delete it first if it is still a draft.'
							);
						}
						// The previous period must be settled before this one is calculated, so a year-to-date
						// figure can never be assembled from a period that is still moving.
						const previous = yield* api.db.payroll_runs.findMany({
							where: { company_id: { eq: input.company_id }, period: { lt: input.period } },
							limit: 1000
						});
						const unsettled = previous
							.toSorted((left, right) => right.period.localeCompare(left.period))
							.find((run) => run.lifecycle === 'DRAFT');
						if (unsettled)
							refuse(
								`Payroll ${unsettled.period} is still a draft. Settle it before calculating ${input.period}: ` +
									'its figures are this period’s year-to-date.'
							);
						const blocking = yield* payrollRunPrecheck({
							api,
							configuration: facts.configuration,
							window: facts.window
						});
						if (blocking.length > 0) refuse(describeIssues(blocking));
						return {
							...input,
							lifecycle: 'DRAFT' as const,
							...(yield* buildGraph(facts))
						};
					})
			}
		}
	},

	/**
	 * Deleting a run is the settlement lock's release, and the only one.
	 *
	 * `payslips.payroll_run_id` is declared to cascade, and `payslip_adjustments.payslip_id` with it,
	 * so the rows this run claimed over work days, obligations and leave requests are dropped by the
	 * database in the same statement that drops the run — and the records become editable again the
	 * moment the run stops standing. That is the owner's rule verbatim: locked while the run stands,
	 * released only if the run is deleted.
	 */
	delete: {
		perRecord: {
			before: {
				description:
					'Allows a payroll run to be deleted only while it is still a draft, so a period that has been paid can never be erased and the settlement locks it holds over work days, obligations and leave requests are never released.',
				handler: ({ existing }) => {
					// The refusal that makes a paid run's locks permanent. Deleting a PAID run would cascade
					// its settlement claims away and quietly reopen every record behind money that has
					// already left the building — so the correction path is the only path, and the message
					// says so rather than leaving the person to find out.
					if (existing.lifecycle !== 'DRAFT')
						refuse(
							`Payroll run ${existing.period} is ${existing.lifecycle} and cannot be deleted. ` +
								'A paid run is the record of money that has been paid, and deleting it would ' +
								'release every work day, obligation and leave record it settled. Correct it with ' +
								'an adjustment obligation in a later draft run instead.'
						);
				}
			}
		}
	}
} satisfies Hooks<PreparedRuns>;
