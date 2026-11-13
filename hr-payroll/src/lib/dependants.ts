import type { Id } from '@norbital-ai/bolt';
import type { EffectCtx } from '@norbital-ai/bolt';
import { Effect } from 'effect';
import { isExit } from './payroll_engine/contract_change.js';
import {
	getErrorMessage,
	Refusal,
	type Json,
	type JsonObject
} from './payroll_engine/foundation.js';
import { buildLoanSchedule, FINAL_SETTLEMENT } from './payroll_engine/loan_schedule.js';
import { objectValue, queryAllRows, queryRows } from './payroll_engine/reads.js';

/**
 * What an exit leaves besides pay. The last payslip settles the leave itself (`run_calculation.ts`), so nothing is
 * raised for it. This routine keeps the rest in step with the contract: the tasks an exit raised, and a loan's final
 * settlement.
 */
const EXIT = 'exit:';
/** A task an exit raised: a law's duty or the loan task (`…:<contract>:exit:<last day>` or `exit:<contract>:…:<last day>`). */
export const isExitDuty = (key: string) => key.includes(':exit:') || key.startsWith(EXIT);

const CHAIN = ['id', 'employee_id', 'status', 'effective_range', 'entity_id'];
/** Every contract of the people who hold these contracts. */
const chainsOf = (contracts: readonly string[]) => ({
	employee_id: { is: { employee_contract: { some: { id: { in: [...contracts] } } } } }
});

/** The contracts of these chains that are exits now, each with its last day. */
export const exitsIn = (
	chain: readonly JsonObject[],
	entities: readonly JsonObject[]
): ReadonlyMap<string, string> => {
	const lineage = new Map(entities.map((row) => [String(row.id), String(row.settings_code)]));
	return new Map(
		chain
			.filter((row) => isExit(row, chain, lineage))
			.map((row) => [String(row.id), String(objectValue(row.effective_range).to)])
	);
};

/**
 * One pass over the contracts whose exit was raised, moved or cancelled, safe to repeat. A cancelled exit's loan still
 * holding a final settlement no run took goes back to monthly instalments; then the tasks: open exit tasks that no
 * longer stand, or answered an earlier last day, are waived, and one this routine waived is reopened when its exit
 * stands again. It answers `false` when nothing is left to do, else `0`: the automation runs it once more.
 */
export const reconcile = Effect.fn('dependants.reconcile')(function* (
	ctx: Pick<EffectCtx, 'act' | 'query'>,
	employments: readonly Id<'employee_contract'>[]
) {
	const { employee_contract: chain = [], entity: entities = [] } = yield* queryRows(ctx.query, {
		employee_contract: { where: chainsOf(employments), fields: CHAIN, limit: 10000 },
		entity: { fields: ['id', 'settings_code'], limit: 10000 }
	});
	const asked = new Set<string>(employments);
	const contracts = chain.filter((row) => asked.has(String(row.id)));
	if (contracts.length === 0) return false as const;

	const exits = exitsIn(chain, entities);
	const ids = contracts.map((row) => String(row.id));
	const cancelled = ids.filter((id) => !exits.has(id));
	const found = yield* queryAllRows(ctx.query, {
		loan_catalog_entry: {
			where: { employment_id: { in: cancelled } },
			fields: ['id', 'entity_id', 'employment_id', 'quantity', 'repayment_period'],
			limit: 10000
		},
		loan_catalog_entry_repayment: {
			where: { employment_id: { in: cancelled } },
			fields: [
				'id',
				'revision',
				'loan_id',
				'amount',
				'paid_on',
				'payroll_run_id',
				'payment_reference'
			],
			limit: 10000
		}
	});

	// A cancelled exit's loan still holding the final settlement no run took goes back to monthly instalments.
	const remove: string[] = [];
	const instalments: JsonObject[] = [];
	const repayments = Map.groupBy(found.loan_catalog_entry_repayment ?? [], (row) =>
		String(row.loan_id)
	);
	for (const loan of found.loan_catalog_entry ?? []) {
		const rows = repayments.get(String(loan.id)) ?? [];
		if (
			!rows.some(
				(row) =>
					row.payroll_run_id == null &&
					String(row.payment_reference ?? '').startsWith(FINAL_SETTLEMENT)
			)
		)
			continue;
		const period = objectValue(loan.repayment_period);
		const plan = yield* Effect.try({
			try: () =>
				buildLoanSchedule({
					principal: Number(loan.quantity),
					from: String(period.from),
					to: String(period.to),
					repayments: rows.map((row) => ({
						id: String(row.id),
						amount: Number(row.amount),
						paid_on: String(row.paid_on),
						payroll_run_id: row.payroll_run_id == null ? null : String(row.payroll_run_id)
					}))
				}),
			catch: (error) => new Refusal({ message: getErrorMessage(error) })
		});
		remove.push(...plan.remove);
		instalments.push(
			...plan.create.map((item) => ({
				entity_id: String(loan.entity_id),
				employment_id: String(loan.employment_id),
				loan_id: String(loan.id),
				amount: item.amount,
				paid_on: item.paid_on
			}))
		);
	}

	const revisions = new Map(
		(found.loan_catalog_entry_repayment ?? []).map((row) => [String(row.id), Number(row.revision)])
	);
	const back: Record<string, Json> = Object.fromEntries(
		[
			[
				'loan_catalog_entry_repayment.delete',
				remove.map((id) => ({ target: { id, revision: revisions.get(id) ?? null } }))
			] as const,
			['loan_catalog_entry_repayment.create', instalments] as const
		].filter(([, input]) => input.length > 0)
	);
	if (Object.keys(back).length > 0) {
		yield* ctx.act(back);
		return 0;
	}
	// last, the tasks: read here, so nothing above waits on them. What this routine waived, it reopens when the fact
	// stands again; a task HR waived for its own reason stays.
	const CANCELLED = 'The exit was cancelled.';
	const MOVED = 'The exit date moved; this task answered the earlier date.';
	const { obligation: tasks = [] } = yield* queryRows(ctx.query, {
		obligation: {
			where: { employment_id: { in: ids } },
			fields: ['id', 'revision', 'employment_id', 'occurrence_key', 'state', 'waiver_reason'],
			limit: 10000
		}
	});
	const moves = tasks.flatMap((task): JsonObject[] => {
		const key = String(task.occurrence_key);
		if (!isExitDuty(key)) return [];
		const to = exits.get(String(task.employment_id));
		const due = to !== undefined && key.endsWith(`:${to}`);
		const target = { id: String(task.id), revision: Number(task.revision) };
		if (task.state === 'OPEN' && !due)
			return [
				{
					target,
					set: { state: 'WAIVED', waiver_reason: to === undefined ? CANCELLED : MOVED }
				}
			];
		if (task.state === 'WAIVED' && due && [CANCELLED, MOVED].includes(String(task.waiver_reason)))
			return [{ target, set: { state: 'OPEN', waiver_reason: null } }];
		return [];
	});
	const update: Record<string, Json> = { 'obligation.update': moves };
	if (moves.length > 0) yield* ctx.act(update);
	return false as const;
});
