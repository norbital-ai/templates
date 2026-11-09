// SG: a young manual worker needs a Commissioner permission case for rest-day work; shared parental leave is 6 weeks
// for a birth before 1 April 2026 and 10 weeks from that date; a contract work category must be a declared one.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from '@effect/vitest';
import { TestWorkspace } from '@norbital-ai/bolt-cli/test';
import { Effect } from 'effect';
import { evaluate } from '../src/lib/payroll_engine/expressions.ts';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import { pack, uuid, workspace } from './kit.ts';

type Rule = { readonly code: string; readonly validate?: string; readonly lookup?: Record<string, unknown>; readonly reads?: Record<string, unknown> };
const load = <T>(version: number, file: string): T =>
	JSON.parse(
		readFileSync(
			new URL(`../seed/public/jurisdiction/SG/version_${version}/${file}`, import.meta.url),
			'utf8'
		)
	) as T;
const ruleOf = (version: number, code: string) => {
	const rule = load<readonly Rule[]>(version, 'registered_rule.json').find((row) => row.code === code);
	assert.ok(rule?.validate !== undefined);
	return rule;
};
const young = ruleOf(4, 'ROSTER_YOUNG_REST_DAY');
const permit = (from: string, to: string | null = null) => ({ opened_on: from, closed_on: to });
const allowed = (cases: readonly object[], date = '2026-05-10') =>
	evaluate(
		young.validate!,
		'CALCULATION',
		{ entry: { work_date: date }, subject: { employment: { entity_id: 'entity-1' } }, reads: { workplace_case_catalog_entry: cases } },
		young.code
	);
const contract = ruleOf(4, 'CONTRACT_CATEGORIES');
const category = (value: string | undefined) =>
	evaluate(
		contract.validate!,
		'CALCULATION',
		{
			lookup: contract.lookup ?? {},
			entry: {
				terms: {
					residency_status: 'CITIZEN',
					work_classification: 'EA_COVERED',
					...(value === undefined ? {} : { statutory_work_category: value })
				}
			}
		},
		contract.code
	);
const splOf = (version: number) => {
	const row = load<readonly { code: string; lookup?: Record<string, unknown> }[]>(
		version,
		'leave_catalog.json'
	).find((item) => item.code === 'SHARED_PARENTAL_LEAVE');
	assert.ok(row?.lookup?.['entitlement'] !== undefined, `version ${version}`);
	return row;
};
const spl = splOf(2);
const splDays = (
	birth: string,
	allocated?: number,
	row: typeof spl = spl,
	children: Readonly<Record<string, Readonly<Record<string, number>>>> = {}
) =>
	evaluate(
		String(row.lookup!['entitlement']),
		'CALCULATION',
		{
			lookup: row.lookup,
			as_of: birth,
			event: { kind: 'CHILD_BIRTH', on: birth },
			subject: {
				employment: {
					child_leave_allocations:
						allocated === undefined
							? children
							: { SHARED_PARENTAL_LEAVE: { ...children['SHARED_PARENTAL_LEAVE'], [birth]: allocated } }
				}
			}
		},
		'SHARED_PARENTAL_LEAVE'
	);

describe('SG remaining gaps', () => {
	it('a covering Commissioner permission case allows young manual rest-day work', () => {
		assert.equal(allowed([permit('2026-05-01', '2026-05-31')]), true);
		assert.equal(allowed([]), false);
		assert.equal(allowed([permit('2026-06-01')]), false);
		const where = (young.reads?.['workplace_case_catalog_entry'] as { where?: Record<string, unknown> }).where ?? {};
		assert.deepEqual(where['kind'], { eq: 'YOUNG_PERSON_REST_DAY_PERMISSION' });
		assert.deepEqual(where['employment_id'], { eq: { var: 'ctx.entry.employment_id' } });
		assert.deepEqual(where['entity_id'], { eq: { var: 'ctx.subject.employment.entity_id' } });
	});
	it('shared parental leave splits at 1 April 2026 and defaults to half the pool', () => {
		assert.equal(Number(splDays('2026-03-31')), 21);
		assert.equal(Number(splDays('2026-04-01')), 35);
	});
	it('a recorded transfer replaces the half default for that parent', () => {
		assert.equal(Number(splDays('2026-04-01', 45)), 45);
		assert.equal(Number(splDays('2026-04-01', 25)), 25);
	});
	it('the default is half of each version’s pool', () => {
		assert.equal(Number(splDays('2025-12-15', undefined, splOf(1))), 21);
		assert.equal(Number(splDays('2026-07-15', undefined, splOf(3))), 35);
		assert.equal(Number(Number(splDays('2026-04-01', 45)) + Number(splDays('2026-04-01', 25))), 70);
	});
	it('allocations are per child and per leave code', () => {
		const children = {
			SHARED_PARENTAL_LEAVE: { '2026-04-01': 45, '2026-08-01': 35 }
		};
		assert.equal(Number(splDays('2026-04-01', undefined, spl, children)), 45);
		assert.equal(Number(splDays('2026-08-01', undefined, spl, children)), 35);
		assert.equal(Number(splDays('2026-12-01', undefined, spl, children)), 35);
	});
	it('HR can record an allocation on a sealed contract', () =>
		Effect.gen(function* () {
			const terms = {
				rate: { amount: 5000, unit: 'MONTHLY' },
				normal_hours_per_day: 8,
				normal_hours_per_week: 44,
				normal_days_per_week: 5,
				statutory_work_category: 'NON_MANUAL',
				work_classification: 'EA_COVERED',
				residency_status: 'CITIZEN',
				wage_payment_method: 'BANK',
				allowances: {}
			};
			const seed = pack('SG', 'Asia/Singapore', terms, {}, [], [], '2026-06-15');
			const contract = idOf('employee_contract', uuid(6));
			const t = yield* TestWorkspace;
			yield* t.as(t.admin).act('employee_contract.update', [
				{
					target: contract,
					set: { child_leave_allocations: { SHARED_PARENTAL_LEAVE: { '2026-04-01': 45 } } }
				}
			]);
			const { employee_contract } = yield* t.storedQuery({ employee_contract: { limit: 1 } });
			assert.deepEqual(employee_contract.rows[0]?.child_leave_allocations, {
				SHARED_PARENTAL_LEAVE: { '2026-04-01': 45 }
			});
		}).pipe(Effect.provide(workspace({ seed: pack('SG', 'Asia/Singapore', {
			rate: { amount: 5000, unit: 'MONTHLY' },
			normal_hours_per_day: 8,
			normal_hours_per_week: 44,
			normal_days_per_week: 5,
			statutory_work_category: 'NON_MANUAL',
			work_classification: 'EA_COVERED',
			residency_status: 'CITIZEN',
			wage_payment_method: 'BANK',
			allowances: {}
		}, {}, [], [], '2026-06-15'), now: '2026-07-01T02:00:00.000Z' })))
	);
	it('a contract work category must be declared', () => {
		assert.equal(category('NON_MANUAL'), true);
		assert.equal(category('MANUAL_LABOUR'), true);
		assert.equal(category('MANUAL_LABOUR_SUPERVISOR'), true);
		assert.equal(category('NON_FIELD'), false);
		assert.equal(category(undefined), true);
	});
});
