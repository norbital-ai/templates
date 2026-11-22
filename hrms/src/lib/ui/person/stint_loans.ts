import { new_id, type Id, type PlainDate, type ReadAnswer } from '@norbital-ai/bolt';
import { DateTime } from 'effect';
import type { Law } from '../../../data/model/jurisdiction/service/law.js';
import type { Json, JsonObject } from '../../foundation.js';
import {
	buildLoanSchedule,
	FINAL_SETTLEMENT,
	loanDisposition,
	loanRecovery,
	newLoanRepayments
} from '../../../data/model/entry/loan_catalog_entry/service/loan_schedule.js';

/** The stint a person leaves, as its loans name it. */
export type Leaving = {
	readonly id: Id<'employment'>;
	readonly entity_id: Id<'entity'>;
	readonly employee_id: Id<'employee_profile'>;
};
/** Rows by callable, for one `ctx.act` map: planned in the order its callables were added. */
export type Writes = Record<string, Json[]>;

const add = (writes: Writes, callable: string, rows: readonly Json[]) => {
	if (rows.length > 0) (writes[callable] ??= []).push(...rows);
};
const plain = (amount: number) =>
	new Intl.NumberFormat('en', { useGrouping: false, maximumFractionDigits: 20 }).format(amount);

/** Each loan less what payroll has already repaid; the open schedule does not count until a run seals it. */
export function outstandingOf<L extends { readonly id: unknown; readonly quantity: unknown }>(
	loanRows: readonly L[],
	repayments: readonly {
		readonly loan_id: unknown;
		readonly amount: unknown;
		readonly payroll_run_id?: unknown;
	}[]
) {
	const paid = new Map<string, number>();
	for (const row of repayments) {
		if (row.payroll_run_id == null) continue;
		const key = String(row.loan_id);
		paid.set(key, (paid.get(key) ?? 0) + Number(row.amount ?? 0));
	}
	return loanRows
		.map((row) => ({ row, amount: Number(row.quantity ?? 0) - (paid.get(String(row.id)) ?? 0) }))
		.filter((item) => item.amount > 0.000001);
}

/** A stint's loans and instalments with the revisions a write targets: the read a leaver's or a transfer's plan takes. */
export const loansRead = (stint: Id<'employment'>) =>
	({
		loan_catalog_entry: {
			where: { employment_id: { eq: stint } },
			fields: ['id', 'revision', 'catalog_code', 'quantity', 'repayment_period'],
			limit: 10000
		},
		loan_catalog_entry_repayment: {
			where: { employment_id: { eq: stint } },
			fields: ['id', 'revision', 'loan_id', 'amount', 'payroll_run_id'],
			limit: 10000
		}
	}) as const;
export type Loans = ReadAnswer<ReturnType<typeof loansRead>>;

/** The outstanding loans, and the instalments of theirs no run has taken. */
const position = (held: Loans) => {
	const outstanding = outstandingOf(
		held.loan_catalog_entry.rows,
		held.loan_catalog_entry_repayment.rows
	);
	const loans = new Set(outstanding.map((item) => item.row.id));
	return {
		outstanding,
		open: held.loan_catalog_entry_repayment.rows.filter(
			(row) => loans.has(row.loan_id) && row.payroll_run_id == null
		)
	};
};
const targetOf = (row: { readonly id: string; readonly revision: number }) => ({
	target: { id: row.id, revision: row.revision }
});

/**
 * A leaver's loans: final pay repays what the recovery allows, the rest stays open on a recalibrated schedule from
 * the month after the last day, and HR gets a task to chase it. The rows go in the write that ends the stint.
 */
export function recoverLoans(
	held: Loans,
	current: Leaving,
	lastDay: PlainDate,
	pay: {
		readonly expectedPay: number | null;
		readonly floorPercent: number;
		readonly decimals: number;
	},
	task: (remaining: number) => string
): Writes {
	const { outstanding, open } = position(held);
	const writes: Writes = {};
	if (outstanding.length === 0 || pay.expectedPay === null) return writes;
	const plan = loanRecovery({
		loans: outstanding.map((item) => ({ id: item.row.id, outstanding: item.amount })),
		expectedPay: pay.expectedPay,
		floorPercent: pay.floorPercent,
		decimals: pay.decimals
	});
	add(writes, 'loan_catalog_entry_repayment.delete', open.map(targetOf));
	const nextMonth = DateTime.formatIsoDateUtc(
		DateTime.add(DateTime.startOf(DateTime.makeUnsafe(lastDay), 'month'), { months: 1 })
	);
	for (const item of outstanding) {
		const share = plan.allocations.find((row) => row.id === item.row.id);
		if (share === undefined) continue;
		if (share.final > 0)
			add(writes, 'loan_catalog_entry_repayment.create', [
				{
					entity_id: current.entity_id,
					employment_id: current.id,
					loan_id: item.row.id,
					amount: plain(share.final),
					paid_on: lastDay,
					payment_reference:
						share.remaining > 0 ? `${FINAL_SETTLEMENT} (partial)` : FINAL_SETTLEMENT
				}
			]);
		if (share.remaining <= 0) continue;
		const oldEnd = item.row.repayment_period.to;
		const end =
			oldEnd !== null && oldEnd.slice(0, 7) >= nextMonth.slice(0, 7)
				? oldEnd
				: DateTime.formatIsoDateUtc(DateTime.add(DateTime.makeUnsafe(nextMonth), { months: 11 }));
		add(writes, 'loan_catalog_entry.update', [
			{
				...targetOf(item.row),
				set: {
					repayment_period: {
						from: DateTime.formatIsoDateUtc(
							DateTime.add(DateTime.makeUnsafe(lastDay), { days: 1 })
						),
						to: end
					}
				}
			}
		]);
		add(
			writes,
			'loan_catalog_entry_repayment.create',
			buildLoanSchedule({
				principal: share.remaining,
				from: nextMonth,
				to: end,
				repayments: []
			}).create.map((row) => ({
				entity_id: current.entity_id,
				employment_id: current.id,
				loan_id: item.row.id,
				amount: plain(row.amount),
				paid_on: row.paid_on
			}))
		);
	}
	if (plan.remaining > 0)
		add(writes, 'obligation.create', [
			{
				entity_id: current.entity_id,
				employee_id: current.employee_id,
				employment_id: current.id,
				title: task(plan.remaining),
				due_on: nextMonth,
				occurrence_key: `LOAN_RECOVERY:${current.id}:exit:${lastDay}`
			}
		]);
	return writes;
}

/**
 * A transfer as one act map, planned in its order: the old stint ends on `lastDay`, the next (`next`, its first terms
 * and parameters) starts under an id minted here, and the old stint's outstanding loans follow it. Under the same law
 * (`carry`) each loan moves to the next stint and its company, and its write takes its open schedule along. Under
 * another the open schedule goes, and each loan is settled from the old stint's final pay, or opened again on the next
 * stint under the target law's row of its code with a fresh schedule.
 */
export function transferActs(
	held: Loans,
	from: Omit<Leaving, 'employee_id'> & {
		readonly revision: number;
		readonly effective_range: { readonly from: PlainDate };
	},
	end: { readonly lastDay: PlainDate; readonly reason: string },
	next: JsonObject,
	target: {
		readonly entityId: Id<'entity'>;
		readonly law: Law;
		readonly carry: boolean;
		readonly settle: boolean;
	}
): Writes {
	const stint = new_id('employment');
	const writes: Writes = {
		'employment.update': [
			{
				target: { id: from.id, revision: from.revision },
				set: {
					effective_range: { from: from.effective_range.from, to: end.lastDay },
					reason: end.reason
				}
			}
		],
		'employment.create': [{ ...next, id: stint }]
	};
	const { outstanding, open } = position(held);
	if (target.carry) {
		// each loan's own write takes its open instalments along
		const set = { entity_id: target.entityId, employment_id: stint };
		add(
			writes,
			'loan_catalog_entry.update',
			outstanding.map((item) => ({ ...targetOf(item.row), set }))
		);
		return writes;
	}
	add(writes, 'loan_catalog_entry_repayment.delete', open.map(targetOf));
	const start = DateTime.add(DateTime.makeUnsafe(end.lastDay), { days: 1 });
	const first = DateTime.formatIsoDateUtc(start);
	for (const item of outstanding) {
		// the loan keeps its code where the target law has a row of it
		const targetCatalog = target.law.rows.loan_catalog.some(
			(row) => row.code === item.row.catalog_code
		);
		if (
			loanDisposition({ carry: target.carry, settle: target.settle, targetCatalog }) === 'SETTLE'
		) {
			add(writes, 'loan_catalog_entry_repayment.create', [
				{
					entity_id: from.entity_id,
					employment_id: from.id,
					loan_id: item.row.id,
					amount: plain(item.amount),
					paid_on: end.lastDay,
					payment_reference: 'Transfer settlement'
				}
			]);
			continue;
		}
		const oldEnd = item.row.repayment_period.to;
		const to =
			oldEnd !== null && oldEnd > first
				? oldEnd
				: DateTime.formatIsoDateUtc(DateTime.add(start, { months: 12 }));
		// a replacement loan arrives with its schedule
		add(writes, 'loan_catalog_entry.create', [
			{
				entity_id: target.entityId,
				employment_id: stint,
				catalog_code: item.row.catalog_code,
				quantity: plain(item.amount),
				repayment_period: { from: first, to },
				repayments: newLoanRepayments(
					{ entity_id: target.entityId, employment_id: stint },
					{ principal: item.amount, from: first, to }
				)
			}
		]);
	}
	return writes;
}
