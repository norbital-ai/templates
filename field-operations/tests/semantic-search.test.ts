import { Effect, Layer, Stream } from 'effect';
/**
 * `search.semantic` on job_assignments: a filed job is embedded by the platform run (title, description and summary on
 * the host's `default` model at 1536 dims), and `$similar` returns the jobs nearest in meaning, within the reader's
 * own grant.
 */
import { expect, it } from '@effect/vitest';
import { Ai, Port, type EmbedInput } from '@norbital-ai/bolt/engine';
import { CONTRACTOR, CONTROLLER, person, rows, siteWithJob, workspace } from './kit.ts';
import { fixtureId } from './test-runtime.js';
const DIM = 1536;
/** The host's embedding model, faked: one axis per meaning a text's words carry. */
const axisOf = (text: string) =>
	/leak|pipe|drip|water/i.test(text) ? 0 : /paint/i.test(text) ? 1 : 2;
const embedded: { text: string; model: string; dimensions: number | undefined }[] = [];
const embed = (inputs: readonly EmbedInput[], model: string, dimensions?: number) =>
	Effect.sync(() =>
		inputs.map((input) => {
			const text = typeof input === 'string' ? input : '';
			embedded.push({ text, model, dimensions });
			return Array.from({ length: DIM }, (_, i) => (i === axisOf(text) ? 1 : 0));
		})
	);
const clear = { suspicious: false, reason: 'No usable photo.', evidence_asset_name: '' };
it.live('a job is embedded once filed and found by meaning, within what the reader may read', () =>
	Effect.gen(function* () {
		const t = yield* workspace({
			ports: Layer.succeed(Ai, {
				ask: () => Effect.die(new Error('Unexpected decision')),
				maxChoices: undefined,
				models: ['default'],
				catalog: Port.unavailable('ai'),
				infer: () =>
					Stream.make({
						_tag: 'Response',
						response: {
							content: clear,
							toolCalls: [],
							finish: 'stop',
							usage: { input: 0, output: 0, cost: 0 }
						}
					}),
				embed
			})
		});
		const contractor = yield* person(t, CONTRACTOR);
		const controller = yield* person(t, CONTROLLER);
		const mine = yield* siteWithJob(t, {
			title: 'Fix burst pipe',
			description: 'Under the kitchen sink',
			assignee_user_id: fixtureId('sys_user', contractor.id)
		});
		const theirs = yield* siteWithJob(t, { title: 'Roof drip', description: 'Bedroom ceiling' });
		yield* siteWithJob(t, { title: 'Paint corridor', description: 'Two coats' });
		yield* t.runDue();
		expect(
			yield* rows(t, 'SELECT count(*)::int AS n FROM job_assignments WHERE bolt_embedding IS NULL')
		).toEqual([{ n: 0 }]);
		expect(embedded).toContainEqual({
			text: 'Fix burst pipe\nUnder the kitchen sink',
			model: 'default',
			dimensions: DIM
		});
		const similar = Effect.fnUntraced(function* (as: typeof controller, to: string) {
			const { job_assignments } = yield* t
				.as(as)
				.query({ job_assignments: { where: { $similar: to }, limit: 20 } });
			return job_assignments.rows.map((row) => row.id).sort();
		});
		expect(yield* similar(controller, 'water leak')).toEqual([mine.job, theirs.job].sort());
		expect(yield* similar(controller, 'fresh paint')).toHaveLength(1);
		expect(yield* similar(contractor, 'water leak')).toEqual([mine.job]);
	})
);
