import { Effect, Schema } from 'effect';
/**
 * Each 06:00 digest is a cron automation whose run output is its JSON extract (L-TPL-construction-009..012).
 */
import { fileURLToPath } from 'node:url';
import { expect, it } from '@effect/vitest';
import { JobResult } from '@norbital-ai/bolt-cli/test';
import { workspace as acquireWorkspace } from './test-runtime.js';
const root = fileURLToPath(new URL('..', import.meta.url));
const RunRow = Schema.Struct({ state: Schema.String, output: Schema.Json });
it.live('runs all four daily digests', () =>
	Effect.gen(function* () {
		const t = yield* acquireWorkspace({ root });
		const admin = yield* t.as(t.admin);
		const digests = [
			'defect_closeout_digest',
			'payment_claim_readiness_watch',
			'permit_expiry_watch',
			'rfi_followup_watch'
		] as const;
		// seed/test holds two active permits, PTW-1 and PTW-2
		for (const digest of digests) {
			const started = yield* admin.run(digest, {}, JobResult);
			expect(started).toMatchObject({ kind: 'committed' });
			if (started.kind !== 'committed') throw new Error('The digest did not start.');
			const { id } = started.output;
			yield* t.run_due();
			const [run] = yield* t.db.rows(RunRow, {
				text: 'select state, output from sys_run where id = $1',
				params: [id]
			});
			expect(run).toMatchObject({
				state: 'succeeded',
				output:
					digest === 'permit_expiry_watch'
						? {
								count: 2,
								rows: expect.arrayContaining([
									expect.objectContaining({ permit_number: 'PTW-1' }),
									expect.objectContaining({ permit_number: 'PTW-2' })
								])
							}
						: { count: 0, rows: [] }
			});
		}
	}).pipe(Effect.scoped)
);
