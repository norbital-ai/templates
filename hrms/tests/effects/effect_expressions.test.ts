// What an effect or rule evaluates: its reads resolve their expressions, an expression falls back past a stored null, a
// rule's validate holds an entry to its lookup bound, and the register-change trigger counts only what the register shows.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { registerChanged } from '../../src/data/model/employee_profile/+model.ts';
import { evaluate } from '../../src/lib/payroll_engine/expressions.ts';
import { resolveRead } from '../../src/lib/payroll_engine/registrations.ts';
import { lawAt } from '../kit.ts';

describe('an effect expression', () => {
	it('resolves a compound read, so a retried effect finds its own obligation', () => {
		const data = { entry: { id: 'row-1', entity_id: 'entity-1', catalog_code: 'CODE_1' } };
		assert.deepEqual(
			resolveRead(
				{
					obligation: {
						where: { occurrence_key: { eq: { var: "'MY:KEY:' + ctx.entry.entity_id" } } }
					},
					leave_catalog: { where: { code: { in: { var: '[ctx.entry.catalog_code]' } } } },
					payslip: { where: { id: { eq: { var: 'ctx.entry.id' } } }, limit: 10 }
				},
				data
			),
			{
				obligation: { where: { occurrence_key: { eq: 'MY:KEY:entity-1' } } },
				leave_catalog: { where: { code: { in: ['CODE_1'] } } },
				payslip: { where: { id: { eq: 'row-1' } }, limit: 10 }
			}
		);
	});
	it('falls back past a stored null: a version with no registrations raises its task', () => {
		const version = (registrations: unknown) => ({ status: 'SEALED', registrations });
		const condition = `// js
const r = ctx.entry;
return r.status === 'SEALED' && !get(r, 'registrations', []).some((x) => get(x, 'scheme_code', '') === 'EPF');`;
		const open = (entry: object) => evaluate(condition, 'CALCULATION', { entry }, 'condition');
		assert.equal(open(version(null)), true);
		assert.equal(open(version([{ scheme_code: 'EPF' }])), false);
	});
});

describe("a registered rule's validate", () => {
	const rule = lawAt('MY', '2026-07-08').rows.registered_rule.find(
		(row) => row.code === 'SHARED_STRUCTURED_EMPLOYEE_INPUTS'
	);
	assert.ok(rule !== undefined);
	const valid = (carry?: number) =>
		evaluate(
			String(rule.validate),
			'CALCULATION',
			{
				lookup: { annual_leave_carry_minimum: 5 },
				entry: { terms: carry === undefined ? {} : { annual_leave_carry_limit_days: carry } }
			},
			'validate'
		);
	it('holds the entry to the bound its lookup sets', () => {
		assert.equal(valid(5), true);
		assert.equal(valid(6), true);
		assert.equal(valid(4), false);
		assert.equal(valid(), true);
	});
});

describe('the register-change trigger', () => {
	const change = (
		before: { name?: string; address?: string; phone?: string; email?: string },
		after: { name?: string; address?: string; phone?: string; email?: string }
	) => ({ before, after });
	it('ignores contact details and counts a changed name or address', () => {
		assert.equal(
			registerChanged([
				change({ name: 'A', address: 'X', phone: '1' }, { name: 'A', address: 'X', phone: '2' })
			]).length,
			0
		);
		assert.equal(
			registerChanged([
				change({ name: 'A', address: 'X', email: 'a' }, { name: 'B', address: 'X', email: 'a' })
			]).length,
			1
		);
		assert.equal(
			registerChanged([change({ name: 'A', address: 'X' }, { name: 'A', address: 'Y' })]).length,
			1
		);
	});
	it('keeps one change per person', () => {
		const changes = [
			change({ name: 'A', address: 'X' }, { name: 'B', address: 'X' }),
			change({ name: 'C', address: 'X' }, { name: 'C', address: 'Y' })
		];
		assert.equal(registerChanged(changes).length, 2);
	});
});
