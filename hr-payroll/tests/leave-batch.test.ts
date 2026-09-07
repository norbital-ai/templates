import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import {
	leavePlanner,
	leaveEntitlementIdFor,
	readLeaveContext,
	stableUuid
} from '../src/lib/leave/entitlements.ts';

test('a leave entitlement is named by one formula, stably, as a valid UUID', () => {
	const id = leaveEntitlementIdFor({
		employment_id: 'emp-1',
		leave_code: 'ANNUAL_LEAVE',
		leave_year: 2026
	});
	assert.equal(
		id,
		leaveEntitlementIdFor({
			employment_id: 'emp-1',
			leave_code: 'ANNUAL_LEAVE',
			leave_year: '2026'
		})
	);
	assert.notEqual(
		id,
		leaveEntitlementIdFor({ employment_id: 'emp-1', leave_code: 'ANNUAL_LEAVE', leave_year: 2027 })
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
		leave_catalogue: [],
		leave_entitlements: [
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
				leave_entitlement_id: 'kept',
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
		db.leave_entitlements!.mutate!([
			{
				employment_id: 'emp-1',
				leave_code: 'ANNUAL_LEAVE',
				leave_year: 2026,
				entitlement_days: 14
			},
			{ id: 'kept', status: 'CLOSED' }
		])
	);
	const opened = (await Effect.runPromise(
		db.leave_entitlements!.findFirst!({
			where: {
				employment_id: { eq: 'emp-1' },
				leave_code: { eq: 'ANNUAL_LEAVE' },
				leave_year: { eq: 2026 }
			}
		})
	)) as { id: string };
	assert.equal(
		opened.id,
		leaveEntitlementIdFor({ employment_id: 'emp-1', leave_code: 'ANNUAL_LEAVE', leave_year: 2026 })
	);
	await Effect.runPromise(
		db.leave_entries!.mutate!([
			{
				leave_entitlement_id: opened.id,
				kind: 'OPENING_ENTITLEMENT',
				days: 14,
				source_key: 'opening'
			},
			{
				leave_entitlement_id: opened.id,
				kind: 'OPENING_ENTITLEMENT',
				days: 14,
				source_key: 'opening'
			}
		])
	);
	const nested = planner.nestedEntitlementsOf('emp-1') as Array<
		Record<string, unknown> & { entry_leave_entitlement: Array<Record<string, unknown>> }
	>;
	assert.equal(nested.length, 2, 'the complete set: the stored entitlement and the new one');
	const kept = nested.find((row) => row.id === 'kept')!;
	assert.deepEqual(
		kept,
		{ id: 'kept', status: 'CLOSED', entry_leave_entitlement: [{ id: 'old-entry' }] },
		'a stored entitlement is restated by id with its change; its stored entries by id'
	);
	const fresh = nested.find((row) => row.id === opened.id)!;
	assert.equal(fresh.entitlement_days, 14);
	assert.equal(
		fresh.entry_leave_entitlement.length,
		1,
		'the duplicate entry collapsed on its deterministic id'
	);
	assert.equal(typeof fresh.entry_leave_entitlement[0]!.id, 'string');
	assert.deepEqual(planner.counts(), {
		entitlements_created: 1,
		entitlements_updated: 1,
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
		leave_catalogue: [],
		leave_entitlements: [
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
				leave_entitlement_id: 'stored',
				kind: 'ADJUSTMENT',
				days: 2,
				source_key: 'adjust:2026-09-07T00:00:00Z'
			}
		])
	);
	assert.deepEqual(planner.changedEmploymentIds(), ['emp-1']);
	// The changed employment restates its whole set: the stored entitlement by id, its new line whole.
	assert.deepEqual(
		planner
			.nestedEntitlementsOf('emp-1')
			.map((entitlement) => [
				entitlement.id,
				(entitlement.entry_leave_entitlement as { source_key?: string }[]).map(
					(entry) => entry.source_key ?? '(by id)'
				)
			]),
		[['stored', ['adjust:2026-09-07T00:00:00Z']]]
	);
});

test('the context reads only the leave years around the planning date', async () => {
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
							: collection === 'companies'
								? [{ id: 'co', settings_code: 'FX', approval_id: null }]
								: []
					);
				}
			})
		}
	);
	await Effect.runPromise(readLeaveContext({ db } as never, ['emp-1'], { asOf: '2026-09-06' }));
	const entitlements = wheres.find((where) => where.collection === 'leave_entitlements');
	assert.deepEqual(entitlements?.leave_year, { gte: 2024 });
	assert.ok(
		!wheres.some(
			(where) =>
				where.collection === 'leave_entries' &&
				Array.isArray((where.leave_entitlement_id as { in?: unknown[] })?.in) &&
				(where.leave_entitlement_id as { in: unknown[] }).in.length > 0
		)
	);
	// The catalogue is read through the companies' lineages: every version of each, then the
	// types under those versions; the reconciler picks the version in force per rule date.
	const versions = wheres.find((where) => where.collection === 'jurisdiction_settings');
	assert.deepEqual(versions?.code, { in: ['FX'] }, 'the lineage versions are read by code');
	assert.ok(
		!wheres.some((where) => where.collection === 'leave_catalogue'),
		'with no version there is no catalogue to read'
	);
});

test('a bounded run walks companies and employments in id order and hands back where it stopped', async () => {
	const { refreshCompaniesLeave } = await import('../src/lib/leave/service.ts');
	const employments = {
		'co-a': ['e1', 'e2', 'e3'],
		'co-b': ['e4'],
		'co-c': ['e5', 'e6']
	};
	const all = Object.entries(employments).flatMap(([company_id, ids]) =>
		ids.map((id) => ({ id, company_id, approval_id: null }))
	);
	const api = {
		db: {
			employments: {
				findMany: ({ where, limit }) =>
					Effect.succeed(
						// The walk asks by company from a cursor; the context read asks by id list.
						where.id?.in != null
							? all.filter((row) => where.id.in.includes(row.id))
							: all
									.filter((row) => row.company_id === where.company_id.eq)
									.filter((row) => (where.id?.gt == null ? true : row.id > where.id.gt))
									.slice(0, limit)
									.map(({ id }) => ({ id }))
					)
			},
			// The walk reads only employments; the arithmetic is exercised elsewhere.
			leave_requests: { findMany: () => Effect.succeed([]), findPending: () => Effect.succeed([]) }
		}
	};
	const run = (cursor) =>
		Effect.runPromise(
			refreshCompaniesLeave(
				{
					db: new Proxy(api.db, {
						get: (target, key) =>
							key in target
								? target[key]
								: {
										findMany: () => Effect.succeed([]),
										findFirst: () => Effect.succeed(null),
										mutate: (rows) => Effect.sync(() => refreshed.push(rows.map((r) => r.id)))
									}
					})
				} as never,
				['co-c', 'co-a', 'co-b'],
				'2026-09-06',
				{ slice: 4, ...(cursor === undefined ? {} : { cursor }) }
			)
		);
	const first = await run(undefined);
	assert.deepEqual(first, { employments: 4, next: { company_id: 'co-b', after: 'e4' } });
	const second = await run(first.next);
	assert.deepEqual(second, { employments: 2 });
});
