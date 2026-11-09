// 大量解僱勞工保護法 §2: the first four thresholds count the workforce of the same 廠場; the fifth is entity-wide.
// 就業服務法 §46 fixed-term workers are excluded from both the workforce and the leavers.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from '@effect/vitest';
import { evaluate } from '../src/lib/payroll_engine/expressions.ts';

type Rule = { readonly code: string; readonly validate?: string; readonly effects?: string; readonly lookup?: Record<string, unknown> };
const load = <T>(file: string): T =>
	JSON.parse(
		readFileSync(new URL(`../seed/public/jurisdiction/TW/version_5/${file}`, import.meta.url), 'utf8')
	) as T;
const effect = load<readonly Rule[]>('registered_effect.json').find((row) => row.code === 'MASS_LAYOFF_PLAN');
const entityEffect = load<readonly Rule[]>('registered_effect.json').find(
	(row) => row.code === 'MASS_LAYOFF_PLAN_ENTITY'
);
const worksite = load<readonly Rule[]>('registered_rule.json').find(
	(row) => row.code === 'MASS_LAYOFF_WORKSITE_REQUIRED'
);
assert.ok(effect?.effects !== undefined && effect.lookup !== undefined);
assert.ok(entityEffect?.effects !== undefined && entityEffect.lookup !== undefined);
assert.ok(worksite?.validate !== undefined);

const EXIT = '2026-06-15';
type Kind = 'staff' | 'local' | 'section46';
const contract = (id: string, site: string, kind: Kind, ground = 'ARTICLE_11') => ({
	id,
	entity_id: 'entity-1',
	status: 'SEALED',
	engagement: 'EMPLOYEE',
	terms: { worksite: site },
	effective_range: kind === 'staff' ? { from: '2026-01-01', to: null } : { from: '2025-01-01', to: EXIT },
	employee_extension_data: {
		...(kind === 'staff' ? {} : { lsa_termination_ground: ground }),
		...(kind === 'local' ? { fixed_term_category: 'LOCAL_FIXED_TERM' } : {}),
		...(kind === 'section46'
			? { fixed_term_category: 'FOREIGN_FIXED_TERM', migrant_worker: true }
			: {})
	}
});
const site = (siteName: string, leavers: number, staff: number, kind: Kind = 'local') => [
	...Array.from({ length: leavers }, (_, i) => contract(`${siteName}-l${i}`, siteName, kind)),
	...Array.from({ length: staff }, (_, i) => contract(`${siteName}-s${i}`, siteName, 'staff'))
];
const obligations = (
	contracts: readonly object[],
	entry: object = contracts[0]!,
	which = effect!
) =>
	evaluate(
		which.effects!,
		'CALCULATION',
		{ lookup: which.lookup ?? {}, entry, reads: { employee_contract: contracts, obligation: [] } },
		which.code
	) as readonly { title: string; due_on: string; occurrence_key: string }[];

describe('TW mass layoff plan', () => {
	it('eleven leavers at one site raise one site plan, due sixty days before the exit', () => {
		const rows = obligations([...site('A', 11, 14), ...site('B', 10, 15)]);
		assert.equal(rows.length, 1);
		assert.match(rows[0]!.occurrence_key, /^MASS_LAYOFF_PLAN:entity-1:A:/);
		assert.equal(rows[0]!.title, 'Mass layoff plan for A notified sixty days before');
		assert.equal(rows[0]!.due_on, '2026-04-16');
	});
	it('ten leavers at each site raise none', () => {
		assert.equal(obligations([...site('A', 10, 15), ...site('B', 10, 15)]).length, 0);
	});
	it('two sites over their threshold raise two distinct plans', () => {
		const rows = obligations([...site('A', 11, 14), ...site('B', 11, 14)]);
		assert.equal(rows.length, 2);
		assert.equal(new Set(rows.map((row) => row.occurrence_key)).size, 2);
	});
	it('a local fixed-term leaver is counted', () => {
		assert.equal(obligations([...site('A', 11, 14, 'local'), ...site('B', 10, 15)]).length, 1);
	});
	it('a section 46 fixed-term worker is excluded from staff and leavers', () => {
		assert.equal(obligations([...site('A', 11, 14, 'section46'), ...site('B', 10, 15)]).length, 0);
	});
	it('the entity-wide threshold raises a plan without a site label', () => {
		const rows = obligations(
			[
				...site('A', 40, 100), ...site('B', 40, 100), ...site('C', 40, 100),
				...site('D', 40, 100), ...site('E', 41, 100)
			],
			undefined,
			entityEffect
		);
		const entity = rows.filter((row) => row.occurrence_key === 'MASS_LAYOFF_PLAN:entity-1:2026-04-16');
		assert.equal(entity.length, 1);
		assert.equal(entity[0]?.title, 'Mass layoff plan notified sixty days before');
	});
	it('requires a worksite on the site-counted engagements only', () => {
		const valid = (engagement: string, worksiteName: string) =>
			evaluate(
				worksite!.validate!,
				'CALCULATION',
				{ entry: { engagement, terms: { worksite: worksiteName } }, lookup: {}, reads: {} },
				'MASS_LAYOFF_WORKSITE_REQUIRED'
			);
		assert.equal(valid('EMPLOYEE', ''), false);
		assert.equal(valid('EMPLOYEE', 'A'), true);
		assert.equal(valid('CONTRACTOR', ''), true);
		assert.equal(valid('PAYEE', ''), true);
	});
});
