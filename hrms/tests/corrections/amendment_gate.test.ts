// The gate of "no write reaches a paid period's inputs without its amendment row": every model a run reads is named
// with its rule, and a model whose rule is `amends` or `refuses` carries that rule in its own write.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from '@effect/vitest';
import { Effect } from 'effect';
import { RUN_INPUTS } from '../../src/data/model/payroll_run/service/amendments.ts';
import { loadRun } from '../../src/data/model/payroll_run/service/run_calculation.ts';
import { TestWorkspace } from '@norbital-ai/bolt-cli/test';
import type { Reader } from '../../src/lib/reads.ts';
import { ENTITY, PAY_GROUP, pack, packTerms, storedReader, workspace } from '../kit.ts';

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
	it.live('every model it reads is named with what its write does to a paid period', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const stored = storedReader(t);
			const asked: string[] = [];
			const recording: Reader = (request) => {
				asked.push(...Object.keys(request));
				return stored(request);
			};
			yield* loadRun(
				recording,
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
		}).pipe(
			Effect.provide(
				workspace({
					seed: pack('MY', 'Asia/Kuala_Lumpur', packTerms(3000), {}, [], []),
					now: '2026-03-05T02:00:00.000Z'
				})
			)
		)
	);

	for (const [model, rule] of Object.entries(RUN_INPUTS)) {
		if (rule === 'amends')
			it(`${model}: its write carries the amendment rows`, () =>
				assert.match(sourceOf(model), /amendments(For|Of)\(|lawWrite\(|datedWrite\(/));
		if (rule === 'refuses')
			it(`${model}: a change paid periods were worked out on is refused`, () =>
				assert.match(sourceOf(model), /paidUnder\(|payroll_run_id: \{ is_null: false \}/));
	}
});
