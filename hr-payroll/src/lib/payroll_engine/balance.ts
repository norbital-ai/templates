import type { JsonObject } from './contracts.js';
import { Refusal, leaveDays } from './foundation.js';
import type { LedgerOperation } from './engine.js';

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
