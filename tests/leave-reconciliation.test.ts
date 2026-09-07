// @ts-nocheck -- focused arithmetic tests run the reconciler over the in-memory planner context.
import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import {
	chargeApprovedRequests,
	closeLeaveYear,
	closeOnExit,
	entitlementEntries,
	expireCarry,
	reconcileEmploymentLeave
} from '../src/lib/leave/reconcile.ts';
import { leavePlanner } from '../src/lib/leave/entitlements.ts';
import {
	leaveEntitlementIdFor,
	leaveEntryIdFor,
	requestSourceKey
} from '../src/lib/leave/identity.ts';
import { leaveDailyRate } from '../src/lib/leave/rate.ts';
import { compileEligibility } from '../src/collections/payroll_runs/lib/eligibility.ts';
import leaveEntryHooks from '../src/collections/leave_entries/+hooks.ts';
import leaveTypeHooks from '../src/collections/leave_types/+hooks.ts';

const UPFRONT = { kind: 'UPFRONT', settlement: { settlement: 'FORFEIT' } };
const MONTHLY = { kind: 'MONTHLY', settlement: { settlement: 'FORFEIT' } };

const SETTINGS_ID = 'settings';
const leaveType = (overrides = {}) => ({
	id: 'type-annual',
	settings_id: SETTINGS_ID,
	code: 'ANNUAL',
	name: 'Annual leave',
	is_statutory: true,
	authority: 'Fixture s.1',
	eligibility: '',
	entitlement: { layers: [{ level: 'ORGANISATION', band_from: 0, days: 12 }] },
	accrual: UPFRONT,
	exit_settlement: { exit: 'FORFEIT' },
	payroll_effect: { kind: 'PAID' },
	approval_id: null,
	...overrides
});

/** One employment in one company, with the rows the arithmetic reads, all in memory. */
function world(options = {}) {
	const context = {
		employments: [
			{
				id: 'employment',
				company_id: 'company',
				employee_id: 'employee',
				hire_date: options.hireDate ?? '2020-01-01',
				exit_date: options.exitDate ?? null,
				exit_reason: options.exitReason ?? null,
				approval_id: null
			}
		],
		companies: [{ id: 'company', settings_code: 'FX', approval_id: null }],
		jurisdiction_settings: [
			{
				id: SETTINGS_ID,
				code: 'FX',
				name: 'Fixture settings',
				sealed_at: '2019-01-01T00:00:00.000Z',
				voided_at: null,
				effective_range: { start: '2019-01-01', end: null },
				approval_id: null
			}
		],
		employees: [
			{
				id: 'employee',
				gender: options.gender ?? 'FEMALE',
				date_of_birth: '1990-05-05',
				nationality: 'MY'
			}
		],
		employment_terms: [
			{
				id: 'terms',
				employment_id: 'employment',
				employment_type: 'PERMANENT',
				work_classification: 'EA_COVERED',
				base_salary: { value: 2600, currency: 'MYR' },
				pay_frequency: 'MONTHLY',
				statutory_work_category: 'NON_MANUAL',
				department: 'OPS',
				payroll_group: null,
				effective_range: { start: '2020-01-01', end: null },
				approval_id: null
			}
		],
		employee_children: options.children ?? [],
		leave_types: options.types ?? [leaveType()],
		leave_entitlements: options.entitlements ?? [],
		leave_entries: options.entries ?? [],
		leave_requests: options.requests ?? []
	};
	const planner = leavePlanner(context, () => Effect.succeed(options.pending ?? []));
	const run = (asOf) =>
		Effect.runPromise(reconcileEmploymentLeave(planner.api, 'employment', asOf));
	const lines = (entitlementId) =>
		context.leave_entries
			.filter((entry) => entry.leave_entitlement_id === entitlementId)
			.map((entry) => [entry.kind, entry.days, entry.source_key]);
	return { context, planner, run, lines };
}

const entitlementId = (code, year) =>
	leaveEntitlementIdFor({ employment_id: 'employment', leave_code: code, leave_year: year });

test('UPFRONT posts one opening line; MONTHLY posts month ends through the date, none before the opening', () => {
	const upfront = entitlementEntries({
		entitlementId: 'e',
		type: leaveType(),
		target: 12,
		yearStart: '2026-01-01',
		yearEnd: '2026-12-31',
		openingDate: '2026-01-01',
		asOf: '2026-09-07'
	});
	assert.deepEqual(
		upfront.map((entry) => [entry.kind, entry.days, entry.effective_on, entry.source_key]),
		[['OPENING_ENTITLEMENT', 12, '2026-01-01', 'opening']]
	);
	const monthly = entitlementEntries({
		entitlementId: 'e',
		type: leaveType({ accrual: MONTHLY }),
		target: 12,
		yearStart: '2026-01-01',
		yearEnd: '2026-12-31',
		openingDate: '2026-03-15',
		asOf: '2026-09-07'
	});
	assert.deepEqual(
		monthly.map((entry) => [entry.effective_on, entry.days, entry.source_key]),
		[
			['2026-03-31', 1, 'accrual:3'],
			['2026-04-30', 1, 'accrual:4'],
			['2026-05-31', 1, 'accrual:5'],
			['2026-06-30', 1, 'accrual:6'],
			['2026-07-31', 1, 'accrual:7'],
			['2026-08-31', 1, 'accrual:8']
		],
		'no catch-up for months before the opening, no lines after the date'
	);
	// A band that does not divide by twelve rounds each cumulative share to the half day.
	const sevens = entitlementEntries({
		entitlementId: 'e',
		type: leaveType({ accrual: MONTHLY }),
		target: 7,
		yearStart: '2026-01-01',
		yearEnd: '2026-12-31',
		openingDate: '2026-01-01',
		asOf: '2026-12-31'
	});
	assert.equal(
		sevens.reduce((total, entry) => total + entry.days, 0),
		7
	);
	assert.ok(sevens.every((entry) => Number.isInteger(entry.days * 2)));
});

test('rule 1: an eligible person gets one entitlement per type per year; an ineligible one gets none', async () => {
	const types = [
		leaveType(),
		leaveType({
			id: 'type-maternity',
			code: 'MATERNITY',
			name: 'Maternity leave',
			eligibility: 'employee.gender == "FEMALE" && employment.service_months >= 3',
			entitlement: { layers: [{ level: 'ORGANISATION', band_from: 0, days: 98 }] }
		}),
		leaveType({
			id: 'type-childcare',
			code: 'CHILDCARE',
			name: 'Childcare leave',
			eligibility: 'children.under(7) >= 1',
			entitlement: { layers: [{ level: 'ORGANISATION', band_from: 0, days: 6 }] }
		}),
		leaveType({
			id: 'type-unpaid',
			code: 'UNPAID',
			name: 'Unpaid leave',
			is_statutory: false,
			authority: null,
			accrual: { kind: 'UNLIMITED' },
			entitlement: { layers: [] }
		}),
		leaveType({
			id: 'type-zero',
			code: 'ZERO',
			name: 'A band of nothing',
			is_statutory: false,
			authority: null,
			entitlement: { layers: [{ level: 'ORGANISATION', band_from: 120, days: 5 }] }
		})
	];
	const woman = world({ types, gender: 'FEMALE' });
	const result = await woman.run('2026-09-07');
	const rows = woman.context.leave_entitlements.map((row) => `${row.leave_code}:${row.leave_year}`);
	assert.deepEqual(
		rows.toSorted(),
		[
			'ANNUAL:2025',
			'ANNUAL:2026',
			'ANNUAL:2027',
			'MATERNITY:2025',
			'MATERNITY:2026',
			'MATERNITY:2027',
			'UNPAID:2025',
			'UNPAID:2026',
			'UNPAID:2027'
		],
		'three years each for the eligible types; no CHILDCARE without a child, no row for a zero band'
	);
	assert.equal(result.entitlements_created, 9);
	assert.deepEqual(woman.lines(entitlementId('ANNUAL', 2026)), [
		['OPENING_ENTITLEMENT', 12, 'opening']
	]);
	assert.deepEqual(woman.lines(entitlementId('MATERNITY', 2026)), [
		['OPENING_ENTITLEMENT', 98, 'opening']
	]);
	assert.deepEqual(
		woman.lines(entitlementId('ANNUAL', 2027)),
		[],
		'next year opens on its own day'
	);
	assert.deepEqual(
		woman.lines(entitlementId('UNPAID', 2026)),
		[],
		'unmetered leave awards nothing'
	);
	const again = await woman.run('2026-09-07');
	assert.deepEqual(again, { entitlements_created: 0, entries_posted: 0 }, 'a rerun is a no-op');

	const man = world({ types, gender: 'MALE' });
	await man.run('2026-09-07');
	assert.ok(
		!man.context.leave_entitlements.some((row) => row.leave_code === 'MATERNITY'),
		'no row at all for a man, not a zero-day one'
	);

	const parent = world({
		types,
		children: [
			{
				id: 'child',
				employment_id: 'employment',
				child_birthdate: '2022-03-01',
				supersedes_id: null,
				approval_id: null
			}
		]
	});
	await parent.run('2026-09-07');
	assert.deepEqual(parent.lines(entitlementId('CHILDCARE', 2026)), [
		['OPENING_ENTITLEMENT', 6, 'opening']
	]);
});

test('rule 1: eligibility first satisfied mid-year opens the row then, with the band or the months left', async () => {
	const types = [
		leaveType({ eligibility: 'employment.service_months >= 3' }),
		leaveType({
			id: 'type-monthly',
			code: 'MONTHLY',
			name: 'Monthly leave',
			eligibility: 'employment.service_months >= 3',
			accrual: MONTHLY
		})
	];
	// Hired 1 May: two months of service on 1 July, three on 1 August.
	const early = world({ types, hireDate: '2026-05-01' });
	await early.run('2026-07-15');
	assert.deepEqual(
		early.context.leave_entitlements.filter((row) => row.leave_year === 2026),
		[],
		'not yet eligible this year: no row (next year opens on its own rule date, eligible by then)'
	);
	const later = world({ types, hireDate: '2026-05-01' });
	await later.run('2026-09-07');
	const upfront = later.context.leave_entitlements.find((row) => row.leave_code === 'ANNUAL');
	assert.equal(upfront.starts_on, '2026-09-07', 'the row opens on the day it was found eligible');
	assert.equal(Number(upfront.entitlement_days), 12);
	assert.deepEqual(later.lines(upfront.id), [['OPENING_ENTITLEMENT', 12, 'opening']]);
	const monthly = later.context.leave_entitlements.find((row) => row.leave_code === 'MONTHLY');
	assert.equal(Number(monthly.entitlement_days), 4, 'September through December, one a month');
	assert.deepEqual(later.lines(monthly.id), [], 'the first line posts at the month end');
	await later.run('2026-10-01');
	assert.deepEqual(later.lines(monthly.id), [['ACCRUAL', 1, 'accrual:9']]);
});

test('rule 2: a catalogue edit posts one ADJUSTMENT per open entitlement, keyed by updated_at, once', async () => {
	const stored = {
		id: entitlementId('ANNUAL', 2026),
		employment_id: 'employment',
		leave_type_id: 'type-annual',
		leave_year: 2026,
		starts_on: '2026-01-01',
		ends_on: '2026-12-31',
		status: 'OPEN',
		entitlement_days: 12,
		accrual_kind: 'UPFRONT',
		settlement: { settlement: 'FORFEIT' },
		exit_settlement: { exit: 'FORFEIT' },
		leave_code: 'ANNUAL',
		leave_name: 'Annual leave',
		created_at: '2026-01-01 00:10:00+00',
		approval_id: null
	};
	const opening = {
		id: leaveEntryIdFor({ leave_entitlement_id: stored.id, source_key: 'opening' }),
		leave_entitlement_id: stored.id,
		kind: 'OPENING_ENTITLEMENT',
		effective_on: '2026-01-01',
		days: 12,
		source_key: 'opening',
		approval_id: null
	};
	const raised = leaveType({
		entitlement: { layers: [{ level: 'ORGANISATION', band_from: 0, days: 14 }] },
		updated_at: '2026-09-07 08:00:00+00'
	});
	const edited = world({ types: [raised], entitlements: [stored], entries: [opening] });
	await edited.run('2026-09-07');
	assert.deepEqual(edited.lines(stored.id), [
		['OPENING_ENTITLEMENT', 12, 'opening'],
		['ADJUSTMENT', 2, 'adjust:2026-09-07 08:00:00+00']
	]);
	const second = await edited.run('2026-09-08');
	assert.equal(second.entries_posted, 0, 'the same edit never posts twice');
	assert.equal(edited.lines(stored.id).length, 2);
	// Next year's row was generated after the edit and needs nothing.
	assert.deepEqual(edited.lines(entitlementId('ANNUAL', 2027)), []);
	// Without an edit after the row was generated, nothing is posted however often it runs.
	const untouched = world({
		types: [leaveType({ updated_at: '2025-12-31 00:00:00+00' })],
		entitlements: [stored],
		entries: [opening]
	});
	await untouched.run('2026-09-07');
	assert.deepEqual(untouched.lines(stored.id), [['OPENING_ENTITLEMENT', 12, 'opening']]);
});

test('rule 2: a MONTHLY edit adjusts the months already accrued and posts the next line from the new band', async () => {
	const stored = {
		id: entitlementId('MONTHLY', 2026),
		employment_id: 'employment',
		leave_type_id: 'type-monthly',
		leave_year: 2026,
		starts_on: '2026-01-01',
		ends_on: '2026-12-31',
		status: 'OPEN',
		entitlement_days: 12,
		accrual_kind: 'MONTHLY',
		settlement: { settlement: 'FORFEIT' },
		exit_settlement: { exit: 'FORFEIT' },
		leave_code: 'MONTHLY',
		leave_name: 'Monthly leave',
		created_at: '2026-01-01 00:10:00+00',
		approval_id: null
	};
	const accrued = Array.from({ length: 8 }, (_, index) => ({
		id: leaveEntryIdFor({ leave_entitlement_id: stored.id, source_key: `accrual:${index + 1}` }),
		leave_entitlement_id: stored.id,
		kind: 'ACCRUAL',
		effective_on: `2026-${String(index + 1).padStart(2, '0')}-${index === 1 ? '28' : '30'}`,
		days: 1,
		source_key: `accrual:${index + 1}`,
		approval_id: null
	}));
	const raised = leaveType({
		id: 'type-monthly',
		code: 'MONTHLY',
		name: 'Monthly leave',
		accrual: MONTHLY,
		entitlement: { layers: [{ level: 'ORGANISATION', band_from: 0, days: 14 }] },
		updated_at: '2026-09-07 08:00:00+00'
	});
	const edited = world({ types: [raised], entitlements: [stored], entries: accrued });
	await edited.run('2026-09-07');
	const lines = edited.lines(stored.id);
	assert.deepEqual(
		lines.at(-1),
		['ADJUSTMENT', 1.5, 'adjust:2026-09-07 08:00:00+00'],
		'14 × 8/12 = 9.5 to date, 8 posted'
	);
	assert.equal(
		lines.filter(([kind]) => kind === 'ACCRUAL').length,
		8,
		'posted lines are never rewritten'
	);
	await edited.run('2026-10-01');
	const september = edited.lines(stored.id).find(([, , key]) => key === 'accrual:9');
	assert.deepEqual(
		september,
		['ACCRUAL', 1, 'accrual:9'],
		'14 × 9/12 = 10.5, less 9.5: the new band from the next line'
	);
	await edited.run('2027-01-02');
	const total = edited.context.leave_entries
		.filter(
			(entry) =>
				entry.leave_entitlement_id === stored.id && ['ACCRUAL', 'ADJUSTMENT'].includes(entry.kind)
		)
		.reduce((sum, entry) => sum + entry.days, 0);
	assert.equal(total, 14, 'the year sums to the new band');
});

test('restored leave is not treated as consumed carry at expiry', async () => {
	const posted = [];
	const entitlement = { id: 'entitlement' };
	const entries = [
		{
			id: 'carry',
			kind: 'CARRY_FORWARD',
			effective_on: '2026-01-01',
			expires_on: '2026-03-31',
			days: 5,
			source_key: 'carry:old',
			approval_id: null
		},
		{ kind: 'TAKEN', effective_on: '2026-02-01', days: -5, approval_id: null },
		{ kind: 'RESTORED', effective_on: '2026-02-01', days: 5, approval_id: null }
	];
	const api = {
		db: { leave_entries: { mutate: (rows) => Effect.sync(() => posted.push(...rows)) } }
	};
	assert.equal(await Effect.runPromise(expireCarry(api, entitlement, entries, '2026-04-01')), 1);
	assert.equal(posted[0].days, -5);
});

test('restoring a request after expiry appends the newly required expiry delta', async () => {
	const posted = [];
	const entries = [
		{
			id: 'carry',
			kind: 'CARRY_FORWARD',
			effective_on: '2026-01-01',
			expires_on: '2026-03-31',
			days: 10,
			source_key: 'carry:old',
			approval_id: null
		},
		{ kind: 'TAKEN', effective_on: '2026-02-01', days: -4, approval_id: null },
		{
			kind: 'EXPIRED',
			effective_on: '2026-03-31',
			days: -6,
			source_key: 'expire:carry',
			approval_id: null
		},
		{ kind: 'RESTORED', effective_on: '2026-02-01', days: 4, approval_id: null }
	];
	const api = {
		db: { leave_entries: { mutate: (rows) => Effect.sync(() => posted.push(...rows)) } }
	};
	assert.equal(
		await Effect.runPromise(expireCarry(api, { id: 'entitlement' }, entries, '2026-04-02')),
		1
	);
	assert.equal(posted[0].days, -4);
	assert.equal(posted[0].source_key, 'expire:carry:v2');
});

const storedYear = (year, overrides = {}) => ({
	id: entitlementId('ANNUAL', year),
	employment_id: 'employment',
	leave_type_id: 'type-annual',
	leave_year: year,
	starts_on: `${year}-01-01`,
	ends_on: `${year}-12-31`,
	status: 'OPEN',
	entitlement_days: 12,
	accrual_kind: 'UPFRONT',
	settlement: { settlement: 'FORFEIT' },
	exit_settlement: { exit: 'FORFEIT' },
	leave_code: 'ANNUAL',
	leave_name: 'Annual leave',
	created_at: `${year}-01-01 00:00:00+00`,
	approval_id: null,
	...overrides
});
const line = (entitlement, values) => ({
	id: leaveEntryIdFor({ leave_entitlement_id: entitlement.id, source_key: values.source_key }),
	leave_entitlement_id: entitlement.id,
	approval_id: null,
	...values
});

test('carry expiry is reread before an employment exit settles the entitlement', async () => {
	const current = storedYear(2026);
	const carry = line(current, {
		kind: 'CARRY_FORWARD',
		effective_on: '2026-01-01',
		expires_on: '2026-03-31',
		days: 5,
		source_key: 'carry:prior'
	});
	// An unmetered type: the stored row awards nothing of its own, so only the carry is in play.
	const unmetered = [leaveType({ accrual: { kind: 'UNLIMITED' }, entitlement: { layers: [] } })];
	const exiting = world({
		types: unmetered,
		entitlements: [current],
		entries: [carry],
		exitDate: '2026-04-01'
	});
	await exiting.run('2026-04-02');
	assert.deepEqual(exiting.lines(current.id), [
		['CARRY_FORWARD', 5, 'carry:prior'],
		['EXPIRED', -5, 'expire:' + carry.id]
	]);
	assert.equal(current.status, 'CLOSED');
});

test('carry expiry is reread before year close transfers the balance', async () => {
	const carrying = { settlement: 'CARRY', limit_days: 5, expiry_months: 12 };
	const previous = storedYear(2026, { settlement: carrying });
	const next = storedYear(2027, { settlement: carrying });
	const carry = line(previous, {
		kind: 'CARRY_FORWARD',
		effective_on: '2026-01-01',
		expires_on: '2026-12-31',
		days: 5,
		source_key: 'carry:prior'
	});
	const closing = world({
		types: [leaveType({ accrual: { kind: 'UNLIMITED' }, entitlement: { layers: [] } })],
		entitlements: [previous, next],
		entries: [carry]
	});
	await closing.run('2027-01-02');
	assert.deepEqual(closing.lines(previous.id), [
		['CARRY_FORWARD', 5, 'carry:prior'],
		['EXPIRED', -5, 'expire:' + carry.id]
	]);
	assert.equal(previous.status, 'CLOSED');
});

test('a retry closes an entitlement after its close lines already committed', async () => {
	const closed = [];
	const previous = storedYear(2025);
	const api = {
		db: {
			leave_entitlements: { mutate: (rows) => Effect.sync(() => closed.push(...rows)) },
			leave_entries: { mutate: () => Effect.die('must not duplicate the close') }
		}
	};
	assert.equal(
		await Effect.runPromise(
			closeLeaveYear({
				api,
				previous,
				next: storedYear(2026),
				entries: [{ source_key: `close:${previous.id}:out` }],
				pending: [],
				asOf: '2026-01-02'
			})
		),
		0
	);
	assert.deepEqual(closed, [{ id: previous.id, status: 'CLOSED' }]);
});

const closeHarness = () => {
	const entries = [];
	const closed = [];
	const api = {
		db: {
			leave_entries: { mutate: (rows) => Effect.sync(() => entries.push(...rows)) },
			leave_entitlements: { mutate: (rows) => Effect.sync(() => closed.push(...rows)) }
		}
	};
	return { api, entries, closed };
};
const opened = (entitlement, days) =>
	line(entitlement, {
		kind: 'OPENING_ENTITLEMENT',
		effective_on: entitlement.starts_on,
		days,
		source_key: 'opening'
	});
const carry = (limit_days, expiry_months) => ({ settlement: 'CARRY', limit_days, expiry_months });
const forfeit = { settlement: 'FORFEIT' };
const commute = { settlement: 'COMMUTE', pay_basis: 'ORDINARY_DIV26' };

test('a carry year closes once: up to the limit moves as one lot with its expiry, the rest lapses', async () => {
	const { api, entries, closed } = closeHarness();
	const previous = storedYear(2025, { settlement: carry(5, 3) });
	const next = storedYear(2026, { settlement: carry(5, 3) });
	const ledger = [opened(previous, 6)];
	const run = () =>
		Effect.runPromise(
			closeLeaveYear({ api, previous, next, entries: ledger, pending: [], asOf: '2026-01-02' })
		);
	assert.equal(await run(), 3);
	assert.deepEqual(
		entries.map((entry) => [
			entry.leave_entitlement_id === previous.id ? 'old' : 'new',
			entry.kind,
			entry.days,
			entry.source_key,
			entry.expires_on ?? null
		]),
		[
			['old', 'CARRY_TRANSFER_OUT', -5, `close:${previous.id}:out`, null],
			['new', 'CARRY_FORWARD', 5, `carry:${previous.id}`, '2026-03-31'],
			['old', 'EXPIRED', -1, `close:${previous.id}:forfeit`, null]
		]
	);
	assert.deepEqual(closed, [{ id: previous.id, status: 'CLOSED' }]);
	ledger.push(...entries);
	assert.equal(await run(), 0, 'a rerun restates the close and never doubles it');
	assert.equal(entries.length, 3);
});

test('a whole-balance carry with no expiry carries everything and never expires', async () => {
	const { api, entries } = closeHarness();
	const previous = storedYear(2025, { settlement: carry(null, 0) });
	await Effect.runPromise(
		closeLeaveYear({
			api,
			previous,
			next: storedYear(2026, { settlement: carry(null, 0) }),
			entries: [opened(previous, 9)],
			pending: [],
			asOf: '2026-01-02'
		})
	);
	assert.deepEqual(
		entries.map((entry) => [entry.kind, entry.days, entry.expires_on ?? null]),
		[
			['CARRY_TRANSFER_OUT', -9, null],
			['CARRY_FORWARD', 9, null]
		]
	);
});

test('a commute year closes into one COMMUTED line; payroll prices it later', async () => {
	const { api, entries, closed } = closeHarness();
	const previous = storedYear(2025, { settlement: commute });
	await Effect.runPromise(
		closeLeaveYear({
			api,
			previous,
			next: storedYear(2026, { settlement: commute }),
			entries: [opened(previous, 8)],
			pending: [],
			asOf: '2026-01-02'
		})
	);
	assert.deepEqual(
		entries.map((entry) => [entry.kind, entry.days, entry.source_key]),
		[['COMMUTED', -8, `close:${previous.id}:commute`]]
	);
	assert.match(String(entries[0].reason), /8 unused days to cash \(ORDINARY_DIV26\)/);
	assert.deepEqual(closed, [{ id: previous.id, status: 'CLOSED' }]);
});

test('a forfeit year lapses, a carry year with no next row lapses, and a held request holds the close', async () => {
	const { api, entries, closed } = closeHarness();
	const close = (settlement, next, pending = []) => {
		const previous = storedYear(2025, { settlement });
		return Effect.runPromise(
			closeLeaveYear({
				api,
				previous,
				next,
				entries: [opened(previous, 4)],
				pending,
				asOf: '2026-01-02'
			})
		);
	};
	assert.equal(await close(forfeit, storedYear(2026)), 1);
	assert.equal(await close(carry(5, 3), null), 1);
	assert.deepEqual(
		entries.map((entry) => [entry.kind, entry.days, entry.reason]),
		[
			['EXPIRED', -4, 'Unused leave lapsed at year end'],
			['EXPIRED', -4, 'No following leave year to carry into']
		]
	);
	assert.equal(closed.length, 2);
	assert.equal(await close(forfeit, null, [{ approval_id: 'held' }]), 0);
	assert.equal(entries.length, 2);
});

test('an exit encashes the balance by the sealed rule and forfeits it on dismissal for misconduct', async () => {
	const payOut = { exit: 'PAY_OUT', pay_basis: 'ORDINARY_DIV26', misconduct_forfeits: true };
	const exiting = (exitReason, rule) => {
		const { api, entries } = closeHarness();
		const entitlement = storedYear(2026, { exit_settlement: rule });
		return {
			entries,
			run: () =>
				Effect.runPromise(
					closeOnExit({
						api,
						employment: { id: 'employment', exit_reason: exitReason },
						entitlement,
						entries: [opened(entitlement, 3)],
						exitDate: '2026-04-30'
					})
				)
		};
	};
	const resigned = exiting('RESIGNATION', payOut);
	assert.equal(await resigned.run(), 1);
	assert.deepEqual(
		resigned.entries.map((entry) => [entry.kind, entry.days, entry.source_key]),
		[['ENCASHED', -3, `exit:${entitlementId('ANNUAL', 2026)}`]]
	);
	const dismissed = exiting('MISCONDUCT', payOut);
	assert.equal(await dismissed.run(), 1);
	assert.deepEqual(
		dismissed.entries.map((entry) => [entry.kind, entry.days, entry.reason]),
		[['EXPIRED', -3, 'Payout forfeited: dismissal for misconduct']]
	);
	const lapsing = exiting('MISCONDUCT', { exit: 'FORFEIT' });
	await lapsing.run();
	assert.deepEqual(
		lapsing.entries.map((entry) => [entry.kind, entry.reason]),
		[['EXPIRED', 'Unused leave lapsed on employment exit']]
	);
});

test('the employment run itself encashes on exit and closes the entitlement through the same path', async () => {
	const current = storedYear(2026, {
		exit_settlement: { exit: 'PAY_OUT', pay_basis: 'ORDINARY_DIV26', misconduct_forfeits: true }
	});
	const leaving = world({
		entitlements: [current],
		entries: [opened(current, 10)],
		exitDate: '2026-04-30',
		exitReason: 'RESIGNATION'
	});
	await leaving.run('2026-05-02');
	assert.deepEqual(leaving.lines(current.id).slice(-1), [['ENCASHED', -10, `exit:${current.id}`]]);
	assert.equal(current.status, 'CLOSED');
});

test('leave money follows the stated divisor and refuses the rest', () => {
	assert.equal(
		leaveDailyRate({ pay_frequency: 'MONTHLY', base_salary: { value: 2600 } }, 'ORDINARY_DIV26'),
		100
	);
	assert.equal(
		leaveDailyRate({ pay_frequency: 'MONTHLY', base_salary: { value: 3000 } }, 'MONTHLY_DIV30'),
		100
	);
	assert.equal(
		leaveDailyRate({ pay_frequency: 'DAILY', base_salary: { value: 150 } }, 'DAILY_WAGE'),
		150
	);
	assert.throws(
		() => leaveDailyRate({ pay_frequency: 'HOURLY', base_salary: { value: 20 } }, 'ORDINARY_DIV26'),
		/not stated/
	);
});

test('an approved request is charged once, under the id its own write would use, whichever write comes first', async () => {
	const employment = { id: 'emp-1', company_id: 'co' };
	const id = leaveEntitlementIdFor({
		employment_id: 'emp-1',
		leave_code: 'ANNUAL',
		leave_year: 2026
	});
	const request = {
		id: 'req-1',
		employment_id: 'emp-1',
		leave_type_id: 'type-annual',
		leave_entitlement_id: null,
		approval_id: null,
		event: { range: { start: { date: '2026-04-16' } }, chargeable_days: 1.5 }
	};
	const posted = [];
	let stored = [];
	const api = {
		db: {
			leave_requests: { findMany: () => Effect.succeed([request]) },
			leave_types: { findMany: () => Effect.succeed([{ id: 'type-annual', code: 'ANNUAL' }]) },
			leave_entries: {
				findFirst: ({ where }) =>
					Effect.succeed(
						stored.find(
							(entry) =>
								entry.leave_entitlement_id === where.leave_entitlement_id.eq &&
								entry.source_key === where.source_key.eq
						) ?? null
					),
				mutate: (rows) =>
					Effect.sync(() => {
						posted.push(...rows);
						stored = [...stored, ...rows];
					})
			}
		}
	};
	assert.equal(await Effect.runPromise(chargeApprovedRequests(api, employment, [{ id }], 1)), 1);
	assert.deepEqual(posted, [
		{
			id: leaveEntryIdFor({ leave_entitlement_id: id, source_key: requestSourceKey('req-1') }),
			leave_entitlement_id: id,
			kind: 'TAKEN',
			effective_on: '2026-04-16',
			days: -1.5,
			reason: 'Approved leave request',
			source_key: 'request:req-1',
			source_request_id: 'req-1'
		}
	]);
	assert.equal(await Effect.runPromise(chargeApprovedRequests(api, employment, [{ id }], 1)), 0);
	assert.equal(
		await Effect.runPromise(chargeApprovedRequests(api, employment, [{ id: 'other' }], 1)),
		0
	);
	assert.equal(posted.length, 1);
});

test('manual balance corrections require a reason, reference and open in-year entitlement', async () => {
	const handler = leaveEntryHooks.mutate.perRecord.before.handler;
	const input = {
		leave_entitlement_id: 'entitlement',
		kind: 'MANUAL_ADJUSTMENT',
		effective_on: '2026-06-01',
		days: 1,
		reason: 'Opening balance evidence corrected',
		source_key: 'manual:ticket-42'
	};
	const stored = [];
	const api = {
		db: {
			leave_entitlements: {
				findFirst: () =>
					Effect.succeed({
						id: 'entitlement',
						status: 'OPEN',
						starts_on: '2026-01-01',
						ends_on: '2026-12-31'
					})
			},
			leave_entries: {
				findFirst: ({ where }) =>
					Effect.succeed(stored.find((row) => row.source_key === where.source_key.eq) ?? null)
			}
		}
	};
	assert.deepEqual(await Effect.runPromise(handler({ input, existing: null, api })), input);
	stored.push({ source_key: input.source_key });
	await assert.rejects(
		Effect.runPromise(handler({ input, existing: null, api })),
		/already posted/,
		'the same reference cannot be posted twice'
	);
	stored.length = 0;
	await assert.rejects(
		Effect.runPromise(handler({ input: { ...input, reason: '' }, existing: null, api })),
		/reason/
	);
	await assert.rejects(
		Effect.runPromise(
			handler({ input: { ...input, effective_on: '2027-01-01' }, existing: null, api })
		),
		/leave year/
	);
});

test('a ledger line accepts the no-change restatement a complete-set write carries, and nothing else', async () => {
	const before = leaveEntryHooks.mutate.perRecord.before.handler;
	const existing = { id: 'line', kind: 'ACCRUAL', days: 1, source_key: 'accrual:1' };
	const context = (input) => ({ input, existing, recordId: 'line', api: { db: {} } });
	assert.deepEqual(await Effect.runPromise(before(context({ id: 'line' }))), { id: 'line' });
	await assert.rejects(Effect.runPromise(before(context({ id: 'line', days: 2 }))), /append-only/);
});

test('a leave type compiles its eligibility against the person context and cites its law', async () => {
	assert.equal(compileEligibility(''), null);
	assert.equal(
		compileEligibility('employee.gender == "FEMALE" && employment.service_months >= 3'),
		null
	);
	assert.equal(compileEligibility('children.under(7) >= 1'), null);
	assert.equal(
		compileEligibility(
			'terms.basic_salary <= 2600.0 || (terms.workman && terms.basic_salary <= 4500.0)'
		),
		null
	);
	assert.match(compileEligibility('employee.gendr == "FEMALE"'), /employee\.gendr/);
	assert.match(compileEligibility('employment.service_months'), /true-or-false/);
	assert.match(compileEligibility('employee.gender == '), /does not compile/);
	// The hook reads the root as the workspace first: a draft lets the rule checks run, a sealed
	// version refuses before anything else is looked at.
	const draft = { id: SETTINGS_ID, code: 'FX', name: 'Fixture settings', sealed_at: null };
	const api = (version) => ({
		db: { jurisdiction_settings: { findFirst: () => Effect.succeed(version) } }
	});
	const before = (input, version = draft) =>
		Effect.runPromise(
			leaveTypeHooks.mutate.perRecord.before.handler({
				input,
				existing: undefined,
				api: api(version)
			})
		);
	await assert.rejects(
		before(leaveType({ eligibility: 'employee.gender = "FEMALE"' })),
		/does not compile/
	);
	await assert.rejects(
		before(leaveType({ is_statutory: true, authority: '' })),
		/cites the section of law/
	);
	assert.deepEqual(await before(leaveType()), leaveType());
	await assert.rejects(
		before(leaveType(), { ...draft, sealed_at: '2026-01-01T00:00:00.000Z' }),
		/Fixture settings \(FX, sealed on 2026-01-01\), which is sealed, so it cannot be created, changed or deleted/
	);
});

test("a person's facts never start the reconciler; a catalogue edit does, for the company", async () => {
	const employmentHooks = (await import('../src/collections/employments/+hooks.ts')).default;
	const childHooks = (await import('../src/collections/employee_children/+hooks.ts')).default;
	const termHooks = (await import('../src/collections/employment_terms/+hooks.ts')).default;
	const requestHooks = (await import('../src/collections/leave_requests/+hooks.ts')).default;
	// The ledger rides the fact's own write (hook-carried-ledger.test.ts): the employment and the
	// request nest it from before; terms and children restate the employment from before, staged
	// into the same commit. None of the four has an after hook, so nothing starts an automation.
	for (const hooks of [employmentHooks, requestHooks, childHooks, termHooks])
		assert.equal(hooks.mutate.perRecord.after, undefined);
	const started = [];
	const api = {
		automations: { run: (name, input) => Effect.sync(() => started.push([name, input])) },
		db: { jurisdiction_settings: { findFirst: () => Effect.succeed({ code: 'FX' }) } }
	};
	const typeAfter = leaveTypeHooks.mutate.perRecord.after.handler;
	await Effect.runPromise(
		typeAfter({
			record: { id: 't', settings_id: SETTINGS_ID, approval_id: null },
			changes: {},
			api
		})
	);
	assert.deepEqual(started, []);
	await Effect.runPromise(
		typeAfter({
			record: { id: 't', settings_id: SETTINGS_ID, approval_id: null },
			changes: { entitlement: { layers: [] } },
			api
		})
	);
	assert.deepEqual(started, [['leave_ledger_refresh', { settings_code: 'FX' }]]);
});
