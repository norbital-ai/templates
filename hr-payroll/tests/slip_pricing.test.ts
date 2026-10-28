/**
 * Two homes a salary slip prices beside its time pay: a scheme's wage adjustments (a taxable excess or an exempt share
 * the scheme assesses without paying it) and an automatic allowance class (priced from the period's facts without a
 * contract line). PIT is the `XX` ladder: 0 % to 1,000, 10 % to 5,000, 20 % above.
 */
import assert from 'node:assert/strict';
import { it } from '@effect/vitest';
import { TestWorkspace } from '@norbital-ai/bolt/test';
import { Effect } from 'effect';
import { fixtureId, nativeId } from './fixture_values.ts';
import { COMPANY, VERSION, employer, runOf, world } from './jurisdiction_kit.ts';

const MARCH = { company_id: COMPANY, period: '2026-03', kind: 'REGULAR' } as const;

it.effect(
	'a scheme wage adjustment moves only the schemes it counts toward, unpaid',
	() => {
		const rows = employer([{ key: 'a', salary: 3000 }]);
		rows.set(
			'statutory_contribution_catalog',
			(rows.get('statutory_contribution_catalog') ?? []).map((row) => {
				const configuration = row['configuration'];
				assert.ok(configuration != null && typeof configuration === 'object');
				return row['code'] === 'PIT'
					? {
							...row,
							configuration: {
								...configuration,
								wage_adjustments: [
									{
										code: 'TAXABLE_EXCESS',
										name: 'Taxable excess',
										eligibility: 'terms.base_salary > 2000.0',
										quantity: '2.0',
										rate: '250.0',
										direction: 'ADD',
										counts_toward: ['PIT']
									},
									{
										code: 'EXEMPT_SHARE',
										name: 'Exempt share',
										eligibility: 'true',
										quantity: '1.0',
										rate: '100.0',
										direction: 'SUBTRACT',
										counts_toward: ['PIT']
									}
								]
							}
						}
					: row;
			})
		);
		return world(rows).withRead(() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const hr = t.as(t.member(['hr_manager']));
				assert.equal((yield* hr.act('payroll_run.create', [MARCH])).kind, 'committed');
				const slip = (yield* runOf(hr, '2026-03')).slip('a');
				// both lines are on the slip, neither is paid
				assert.deepEqual(slip.lines, { BASIC: 3000, TAXABLE_EXCESS: 500, EXEMPT_SHARE: -100 });
				assert.equal(slip.gross, 3000);
				// PIT on 3,000 + 500 − 100 = 3,400: 10 % of 2,400; FUND (5 %) and WHT (10 %) stay on 3,000
				assert.deepEqual(slip.statutory, { FUND: 150, WHT: 300, PIT: 240 });
				assert.equal(slip.net, 3000 - 150 - 300 - 240);
			})
		);
	}
);

it.effect(
	'an automatic allowance class prices on its eligibility without a contract line',
	() => {
		const rows = employer([
			{ key: 'a', salary: 3000 },
			{ key: 'b', salary: 6000 }
		]);
		rows.set('allowance_catalog', [
			...(rows.get('allowance_catalog') ?? []),
			{
				id: nativeId('allowance_catalog', fixtureId('xx-heat')),
				settings_id: VERSION,
				code: 'HEAT',
				name: 'Heat allowance',
				automatic: true,
				eligibility: 'terms.base_salary < 5000.0',
				amount: '(2.0) * (20.0)',
				destination: 'PAY',
				direction: 'ADD',
				counts_toward: ['PIT']
			}
		]);
		return world(rows).withRead(() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const hr = t.as(t.member(['hr_manager']));
				assert.equal((yield* hr.act('payroll_run.create', [MARCH])).kind, 'committed');
				const run = yield* runOf(hr, '2026-03');
				assert.deepEqual(run.slip('a').lines, { BASIC: 3000, HEAT: 40 });
				assert.equal(run.slip('a').gross, 3040);
				// PIT on 3,040: 10 % of 2,040
				assert.equal(run.slip('a').statutory['PIT'], 204);
				assert.deepEqual(run.slip('b').lines, { BASIC: 6000 });
			})
		);
	}
);
