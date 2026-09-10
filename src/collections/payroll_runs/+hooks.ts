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
import type { PayslipCaptures } from './lib/graph.js';
import { assertPayrollPeriodAvailable, assertPayrollRunDeletable } from './lib/period.js';
import { payrollRunPrecheck } from './lib/precheck.js';
import { describeIssues } from './lib/validate.js';
import { stableJson } from '../../lib/jurisdiction_settings.js';
import { runWithholdingValueSchema } from '../../datatypes/run_withholdings/+definition.js';

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
	lifecycle: Schema.optional(Schema.Literal('PAID')),
	/**
	 * The people this run deliberately leaves out, each with a reason. Caller input, not derived:
	 * the run's population is everyone eligible, and only a person can say who is the exception.
	 */
	withheld: Schema.optional(Schema.Array(runWithholdingValueSchema)),
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
	// Not engine-derived, but frozen with everything else the calculation read: the run was
	// calculated over the population these withholds produced, so editing them after the fact would
	// leave a run whose payslips and whose stated population disagree.
	'withheld',
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

/**
 * What each new payslip settled, handed from `before` (which minted the payslip ids) to `after`
 * (where the payslips exist and the sources can name them). In-process and per request; a missing
 * entry in `after` is refused loudly rather than leaving a run's sources unlocked.
 */
const PENDING_CAPTURES = new Map<string, readonly PayslipCaptures[]>();
const SETTLED_SOURCES = ['work_days', 'claim_requests', 'payment_requests'] as const;
/** Four collections, one shape: the union of their clients is not callable, the reader is. */
type SettledReader = {
	readonly findMany: (query: {
		readonly where: { readonly settled_payslip_id: { readonly in: readonly string[] } };
		readonly columns: { readonly id: true };
		readonly limit: number;
	}) => Effect.Effect<readonly { readonly id: string }[]>;
	readonly mutate: (
		values: readonly {
			readonly id: string;
			readonly settled_payslip_id: null;
			readonly settled_period: null;
		}[]
	) => Effect.Effect<void>;
};

/** Calculate, and hand back the run's columns with every payslip it produced nested under them. */
const buildGraph = (prepared: PreparedRun) =>
	Effect.gen(function* () {
		const built = buildPayrollRun(prepared);
		PENDING_CAPTURES.set(
			runKey(prepared.configuration.company.id, prepared.period),
			built.captures
		);
		if (built.warnings.length > 0)
			yield* Effect.logWarning(`[payroll-warnings] ${prepared.period} ${built.warnings.join(' ')}`);
		yield* Effect.log(
			`[payroll-result] ${prepared.period} payslips=${built.payslipCount} ` +
				`base=${built.baseCount} adjustments=${built.adjustmentCount} ` +
				`captured=${built.capturedCount} | ${prepared.readLog.logString()}`
		);
		return {
			...derivedColumns(prepared),
			payslip_payroll_run: built.payslip_payroll_run
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
							period: one.period!,
							withheld: (one.withheld ?? []).map((row) => row.employment_id)
						});
						return [runKey(one.company_id!, one.period!), run] as const;
					})
				);
				return new Map(entries);
			}),
		perRecord: {
			before: {
				description:
					'Freezes inputs, enforces payment order and calculates the company’s single payroll for the period and returns the run together with every payslip, every captured input junction and every adjustment it produced.',
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
							const payslip = yield* api.db.payslips.findFirst({
								where: { payroll_run_id: { eq: existing.id } },
								columns: { id: true }
							});
							if (payslip == null) refuse('A payroll with no payslips cannot be marked paid.');
							return { lifecycle: 'PAID' as const };
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
							window: facts.window,
							withheld: (input.withheld ?? []).map((row) => row.employment_id)
						});
						if (blocking.length > 0) refuse(describeIssues(blocking));
						return {
							...input,
							lifecycle: 'DRAFT' as const,
							...(yield* buildGraph(facts))
						};
					})
			},
			after: {
				description:
					'Stamps settled_payslip_id and settled_period on every single-use source the new run captured, now that its payslips exist, and — when the run is marked paid — records the payment on every one of its unpaid payslips, because payment is a fact of the slip. The holidays the run read stay on the run itself (`holidays`): a holiday is frozen while a run captures it, with no stamp on the holiday row.',
				handler: ({ previous, record, api }): Effect.Effect<void> =>
					Effect.gen(function* () {
						if (previous !== undefined) {
							/**
							 * Marking the run paid is the bulk gesture, and the bulk gesture is "pay every
							 * slip still unpaid". The record of payment is the slip's, so this is where it
							 * is written; the run's own `lifecycle` is the summary those slips produce.
							 * Each write goes through the payslip's own hook, so a person whose earlier
							 * period is still unpaid refuses here by name rather than being swept along.
							 */
							if (previous.lifecycle === 'PAID' || record.lifecycle !== 'PAID') return;
							const unpaid = yield* api.db.payslips.findMany({
								where: { payroll_run_id: { eq: record.id }, paid_at: { isNull: true } },
								columns: { id: true },
								limit: 20_000
							});
							if (unpaid.length >= 20_000) refuse('Too many payslips to pay in one run.');
							if (unpaid.length > 0)
								yield* api.db.payslips.mutate(
									unpaid.map((slip) => ({ id: slip.id, paid_at: record.pay_date }))
								);
							return;
						}
						const key = runKey(record.company_id, record.period);
						const captures = PENDING_CAPTURES.get(key);
						PENDING_CAPTURES.delete(key);
						if (captures == null)
							refuse(
								`Payroll ${record.period} was created without its capture list. This is a bug.`
							);
						const stamp = (ids: readonly string[], payslipId: string) =>
							ids.map((id) => ({
								id,
								settled_payslip_id: payslipId,
								settled_period: record.period
							}));
						for (const capture of captures) {
							if (capture.workDays.length)
								yield* api.db.work_days.mutate(stamp(capture.workDays, capture.payslipId));
							if (capture.claims.length)
								yield* api.db.claim_requests.mutate(stamp(capture.claims, capture.payslipId));
							if (capture.payments.length)
								yield* api.db.payment_requests.mutate(stamp(capture.payments, capture.payslipId));
						}
					})
			}
		}
	},

	/**
	 * Deleting a run is the settlement lock's release, and the only one.
	 *
	 * `payslips.payroll_run_id` cascades, the two capture junctions cascade from their payslips, and
	 * the single-use sources are unpinned by the hook below in the same transaction — so every record
	 * this run settled becomes editable again the moment the run stops standing. That is the owner's
	 * rule verbatim: locked while the run stands, released only if the run is deleted.
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
					'Allows a payroll run to be deleted only while it is still a draft, so a period that has been paid can never be erased and the settlement locks it holds over work days, component entries, loan repayments and leave requests are never released.',
				handler: ({ existing, api }) =>
					Effect.gen(function* () {
						// The refusal that makes a paid run's locks permanent. Deleting a PAID run would
						// release every record behind money that has already left the building — so the
						// correction path is the only path, and the message says so.
						// A paid slip is money that left the building, whatever its run's summary says. The
						// run's own lifecycle is a reading of these, so this is the same rule stated where
						// the fact lives — and it still refuses a half-paid run, which reads DRAFT.
						const paid = yield* api.db.payslips.findFirst({
							where: { payroll_run_id: { eq: existing.id }, paid_at: { isNotNull: true } },
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
						// The release: a draft's payslips cascade away with the run; the single-use sources
						// they settled are unlocked here, in the same transaction, by clearing their pin.
						const payslips = yield* api.db.payslips.findMany({
							where: { payroll_run_id: { eq: existing.id } },
							columns: { id: true },
							limit: 20_000
						});
						if (payslips.length >= 20_000) refuse('Too many payslips to release safely.');
						const ids = payslips.map((row) => row.id);
						if (ids.length === 0) return;
						for (const source of SETTLED_SOURCES) {
							const reader = api.db[source] as unknown as SettledReader;
							const rows = yield* reader.findMany({
								where: { settled_payslip_id: { in: ids } },
								columns: { id: true },
								limit: 20_000
							});
							if (rows.length >= 20_000) refuse('Too many settled rows to release safely.');
							if (rows.length)
								yield* reader.mutate(
									rows.map((row) => ({
										id: row.id,
										settled_payslip_id: null,
										settled_period: null
									}))
								);
						}
					})
			}
		}
	}
} satisfies Hooks<PreparedRuns>;
