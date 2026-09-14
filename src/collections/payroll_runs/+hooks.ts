import { Effect } from 'effect';
import { refuse } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';
import type { Hooks } from './$types.js';
import {
	buildPayrollRun,
	CALCULATION_VERSION,
	gatherPayrollRun,
	type PreparedRun
} from './lib/engine.js';
import { assertPayrollPeriodAvailable, assertPayrollRunDeletable } from './lib/period.js';
import { payrollRunPrecheck } from './lib/precheck.js';
import { describeIssues } from './lib/validate.js';
import { stableJson } from '../../lib/jurisdiction_settings.js';
import { captureWriters, type CaptureApi } from './lib/captures.js';

/**
 * What a person actually chooses when creating a run: a company and a period. Everything else on the
 * record is derived below, so the generated create schema — which requires every non-nullable column,
 * `lifecycle` and the whole resolved window among them — would demand figures the caller has no way
 * to know and no business asserting.
 *
 * The population is not a choice: the run covers every eligible employment in the period. Individual
 * cases are held per payslip (`ON_HOLD`), not excluded from the run.
 */
const createPayrollRunInput = Schema.Struct({
	company_id: Schema.String.check(Schema.isUUID()),
	lifecycle: Schema.optional(Schema.Literal('PAID')),
	/**
	 * A month for a monthly company, a half for a semi-monthly one. The grammar is checked against
	 * the company in `prepare`, naming its frequency; this only says what a period can look like.
	 */
	period: Schema.String.check(
		Schema.isPattern(/^\d{4}-(0[1-9]|1[0-2])(-[12])?$/, {
			message: 'Payroll period must be YYYY-MM, or YYYY-MM-1 / YYYY-MM-2 at a semi-monthly company.'
		})
	)
});

/** Columns the engine owns; a person may not edit them. */
const DERIVED_COLUMNS = [
	'company_id',
	'period',
	'configuration_hash',
	'holidays',
	'settings_id',
	'calculation_version',
	'pay_date',
	'attendance_from',
	'attendance_to'
] as const;

/** The key a prepared run is filed under, so a batch of runs cannot read each other's facts. */
const runKey = (companyId: string, period: string): string => `${companyId}:${period}`;

/** What `create.prepare` hands `create.before`: one entry per run in the batch, keyed by `runKey`. */
type PreparedRuns = ReadonlyMap<string, PreparedRun>;

/**
 * The run's own derived columns, from the facts `prepare` resolved.
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
	pay_date: prepared.window.payDate,
	attendance_from: prepared.window.attendance.start,
	attendance_to: prepared.window.attendance.end
});

/** Calculate, and hand back the run's columns, its payslips, and what each payslip captured. */
const buildGraph = (prepared: PreparedRun) =>
	Effect.gen(function* () {
		const built = buildPayrollRun(prepared);
		if (built.warnings.length > 0)
			yield* Effect.logWarning(`[payroll-warnings] ${prepared.period} ${built.warnings.join(' ')}`);
		yield* Effect.log(
			`[payroll-result] ${prepared.period} payslips=${built.payslipCount} ` +
				`base=${built.baseCount} adjustments=${built.adjustmentCount} ` +
				`captured=${built.capturedCount} | ${prepared.readLog.logString()}`
		);
		return {
			graph: {
				...derivedColumns(prepared),
				payslip_payroll_run: built.payslip_payroll_run
			},
			captures: built.captures
		};
	});

export default {
	input: createPayrollRunInput,
	mutate: {
		/** Resolve one new run per company; later runs must observe its settlement. */
		prepare: ({ inputs, api }) =>
			Effect.gen(function* () {
				const ids = inputs.flatMap((one) => (one.id == null ? [] : [one.id]));
				const existingIds = new Set(
					ids.length === 0
						? []
						: (yield* api.db.payroll_runs.findMany({
								where: { id: { in: ids } },
								columns: { id: true },
								limit: ids.length
							})).map((row) => row.id)
				);
				const creates = inputs.filter(
					(one) =>
						(one.id == null || !existingIds.has(one.id)) &&
						one.company_id != null &&
						one.period != null
				);
				const companies = new Set<string>();
				for (const one of creates) {
					if (companies.has(one.company_id!))
						refuse(
							'Create one payroll per company at a time so every run observes its prior settlement.'
						);
					companies.add(one.company_id!);
				}
				const entries = yield* Effect.forEach(creates, (one) =>
					Effect.gen(function* () {
						const runs = yield* api.db.payroll_runs.findMany({
							where: { company_id: { eq: one.company_id! } },
							columns: { period: true, lifecycle: true },
							limit: 20_000
						});
						if (runs.length >= 20_000) refuse('Too many payrolls to verify settlement order.');
						assertPayrollPeriodAvailable(runs, one.period!);
						const run = yield* gatherPayrollRun({
							api,
							companyId: one.company_id!,
							period: one.period!
						});
						return [runKey(one.company_id!, one.period!), run] as const;
					})
				);
				return new Map(entries);
			}),
		perRecord: {
			before: {
				description:
					'Freezes inputs and calculates the company’s single payroll for the period, returning the run together with every payslip, every captured entry pin and every per-period row it materialised.',
				handler: ({ input, existing, prepared, api, relationships }) =>
					Effect.gen(function* () {
						// `existing` is undefined on a create and is the only thing that tells the two apart —
						// the same distinction the runtime already makes from the id. Every branch below returns,
						// so the create path is unreachable once this one is taken.
						if (existing !== undefined) {
							if (relationships?.length)
								refuse('Marking payroll paid cannot change its payslips or captured inputs.');
							// A paid run is a closed record: no column edit, no lifecycle move, no no-op PATCH.
							// The one transition out of DRAFT is mark-paid, below; everything else refuses.
							if (existing.lifecycle !== 'DRAFT')
								refuse(
									`Payroll run ${existing.period} is ${existing.lifecycle} and is immutable. ` +
										'Correct it with a component entry in a later draft run.'
								);
							for (const column of DERIVED_COLUMNS)
								if (column in input && stableJson(input[column]) !== stableJson(existing[column]))
									refuse(
										`Payroll run ${column} is derived from the period and the configuration, and cannot be edited.`
									);
							const next = input.lifecycle ?? existing.lifecycle;
							if (next !== 'PAID')
								refuse(
									'Payroll inputs are frozen. Delete the draft and create it again to change its inputs.'
								);
							const previous = yield* api.db.payroll_runs.findMany({
								where: { company_id: { eq: existing.company_id }, lifecycle: { eq: 'DRAFT' } },
								limit: 20_000
							});
							if (previous.length >= 20_000)
								refuse('Too many outstanding payrolls to verify payment order.');
							// Period text orders runs: within one company's grammar, `2026-02-1 < 2026-02-2 <
							// 2026-03-1` and `2026-02 < 2026-03` are the chronological orders, so the comparison
							// reads a semi-monthly company's halves exactly as it reads a monthly company's months.
							const blocked = previous.find(
								(run) => run.id !== existing.id && run.period < existing.period
							);
							if (blocked != null)
								refuse(
									`Payroll ${blocked.period} must be paid before this payroll can be marked paid.`
								);
							const slips = yield* api.db.payslips.findMany({
								where: { payroll_run_id: { eq: existing.id } },
								columns: { id: true, paid_at: true, status: true },
								limit: 20_000
							});
							if (slips.length >= 20_000) refuse('Too many payslips to pay in one run.');
							if (slips.length === 0) refuse('A payroll with no payslips cannot be marked paid.');
							// Payment is a fact of the slip, so the slips ride the run's own write. Every slip
							// is stated, not only the unpaid ones: the nested list is the parent's complete
							// desired state, and omitting a paid slip would remove it. A held slip is left
							// exactly as it is: it is deliberately out of the bank file.
							const held = slips.filter((slip) => slip.status === 'ON_HOLD');
							return {
								// The run's lifecycle is a reading of its slips: with any slip still held there
								// is money not yet paid, so the run stays a draft.
								lifecycle: held.length === 0 ? ('PAID' as const) : ('DRAFT' as const),
								payslip_payroll_run: slips.map((slip) =>
									slip.status === 'ON_HOLD'
										? { id: slip.id, status: 'ON_HOLD' as const, paid_at: slip.paid_at }
										: {
												id: slip.id,
												status: 'PAID' as const,
												paid_at: slip.paid_at ?? existing.pay_date
											}
								)
							} as never;
						}
						// `refuse` returns `never`, so these two narrow for the rest of the create path. The
						// hook's own `input` schema requires both; this states it where the types can see it.
						const { company_id: companyId, period } = input;
						if (companyId == null || period == null)
							refuse('A payroll run states the company and the period it settles.');
						const facts = prepared.get(runKey(companyId, period));
						if (facts == null)
							refuse(`Payroll ${period} was not prepared. This is a bug, not a data fault.`);
						const blocking = yield* payrollRunPrecheck({
							api,
							configuration: facts.configuration,
							window: facts.window
						});
						if (blocking.length > 0) refuse(describeIssues(blocking));
						const built = yield* buildGraph(facts);
						const writers = captureWriters(api as unknown as CaptureApi);
						for (const writer of writers) yield* writer.pin(built.captures);
						// The per-period rows materialised from standing sources: created with the run,
						// pinned to the payslip they priced, deleted with it. The id is the runtime's.
						const rows = built.captures.flatMap((capture) => capture.materialised);
						if (rows.length > 0)
							yield* api.db.allowance_requests.mutate(
								rows.map((row) => ({
									...row.values,
									payslip_id: row.payslipId
								})) as never
							);
						return {
							...input,
							lifecycle: 'DRAFT' as const,
							...built.graph
						};
					})
			}
		}
	},

	/**
	 * Deleting a run is the settlement lock's release, and the only one.
	 *
	 * `payslips.payroll_run_id` cascades, and the hook below releases the sources they pinned in
	 * the same transaction: authored entries are unpinned, per-period materialisations deleted. A
	 * run that has paid anyone is refused, so money that left the building is never erased.
	 */
	delete: {
		/**
		 * Newest first, judged over the whole batch.
		 *
		 * A run below a later one holds inputs that later run has already read and priced — its
		 * payslips, its year-to-date, its loan consumption — so releasing them leaves the later run
		 * citing rows that are free again, and nothing downstream notices. The order is judged here
		 * rather than per record because deleting a lineage's last two drafts together is legitimate
		 * and each of them is "below" the other's sibling until both are gone.
		 */
		prepare: ({ existing, api }) =>
			Effect.gen(function* () {
				const going = new Set(existing.map((run) => run.id));
				for (const companyId of new Set(existing.map((run) => run.company_id))) {
					const siblings = yield* api.db.payroll_runs.findMany({
						where: { company_id: { eq: companyId } },
						columns: { id: true, period: true },
						limit: 20_000
					});
					if (siblings.length >= 20_000) refuse('Too many payrolls to verify deletion order.');
					const staying = siblings.filter((run) => !going.has(run.id));
					for (const run of existing)
						if (run.company_id === companyId) assertPayrollRunDeletable(staying, run.period);
				}
				return new Map() as PreparedRuns;
			}),
		perRecord: {
			before: {
				description:
					'Allows a payroll run to be deleted only while no slip has been paid, so a period that has been paid can never be erased and the settlement locks it holds over work days, entries and repayments are never released.',
				handler: ({ existing, api }) =>
					Effect.gen(function* () {
						// A paid slip is money that left the building, whatever its run's summary says. The
						// run's own lifecycle is a reading of these, so this is the same rule stated where
						// the fact lives — and it still refuses a half-paid run, which reads DRAFT.
						const paid = yield* api.db.payslips.findFirst({
							where: { payroll_run_id: { eq: existing.id }, status: { eq: 'PAID' } },
							columns: { id: true }
						});
						if (paid != null)
							refuse(
								`Payroll run ${existing.period} has payslips that have been paid and cannot be ` +
									'deleted. Correct it with a component entry in a later draft run.'
							);
						if (existing.lifecycle !== 'DRAFT')
							refuse(
								`Payroll run ${existing.period} is ${existing.lifecycle} and cannot be deleted. ` +
									'A paid run is the record of money that has been paid, and deleting it would ' +
									'release every work day, entry, repayment and leave record it settled. Correct ' +
									'it with a component entry in a later draft run instead.'
							);
						const payslips = yield* api.db.payslips.findMany({
							where: { payroll_run_id: { eq: existing.id } },
							columns: { id: true },
							limit: 20_000
						});
						if (payslips.length >= 20_000) refuse('Too many payslips to release safely.');
						const ids = payslips.map((row) => row.id);
						if (ids.length === 0) return;
						// Release is the database's `ON DELETE SET NULL`; nothing is written here.
					})
			}
		}
	}
} satisfies Hooks<PreparedRuns>;
