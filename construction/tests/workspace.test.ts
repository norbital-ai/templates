import { Option, Context, Effect } from 'effect';
import { Runs, Identity } from '@norbital-ai/bolt/engine';
import type { AutomationName } from '@norbital-ai/bolt';
/**
 * Each 06:00 digest is a cron automation whose run output is its JSON extract (L-TPL-construction-009..012).
 */
import { fileURLToPath } from 'node:url';
import { expect, it } from '@effect/vitest';
import { workspace as acquireWorkspace, fixtureId } from './test-runtime.js';
const root = fileURLToPath(new URL('..', import.meta.url));
it.live('runs all four daily digests', () =>
	Effect.gen(function* () {
		const t = yield* acquireWorkspace({ root });
		const admin = t.as(t.admin);
		const created = yield* admin.act('projects.create', { project_name: 'Synthetic project' });
		const project = created.records.find((record) => record.collection === 'projects');
		if (project === undefined) throw new Error('Missing synthetic project');
		const digests = [
			'defect_closeout_digest',
			'payment_claim_readiness_watch',
			'permit_expiry_watch',
			'rfi_followup_watch'
		] as const satisfies readonly AutomationName[];
		for (const a of digests)
			expect(t.manifest.automations[a]).toMatchObject({
				on: { cron: '0 6 * * *' },
				runAs: ['construction_read']
			});
		yield* admin.act('permits_to_work.create', {
			permit_number: 'PTW-1',
			project_id: fixtureId('projects', project.id),
			status: 'active'
		});
		const runs = Context.get(t.services, Runs);
		if (runs === undefined) throw new Error('Test workspace has no runs driver.');
		for (const digest of digests) {
			const started = yield* admin.start(digest, {});
			expect(started).toMatchObject({ kind: 'committed' });
			if (started.kind !== 'committed') throw new Error('The digest did not start.');
			const { id } = started.output;
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
