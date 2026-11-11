// Registration reads resolve their expressions, and an expression falls back past a stored null.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { evaluate } from '../src/lib/payroll_engine/expressions.ts';
import { resolveRead } from '../src/lib/payroll_engine/registrations.ts';

describe('jurisdiction worker classifications', () => {
	it('resolves a compound read, so a retried effect finds its own obligation', () => {
		const data = { entry: { id: 'row-1', entity_id: 'entity-1', catalog_id: 'catalog-1' } };
		assert.deepEqual(
			resolveRead(
				{
					obligation: {
						where: { occurrence_key: { eq: { var: "'MY:KEY:' + ctx.entry.entity_id" } } }
					},
					leave_catalog: { where: { id: { in: { var: '[ctx.entry.catalog_id]' } } } },
					payslip: { where: { id: { eq: { var: 'ctx.entry.id' } } }, limit: 10 }
				},
				data
			),
			{
				obligation: { where: { occurrence_key: { eq: 'MY:KEY:entity-1' } } },
				leave_catalog: { where: { id: { in: ['catalog-1'] } } },
				payslip: { where: { id: { eq: 'row-1' } }, limit: 10 }
			}
		);
	});
	it('falls back past a stored null: an MY version with no registrations raises its EPF task', () => {
		const version = (registrations: unknown) => ({ status: 'SEALED', registrations });
		const condition = `// js
const r = ctx.entry;
return r.status === 'SEALED' && !get(r, 'registrations', []).some((x) => get(x, 'scheme_code', '') === 'EPF');`;
		const open = (entry: object) => evaluate(condition, 'CALCULATION', { entry }, 'condition');
		assert.equal(open(version(null)), true);
		assert.equal(open(version([{ scheme_code: 'EPF' }])), false);
	});
});
