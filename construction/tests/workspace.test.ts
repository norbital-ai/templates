import { Option, Context, Effect, Schema } from 'effect';
import { Runs, Identity } from '@norbital-ai/bolt/engine';
/**
 * The workspace compiles, initializes and restores its public base pack (the three fixture rows), and each 06:00 digest
 * is a cron automation whose run output is its JSON extract (L-TPL-construction-009..012).
 */
import { fileURLToPath } from 'node:url';
import { expect, it } from '@effect/vitest';
import { workspace as acquireWorkspace } from './test-runtime.js';
const root = fileURLToPath(new URL('..', import.meta.url));
it.live('restores the public base pack and runs all four daily digests', () =>
	Effect.gen(function* () {
		const t = yield* acquireWorkspace({ root });
		const admin = t.as(t.admin);
		const projects = yield* admin.read('projects', { select: { project_number: true }, all: true });
		expect(projects.rows.map((r) => r.project_number)).toEqual(['PUB-PRJ-0001']);
		expect((yield* admin.read('certification_types', { all: true })).rows).toHaveLength(1);
		expect((yield* admin.read('workers', { all: true })).rows).toHaveLength(1);
		const digests = [
			'defect_closeout_digest',
			'payment_claim_readiness_watch',
			'permit_expiry_watch',
			'rfi_followup_watch'
		] satisfies readonly Parameters<typeof admin.start>[0][];
		for (const a of digests)
			expect(t.manifest.automations[a]).toMatchObject({
				on: { cron: '0 6 * * *' },
				runAs: ['construction_read']
			});
		const project = projects.rows[0];
		if (project === undefined) throw new Error('Missing restored base-pack project');
		yield* admin.act('permits_to_work.create', {
			permit_number: 'PTW-1',
			project_id: project.id,
			status: 'active'
		});
		const runs = Context.get(t.services, Runs);
		if (runs === undefined) throw new Error('Test workspace has no runs driver.');
		for (const digest of digests) {
			const started = yield* admin.start(digest, {});
			expect(started).toMatchObject({ kind: 'committed' });
			if (started.kind !== 'committed') throw new Error('The digest did not start.');
			const { id } = yield* Schema.decodeUnknownEffect(Schema.Struct({ id: Schema.String }))(
				started.output
			);
			yield* t.runDue();
			const run = Option.getOrNull(
				yield* runs.view(yield* Context.get(t.services, Identity).authority(t.admin), id)
			);
			expect(run).toMatchObject({
				status: 'succeeded',
				result:
					digest === 'permit_expiry_watch'
						? { count: 1, rows: [{ permit_number: 'PTW-1' }] }
						: { count: 0, rows: [] }
			});
		}
	}).pipe(Effect.scoped)
);
