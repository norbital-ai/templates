/**
 * Step 8 — PERSIST.
 *
 * Three collections, written in dependency order: the payslip, its complete component breakdown,
 * and typed attendance/leave source links. A payslip line is the component junction. Its strict
 * union projects direct foreign keys to the configured component, entered event, loan agreement,
 * or statutory scheme that produced the line.
 *
 * A rebuild is safe: the run's existing payslips are deleted first and the cascade takes their
 * lines and their source rows with them. Nothing is merged, so a rebuild cannot leave half of a
 * previous answer behind.
 */

import { Clock, Effect, Schema } from 'effect';
import { PAGE_LIMIT, type PayrollApi, type ReadLog } from './api.js';
import { dedupeClaims, type SettlementClaim } from './claims.js';
import type { ContributionCharge } from './contribute.js';
import type { MeasuredLine } from './measure.js';
import { payslipLineComponentValueSchema } from '../../../datatypes/payslip_line_component/+definition.js';
import type { Settlement } from './settle.js';

/** The post-write capability set with the per-run read log bound, which every engine write uses. */
type PayrollWriteApi = PayrollApi & { readonly reads: ReadLog };

export type PendingPayslip = {
	readonly employmentId: string;
	readonly currency: string;
	readonly settlement: Settlement;
	readonly charges: readonly ContributionCharge[];
	/**
	 * The time entries and leave movements this payslip consumed, from `claimsForBundle`.
	 *
	 * Component entries and loan instalments are not in here: their direct foreign keys already live
	 * on the payslip lines that name them.
	 */
	readonly claims: readonly SettlementClaim[];
};

/**
 * Remove a run's results so it can be rebuilt from scratch.
 *
 * The read is checked against the page ceiling because a partial clear is worse than a failed
 * one: the rebuild would write a second set of payslips alongside the half of the first set this
 * never saw, and the run would report every figure twice.
 *
 * The run's settlement locks go with the payslips, performed by the database: `payslips` cascades
 * to `payslip_sources`, so deleting the payslips here drops the claims that would otherwise make
 * the rebuild self-blocking on the per-payslip unique index. This is the only release path that is
 * not the run's own deletion: a rebuild is the same run reconsidering, so the locks it drops here
 * it immediately takes again.
 *
 * Deleting the run itself needs none of this: `payslips.payroll_run_id` cascades, and so does
 * `payslip_sources.payslip_id`, so the database releases every claim in the same statement. See
 * `src/collections/payslip_sources/+model.ts` for why a hook loop is not the answer.
 */
export function clearRunResults(
	api: PayrollWriteApi,
	runId: string
): Effect.Effect<void, never, never> {
	/**
	 * The run's payslips, stated as none.
	 *
	 * An included `many` relationship is its complete desired state, so an empty list is the removal
	 * — and it needs no read at all, where the delete it replaces had to page every payslip in first
	 * just to name them. That is also why there is no `Effect.gen` here any more: one statement is
	 * the whole function, and a generator wrapping a single yield composes nothing.
	 *
	 * The lines and the source rows still go with them, and the database still does it.
	 * `payslip_lines.payslip_id` and `payslip_sources.payslip_id` are declared `cascade(...)` in
	 * `+relationship.ts`, and those declarations reach the DDL — until they did, every foreign key
	 * was `NO ACTION` and deleting a payslip that still had children was refused outright. Removing
	 * them here as well would be a second mechanism for one rule.
	 */
	return api.db.payroll_runs.mutate({ id: runId, payslip_payroll_run: [] });
}

/** What `persistPayslips` writes and against which run. */
type PersistPayslipsOptions = {
	readonly api: PayrollWriteApi;
	readonly runId: string;
	readonly period: string;
	readonly pending: readonly PendingPayslip[];
};

export function persistPayslips(
	options: PersistPayslipsOptions
): Effect.Effect<{ payslipCount: number; lineCount: number; claimCount: number }, never, never> {
	return Effect.gen(function* () {
		if (options.pending.length === 0) return { payslipCount: 0, lineCount: 0, claimCount: 0 };

		let writeMark = yield* Clock.currentTimeMillis;
		/**
		 * Each batch write timed as it lands.
		 *
		 * PERSIST is three `mutate` calls over thousands of rows, and a run killed by the invocation
		 * deadline dies inside one of them — so without this the only thing left of the most expensive
		 * phase in the engine is the absence of its summary line. Naming the batch and its row count
		 * makes "which write" and "how much per row" answerable from one killed run.
		 */
		const wrote = (what: string, rows: number): Effect.Effect<void> =>
			Effect.gen(function* () {
				const now = yield* Clock.currentTimeMillis;
				yield* Effect.log(`[payroll-write] ${what} rows=${rows} ms=${now - writeMark}`);
				writeMark = now;
			});

		const LineInputSchema = Schema.Struct({
			component: payslipLineComponentValueSchema,
			bucket: Schema.Literals([
				'EARNING',
				'ABSENCE',
				'DEDUCTION',
				'NON_WAGE_PAYMENT',
				'EMPLOYER_COST'
			]),
			amount: Schema.Number,
			quantity: Schema.NullOr(Schema.Number),
			rate: Schema.NullOr(Schema.Number),
			sequence: Schema.Number
		});
		type LineInput = Schema.Schema.Type<typeof LineInputSchema>;

		/**
		 * Every payslip with the lines and locks that belong to it, assembled before anything is
		 * written.
		 *
		 * A line used to carry `payslip_id`, which meant the payslips had to be written first, their
		 * returned ids collected into a map, and two guards written for the two ways that map could
		 * come back wrong — a payslip without an identifier, and an employment without a payslip.
		 * Nested under the payslip that owns them, a line has no id to carry and neither guard has
		 * anything to check: the parent and its children are one write, and the runtime assigns the
		 * link.
		 */
		const graph = options.pending.map((payslip) => {
			let sequence = 1;
			const lines: LineInput[] = [];
			for (const line of payslip.settlement.lines) {
				// Derived overtime carries its own nature — there is no component row to read one off.
				if (line.nature == null || line.nature === 'INFORMATION') continue;
				lines.push({
					component: line.component,
					bucket: line.nature,
					amount: line.amount,
					quantity: line.quantity,
					rate: line.rate,
					sequence: sequence++
				});
			}
			for (const charge of payslip.charges) {
				const shared = {
					statutory_contribution_id: charge.contribution.row.id,
					base_amount: charge.base,
					band_reference: charge.bandReference,
					special_amounts: charge.special
				};
				lines.push({
					component: { kind: 'STATUTORY_EMPLOYEE', ...shared },
					bucket: 'DEDUCTION',
					amount: charge.employee,
					quantity: null,
					rate: null,
					sequence: sequence++
				});
				lines.push({
					component: { kind: 'STATUTORY_EMPLOYER', ...shared },
					bucket: 'EMPLOYER_COST',
					amount: charge.employer,
					quantity: null,
					rate: null,
					sequence: sequence++
				});
			}
			/**
			 * Take the settlement locks in the same write that records the figures they protect.
			 *
			 * These rows exist only for sources that have no natural payslip line: attendance and
			 * leave. Component entries and loan instalments are already linked by the generated
			 * foreign-key projections on `payslip_lines`, so writing them again here would duplicate
			 * one fact.
			 *
			 * They used to be written after the lines and never before, because a claim that landed
			 * first would leave a record locked by a run that then failed to persist anything. In one
			 * declarative write there is no "after": either the payslip, its lines and its locks are
			 * all there, or none of them are.
			 */
			const sources = dedupeClaims([...payslip.claims]).map((claim) => ({
				source: claim,
				period: options.period
			}));
			return { payslip, lines, sources };
		});
		const lineCount = graph.reduce((total, entry) => total + entry.lines.length, 0);
		const claimCount = graph.reduce((total, entry) => total + entry.sources.length, 0);

		yield* options.api.db.payroll_runs.mutate({
			id: options.runId,
			payslip_payroll_run: graph.map(({ payslip, lines, sources }) => ({
				employment_id: payslip.employmentId,
				gross: payslip.settlement.gross,
				total_deductions: payslip.settlement.totalDeductions,
				net: payslip.settlement.net,
				employer_cost: payslip.settlement.employerCost,
				currency: payslip.currency,
				payslip_line_payslip: lines,
				payslip_source_payslip: sources
			}))
		});
		yield* wrote('payroll run graph', options.pending.length + lineCount + claimCount);

		return { payslipCount: options.pending.length, lineCount, claimCount };
	});
}

/** A deduction that could not be taken, and the next period to carry it into. */
type PersistShortfallsOptions = {
	readonly api: PayrollWriteApi;
	readonly period: string;
	readonly nextPeriod: string;
	readonly payDate: string;
	readonly shortfalls: readonly {
		readonly employmentId: string;
		readonly payComponentId: string;
		readonly amount: number;
	}[];
};

/**
 * Carry a shortfall into the next period.
 *
 * An arrears entry is written for what the negative-net guard could not deduct. It is keyed by the
 * period it covers, and any arrears already written for that same period on the same component is
 * removed first, so rebuilding a run cannot make an employee owe the same money twice.
 */
export function persistShortfalls(
	options: PersistShortfallsOptions
): Effect.Effect<void, never, never> {
	return Effect.gen(function* () {
		if (options.shortfalls.length === 0) return;
		const employmentIds = [...new Set(options.shortfalls.map((row) => row.employmentId))];
		const existing = yield* options.api.db.component_entries.findMany({
			where: { employment_id: { in: employmentIds } },
			limit: PAGE_LIMIT
		});
		// A truncated read here would leave last build's arrears standing beside this build's, and the
		// employee would owe the same money twice.
		options.api.reads.assertComplete(existing, 'component entries to re-arrear');
		const isStale = (entry: (typeof existing)[number]): boolean =>
			entry.origin?.kind === 'ARREARS' &&
			entry.origin.covers_periods.length === 1 &&
			entry.origin.covers_periods[0] === options.period;
		/**
		 * Stated as each employment's complete set of component entries, per employment.
		 *
		 * There is one declarative write, and an included `many` relationship is the whole desired
		 * state: entries listed are kept or created, entries left out are removed. That is what
		 * replaces the delete-then-insert pair — and it is the same statement, so a rebuild can no
		 * longer leave last build's arrears standing beside this build's if the write between the two
		 * halves fails. Rows being kept are named by id alone; only the arrears this run owns are
		 * restated in full.
		 */
		yield* Effect.forEach(
			employmentIds,
			(employmentId) =>
				options.api.db.employments.mutate({
					id: employmentId,
					entry_employment: [
						...existing
							.filter((entry) => entry.employment_id === employmentId && !isStale(entry))
							.map((entry) => ({ id: entry.id })),
						...options.shortfalls
							.filter((shortfall) => shortfall.employmentId === employmentId)
							.map((shortfall) => ({
								pay_component_id: shortfall.payComponentId,
								amount: shortfall.amount,
								quantity: null,
								event_date: options.payDate,
								pay_period: options.nextPeriod,
								origin: {
									kind: 'ARREARS' as const,
									covers_periods: [options.period],
									reason: `Net pay for ${options.period} reached zero before this deduction could be taken.`
								}
							}))
					]
				}),
			{ discard: true }
		);
	});
}

/** A skipped joining period, and what this run is paying for it. */
const PendingDeferralSchema = Schema.Struct({
	employmentId: Schema.String,
	employeeNumber: Schema.String,
	hireDate: Schema.NullOr(Schema.String),
	coversPeriod: Schema.String,
	paidInPeriod: Schema.String,
	payComponentId: Schema.String,
	amount: Schema.Number
});
export type PendingDeferral = Schema.Schema.Type<typeof PendingDeferralSchema>;

/**
 * Record a skipped joining period in the employee's own entry stream.
 *
 * The money is already on the payslip — MEASURE derived it, and it went through the grid and the
 * statutory schemes with everything else on this run. This writes the **arrears entry** that says
 * so, on the component the company nominated, keyed by the period it covers.
 *
 * That entry is a record, not an input: the run re-derives the figure from the contract every time,
 * so the entry cannot go stale and cannot be double-counted if a build is repeated. It exists
 * because a wage that appears on one payslip with no trace of where it came from is the kind of
 * number a payroll clerk cannot answer a question about — the entry stream is where "why is there
 * an extra 857.14 on this payslip?" is answerable, and `origin.reason` answers it in words.
 *
 * Delete-first for the same reason `persistShortfalls` does it: rebuilding a month must leave one
 * record of that month's arrears, not two.
 */
export function persistDeferrals(options: {
	readonly api: PayrollWriteApi;
	readonly deferrals: readonly PendingDeferral[];
}): Effect.Effect<void, never, never> {
	return Effect.gen(function* () {
		if (options.deferrals.length === 0) return;
		const employmentIds = [...new Set(options.deferrals.map((row) => row.employmentId))];
		const existing = yield* options.api.db.component_entries.findMany({
			where: { employment_id: { in: employmentIds } },
			limit: PAGE_LIMIT
		});
		options.api.reads.assertComplete(existing, 'component entries to re-defer');
		const owned = new Set(
			options.deferrals.map(
				(row) => `${row.employmentId}:${row.payComponentId}:${row.coversPeriod}`
			)
		);
		const isStale = (entry: (typeof existing)[number]): boolean =>
			entry.origin?.kind === 'ARREARS' &&
			entry.origin.covers_periods.length === 1 &&
			owned.has(
				`${entry.employment_id}:${entry.pay_component_id}:${entry.origin.covers_periods[0]}`
			);
		// Each employment's component entries, stated whole: the ones this run does not own are named
		// by id and kept, the deferrals it does own are restated, and the arrears it superseded are
		// gone by being left out. One statement, so a rebuild cannot double-pay a joining period.
		yield* Effect.forEach(
			employmentIds,
			(employmentId) =>
				options.api.db.employments.mutate({
					id: employmentId,
					entry_employment: [
						...existing
							.filter((entry) => entry.employment_id === employmentId && !isStale(entry))
							.map((entry) => ({ id: entry.id })),
						...options.deferrals
							.filter((row) => row.employmentId === employmentId)
							.map((row) => {
								const joined =
									row.hireDate == null ? row.coversPeriod : String(row.hireDate).slice(0, 10);
								return {
									pay_component_id: row.payComponentId,
									amount: row.amount,
									quantity: null,
									event_date: joined,
									pay_period: row.paidInPeriod,
									origin: {
										kind: 'ARREARS' as const,
										covers_periods: [row.coversPeriod],
										reason:
											`${row.employeeNumber} joined on ${joined}, after the ${row.coversPeriod} attendance ` +
											`window had closed, so ${row.coversPeriod} was not processed. Those days are paid ` +
											`with ${row.paidInPeriod}.`
									}
								};
							})
					]
				}),
			{ discard: true }
		);
	});
}
