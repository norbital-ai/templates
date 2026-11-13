// The gate of "no write reaches a paid period's inputs without its amendment row": every model a run reads is named
// with its rule, and a model whose rule is `amends` or `refuses` carries that rule in its own write.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from '@effect/vitest';
import { Effect } from 'effect';
import { RUN_INPUTS } from '../../src/lib/amendments.ts';
import { loadRun } from '../../src/lib/payroll_engine/run_calculation.ts';
import { ENTITY, PAY_GROUP } from '../kit.ts';

const models = (root: string): readonly string[] =>
	readdirSync(root, { withFileTypes: true }).flatMap((entry) =>
		entry.isDirectory()
			? models(join(root, entry.name))
			: entry.name === '+model.ts'
				? [join(root, entry.name)]
				: []
	);
const sourceOf = (model: string) => {
	const path = models(join(process.cwd(), 'src/data/model')).find((file) =>
		file.endsWith(`/${model}/+model.ts`)
	);
	assert.ok(path !== undefined, `${model}: its model file`);
	return readFileSync(path, 'utf8');
};

describe('what a run reads', () => {
	it.effect('every model it reads is named with what its write does to a paid period', () =>
		Effect.gen(function* () {
			const asked: string[] = [];
			yield* loadRun(
				(request) => {
					asked.push(...Object.keys(request));
					return Effect.succeed(
						Object.fromEntries(Object.keys(request).map((root) => [root, { rows: [], next: null }]))
					);
				},
				{
					entity_id: ENTITY,
					pay_group_id: PAY_GROUP,
					kind: 'ON_CYCLE',
					period: '2026-02',
					pay_date: '2026-02-25',
					salary_coverage: { from: '2026-02-01', to: '2026-02-28' }
				},
				{ attendance: { from: '2026-02-01', to: '2026-02-28' } },
				'MY'
			);
			const read = [...new Set(asked.map((root) => root.split('.')[0] ?? root))].toSorted();
			assert.deepEqual(
				read.filter((model) => !Object.hasOwn(RUN_INPUTS, model)),
				[],
				'a model the run reads has no rule for a paid period'
			);
		})
	);

	for (const [model, rule] of Object.entries(RUN_INPUTS)) {
		if (rule === 'amends')
			it(`${model}: its write carries the amendment rows`, () =>
				assert.match(sourceOf(model), /amendments(For|Of)\(|lawWrite\(/));
		if (rule === 'refuses')
			it(`${model}: a change paid periods were worked out on is refused`, () =>
				assert.match(sourceOf(model), /paidUnder\(|payroll_run_id: \{ is_null: false \}/));
	}
});
