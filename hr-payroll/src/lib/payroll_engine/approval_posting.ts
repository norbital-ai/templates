import { Effect, Schema } from 'effect';
import type { EffectCtx } from '@norbital-ai/bolt';
import { JsonObject } from './contracts.js';
import type { JsonObject as JsonObjectType } from './contracts.js';
import { isJsonObject, Refusal, type Json } from './foundation.js';
import { approvalOperation } from './balance.js';
import { queryRows, type Reader } from './reads.js';

type Family = 'leave' | 'claim' | 'adhoc';

const ACTION: Readonly<Record<Family, string>> = {
	leave: 'leave_catalog_entry',
	claim: 'claim_catalog_entry',
	adhoc: 'adhoc_catalog_entry'
};

const apply = (
	account: JsonObjectType,
	operations: readonly ReturnType<typeof approvalOperation>[]
) => {
	const next: Record<string, Record<string, Json>> = {};
	for (const [family, values] of Object.entries(account))
		next[family] = isJsonObject(values) ? { ...values } : {};
	for (const operation of operations) {
		if (operation.amount < 0)
			throw new Refusal({ message: `${operation.code}: amount must be nonnegative.` });
		const family = (next[operation.account] ??= {});
		const current = family[operation.code];
		const value = typeof current === 'number' ? current : undefined;
		switch (operation.operation) {
			case 'CREATE':
				if (value !== undefined) throw new Refusal({ message: `${operation.code}: exists.` });
				family[operation.code] = operation.amount;
				break;
			case 'REMOVE':
				if (value !== 0) throw new Refusal({ message: `${operation.code}: not empty.` });
				delete family[operation.code];
				break;
			case 'ADD':
				family[operation.code] = (value ?? 0) + operation.amount;
				break;
			case 'DEDUCT': {
				const left = (value ?? 0) - operation.amount;
				if (left < 0) throw new Refusal({ message: `${operation.code}: insufficient balance.` });
				family[operation.code] = left;
				break;
			}
		}
	}
	return Schema.decodeUnknownSync(JsonObject)(next);
};

/** The same operation `postApproval` will post, checked against the current account before the write commits. */
export const assertApprovalBalance = Effect.fn('payroll.assertApprovalBalance')(function* (
	read: Reader,
	family: Family,
	entries: readonly JsonObjectType[],
	postedAt: string
) {
	if (entries.length === 0) return;
	const employmentIds = [...new Set(entries.map((entry) => String(entry.employment_id)))];
	const contracts = yield* queryRows(read, {
		employee_contract: {
			where: { id: { in: employmentIds } },
			fields: ['employee_id'],
			limit: 10000
		}
	});
	const owner = new Map(
		(contracts.employee_contract ?? []).map((row) => [
			String(row.id),
			{ employee_id: String(row.employee_id) }
		])
	);
	const catalogModel = {
		leave: 'leave_catalog',
		claim: 'claim_catalog',
		adhoc: 'adhoc_catalog'
	}[family];
	const catalogIds = [
		...new Set(
			entries.flatMap((entry) => (typeof entry.catalog_id === 'string' ? [entry.catalog_id] : []))
		)
	];
	const catalogs =
		catalogIds.length === 0
			? []
			: ((yield* queryRows(read, {
					[catalogModel]: {
						where: { id: { in: catalogIds } },
						fields: ['id', 'code'],
						limit: 10000
					}
				}))[catalogModel] ?? []);
	const catalogCodes = new Map(
		catalogs.flatMap((row) =>
			typeof row.id === 'string' && typeof row.code === 'string'
				? [[row.id, row.code] as const]
				: []
		)
	);
	const coded = (entry: JsonObjectType) =>
		typeof entry.catalog_id === 'string' && catalogCodes.has(entry.catalog_id)
			? { ...entry, catalog_code: catalogCodes.get(entry.catalog_id) ?? '' }
			: entry;
	const employeeIds = [...new Set([...owner.values()].map((row) => row.employee_id))];
	const balances =
		employeeIds.length === 0
			? []
			: ((yield* queryRows(read, {
					employee_balance: {
						where: { employee_id: { in: employeeIds } },
						fields: ['employee_id', 'account'],
						limit: 10000
					}
				})).employee_balance ?? []);
	const held = new Map(
		balances.map((row) => [String(row.employee_id), isJsonObject(row.account) ? row.account : {}])
	);
	const running = new Map<string, JsonObjectType>();
	for (const entry of entries) {
		const ownerRow = owner.get(String(entry.employment_id));
		if (ownerRow === undefined) continue;
		const operation = approvalOperation(family, coded(entry), postedAt);
		const account = running.get(ownerRow.employee_id) ?? held.get(ownerRow.employee_id) ?? {};
		running.set(ownerRow.employee_id, apply(account, [operation]));
	}
});

/**
 * Commit-time posting: access control has already approved the write, so its ledger rows and the
 * employee's cumulative account map commit together.
 */
export const postApproval = Effect.fn('payroll.postApproval')(function* (
	ctx: EffectCtx,
	family: Family,
	entries: readonly JsonObjectType[]
) {
	if (entries.length === 0) return;
	const employmentIds = [...new Set(entries.map((entry) => String(entry.employment_id)))];
	const contracts = yield* queryRows(ctx.query, {
		employee_contract: {
			where: { id: { in: employmentIds } },
			fields: ['employee_id'],
			limit: 10000
		}
	});
	const owner = new Map(
		(contracts.employee_contract ?? []).map((row) => [
			String(row.id),
			{ employee_id: String(row.employee_id) }
		])
	);
	const catalogModel = {
		leave: 'leave_catalog',
		claim: 'claim_catalog',
		adhoc: 'adhoc_catalog'
	}[family];
	const catalogIds = [
		...new Set(
			entries.flatMap((entry) => (typeof entry.catalog_id === 'string' ? [entry.catalog_id] : []))
		)
	];
	const catalogs =
		catalogIds.length === 0
			? []
			: ((yield* queryRows(ctx.query, {
					[catalogModel]: {
						where: { id: { in: catalogIds } },
						fields: ['id', 'code'],
						limit: 10000
					}
				}))[catalogModel] ?? []);
	const catalogCodes = new Map(
		catalogs.flatMap((row) =>
			typeof row.id === 'string' && typeof row.code === 'string'
				? [[row.id, row.code] as const]
				: []
		)
	);
	const coded = (entry: JsonObjectType) =>
		typeof entry.catalog_id === 'string' && catalogCodes.has(entry.catalog_id)
			? { ...entry, catalog_code: catalogCodes.get(entry.catalog_id) ?? '' }
			: entry;
	const employeeIds = [...new Set([...owner.values()].map((row) => row.employee_id))];
	const balances = yield* queryRows(ctx.query, {
		employee_balance: {
			where: { employee_id: { in: employeeIds } },
			fields: ['employee_id', 'account'],
			limit: 10000
		}
	});
	const held = new Map(
		(balances.employee_balance ?? []).map((row) => [
			String(row.employee_id),
			{ id: String(row.id), account: isJsonObject(row.account) ? row.account : {} }
		])
	);
	const missing = [...owner.values()].filter((row) => !held.has(row.employee_id));
	if (missing.length > 0) {
		const created = yield* ctx.act.checked([
			{
				callable: 'employee_balance.create',
				input: missing.map((row) => ({
					employee_id: row.employee_id,
					account: {}
				}))
			}
		]);
		for (const [index, row] of (created.records ?? []).entries()) {
			const ownerRow = missing[index];
			if (ownerRow === undefined || !isJsonObject(row)) continue;
			if (row.model === 'employee_balance' && typeof row.id === 'string')
				held.set(ownerRow.employee_id, { id: row.id, account: {} });
		}
	}

	const byEmployee = new Map<string, { id: string; account: JsonObject }>();
	for (const entry of entries) {
		const ownerRow = owner.get(String(entry.employment_id));
		if (ownerRow === undefined) continue;
		const balance = held.get(ownerRow.employee_id);
		if (balance === undefined)
			return yield* Effect.fail(
				new Refusal({ message: `${ACTION[family]}: the employee has no balance row.` })
			);
		const operation = approvalOperation(family, coded(entry), ctx.today);
		const current = byEmployee.get(ownerRow.employee_id) ?? balance;
		byEmployee.set(ownerRow.employee_id, {
			id: current.id,
			account: apply(current.account, [operation])
		});
	}

	const ledger: Json[] = [];
	const balancesToWrite: Json[] = [];
	for (const [employeeId, balance] of byEmployee) {
		balancesToWrite.push({ target: balance.id, set: { account: balance.account } });
		for (const entry of entries) {
			const ownerRow = owner.get(String(entry.employment_id));
			if (ownerRow?.employee_id !== employeeId) continue;
			const operation = approvalOperation(family, coded(entry), ctx.today);
			ledger.push({
				balance_id: balance.id,
				operation: operation.operation,
				account: operation.account,
				code: operation.code,
				amount: operation.amount,
				...(operation.unit === undefined ? {} : { unit: operation.unit }),
				effective_on: operation.effective_on,
				...(operation.source_id === undefined ? {} : { source_id: operation.source_id })
			});
		}
	}
	yield* ctx.act.checked([
		{ callable: 'ledger_entry.create', input: ledger },
		{ callable: 'employee_balance.update', input: balancesToWrite }
	]);
});
