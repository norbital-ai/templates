// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * The `leave_entries` collection end to end over stored rows: its transform and its two queries read
 * the employment's history through `readLeaveContext` (wire shapes: a date period, money beside its
 * currency) and answer exactly what the planner answers over the same facts in hand.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import leaveEntries from '../src/data/collection/leave_entries/+collection.ts';
import { leaveBalanceSummaries } from '../src/lib/leave/summary.ts';
import { memoryDb, runTransform } from './helpers/ctx.ts';
import {
	approve,
	id,
	leaveContext,
	planLeaveBatch,
	submission,
	timeOff
} from './helpers/manual-leave-context.ts';

const period = (range) => ({
	from: { $d: range.start },
	to: range.end == null ? null : { $d: range.end }
});

/** The planner's context as the tables it is read from. */
function tables(context = leaveContext()) {
	return {
		employments: context.employments.map((row) => ({
			...row,
			effective_range: period(row.effective_range)
		})),
		companies: context.companies,
		employees: context.employees,
		employment_terms: context.terms.map(({ base_salary, ...row }) => ({
			...row,
			effective_range: period(row.effective_range),
			base_salary: { $dec: String(base_salary.value) },
			currency: base_salary.currency
		})),
		leave_entries: context.entries,
		jurisdiction_settings: context.versions,
		leave_catalogue: context.catalogues,
		shift_patterns: context.patterns.map((row) => ({ ...row, company_id: id(3) })),
		shift_definitions: context.shifts
	};
}

const request = submission(timeOff('2026-04-06', '2026-04-08'), 'APR');

test('the transform plans a stored employment exactly as the planner plans it in hand', async () => {
	const [planned] = await runTransform(leaveEntries, [request], { tables: tables() });
	const [expected] = planLeaveBatch(leaveContext(), [request]);
	assert.equal(planned.activity, 'TIME_OFF');
	assert.equal(planned.leave_code, 'ANNUAL');
	assert.deepEqual(planned.charges, expected.charges);
	assert.equal(planned.charges.length, 3);
	await assert.rejects(
		runTransform(leaveEntries, [{ ...request, employment_id: id(99) }], { tables: tables() }),
		/approved employment/
	);
});

test('leave_balances and preview_leave answer from the same read', async () => {
	const ctx = memoryDb(tables());
	const balances = await leaveEntries.bodies.queries.leave_balances(
		{ employment_id: id(1), as_of: { $d: '2026-06-01' } },
		ctx
	);
	assert.deepEqual(balances, leaveBalanceSummaries(leaveContext(), id(1), '2026-06-01'));
	assert.equal(balances[0].available, 12);
	assert.deepEqual(
		await leaveEntries.bodies.queries.leave_balance_report(
			{ company_id: id(3), as_of: { $d: '2026-06-01' } },
			ctx
		),
		{
			rows: [{ employee_number: '', name: '', service_start: '2025-01-01', balances }],
			next_cursor: null
		}
	);
	const preview = await leaveEntries.bodies.queries.preview_leave(
		{
			employment_id: id(1),
			catalogue_id: id(7),
			range: {
				start: { date: '2026-04-06', half: 'FIRST' },
				end: { date: '2026-04-08', half: 'SECOND' }
			}
		},
		ctx
	);
	assert.equal(preview.chargeable_days, 3);
	await assert.rejects(
		leaveEntries.bodies.queries.preview_leave({ employment_id: id(1), catalogue_id: id(7) }, ctx),
		/Choose a calendar month or a leave range/
	);
});

test('company report retains an overdrawn person with unknown balances while individual balance still refuses', async () => {
	const context = leaveContext();
	context.catalogues[0].entitlement.auto_carry_one_year = true;
	const entry = approve(context, timeOff('2025-04-01'));
	entry.days = -13;
	entry.allocations.forEach((allocation) => {
		allocation.days = -13;
	});
	context.employments.push({ ...context.employments[0], id: id(21), employee_id: id(22) });
	context.employees.push({ ...context.employees[0], id: id(22) });
	context.terms.push({ ...context.terms[0], id: id(24), employment_id: id(21) });
	const ctx = memoryDb(tables(context));
	const { rows } = await leaveEntries.bodies.queries.leave_balance_report(
		{ company_id: id(3), as_of: '2026-06-01' },
		ctx
	);
	assert.equal(rows.length, 2);
	assert.deepEqual(rows[0].balances, []);
	assert.match(rows[0].issue, /Prior-year leave is overdrawn/);
	assert.equal(rows[0].service_start, '2025-01-01');
	assert.equal(rows[1].issue, undefined);
	assert.ok(rows[1].balances[0].balance > 0);
	await assert.rejects(
		leaveEntries.bodies.queries.leave_balances({ employment_id: id(1), as_of: '2026-06-01' }, ctx),
		/Prior-year leave is overdrawn/
	);
});

test('company report does not convert unexpected calculation errors into incomplete balances', async () => {
	const context = leaveContext();
	context.catalogues[0].entitlement.bands = null;
	await assert.rejects(
		leaveEntries.bodies.queries.leave_balance_report(
			{ company_id: id(3), as_of: '2026-06-01' },
			memoryDb(tables(context))
		),
		TypeError
	);
});

test('company balance report pages include every employment once and never another company', async () => {
	const context = leaveContext();
	for (let n = 20; n < 26; n++) {
		context.employments.push({ ...context.employments[0], id: id(n), employee_id: id(n + 100) });
		context.employees.push({ ...context.employees[0], id: id(n + 100) });
		context.terms.push({ ...context.terms[0], id: id(n + 200), employment_id: id(n) });
	}
	const stored = tables(context);
	stored.employments.forEach((row, n) => {
		row.employee_number = `PERSON${n}`;
	});
	stored.employments.push({
		...stored.employments[0],
		id: id(99),
		company_id: id(98),
		employee_number: 'OTHER'
	});
	const ctx = memoryDb(stored);
	const first = await leaveEntries.bodies.queries.leave_balance_report(
		{ company_id: id(3), as_of: '2026-06-01' },
		ctx
	);
	assert.equal(first.rows.length, 5);
	assert.ok(first.next_cursor);
	const second = await leaveEntries.bodies.queries.leave_balance_report(
		{ company_id: id(3), as_of: '2026-06-01', after: first.next_cursor },
		ctx
	);
	assert.equal(second.rows.length, 2);
	assert.equal(second.next_cursor, null);
	assert.deepEqual(
		[...first.rows, ...second.rows].map((row) => row.employee_number).sort(),
		Array.from({ length: 7 }, (_, n) => `PERSON${n}`)
	);
});
