// @ts-nocheck -- executed directly by Node with --experimental-strip-types; the hooks are driven
// with the memory world, as the runtime drives them, and read the clock through Effect's service.
import assert from 'node:assert/strict';
import test from 'node:test';
import { Clock, Effect } from 'effect';
import employmentHooks from '../src/collections/employments/+hooks.ts';
import childHooks from '../src/collections/employee_children/+hooks.ts';
import requestHooks from '../src/collections/leave_requests/+hooks.ts';
import { leaveEntitlementIdFor, leaveEntryIdFor } from '../src/lib/leave/identity.ts';
import { memoryPayrollApi } from './fixtures/memory-payroll-api.ts';
import {
	COMPANY_ID,
	JURISDICTION_ID,
	createPublicPayrollWorld,
	EMPLOYEE_ID,
	EMPLOYMENT_ID
} from './fixtures/public-payroll-world.ts';

/**
 * RFC 0003 §5.1 to §5.3 and §3.2 (determinism). A fact carries its ledger in its own write, as
 * the workspace, and nothing a hook derives depends on the day it runs: a held graph is replayed
 * through the same hooks on resume and must reproduce the review byte for byte.
 */

const ANNUAL_TYPE_ID = 'ffffffff-ffff-4fff-8fff-fffffffffff1';
const CHILDCARE_TYPE_ID = 'ffffffff-ffff-4fff-8fff-fffffffffff7';

const leaveType = (overrides) => ({
	id: ANNUAL_TYPE_ID,
	settings_id: JURISDICTION_ID,
	code: 'ANNUAL',
	name: 'Annual leave',
	is_statutory: true,
	authority: 'Fixture',
	eligibility: '',
	requires_certificate_after_days: null,
	entitlement: { layers: [{ level: 'ORGANISATION', band_from: 0, days: 8 }] },
	accrual: { kind: 'UPFRONT', settlement: { settlement: 'FORFEIT' } },
	exit_settlement: { exit: 'FORFEIT' },
	payroll_effect: { kind: 'PAID' },
	approval_id: null,
	created_at: '2025-01-01T00:00:00.000Z',
	updated_at: '2025-01-01T00:00:00.000Z',
	...overrides
});

/** A hook api over the world: reads, `findPending` (nothing held) and a recording `mutate`. */
function hookApi(world) {
	const staged = [];
	const memory = memoryPayrollApi(world);
	const db = Object.fromEntries(
		Object.entries(memory.db).map(([name, reads]) => [
			name,
			{
				...reads,
				findPending: () => Effect.succeed([]),
				mutate: (rows) => Effect.sync(() => staged.push([name, rows]))
			}
		])
	);
	return { api: { db }, staged };
}

/** A clock frozen on one day, or one that dies when read. */
const clockOn = (day) => {
	const millis = Date.parse(`${day}T12:00:00.000Z`);
	return {
		currentTimeMillis: Effect.succeed(millis),
		currentTimeMillisUnsafe: () => millis,
		currentTimeNanos: Effect.succeed(BigInt(millis) * 1_000_000n),
		currentTimeNanosUnsafe: () => BigInt(millis) * 1_000_000n
	};
};
const deadClock = {
	currentTimeMillis: Effect.die(new Error('a hook read the clock')),
	currentTimeMillisUnsafe: () => {
		throw new Error('a hook read the clock');
	},
	currentTimeNanos: Effect.die(new Error('a hook read the clock')),
	currentTimeNanosUnsafe: () => {
		throw new Error('a hook read the clock');
	}
};
const run = (effect, clock) => Effect.runPromise(Effect.provideService(effect, Clock.Clock, clock));

const runBefore = (hooks, inputs, context, clock) =>
	run(
		Effect.gen(function* () {
			const prepared = yield* hooks.mutate.prepare({ inputs, api: context.api });
			return yield* hooks.mutate.perRecord.before.handler({ ...context, prepared });
		}),
		clock
	);

test('an employment create returns its entitlements and opening lines nested, as of its hire date, without reading the clock', async () => {
	const world = createPublicPayrollWorld();
	world.leave_types.push(leaveType());
	const { api } = hookApi(world);
	const input = {
		employee_id: EMPLOYEE_ID,
		company_id: COMPANY_ID,
		employee_number: 'PF0002',
		hire_date: '2026-03-15',
		effective_range: { start: '2026-03-15', end: null }
	};
	const context = { input, existing: undefined, recordId: 'emp-new', relationships: [], api };
	const graph = await runBefore(employmentHooks, [input], context, deadClock);
	const entitlement2026 = leaveEntitlementIdFor({
		employment_id: 'emp-new',
		leave_code: 'ANNUAL',
		leave_year: 2026
	});
	const nested = graph.leave_entitlement_employment;
	assert.deepEqual(
		nested.map((row) => [row.id, row.leave_year, row.starts_on, row.entitlement_days]),
		[
			[entitlement2026, 2026, '2026-03-15', 8],
			[
				leaveEntitlementIdFor({ employment_id: 'emp-new', leave_code: 'ANNUAL', leave_year: 2027 }),
				2027,
				'2027-01-01',
				8
			]
		]
	);
	// What the hire opens is posted as of the hire date; 2027 opens when the schedule gets there.
	assert.deepEqual(
		nested[0].entry_leave_entitlement.map((row) => [row.id, row.kind, row.days, row.effective_on]),
		[
			[
				leaveEntryIdFor({ leave_entitlement_id: entitlement2026, source_key: 'opening' }),
				'OPENING_ENTITLEMENT',
				8,
				'2026-03-15'
			]
		]
	);
	assert.deepEqual(nested[1].entry_leave_entitlement, []);
	// The same input on two different days is the same graph.
	assert.deepEqual(
		await runBefore(employmentHooks, [input], context, clockOn('2026-09-07')),
		graph
	);
	assert.deepEqual(
		await runBefore(employmentHooks, [input], context, clockOn('2027-02-01')),
		graph
	);
});

test('an employment nested under a person created in the same write plans from the empty person', async () => {
	const world = createPublicPayrollWorld();
	world.leave_types.push(
		leaveType(),
		leaveType({
			id: CHILDCARE_TYPE_ID,
			code: 'MATERNITY',
			eligibility: 'employee.gender == "FEMALE"'
		})
	);
	const { api } = hookApi(world);
	// The parent key arrives after this hook (a kiosk enrolment): no employee_id in the input.
	const input = {
		company_id: COMPANY_ID,
		employee_number: 'KIOSK-1',
		hire_date: '2026-09-07',
		effective_range: { start: '2026-09-07', end: null }
	};
	const graph = await runBefore(
		employmentHooks,
		[input],
		{ input, existing: undefined, recordId: 'emp-kiosk', relationships: [], api },
		deadClock
	);
	assert.deepEqual(
		graph.leave_entitlement_employment.map((row) => row.leave_code),
		['ANNUAL', 'ANNUAL'],
		'the everyone type generates; the gendered one waits for a stored fact'
	);
});

test('a write that already carries the ledger keeps it, and an edit off the ledger columns leaves it alone', async () => {
	const world = createPublicPayrollWorld();
	world.leave_types.push(leaveType());
	const { api } = hookApi(world);
	const stated = { id: EMPLOYMENT_ID, leave_entitlement_employment: [] };
	assert.deepEqual(
		await runBefore(
			employmentHooks,
			[stated],
			{
				input: stated,
				existing: world.employments[0],
				recordId: EMPLOYMENT_ID,
				relationships: ['leave_entitlement_employment'],
				api
			},
			deadClock
		),
		stated
	);
	const renumbered = { id: EMPLOYMENT_ID, employee_number: 'PF0009' };
	assert.deepEqual(
		await runBefore(
			employmentHooks,
			[renumbered],
			{
				input: renumbered,
				existing: world.employments[0],
				recordId: EMPLOYMENT_ID,
				relationships: [],
				api
			},
			deadClock
		),
		renumbered
	);
});

test('a child fact restates the employment with the entitlement the child opens, staged into its own commit', async () => {
	const world = createPublicPayrollWorld();
	world.leave_types.push(
		leaveType({
			id: CHILDCARE_TYPE_ID,
			code: 'CHILDCARE',
			eligibility: 'children.under(7) >= 1',
			entitlement: { layers: [{ level: 'ORGANISATION', band_from: 0, days: 6 }] }
		})
	);
	const { api, staged } = hookApi(world);
	const input = {
		employment_id: EMPLOYMENT_ID,
		child_birthdate: '2026-04-10',
		relationship: 'BIRTH'
	};
	// The child is not stored yet: the hook plans with it overlaid and stages the employment root
	// carrying the complete ledger, without reading the clock.
	const returned = await runBefore(
		childHooks,
		[input],
		{ input, existing: undefined, recordId: 'child-1', relationships: [], api },
		deadClock
	);
	assert.deepEqual(returned, input);
	assert.equal(staged.length, 1);
	const [[collection, rows]] = staged;
	assert.equal(collection, 'employments');
	assert.equal(rows.length, 1);
	assert.equal(rows[0].id, EMPLOYMENT_ID);
	// It plans as of the latest date the facts state (the birth), and the row opens that day.
	const childcare = rows[0].leave_entitlement_employment.filter(
		(row) => row.leave_code === 'CHILDCARE'
	);
	assert.deepEqual(
		childcare.map((row) => [row.leave_year, row.starts_on, row.entry_leave_entitlement.length]),
		[
			[2026, '2026-04-10', 1],
			[2027, '2027-01-01', 0]
		]
	);
	// The staged root reaches the employment's before with the ledger among its relationships,
	// and the employment keeps what it is handed rather than planning again without the child.
	const restated = rows[0];
	assert.deepEqual(
		await runBefore(
			employmentHooks,
			[restated],
			{
				input: restated,
				existing: world.employments[0],
				recordId: EMPLOYMENT_ID,
				relationships: ['leave_entitlement_employment'],
				api
			},
			deadClock
		),
		restated
	);
});

test('a leave request carries the TAKEN line it charges and is the same graph on any day', async () => {
	const world = createPublicPayrollWorld();
	world.leave_types.push(leaveType());
	const entitlementId = leaveEntitlementIdFor({
		employment_id: EMPLOYMENT_ID,
		leave_code: 'ANNUAL',
		leave_year: 2026
	});
	world.leave_entitlements.push({
		id: entitlementId,
		employment_id: EMPLOYMENT_ID,
		leave_type_id: ANNUAL_TYPE_ID,
		leave_year: 2026,
		starts_on: '2026-01-01',
		ends_on: '2026-12-31',
		status: 'OPEN',
		entitlement_days: 8,
		accrual_kind: 'UPFRONT',
		settlement: { settlement: 'FORFEIT' },
		exit_settlement: { exit: 'FORFEIT' },
		leave_code: 'ANNUAL',
		leave_name: 'Annual leave',
		approval_id: null
	});
	world.leave_entries.push({
		id: leaveEntryIdFor({ leave_entitlement_id: entitlementId, source_key: 'opening' }),
		leave_entitlement_id: entitlementId,
		kind: 'OPENING_ENTITLEMENT',
		effective_on: '2026-01-01',
		days: 8,
		source_key: 'opening',
		source_request_id: null,
		approval_id: null
	});
	const { api } = hookApi(world);
	const requestId = 'request-1';
	const input = {
		employment_id: EMPLOYMENT_ID,
		leave_type_id: ANNUAL_TYPE_ID,
		event: {
			kind: 'TIME_OFF',
			range: {
				start: { date: '2026-02-03', half: 'FIRST' },
				end: { date: '2026-02-03', half: 'SECOND' }
			},
			chargeable_days: null,
			reason: 'determinism'
		}
	};
	const context = { input, existing: undefined, recordId: requestId, relationships: [], api };
	// Filed on one day, held for review, resumed three days later: the review must match.
	const filed = await runBefore(requestHooks, [input], context, clockOn('2026-01-20'));
	const resumed = await runBefore(requestHooks, [input], context, clockOn('2026-01-23'));
	assert.deepEqual(resumed, filed);
	assert.deepEqual(await runBefore(requestHooks, [input], context, deadClock), filed);
	assert.equal(filed.leave_entitlement_id, entitlementId);
	assert.equal(filed.event.chargeable_days, 1);
	assert.deepEqual(filed.leave_entry_request, [
		{
			id: leaveEntryIdFor({
				leave_entitlement_id: entitlementId,
				source_key: `request:${requestId}`
			}),
			leave_entitlement_id: entitlementId,
			kind: 'TAKEN',
			effective_on: '2026-02-03',
			days: -1,
			reason: 'Approved leave request',
			source_key: `request:${requestId}`
		}
	]);
});
