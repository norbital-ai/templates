import assert from 'node:assert/strict';
import { it } from '@effect/vitest';
import { TestWorkspace } from '@norbital-ai/bolt-cli/test';
import { PlainDate } from '@norbital-ai/std/date';
import { Effect } from 'effect';
import { kindsOf } from '../src/lib/payroll_engine/listed_kinds.ts';
import { fixtureId, nativeId } from './fixture_values.ts';
import { COMPANY, VERSION, employer, employment, world } from './jurisdiction_kit.ts';

it('listed kinds default missing names and reject a malformed slot as a whole', () => {
	assert.deepEqual(
		kindsOf({ kinds: [{ code: 'RESIGNATION', name: 'Resignation' }, { code: 'MUTUAL' }] }),
		[
			{ code: 'RESIGNATION', name: 'Resignation' },
			{ code: 'MUTUAL', name: 'MUTUAL' }
		]
	);
	assert.deepEqual(
		kindsOf({ kinds: [{ code: 'RESIGNATION', name: 'Resignation' }, { name: 'x' }] }),
		[]
	);
});

it.effect(
	'calendar and workplace writes validate a whole batch against their own governing definitions',
	() => {
		const rows = employer([{ key: 'a', salary: 3000 }]);
		const rules = rows.get('rule_set');
		assert.ok(rules);
		rows.set('suspension_catalog', [
			{
				id: nativeId('suspension_catalog', fixtureId('xx-closure')),
				settings_id: VERSION,
				code: 'CLOSURE',
				name: 'Closure'
			}
		]);
		rules.push({
			id: nativeId('rule_set', fixtureId('xx-case-kinds')),
			settings_id: VERSION,
			family: 'PARAMETERS',
			code: 'case_kinds',
			name: 'Case kinds',
			rules: { kinds: [{ code: 'FLEXIBLE_WORK', name: 'Flexible work' }] }
		});
		return world(rows).withRead(() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const hr = t.as(t.member(['hr_manager']));
				const days = ['2026-03-03', '2026-03-04', '2026-03-05'];
				assert.equal(
					(yield* hr.act(
						'holiday.create',
						days.map((day) => ({
							company_id: COMPANY,
							date: PlainDate(day),
							name: `Holiday ${day}`,
							kind: 'PUBLIC_HOLIDAY'
						}))
					)).kind,
					'committed'
				);
				assert.equal(
					(yield* hr.act(
						'work_suspension.create',
						days.map((day) => ({
							company_id: COMPANY,
							starts_on: PlainDate(day),
							ends_on: PlainDate(day),
							kind: 'CLOSURE'
						}))
					)).kind,
					'committed'
				);
				assert.equal(
					(yield* hr.act(
						'workplace_case.create',
						days.map((day) => ({
							company_id: COMPANY,
							employment_id: employment('a'),
							opened_on: PlainDate(day),
							kind: 'FLEXIBLE_WORK'
						}))
					)).kind,
					'committed'
				);
				const rejected = yield* Effect.flip(
					hr.act('workplace_case.create', [
						{
							company_id: COMPANY,
							opened_on: PlainDate(days[0]!),
							kind: 'UNLISTED'
						}
					])
				);
				assert.match(rejected.message, /lists no case kind UNLISTED/);
				assert.equal((yield* hr.query({ workplace_case: {} })).workplace_case.rows.length, 3);
			})
		);
	}
);
