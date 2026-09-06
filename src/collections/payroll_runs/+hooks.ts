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
import {
	storedCumulativePayroll,
	supplementalPayroll,
	corePayrollInputHash
} from './lib/supplemental.js';
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
	run_kind: Schema.optional(Schema.Literals(['REGULAR', 'AD_HOC'])),
	lifecycle: Schema.optional(Schema.Literal('PAID')),
	period: Schema.String.check(
		Schema.isPattern(/^\d{4}-(0[1-9]|1[0-2])$/, {
			message: 'Payroll period must be YYYY-MM.'
		})
	)
});

/** Columns the engine owns; a person may not edit them. */
const DERIVED_COLUMNS = [
	'run_kind',
	'sequence',
	'company_id',
	'period',
	'configuration_hash',
	'core_input_hash',
	'statutory_snapshot_id',
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
 * `statutory_snapshot_id` is the effective `jurisdictions` row the configuration was picked under —
 * the snapshot that governed this calculation — captured atomically beside the configuration it is
 * one half of. `calculation_version` is the engine identity that interpreted both.
 */
const derivedColumns = (prepared: PreparedRun) => ({
	configuration_hash: prepared.configuration.hash,
	core_input_hash: corePayrollInputHash(prepared),
	statutory_snapshot_id: prepared.configuration.jurisdiction.id,
	calculation_version: CALCULATION_VERSION,
	pay_date: prepared.window.payDate,
	attendance_from: prepared.window.attendance.start,
	attendance_to: prepared.window.attendance.end
});

/** Calculate, and hand back the run's columns with every payslip it produced nested under them. */
const buildGraph = (prepared: PreparedRun, baseline?: unknown) =>
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
			...derivedColumns(prepared),
			payslip_payroll_run:
				baseline === undefined
					? built.payslip_payroll_run
					: supplementalPayroll(built.payslip_payroll_run, baseline)
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
					Effect.map(
						gatherPayrollRun({ api, companyId: one.company_id!, period: one.period! }),
						(run) => [runKey(one.company_id!, one.period!), run] as const
					)
				);
				return new Map(entries);
			}),
		perRecord: {
			before: {
				description:
					'Freezes inputs, enforces payment order and calculates regular payroll or a same-month supplemental difference and returns the run together with every payslip, every captured input junction and every adjustment it produced.',
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
								if (input[column] != null && String(input[column]) !== String(existing[column]))
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
							const blocked = previous.find(
								(run) =>
									run.id !== existing.id &&
									(run.period < existing.period ||
										(run.period === existing.period && run.sequence < existing.sequence))
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
						const runs = yield* api.db.payroll_runs.findMany({
							where: { company_id: { eq: companyId } },
							limit: 20_000
						});
						if (runs.length >= 20_000) refuse('Too many payrolls to verify settlement order.');
						const later = runs.find((run) => run.period > period);
						if (later != null)
							refuse(
								`Payroll ${later.period} already exists. Record this correction in the current payroll period.`
							);
						const unsettled = runs.find((run) => run.lifecycle !== 'PAID');
						if (unsettled != null)
							refuse(
								`Payroll ${unsettled.period} is still a draft. Settle or delete it before another run.`
							);
						const sameMonth = runs
							.filter((run) => run.period === period)
							.toSorted((a, b) => b.sequence - a.sequence);
						const previous = sameMonth[0];
						const runKind = input.run_kind ?? 'REGULAR';
						if (runKind === 'REGULAR' && previous != null)
							refuse(
								`Payroll ${period} already exists. Use an ad hoc run for same-month adjustments.`
							);
						if (runKind === 'AD_HOC' && previous == null)
							refuse('An ad hoc payroll needs a paid regular payroll in the same month.');
						if (previous != null && previous.core_input_hash == null)
							refuse(
								'This paid payroll predates input fingerprints. Record adjustments in a later regular payroll.'
							);
						if (
							previous != null &&
							(previous.configuration_hash !== facts.configuration.hash ||
								previous.calculation_version !== CALCULATION_VERSION ||
								previous.core_input_hash !== corePayrollInputHash(facts))
						)
							refuse(
								'The paid payroll inputs or calculation version changed. An ad hoc run may only add monetary entries; record other corrections in a later regular payroll.'
							);
						const blocking = yield* payrollRunPrecheck({
							api,
							configuration: facts.configuration,
							window: facts.window
						});
						if (blocking.length > 0) refuse(describeIssues(blocking));
						// The paid month's cumulative baseline is read back from its payslips, never from a
						// copy on the run: the stored amounts are the settled facts.
						const baseline =
							previous == null
								? undefined
								: storedCumulativePayroll(
										yield* api.db.payslips.findMany({
											where: { payroll_run_id: { eq: previous.id } },
											with: {
												payslip_adjustment_payslip: true,
												payslip_work_day_input_payslip: true,
												payslip_component_entry_input_payslip: true,
												payslip_leave_request_input_payslip: true,
												payslip_loan_repayment_input_payslip: true
											},
											limit: 10_000
										})
									);
						return {
							...input,
							lifecycle: 'DRAFT' as const,
							run_kind: runKind,
							sequence: previous == null ? 0 : previous.sequence + 1,
							...(yield* buildGraph(facts, baseline))
						};
					})
			}
		}
	},

	/**
	 * Deleting a run is the settlement lock's release, and the only one.
	 *
	 * `payslips.payroll_run_id` is declared to cascade, and the four input junctions cascade from
	 * their payslips with it, so the captures this run held over work days, component entries, loan
	 * repayments and leave requests are dropped by the database in the same statement that drops the
	 * run — and the records become editable again the moment the run stops standing. That is the
	 * owner's rule verbatim: locked while the run stands, released only if the run is deleted.
	 */
	delete: {
		perRecord: {
			before: {
				description:
					'Allows a payroll run to be deleted only while it is still a draft, so a period that has been paid can never be erased and the settlement locks it holds over work days, component entries, loan repayments and leave requests are never released.',
				handler: ({ existing }) => {
					// The refusal that makes a paid run's locks permanent. Deleting a PAID run would cascade
					// its captured inputs away and quietly reopen every record behind money that has
					// already left the building — so the correction path is the only path, and the message
					// says so rather than leaving the person to find out.
					if (existing.lifecycle !== 'DRAFT')
						refuse(
							`Payroll run ${existing.period} is ${existing.lifecycle} and cannot be deleted. ` +
								'A paid run is the record of money that has been paid, and deleting it would ' +
								'release every work day, entry, repayment and leave record it settled. Correct ' +
								'it with a component entry in a later draft run instead.'
						);
				}
			}
		}
	}
} satisfies Hooks<PreparedRuns>;
