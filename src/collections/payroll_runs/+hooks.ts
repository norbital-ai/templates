/**
 * The payroll run's lifecycle, and the entry point that builds one.
 *
 * ```
 *  DRAFT ──mark paid──► PAID
 *    │
 *    └──── recalculate
 * ```
 *
 * The platform owns permissions, approval locks, request-change comments, and audit history. This
 * hook owns the payroll invariant: draft figures may be rebuilt; paid figures are immutable and
 * later corrections arrive as adjustment entries in a future draft.
 *
 * It also owns one end of the **settlement lock**. A run that persists claims every source record it
 * consumed in `payslip_sources`; deleting the run cascades those claims away with its payslips.
 * Which is why the delete refusal below is not merely tidiness about history: it is what makes a
 * paid period's attendance, entries and leave permanently immutable. See
 * `src/collections/payslip_sources/+model.ts`, and `src/lib/policy_grants.ts` for why this lock
 * is not `approval_id`.
 *
 * Creating a run resolves its window and its governing configuration first, because
 * `configuration_hash`, `pay_date`, `attendance_from` and `attendance_to` are what make a payslip
 * traceable to the law it was computed under — a run that had to be built before it could say what
 * it was built against would be unauditable. The build itself then runs after the record exists.
 */

import { Effect } from 'effect';
import { refuse } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';
import type { Hooks } from './$types.js';
import { buildPayrollRun as runEngine, preparePayrollRun } from './lib/engine.js';
import type { PayrollApi } from './lib/api.js';
import { configurationSnapshot } from './lib/configuration.js';
import { payrollRunPrecheck } from './lib/precheck.js';
import { describeIssues } from './lib/validate.js';

/**
 * What a person actually chooses when creating a run: a company and a period. Everything else on the
 * record is derived below, so the generated create schema — which requires every non-nullable column,
 * `lifecycle` and the whole resolved window among them — would demand figures the caller has no way
 * to know and no business asserting.
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

/**
 * Build (or rebuild) one company's payroll for one period.
 *
 * This is what a representation calls. The run record must already exist — `create.after` calls it
 * for a new run, and recalculating a draft calls it again. It is idempotent: the run's existing
 * results are cleared before the new ones are written.
 */
export function buildPayrollRun(
	input: { readonly companyId: string; readonly period: string },
	api: PayrollApi
): Effect.Effect<{ payslipCount: number; lineCount: number }, never, never> {
	return Effect.gen(function* () {
		const run = yield* api.db.query.payroll_runs.findFirst({
			where: { company_id: { eq: input.companyId }, period: { eq: input.period } }
		});
		if (!run)
			refuse(
				`There is no payroll run for ${input.period}. Create the run first; building it is what ` +
					'creating it does.'
			);
		if (run.lifecycle === 'PAID')
			refuse(`Payroll ${input.period} is paid. A paid run is never re-run — correct it instead.`);
		const result = yield* runEngine({
			api,
			runId: run.id,
			companyId: input.companyId,
			period: input.period
		});
		return { payslipCount: result.payslipCount, lineCount: result.lineCount };
	});
}

export default {
	create: {
		input: createPayrollRunInput,
		perRecord: {
			before: {
				description:
					'Refuses a second run for a company and period, and refuses one while an earlier period is still a draft, then resolves the pay date, attendance window and configuration snapshot the run will be computed under.',
				handler: ({ input, api }) =>
					Effect.gen(function* () {
						const existing = yield* api.db.query.payroll_runs.findFirst({
							where: { company_id: { eq: input.company_id }, period: { eq: input.period } }
						});
						if (existing) {
							const lifecycle = existing.lifecycle;
							if (lifecycle == null) refuse(`Payroll ${input.period} already exists.`);
							refuse(
								`Payroll ${input.period} already exists (${lifecycle.toLowerCase()}). ` +
									'Open that run, or delete it first if it is still a draft.'
							);
						}
						const { window, configuration } = yield* preparePayrollRun({
							api,
							companyId: input.company_id,
							period: input.period
						});
						// The previous period must be settled before this one is calculated, so a year-to-date
						// figure can never be assembled from a period that is still moving.
						const previous = yield* api.db.query.payroll_runs.findMany({
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
						/**
						 * The last refusal that can still be free.
						 *
						 * These checks used to live inside the engine, which runs in `create.after` — after the
						 * row is committed and with no transaction to take it back. A run refused for an
						 * unclosed clock therefore left a DRAFT payroll run with no payslips under it: a record
						 * asserting that a period had been calculated, blocking the next period, describing a
						 * calculation that never happened. Every one of those had to be found and deleted by
						 * hand.
						 *
						 * Moving them here is the whole of the fix, and it is a fix precisely because `before`
						 * has a property `after` cannot have: it runs before the insert, so a refusal leaves
						 * nothing behind. The engine keeps its own copies of these checks — this is the cheap,
						 * early answer, not the authoritative one.
						 */
						const blocking = yield* payrollRunPrecheck({ api, configuration, window });
						if (blocking.length > 0) refuse(describeIssues(blocking));
						return {
							...input,
							lifecycle: 'DRAFT' as const,
							configuration_hash: configuration.hash,
							configuration_snapshot: {
								kind: 'CAPTURED' as const,
								configuration_hash: configuration.hash,
								configuration: configurationSnapshot(configuration, input.period)
							},
							pay_date: window.payDate,
							attendance_from: window.attendance.start,
							attendance_to: window.attendance.end
						};
					})
			},
			after: {
				description:
					'Runs the payroll engine for the newly created run, producing its payslips and payslip lines from the attendance, entries and statutory rules in the resolved window.',
				/**
				 * The build, and it stays here.
				 *
				 * By the time this runs the row is a fact, and it cannot be unwritten — the database
				 * facility has no transaction primitive, so every statement the engine issues is its own
				 * autocommitted call and so was the insert that caused it. That is the right place for the
				 * *build*: producing payslips is work that follows a run existing, not a condition of it
				 * existing. What moved out is validation, which had no business being downstream of a
				 * commit it could not undo.
				 *
				 * A failure here is reported, never swallowed. The run exists and has no payslips, which is
				 * a state an operator can see and act on — recalculating a draft is one click — and it is
				 * strictly better than a silent partial build nobody is told about.
				 */
				handler: ({ record, api }) =>
					runEngine({
						api,
						runId: record.id,
						companyId: record.company_id,
						period: record.period
					})
			}
		}
	},

	update: {
		perRecord: {
			before: {
				description:
					'Refuses hand edits to the engine-owned period, pay date, attendance window and configuration hash, refuses any change to a PAID run, and re-resolves that window and configuration when a draft is recalculated.',
				handler: ({ input, existing, api }) =>
					Effect.gen(function* () {
						for (const column of DERIVED_COLUMNS)
							if (input[column] != null && String(input[column]) !== String(existing[column]))
								refuse(
									`Payroll run ${column} is derived from the period and the configuration, and cannot be edited.`
								);
						const next = input.lifecycle ?? existing.lifecycle;
						if (next === existing.lifecycle) {
							if (next !== 'DRAFT') return input;
							const { window, configuration } = yield* preparePayrollRun({
								api,
								companyId: existing.company_id,
								period: existing.period
							});
							return {
								...input,
								configuration_hash: configuration.hash,
								configuration_snapshot: {
									kind: 'CAPTURED' as const,
									configuration_hash: configuration.hash,
									configuration: configurationSnapshot(configuration, existing.period)
								},
								pay_date: window.payDate,
								attendance_from: window.attendance.start,
								attendance_to: window.attendance.end
							};
						}
						if (existing.lifecycle === 'PAID')
							refuse('A paid payroll run is immutable. Correct it with a later adjustment entry.');
						return input;
					})
			},
			after: {
				description:
					'Rebuilds a draft run’s payslips and lines from scratch after its source time entries, component entries or rules have changed, and leaves a paid run untouched.',
				handler: ({ record, api }) =>
					Effect.gen(function* () {
						// A same-state DRAFT update is the explicit recalculation action after source entries
						// change. The platform carries the approval/revision context; payroll only rebuilds.
						if (record.lifecycle !== 'DRAFT') return;
						yield* runEngine({
							api,
							runId: record.id,
							companyId: record.company_id,
							period: record.period
						});
					})
			}
		}
	},

	/**
	 * Deleting a run is the settlement lock's release, and the only one.
	 *
	 * `payslips.payroll_run_id` is declared to cascade, and `payslip_sources.payslip_id` with it, so
	 * the rows this run claimed over time entries, component entries, leave requests, pay components
	 * and repayment agreements are dropped by the database in the same statement that drops the run —
	 * and the records become editable again the moment the run stops standing. That is the owner's rule
	 * verbatim: locked while the run stands, released only if the run is deleted.
	 *
	 * There is no `delete.after` releasing them by hand, and that is deliberate. A hook release would
	 * have to page through the claims and delete them one at a time, and the reachable delete —
	 * `api.db.<collection>.delete(identifiers)` — takes `identifiers[0]` and ignores the rest, so a
	 * release written that way would quietly free one record out of several hundred and report
	 * success. A cascade cannot half-happen; a loop over a single-id delete can.
	 *
	 * The cascade is honoured: `cascade(...)` in `+relationship.ts` reaches the DDL as
	 * `ON DELETE CASCADE` (see `20260818183224_cascade_payroll_ownership`). So today a draft run that
	 * has written payslips is deleted with its payslips, lines and source rows in one statement. See
	 * `src/collections/payslip_sources/+model.ts`.
	 */
	delete: {
		perRecord: {
			before: {
				description:
					'Allows a payroll run to be deleted only while it is still a draft, so a period that has been paid can never be erased and the settlement locks it holds over attendance, entries, leave, components and repayment agreements are never released.',
				handler: ({ existing }) => {
					// The refusal that makes a paid run's locks permanent. Deleting a PAID run would cascade
					// its settlement claims away and quietly reopen every record behind money that has
					// already left the building — so the correction path is the only path, and the message
					// says so rather than leaving the person to find out.
					if (existing.lifecycle !== 'DRAFT')
						refuse(
							`Payroll run ${existing.period} is ${existing.lifecycle} and cannot be deleted. ` +
								'A paid run is the record of money that has been paid, and deleting it would ' +
								'release every attendance, entry and leave record it settled. Correct it with an ' +
								'adjustment entry in a later draft run instead.'
						);
				}
			}
		}
	}
} satisfies Hooks;
