import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import {
	leavePlanner,
	leaveAccountIdFor,
	readLeaveContext,
	stableUuid
} from '../src/lib/leave/entitlements.ts';

test('a leave account is named by one formula, stably, as a valid UUID', () => {
	const id = leaveAccountIdFor({
		employment_id: 'emp-1',
		leave_code: 'ANNUAL_LEAVE',
		leave_year: 2026
	});
	assert.equal(
		id,
		leaveAccountIdFor({ employment_id: 'emp-1', leave_code: 'ANNUAL_LEAVE', leave_year: '2026' })
	);
	assert.notEqual(
		id,
		leaveAccountIdFor({ employment_id: 'emp-1', leave_code: 'ANNUAL_LEAVE', leave_year: 2027 })
	);
	assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
	assert.equal(stableUuid('x'), stableUuid('x'));
});

test('the planner serves reads from context, keeps writes in memory, and hands them back as nested rows', async () => {
	const context = {
		employments: [{ id: 'emp-1', company_id: 'co', approval_id: null }],
		companies: [],
		employees: [],
		employment_terms: [],
		employee_children: [],
		leave_plans: [],
		leave_types: [],
		jurisdictions: [],
		leave_accounts: [
			{
				id: 'kept',
				employment_id: 'emp-1',
				leave_code: 'SICK',
				leave_year: 2026,
				approval_id: null
			}
		],
		leave_entries: [
			{
				id: 'old-entry',
				leave_account_id: 'kept',
				kind: 'ACCRUAL',
				days: 1,
				source_key: 'accrual:1',
				approval_id: null
			}
		],
		leave_requests: []
	};
	const planner = leavePlanner(context as never, () => Effect.succeed([]) as never);
	const db = planner.api.db as never as Record<
		string,
		Record<string, (input?: unknown) => Effect.Effect<unknown>>
	>;
	await Effect.runPromise(
		db.leave_accounts!.mutate!([
			{
				employment_id: 'emp-1',
				leave_code: 'ANNUAL_LEAVE',
				leave_year: 2026,
				account_kind: 'YEAR',
				event_reference: '',
				entitlement_days: 14
			},
			{ id: 'kept', status: 'CLOSED' }
		])
	);
	const opened = (await Effect.runPromise(
		db.leave_accounts!.findFirst!({
			where: {
				employment_id: { eq: 'emp-1' },
				leave_code: { eq: 'ANNUAL_LEAVE' },
				leave_year: { eq: 2026 }
			}
		})
	)) as { id: string };
	assert.equal(
		opened.id,
		leaveAccountIdFor({ employment_id: 'emp-1', leave_code: 'ANNUAL_LEAVE', leave_year: 2026 })
	);
	await Effect.runPromise(
		db.leave_entries!.mutate!([
			{ leave_account_id: opened.id, kind: 'OPENING_ENTITLEMENT', days: 14, source_key: 'opening' },
			{ leave_account_id: opened.id, kind: 'OPENING_ENTITLEMENT', days: 14, source_key: 'opening' }
		])
	);
	const nested = planner.nestedAccountsOf('emp-1') as Array<
		Record<string, unknown> & { entry_leave_account: Array<Record<string, unknown>> }
	>;
	assert.equal(nested.length, 2, 'the complete set: the stored account and the new one');
	const kept = nested.find((row) => row.id === 'kept')!;
	assert.deepEqual(
		kept,
		{ id: 'kept', status: 'CLOSED', entry_leave_account: [{ id: 'old-entry' }] },
		'a stored account is restated by id with its change; its stored entries by id'
	);
	const fresh = nested.find((row) => row.id === opened.id)!;
	assert.equal(fresh.entitlement_days, 14);
	assert.equal(
		fresh.entry_leave_account.length,
		1,
		'the duplicate entry collapsed on its deterministic id'
	);
	assert.equal(typeof fresh.entry_leave_account[0]!.id, 'string');
	assert.deepEqual(planner.counts(), {
		accounts_created: 1,
		accounts_updated: 1,
		entries_created: 1
	});
});

test('the planner names the employments whose nested set changed, and only those', async () => {
	const context = {
		employments: [
			{ id: 'emp-1', company_id: 'co', approval_id: null },
			{ id: 'emp-2', company_id: 'co', approval_id: null }
		],
		companies: [],
		employees: [],
		employment_terms: [],
		employee_children: [],
		leave_plans: [],
		leave_types: [],
		jurisdictions: [],
		leave_accounts: [
			{
				id: 'stored',
				employment_id: 'emp-1',
				leave_code: 'ANNUAL_LEAVE',
				leave_year: 2026,
				approval_id: null
			},
			{
				id: 'quiet',
				employment_id: 'emp-2',
				leave_code: 'ANNUAL_LEAVE',
				leave_year: 2026,
				approval_id: null
			}
		],
		leave_entries: [],
		leave_requests: []
	};
	const planner = leavePlanner(context as never, () => Effect.succeed([]) as never);
	const db = planner.api.db as never as Record<
		string,
		Record<string, (input?: unknown) => Effect.Effect<unknown>>
	>;
	assert.deepEqual(planner.changedEmploymentIds(), []);
	await Effect.runPromise(
		db.leave_entries!.mutate!([
			{
				leave_account_id: 'stored',
				kind: 'STATUTORY_ADJUSTMENT',
				days: 2,
				source_key: 'statutory:law-2',
				statutory_profile_id: 'law-2'
			}
		])
	);
	assert.deepEqual(planner.changedEmploymentIds(), ['emp-1']);
	// The changed employment restates its whole set: the stored account by id, its new line whole.
	assert.deepEqual(
		planner
			.nestedAccountsOf('emp-1')
			.map((account) => [
				account.id,
				(account.entry_leave_account as { source_key?: string }[]).map(
					(entry) => entry.source_key ?? '(by id)'
				)
			]),
		[['stored', ['statutory:law-2']]]
	);
});

test('the context reads only the leave years around the planning date, plus open event accounts', async () => {
	const wheres: Record<string, unknown>[] = [];
	const db = new Proxy(
		{},
		{
			get: (_target, collection: string) => ({
				findMany: (input: { where: Record<string, unknown> }) => {
					wheres.push({ collection, ...input.where });
					return Effect.succeed(
						collection === 'employments'
							? [{ id: 'emp-1', company_id: 'co', employee_id: 'person', approval_id: null }]
							: []
					);
				}
			})
		}
	);
	await Effect.runPromise(readLeaveContext({ db } as never, ['emp-1'], { asOf: '2026-09-06' }));
	const accounts = wheres.find((where) => where.collection === 'leave_accounts');
	assert.deepEqual(accounts?.OR, [
		{ leave_year: { gte: 2024 } },
		{ account_kind: { eq: 'EVENT' }, status: { eq: 'OPEN' } }
	]);
	assert.ok(
		!wheres.some(
			(where) =>
				where.collection === 'leave_entries' &&
				Array.isArray((where.leave_account_id as { in?: unknown[] })?.in) &&
				(where.leave_account_id as { in: unknown[] }).in.length > 0
		)
	);
});
