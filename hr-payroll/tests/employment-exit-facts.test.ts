import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import employments from '../src/collections/employments/+collection.ts';
import { transformOne } from './helpers/transform.ts';

const stored = {
	id: 'employment',
	employee_id: 'employee',
	company_id: 'company',
	employee_number: 'TEST',
	effective_range: { start: '2020-01-01', end: '2026-01-31' },
	exit_reason: 'DISMISSAL',
	exit_facts: { cause: 'WARNINGS', reference: 'NOTICE-1', offset: 0 }
};
const declarations = [
	{ key: 'cause', type: 'string', options: ['WARNINGS', 'URGENT'], required: true },
	{ key: 'reference', type: 'string', min_length: 1, required: true },
	{ key: 'offset', type: 'number', minimum: 0 }
];
const version = (start: string, end: string, options: string[]) => ({
	id: start,
	code: 'ID',
	sealed_at: start,
	voided_at: null,
	approval_id: null,
	effective_range: { start, end },
	exit_facts: declarations.map((field) => (field.key === 'cause' ? { ...field, options } : field))
});
function database(paidThrough: string | null = null) {
	return {
		companies: { findMany: () => Effect.succeed([{ id: 'company', settings_code: 'ID' }]) },
		jurisdiction_settings: {
			findMany: () =>
				Effect.succeed([
					version('2025-01-01', '2026-01-01', ['OLD']),
					version('2026-01-01', '9999-12-31', ['WARNINGS', 'URGENT'])
				])
		},
		employments: { findMany: () => Effect.succeed([stored]) },
		payslips: {
			findMany: () =>
				Effect.succeed(
					paidThrough == null ? [] : [{ employment_id: stored.id, terms_through: paidThrough }]
				)
		}
	};
}
const write = (input: Record<string, unknown>, through: string | null = null, row = stored) =>
	transformOne(employments, input, row, database(through));

test('departure declarations use the last working day, not the current jurisdiction version', () => {
	const old = {
		...stored,
		effective_range: { start: '2020-01-01', end: '2025-12-31' },
		exit_facts: { cause: 'OLD', reference: 'OLD-NOTICE', offset: 0 }
	};
	assert.deepEqual(write({ exit_facts: old.exit_facts }, null, old).exit_facts, old.exit_facts);
	assert.throws(() => write({ exit_facts: stored.exit_facts }, null, old), /must be one of: OLD/);
	assert.throws(
		() => write({ exit_facts: { ...stored.exit_facts, cause: 'OLD' } }),
		/must be one of: WARNINGS, URGENT/
	);
});

test('departure writes reject unknown keys, invalid choices and invalid declared values', () => {
	for (const [facts, error] of [
		[{ ...stored.exit_facts, typo: 1 }, /does not declare/],
		[{ ...stored.exit_facts, cause: 'OTHER' }, /must be one of/],
		[{ ...stored.exit_facts, offset: -1 }, /must be at least 0/],
		[{ ...stored.exit_facts, offset: '0' }, /must be a number/],
		[{ ...stored.exit_facts, reference: '   ' }, /at least 1 characters/]
	] as const)
		assert.throws(() => write({ exit_facts: facts }), error);
});

test('incomplete departure values can be saved for review without inventing defaults', () => {
	assert.deepEqual(write({ exit_facts: {} }).exit_facts, {});
	assert.deepEqual(write({ exit_facts: { offset: 0 } }).exit_facts, { offset: 0 });
});

test('departure facts require an actual last working day', () => {
	assert.throws(
		() => write({ effective_range: { start: '2020-01-01', end: null } }),
		/require a last working day/
	);
});

test('departure facts remain correctable before final payroll is paid', () => {
	const changed = { ...stored.exit_facts, cause: 'URGENT' };
	assert.deepEqual(write({ exit_facts: changed }).exit_facts, changed);
	assert.deepEqual(write({ exit_facts: changed }, '2025-12-31').exit_facts, changed);
});

test('paid final payroll freezes departure facts and the broad reason', () => {
	for (const through of ['2026-01-31', '2026-02-28']) {
		assert.throws(
			() => write({ exit_facts: { ...stored.exit_facts, cause: 'URGENT' } }, through),
			/fixed by paid final payroll/
		);
		assert.throws(() => write({ exit_facts: null }, through), /fixed by paid final payroll/);
		assert.throws(
			() => write({ exit_reason: 'RESIGNATION' }, through),
			/fixed by paid final payroll/
		);
	}
	assert.deepEqual(
		write({ exit_facts: stored.exit_facts }, '2026-01-31').exit_facts,
		stored.exit_facts
	);
	assert.equal(
		write({ comments: 'Settlement reference corrected' }, '2026-01-31').comments,
		'Settlement reference corrected'
	);
});
