// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * A fact the next regular run would refuse on is one FACT_OWED reminder per subject and key, due on that run's pay
 * date; the sweep raises it once and closes it after the fact is recorded. Fixtures are jurisdiction-free.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { entityFactsOwed } from '../src/lib/facts-owed.ts';
import { factReminders, nextRegularRun } from '../src/lib/obligations/reminders.ts';

const version = {
	facts: [{ key: 'registered', type: 'boolean', required: true }],
	person_facts: [{ key: 'status', type: 'string', required: true }]
};
const owed = (overrides = {}) =>
	entityFactsOwed({
		asOf: '2026-10-31',
		window: { start: '2026-10-01', end: '2026-10-31' },
		versionOn: () => version,
		company: { id: 'co', name: 'Co', settings_code: 'LX', region: null, pay_frequency: 'MONTHLY' },
		companyFactRevisions: [],
		employments: [
			{
				id: 'e1',
				employee_id: 'p1',
				employee_number: 'E001',
				effective_range: { from: '2025-01-01', to: null }
			}
		],
		employees: [{ id: 'p1' }],
		terms: [],
		personFacts: [],
		evidence: new Set(),
		...overrides
	});

/** One sweep over the recorded reminders: what it raises is stored OPEN, what it closes is FULFILLED. */
const sweep = (recorded, facts) => {
	const { raise, close } = factReminders({
		companyId: 'co',
		settingsId: 'v1',
		dueOn: '2026-10-31',
		today: '2026-10-01',
		owed: facts,
		reminders: recorded
	});
	return {
		raise,
		close,
		after: [
			...recorded.map((row) => (close.includes(row.id) ? { ...row, state: 'FULFILLED' } : row)),
			...raise.map((row, index) => ({ ...row, id: `r${recorded.length + index}` }))
		]
	};
};

test('the next regular run follows the latest regular one, else pays the current period', () => {
	assert.deepEqual(nextRegularRun(['2026-08', '2026-09'], 'MONTHLY', '2026-10-01'), {
		period: '2026-10',
		window: { start: '2026-10-01', end: '2026-10-31' },
		payDate: '2026-10-31'
	});
	assert.equal(nextRegularRun(['2026-09-1'], 'SEMI_MONTHLY', '2026-10-01').period, '2026-09-2');
	assert.equal(nextRegularRun([], 'MONTHLY', '2026-10-01').payDate, '2026-10-31');
});

test('a missing required fact raises one reminder per subject and key, due on the pay date', () => {
	const { raise, close } = sweep([], owed());
	assert.deepEqual(close, []);
	assert.deepEqual(
		raise.map((row) => [
			row.duty_code,
			row.subject_kind,
			row.subject_id,
			row.trigger_ref,
			row.due_on
		]),
		[
			['FACT_OWED', 'COMPANY', 'co', 'registered', '2026-10-31'],
			['FACT_OWED', 'EMPLOYMENT', 'e1', 'status', '2026-10-31']
		]
	);
});

test('a second sweep raises nothing new', () => {
	const first = sweep([], owed());
	const second = sweep(first.after, owed());
	assert.deepEqual(second.raise, []);
	assert.deepEqual(second.close, []);
});

test('recording the fact closes its reminder and leaves the other open', () => {
	const first = sweep([], owed());
	const recorded = owed({
		companyFactRevisions: [
			{ id: 'f1', facts: { registered: true }, effective_range: { from: '2026-01-01', to: null } }
		]
	});
	const second = sweep(first.after, recorded);
	assert.deepEqual(second.raise, []);
	assert.deepEqual(
		second.after.map((row) => [row.trigger_ref, row.state]),
		[
			['registered', 'FULFILLED'],
			['status', 'OPEN']
		]
	);
	// closed stays closed: a third sweep neither reopens nor raises it again
	assert.deepEqual(sweep(second.after, recorded).raise, []);
});
