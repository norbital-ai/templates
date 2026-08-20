/**
 * Step 8 — PERSIST.
 *
 * Three collections, written in dependency order: the payslip, its complete component breakdown,
 * and the source rows naming everything the payslip consumed. A payslip line is the junction. Its
 * strict component union points directly to the configured component, the entered component event,
 * or the statutory scheme that produced the line.
 *
 * A rebuild is safe: the run's existing payslips are deleted first and the cascade takes their
 * lines and their source rows with them. Nothing is merged, so a rebuild cannot leave half of a
 * previous answer behind.
 */

import { Effect } from 'effect';
import { assertComplete, PAGE_LIMIT, type PayrollApi } from './api.js';
import { dedupeClaims, type SettlementClaim } from './claims.js';
import type { ContributionCharge } from './contribute.js';
import type { MeasuredLine } from './measure.js';
import type { PayslipLineComponent } from '../../../custom-types/payslip_line_component/+definition.js';
import type { Settlement } from './settle.js';

export type PendingPayslip = {
	readonly employmentId: string;
	readonly currency: string;
	readonly settlement: Settlement;
	readonly charges: readonly ContributionCharge[];
	/**
	 * The time entries and leave movements this payslip consumed, from `claimsForBundle`.
	 *
	 * Component entries, pay components and repayment agreements are not in here: they are recovered
	 * below from the payslip lines that name them, which is exact where a date range would only be
	 * close.
	 */
	readonly claims: readonly SettlementClaim[];
};

function identifier(row: Record<string, unknown>, what: string): string {
	const id = row.norbital_id;
	if (typeof id !== 'string')
		throw new Error(`Writing ${what} returned a row without an identifier.`);
	return id;
}

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
export function clearRunResults(api: PayrollApi, runId: string): Effect.Effect<void, never, never> {
	return Effect.gen(function* () {
		const existing = yield* api.db.query.payslips.findMany({
			where: { payroll_run_id: { eq: runId } },
			limit: PAGE_LIMIT
		});
		assertComplete(existing, 'payslips to clear');
		if (existing.length === 0) return;

		// The lines and the source rows go with them, and the database does it.
		// `payslip_lines.payslip_id` and `payslip_sources.payslip_id` are declared `cascade(...)` in
		// `+relationship.ts`, and those declarations reach the DDL — until they did, every foreign
		// key was `NO ACTION` and deleting a payslip that still had children was refused outright.
		// Deleting them here as well would be a second mechanism for one rule.
		yield* api.db.payslips.delete(existing.map((row) => row.norbital_id));
	});
}

/**
 * The source claims one persisted line stands for.
 *
 * A line *names* what it consumed: `pay_component_id` is a generated projection of the union arm,
 * `component_entry_id` another, and `repayment_agreement_id` a third. That is the exact set, and
 * exactness matters here more than anywhere else: a record the run priced must lock, and a record
 * it skipped (a recurring allowance whose effective range had lapsed, a loan instalment already
 * covered by an agreement) must not, because nothing has consumed it and a later run still needs it.
 *
 * Statutory lines name no source — a contribution scheme is the law, not a record a run consumes.
 */
function lineClaims(line: {
	readonly component: PayslipLineComponent;
	readonly payslip_id: string;
}): SettlementClaim[] {
	const component = line.component;
	const claims: SettlementClaim[] = [];
	if ('pay_component_id' in component && component.pay_component_id != null) {
		claims.push({
			source_collection: 'pay_components',
			source_record_id: component.pay_component_id
		});
	}
	if (component.kind === 'COMPONENT_ENTRY_ONCE' || component.kind === 'COMPONENT_ENTRY_RECURRING') {
		claims.push({
			source_collection: 'component_entries',
			source_record_id: component.component_entry_id
		});
	}
	if (component.kind === 'LOAN_INSTALMENT') {
		claims.push({
			source_collection: 'repayment_agreements',
			source_record_id: component.agreement_id
		});
	}
	return claims;
}

export function persistPayslips(options: {
	readonly api: PayrollApi;
	readonly runId: string;
	readonly period: string;
	readonly pending: readonly PendingPayslip[];
}): Effect.Effect<{ payslipCount: number; lineCount: number; claimCount: number }, never, never> {
	return Effect.gen(function* () {
		if (options.pending.length === 0) return { payslipCount: 0, lineCount: 0, claimCount: 0 };

		const writeMark = { at: Date.now() };
		/**
		 * Each batch write timed as it lands.
		 *
		 * PERSIST is three `mutate` calls over thousands of rows, and a run killed by the invocation
		 * deadline dies inside one of them — so without this the only thing left of the most expensive
		 * phase in the engine is the absence of its summary line. Naming the batch and its row count
		 * makes "which write" and "how much per row" answerable from one killed run.
		 */
		const wrote = (what: string, rows: number): void => {
			const now = Date.now();
			console.log(`[payroll-write] ${what} rows=${rows} ms=${now - writeMark.at}`);
			writeMark.at = now;
		};

		const payslipRows = yield* options.api.db.payslips.mutate(
			options.pending.map((payslip) => ({
				payroll_run_id: options.runId,
				employment_id: payslip.employmentId,
				gross: payslip.settlement.gross,
				total_deductions: payslip.settlement.totalDeductions,
				net: payslip.settlement.net,
				employer_cost: payslip.settlement.employerCost,
				currency: payslip.currency
			}))
		);
		wrote('payslips', options.pending.length);
		const payslipIdByEmployment = new Map(
			payslipRows.map((row) => [String(row.employment_id), identifier(row, 'a payslip')])
		);
		if (payslipIdByEmployment.size !== options.pending.length)
			throw new Error('Not every calculated employment produced a payslip.');

		type LineInput = {
			readonly payslip_id: string;
			readonly component: PayslipLineComponent;
			readonly bucket: 'EARNING' | 'ABSENCE' | 'DEDUCTION' | 'NON_WAGE_PAYMENT' | 'EMPLOYER_COST';
			readonly amount: number;
			readonly quantity: number | null;
			readonly rate: number | null;
			readonly sequence: number;
		};
		const lineInputs: LineInput[] = [];
		for (const payslip of options.pending) {
			const payslipId = payslipIdByEmployment.get(payslip.employmentId);
			if (payslipId == null)
				throw new Error('A calculated employment has no payslip to hang lines on.');
			let sequence = 1;
			for (const line of payslip.settlement.lines) {
				// Derived overtime carries its own nature — there is no component row to read one off.
				if (line.nature == null || line.nature === 'INFORMATION') continue;
				lineInputs.push({
					payslip_id: payslipId,
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
					statutory_contribution_id: charge.contribution.row.norbital_id,
					base_amount: charge.base,
					band_reference: charge.bandReference,
					special_amounts: charge.special
				};
				lineInputs.push({
					payslip_id: payslipId,
					component: { kind: 'STATUTORY_EMPLOYEE', ...shared },
					bucket: 'DEDUCTION',
					amount: charge.employee,
					quantity: null,
					rate: null,
					sequence: sequence++
				});
				lineInputs.push({
					payslip_id: payslipId,
					component: { kind: 'STATUTORY_EMPLOYER', ...shared },
					bucket: 'EMPLOYER_COST',
					amount: charge.employer,
					quantity: null,
					rate: null,
					sequence: sequence++
				});
			}
		}

		if (lineInputs.length > 0) {
			yield* options.api.db.payslip_lines.mutate(lineInputs);
			wrote('payslip_lines', lineInputs.length);
		}

		/**
		 * Take the settlement locks, in the same step that wrote the figures they protect.
		 *
		 * The claims are the union of what each bundle measured (`claimsForBundle`) and what each
		 * line names — so the set is exact in both directions: nothing a payslip priced goes
		 * unclaimed, and nothing it skipped is locked by a guess.
		 *
		 * Written after the lines and never before them. A claim that landed first would leave a
		 * record locked by a run that then failed to persist anything.
		 */
		const claimsByPayslip = new Map<string, SettlementClaim[]>();
		for (const payslip of options.pending) {
			const payslipId = payslipIdByEmployment.get(payslip.employmentId);
			if (payslipId == null) continue;
			claimsByPayslip.set(payslipId, [...payslip.claims]);
		}
		for (const line of lineInputs) {
			const claims = claimsByPayslip.get(line.payslip_id);
			if (claims == null) continue;
			claims.push(...lineClaims(line));
		}
		const sources = [...claimsByPayslip.entries()].flatMap(([payslipId, claims]) =>
			dedupeClaims(claims).map((claim) => ({
				payslip_id: payslipId,
				source_collection: claim.source_collection,
				source_record_id: claim.source_record_id,
				period: options.period
			}))
		);
		if (sources.length > 0) {
			yield* options.api.db.payslip_sources.mutate(sources);
			wrote('payslip_sources', sources.length);
		}

		return {
			payslipCount: options.pending.length,
			lineCount: lineInputs.length,
			claimCount: sources.length
		};
	});
}

/**
 * Carry a shortfall into the next period.
 *
 * An arrears entry is written for what the negative-net guard could not deduct. It is keyed by the
 * period it covers, and any arrears already written for that same period on the same component is
 * removed first, so rebuilding a run cannot make an employee owe the same money twice.
 */
export function persistShortfalls(options: {
	readonly api: PayrollApi;
	readonly period: string;
	readonly nextPeriod: string;
	readonly payDate: string;
	readonly shortfalls: readonly {
		readonly employmentId: string;
		readonly payComponentId: string;
		readonly amount: number;
	}[];
}): Effect.Effect<void, never, never> {
	return Effect.gen(function* () {
		if (options.shortfalls.length === 0) return;
		const employmentIds = [...new Set(options.shortfalls.map((row) => row.employmentId))];
		const existing = yield* options.api.db.query.component_entries.findMany({
			where: { employment_id: { in: employmentIds } },
			limit: PAGE_LIMIT
		});
		// A truncated read here would leave last build's arrears standing beside this build's, and the
		// employee would owe the same money twice.
		assertComplete(existing, 'component entries to re-arrear');
		const stale = existing.filter(
			(entry) =>
				entry.origin?.kind === 'ARREARS' &&
				entry.origin.covers_periods.length === 1 &&
				entry.origin.covers_periods[0] === options.period
		);
		if (stale.length > 0)
			yield* options.api.db.component_entries.delete(stale.map((row) => row.norbital_id));
		yield* options.api.db.component_entries.mutate(
			options.shortfalls.map((shortfall) => ({
				employment_id: shortfall.employmentId,
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
		);
	});
}

/** A skipped joining period, and what this run is paying for it. */
export type PendingDeferral = {
	readonly employmentId: string;
	readonly employeeNumber: string;
	readonly hireDate: Date | string | null;
	readonly coversPeriod: string;
	readonly paidInPeriod: string;
	readonly payComponentId: string;
	readonly amount: number;
};

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
	readonly api: PayrollApi;
	readonly deferrals: readonly PendingDeferral[];
}): Effect.Effect<void, never, never> {
	return Effect.gen(function* () {
		if (options.deferrals.length === 0) return;
		const employmentIds = [...new Set(options.deferrals.map((row) => row.employmentId))];
		const existing = yield* options.api.db.query.component_entries.findMany({
			where: { employment_id: { in: employmentIds } },
			limit: PAGE_LIMIT
		});
		assertComplete(existing, 'component entries to re-defer');
		const owned = new Set(
			options.deferrals.map(
				(row) => `${row.employmentId}:${row.payComponentId}:${row.coversPeriod}`
			)
		);
		const stale = existing.filter(
			(entry) =>
				entry.origin?.kind === 'ARREARS' &&
				entry.origin.covers_periods.length === 1 &&
				owned.has(
					`${entry.employment_id}:${entry.pay_component_id}:${entry.origin.covers_periods[0]}`
				)
		);
		if (stale.length > 0)
			yield* options.api.db.component_entries.delete(stale.map((row) => row.norbital_id));
		yield* options.api.db.component_entries.mutate(
			options.deferrals.map((row) => {
				const joined = row.hireDate == null ? row.coversPeriod : String(row.hireDate).slice(0, 10);
				return {
					employment_id: row.employmentId,
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
		);
	});
}
