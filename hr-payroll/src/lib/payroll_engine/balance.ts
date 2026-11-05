import { Effect } from 'effect';
import type { EffectCtx } from '@norbital-ai/bolt';
import type { JsonObject } from './contracts.js';
import { Refusal, isJsonObject, leaveDays, type Json } from './foundation.js';
import type { LedgerOperation } from './engine.js';
import { queryRows } from './reads.js';

export type AccountMap = Record<string, Record<string, number>>;

/** Approvals write the benefit balance immediately; payroll only writes money/statutory/YTD. */
export function applyOperations(
	account: AccountMap,
	operations: readonly LedgerOperation[]
): AccountMap {
	const next: Record<string, Record<string, number>> = Object.fromEntries(
		Object.entries(account).map(([family, values]) => [family, { ...values }])
	);
	for (const operation of operations) {
		if (!Number.isFinite(operation.amount) || operation.amount < 0)
			throw new Refusal({ message: `${operation.code}: operation amount must be nonnegative.` });
		const family = (next[operation.account] ??= {});
		const current = family[operation.code];
		switch (operation.operation) {
			case 'CREATE':
				if (current !== undefined)
					throw new Refusal({ message: `${operation.code}: account already exists.` });
				family[operation.code] = operation.amount;
				break;
			case 'REMOVE':
				if (current === undefined || current !== 0)
					throw new Refusal({ message: `${operation.code}: only a zero account can be removed.` });
				delete family[operation.code];
				break;
			case 'ADD':
				family[operation.code] = (current ?? 0) + operation.amount;
				break;
			case 'DEDUCT': {
				const value = (current ?? 0) - operation.amount;
				if (value < 0)
					throw new Refusal({ message: `${operation.code}: insufficient account balance.` });
				family[operation.code] = value;
				break;
			}
		}
	}
	return next;
}

const amountOf = (entry: JsonObject, key = 'quantity'): number => {
	const value = entry[key];
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
		throw new Refusal({ message: `${key}: expected a nonnegative quantity.` });
	return value;
};

/** Each payroll run applies its own ledger entries to the balance, its projection. */
export const postRunToBalances = Effect.fn('payroll.postRunToBalances')(function* (
	ctx: EffectCtx,
	runs: readonly { readonly id: string; readonly run_number: number; readonly pay_date: string }[]
) {
	const ids = runs.map(({ id }) => id);
	const { payslip: slips = [] } = yield* queryRows(ctx.query, {
		payslip: { where: { payroll_run_id: { in: ids } }, fields: ['employee_id'], limit: 10000 }
	});
	const { employee_balance: balances = [] } = yield* queryRows(ctx.query, {
		employee_balance: {
			where: { employee_id: { in: [...new Set(slips.map((row) => String(row.employee_id)))] } },
			limit: 10000
		}
	});
	const { ledger_entry: ledger = [] } = yield* queryRows(ctx.query, {
		ledger_entry: {
			where: {
				balance_id: { in: balances.map((row) => String(row.id)) },
				effective_on: { in: runs.map(({ pay_date }) => pay_date) }
			},
			limit: 10000
		}
	});
	const entries = ledger.filter(
		({ source_id: source }) => isJsonObject(source) && ids.includes(String(source.id))
	);
	// an effect can run again after a crash: a balance remembers the last run it took
	const lastRun = Math.max(...runs.map(({ run_number }) => run_number));
	const input: Json[] = balances.flatMap((balance) => {
		const held = isJsonObject(balance.account) ? balance.account : {};
		const ytd = isJsonObject(held.ytd) ? held.ytd : {};
		if (Number(ytd.LAST_RUN ?? 0) >= lastRun) return [];
		const account = Object.fromEntries(
			Object.entries(held).map(([family, values]) => [
				family,
				Object.fromEntries(
					Object.entries(isJsonObject(values) ? values : {}).map(([code, value]) => [
						code,
						Number(value)
					])
				)
			])
		);
		// net pay can be negative and has no use held: `ytd` already carries the NET checkpoint
		const own = entries.filter((row) => row.balance_id === balance.id && row.account !== 'payroll');
		const posted = applyOperations(
			account,
			own.map((row) => ({
				operation: row.operation as LedgerOperation['operation'],
				account: String(row.account),
				code: String(row.code),
				amount: Number(row.amount),
				effective_on: String(row.effective_on)
			}))
		);
		return [
			{
				target: String(balance.id),
				set: { account: { ...posted, ytd: { ...posted.ytd, LAST_RUN: lastRun } } }
			}
		];
	});
	if (input.length === 0) return;
	yield* ctx.act.checked([{ callable: 'employee_balance.update', input }]);
});

/**
 * A deleted run's ledger rows stay, unlinked. Whatever they still hold on its pay dates nets to one inverse entry per
 * account code, so the balance returns to where it stood, and a second pass finds nothing left.
 */
export const reverseRunInBalances = Effect.fn('payroll.reverseRunInBalances')(function* (
	ctx: EffectCtx,
	runs: readonly { readonly run_number: number; readonly pay_date: string }[]
) {
	const { ledger_entry: ledger = [] } = yield* queryRows(ctx.query, {
		ledger_entry: {
			where: {
				effective_on: { in: [...new Set(runs.map(({ pay_date }) => pay_date))] },
				account: { in: ['ytd', 'statutory_contribution', 'month', 'payroll'] }
			},
			limit: 10000
		}
	});
	const orphaned = ledger.filter((row) => row.source_id == null);
	const nets = new Map<string, { readonly row: JsonObject; net: number }>();
	for (const row of orphaned) {
		if (row.operation !== 'ADD' && row.operation !== 'DEDUCT') continue;
		const key = JSON.stringify([row.balance_id, row.account, row.code, row.effective_on]);
		const held = nets.get(key) ?? { row, net: 0 };
		held.net += row.operation === 'ADD' ? Number(row.amount) : -Number(row.amount);
		nets.set(key, held);
	}
	const inverse = [...nets.values()].flatMap(({ row, net }) =>
		net === 0
			? []
			: [
					{
						balance_id: String(row.balance_id),
						operation: net > 0 ? ('DEDUCT' as const) : ('ADD' as const),
						account: String(row.account),
						code: String(row.code),
						amount: Math.abs(net),
						effective_on: String(row.effective_on),
						...(row.unit == null ? {} : { unit: String(row.unit) })
					}
				]
	);
	if (inverse.length === 0) return;
	const ids = [...new Set(inverse.map((row) => row.balance_id))];
	const { employee_balance: balances = [] } = yield* queryRows(ctx.query, {
		employee_balance: { where: { id: { in: ids } }, limit: 10000 }
	});
	const first = Math.min(...runs.map(({ run_number }) => run_number));
	const updates: Json[] = balances.flatMap((balance) => {
		const held = isJsonObject(balance.account) ? balance.account : {};
		// deleted before its effect ran: the balance never took this run, so there is nothing to undo
		if (Number((isJsonObject(held.ytd) ? held.ytd : {}).LAST_RUN ?? 0) < first) return [];
		const next: AccountMap = Object.fromEntries(
			Object.entries(held).map(([family, values]) => [
				family,
				Object.fromEntries(
					Object.entries(isJsonObject(values) ? values : {}).map(([code, value]) => [
						code,
						Number(value)
					])
				)
			])
		);
		for (const row of inverse) {
			if (row.balance_id !== balance.id || row.account === 'payroll') continue;
			const family = (next[row.account] ??= {});
			family[row.code] =
				(family[row.code] ?? 0) + (row.operation === 'ADD' ? row.amount : -row.amount);
		}
		return [{ target: String(balance.id), set: { account: next } }];
	});
	yield* ctx.act.checked([
		{ callable: 'ledger_entry.create', input: inverse },
		{ callable: 'employee_balance.update', input: updates }
	]);
});

/** The approval-time operation. A reversal appends the inverse operation, never edits history. */
export function approvalOperation(
	family: 'leave' | 'claim' | 'adhoc',
	entry: JsonObject,
	postedAt: string
): LedgerOperation {
	const code = String(entry.catalog_code ?? entry.code ?? entry.catalog_id ?? '');
	if (code.length === 0) throw new Refusal({ message: 'An entry needs its catalogue code.' });
	const quantity = family === 'leave' ? leaveDays(entry) : amountOf(entry);
	const sourceModel = String(entry.source_model ?? `${family}_catalog_entry`);
	const sourceId = String(entry.id);
	const unit = family === 'leave' ? 'DAY' : entry.unit;
	return {
		operation: entry.is_reversal === true ? 'ADD' : 'DEDUCT',
		account: family,
		code,
		amount: quantity,
		...(typeof unit === 'string' ? { unit: unit as NonNullable<LedgerOperation['unit']> } : {}),
		effective_on: String(
			family === 'leave' && Array.isArray(entry.days) && typeof entry.days[0]?.date === 'string'
				? entry.days[0].date
				: (entry.incurred_on ?? postedAt)
		),
		...(entry.source_id === null ? {} : { source_id: { model: sourceModel, id: sourceId } })
	};
}
