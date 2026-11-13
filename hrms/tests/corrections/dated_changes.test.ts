// The one fold a person's, a company's and a law's dated changes are read by, and how far a write to one reaches.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { corrected, inForce, reachOf, type Change } from '../../src/lib/dated.ts';

const row = (id: string, effective_from: string, patch: Change['patch']): Change => ({
	id,
	effective_from,
	patch
});

describe('the fold', () => {
	const rows = [
		row('raise', '2026-04-01', { rate: 3500 }),
		row('hire', '2026-01-01', { rate: 3000, title: 'Clerk', pass: 'EP' }),
		row('citizen', '2026-06-01', { pass: null }),
		row('next', '2027-01-01', { rate: 4000 })
	];

	it('applies the changes dated on or before the day, oldest first', () => {
		assert.deepEqual(inForce(rows, '2026-03-31').state, { rate: 3000, title: 'Clerk', pass: 'EP' });
		assert.deepEqual(inForce(rows, '2026-04-01').state, { rate: 3500, title: 'Clerk', pass: 'EP' });
	});

	it('takes a value away with null and leaves a later change out of force', () => {
		assert.deepEqual(inForce(rows, '2026-12-31').state, { rate: 3500, title: 'Clerk' });
	});

	it('names the change that set each value', () => {
		assert.deepEqual(inForce(rows, '2026-12-31').set_by, { rate: 'raise', title: 'hire' });
	});

	it('holds nothing before the first change', () => {
		assert.deepEqual(inForce(rows, '2025-12-31').state, {});
	});

	it('merges a law patch by family, row and field, and replaces a table whole', () => {
		const law = [
			row('base', '2025-12-01', {
				subtotal: { GROSS: { expression: 'a', after: 'BASIC' }, NET: { expression: 'n' } },
				lookup: { EPF: { table: { low: 1, high: 2 } } }
			}),
			row('patch', '2026-07-01', {
				subtotal: { GROSS: { expression: 'b' }, NET: null },
				lookup: { EPF: { table: { low: 3 } } }
			})
		];
		const folded = inForce(law, '2026-07-01', 3);
		assert.deepEqual(folded.state, {
			subtotal: { GROSS: { expression: 'b', after: 'BASIC' } },
			lookup: { EPF: { table: { low: 3 } } }
		});
		assert.deepEqual(folded.set_by, {
			'subtotal/GROSS/expression': 'patch',
			'subtotal/GROSS/after': 'base',
			'lookup/EPF/table': 'patch'
		});
	});
});

describe('the reach of a write', () => {
	const hire = row('hire', '2026-01-01', { rate: 3000, title: 'Clerk' });
	const raise = row('raise', '2026-04-01', { rate: 3500 });
	const later = row('later', '2026-09-01', { rate: 3800 });

	it('runs from the change to the day before the next that sets the same value', () => {
		assert.deepEqual(reachOf([hire, later], undefined, raise), {
			from: '2026-04-01',
			to: '2026-08-31'
		});
		assert.deepEqual(reachOf([hire, later], raise, undefined), {
			from: '2026-04-01',
			to: '2026-08-31'
		});
	});

	it('has no end when no later change sets it', () => {
		assert.deepEqual(reachOf([hire, raise], undefined, later), { from: '2026-09-01', to: null });
	});

	it('starts at the earlier date when a change moves', () => {
		assert.deepEqual(reachOf([hire, later], raise, { ...raise, effective_from: '2026-06-01' }), {
			from: '2026-04-01',
			to: '2026-08-31'
		});
	});

	it('counts only what was edited', () => {
		assert.deepEqual(
			reachOf([raise, later], hire, { ...hire, patch: { rate: 3000, title: 'Officer' } }),
			{ from: '2026-01-01', to: null }
		);
		assert.deepEqual(
			reachOf([raise, later], hire, { ...hire, patch: { rate: 3100, title: 'Clerk' } }),
			{ from: '2026-01-01', to: '2026-03-31' }
		);
		assert.equal(reachOf([raise, later], hire, hire), undefined);
	});

	it('is nothing for a value payroll does not read', () => {
		assert.equal(
			reachOf(
				[raise],
				hire,
				{ ...hire, patch: { rate: 3000, title: 'Officer' } },
				1,
				(path) => path !== 'title'
			),
			undefined
		);
	});

	it('follows a law row removed whole', () => {
		const base = row('base', '2025-12-01', { subtotal: { GROSS: { expression: 'a' } } });
		const gone = row('gone', '2026-07-01', { subtotal: { GROSS: null } });
		assert.deepEqual(
			reachOf([gone], base, { ...base, patch: { subtotal: { GROSS: { expression: 'b' } } } }, 3),
			{ from: '2025-12-01', to: '2026-06-30' }
		);
	});
});

describe('a correction', () => {
	const law = [
		row('base', '2025-12-01', {
			subtotal: { GROSS: { expression: 'a', name: 'Gross' }, OLD: { expression: 'o' } }
		}),
		row('patch', '2026-07-01', { subtotal: { GROSS: { expression: 'b' }, OLD: { name: 'Old' } } })
	];
	const { set_by } = inForce(law, '2026-12-31', 3);

	it('goes on the change that set each value, and on the first change for a new one', () => {
		const fixed = corrected(
			law,
			set_by,
			{ subtotal: { GROSS: { expression: 'c', name: 'Gross pay', after: 'BASIC' } } },
			3
		);
		assert.deepEqual(fixed.get('patch'), {
			subtotal: { GROSS: { expression: 'c' }, OLD: { name: 'Old' } }
		});
		assert.deepEqual(fixed.get('base'), {
			subtotal: {
				GROSS: { expression: 'a', name: 'Gross pay', after: 'BASIC' },
				OLD: { expression: 'o' }
			}
		});
	});

	it('takes a row away from every change that held it', () => {
		const fixed = corrected(law, set_by, { subtotal: { OLD: null } }, 3);
		assert.deepEqual(fixed.get('base'), {
			subtotal: { GROSS: { expression: 'a', name: 'Gross' } }
		});
		assert.deepEqual(fixed.get('patch'), { subtotal: { GROSS: { expression: 'b' } } });
	});
});
