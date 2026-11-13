import type { Id, PlainDate } from '@norbital-ai/bolt';
import type { PageContext } from '@norbital-ai/bolt/page';
import { run } from '@norbital-ai/ui/effect';
import { BigDecimal, DateTime } from 'effect';
import type { Law } from '../../law.js';
import { isJsonObject, type Json } from '../../payroll_engine/foundation.js';
import {
	buildLoanSchedule,
	FINAL_SETTLEMENT,
	loanDisposition,
	loanRecovery
} from '../../payroll_engine/loan_schedule.js';

type Ctx = Pick<PageContext, 'query' | 'act'>;
/** The stint a person leaves, as its loans name it. */
export type Leaving = {
	readonly id: Id<'employment'>;
	readonly entity_id: Id<'entity'>;
	readonly employee_id: Id<'employee_profile'>;
	readonly employee_number: string;
};
/** Rows by callable, for one `ctx.act` map. */
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

export async function readLoans(ctx: Ctx, stint: Id<'employment'>) {
	const held = await ctx.query({
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
	});
	return {
		held,
		outstanding: outstandingOf(held.loan_catalog_entry.rows, held.loan_catalog_entry_repayment.rows)
	};
}

/** The instalments of the outstanding loans no run has taken. */
const openSchedule = ({ held, outstanding }: Awaited<ReturnType<typeof readLoans>>) => {
	const loanIds = new Set(outstanding.map((item) => String(item.row.id)));
	return held.loan_catalog_entry_repayment.rows.filter(
		(row) => loanIds.has(String(row.loan_id)) && row.payroll_run_id == null
	);
};

/**
 * A leaver's loans: final pay repays what the recovery allows, the rest stays open on a recalibrated schedule from
 * the month after the last day, and HR gets a task to chase it. The rows go in the write that ends the stint.
 */
export async function recoverLoans(
	ctx: Ctx,
	current: Leaving,
	day: PlainDate,
	pay: {
		readonly expectedPay: number | null;
		readonly floorPercent: number;
		readonly decimals: number;
	},
	task: (remaining: number) => string
): Promise<Writes> {
	const position = await readLoans(ctx, current.id);
	const { outstanding } = position;
	const writes: Writes = {};
	if (outstanding.length === 0 || pay.expectedPay === null) return writes;
	const plan = loanRecovery({
		loans: outstanding.map((item) => ({ id: String(item.row.id), outstanding: item.amount })),
		expectedPay: pay.expectedPay,
		floorPercent: pay.floorPercent,
		decimals: pay.decimals
	});
	add(
		writes,
		'loan_catalog_entry_repayment.delete',
		openSchedule(position).map((row) => ({ target: { id: row.id, revision: row.revision } }))
	);
	const nextMonth = DateTime.formatIsoDateUtc(
		DateTime.add(DateTime.startOf(DateTime.makeUnsafe(day), 'month'), { months: 1 })
	);
	for (const item of outstanding) {
		const share = plan.allocations.find((row) => row.id === String(item.row.id));
		if (share === undefined) continue;
		if (share.final > 0)
			add(writes, 'loan_catalog_entry_repayment.create', [
				{
					entity_id: current.entity_id,
					employment_id: current.id,
					loan_id: item.row.id,
					amount: plain(share.final),
					paid_on: day,
					payment_reference:
						share.remaining > 0 ? `${FINAL_SETTLEMENT} (partial)` : FINAL_SETTLEMENT
				}
			]);
		if (share.remaining <= 0) continue;
		const period = item.row.repayment_period;
		const oldEnd = isJsonObject(period) && typeof period.to === 'string' ? period.to : '';
		const end =
			oldEnd.slice(0, 7) >= nextMonth.slice(0, 7)
				? oldEnd
				: DateTime.formatIsoDateUtc(DateTime.add(DateTime.makeUnsafe(nextMonth), { months: 11 }));
		add(writes, 'loan_catalog_entry.update', [
			{
				target: { id: item.row.id, revision: item.row.revision },
				set: {
					repayment_period: {
						from: DateTime.formatIsoDateUtc(DateTime.add(DateTime.makeUnsafe(day), { days: 1 })),
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
				occurrence_key: `LOAN_RECOVERY:${current.id}:exit:${day}`
			}
		]);
	return writes;
}

/**
 * A transferred person's loans. Under the same law they move with the person; under another, each is settled from
 * the old stint's final pay or opened again under the target's catalogue. `writes` go in the write that ends the old
 * stint and creates the next; `follow` writes what names the new stint, once it has an id.
 */
export async function transferOrSettleLoans(
	ctx: Ctx,
	current: Leaving,
	target: { readonly entityId: Id<'entity'>; readonly law: Law },
	day: PlainDate,
	carry: boolean,
	settle: boolean
): Promise<{ writes: Writes; follow: (stint: Id<'employment'>) => Promise<void> }> {
	const position = await readLoans(ctx, current.id);
	const { outstanding } = position;
	const writes: Writes = {};
	if (outstanding.length === 0) return { writes, follow: async () => {} };
	if (carry)
		return {
			writes,
			follow: async (stint) => {
				const set = { entity_id: target.entityId, employment_id: stint };
				const moves: Writes = {};
				add(
					moves,
					'loan_catalog_entry.update',
					outstanding.map((item) => ({
						target: { id: item.row.id, revision: item.row.revision },
						set
					}))
				);
				add(
					moves,
					'loan_catalog_entry_repayment.update',
					openSchedule(position).map((row) => ({
						target: { id: row.id, revision: row.revision },
						set
					}))
				);
				const moved = await run(ctx.act(moves));
				if (moved.kind !== 'committed')
					throw new Error('The carried loan could not be moved to the new employment.');
			}
		};
	add(
		writes,
		'loan_catalog_entry_repayment.delete',
		openSchedule(position).map((row) => ({ target: { id: row.id, revision: row.revision } }))
	);
	const moving: typeof outstanding = [];
	for (const item of outstanding) {
		// the loan keeps its code where the target law has a row of it
		const targetCatalog = target.law.rows.loan_catalog.some(
			(row) => row.code === item.row.catalog_code
		);
		if (loanDisposition({ carry, settle, targetCatalog }) === 'SETTLE')
			add(writes, 'loan_catalog_entry_repayment.create', [
				{
					entity_id: current.entity_id,
					employment_id: current.id,
					loan_id: item.row.id,
					amount: plain(item.amount),
					paid_on: day,
					payment_reference: 'Transfer settlement'
				}
			]);
		else moving.push(item);
	}
	return {
		writes,
		follow: async (stint) => {
			for (const item of moving) {
				const period = item.row.repayment_period;
				const start = DateTime.add(DateTime.makeUnsafe(day), { days: 1 });
				const oldEnd = isJsonObject(period) && typeof period.to === 'string' ? period.to : '';
				const end =
					oldEnd !== '' && oldEnd > DateTime.formatIsoDateUtc(start)
						? oldEnd
						: DateTime.formatIsoDateUtc(DateTime.add(start, { months: 12 }));
				const created = await run(
					ctx.act({
						'loan_catalog_entry.create': [
							{
								entity_id: target.entityId,
								employment_id: stint,
								catalog_code: item.row.catalog_code,
								quantity: plain(item.amount),
								repayment_period: { from: DateTime.formatIsoDateUtc(start), to: end }
							}
						]
					})
				);
				if (created.kind !== 'committed')
					throw new Error('The replacement loan could not be created.');
				const newLoanId = created.records.flatMap((row) =>
					row.model === 'loan_catalog_entry' ? [row.id] : []
				)[0];
				if (newLoanId === undefined) throw new Error('The replacement loan has no id.');
				const last = DateTime.toPartsUtc(DateTime.makeUnsafe(end)),
					first = DateTime.toPartsUtc(start);
				const months = Math.max(
					1,
					Math.min(120, (last.year - first.year) * 12 + last.month - first.month + 1)
				);
				const amount = BigDecimal.fromNumberUnsafe(item.amount);
				const base = BigDecimal.round(
					BigDecimal.divideUnsafe(amount, BigDecimal.fromNumberUnsafe(months)),
					{ scale: 2, mode: 'floor' }
				);
				const scheduled = await run(
					ctx.act({
						'loan_catalog_entry_repayment.create': Array.from({ length: months }, (_, index) => ({
							entity_id: target.entityId,
							employment_id: stint,
							loan_id: newLoanId,
							amount: BigDecimal.format(
								index === months - 1
									? BigDecimal.round(
											BigDecimal.subtract(
												amount,
												BigDecimal.multiply(base, BigDecimal.fromNumberUnsafe(months - 1))
											),
											{ scale: 2, mode: 'half-ceil' }
										)
									: base
							),
							paid_on: DateTime.formatIsoDateUtc(DateTime.add(start, { months: index }))
						}))
					})
				);
				if (scheduled.kind !== 'committed')
					throw new Error('The replacement loan schedule could not be created.');
			}
		}
	};
}
