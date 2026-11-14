// A leave request its own employee takes back: the approval move runs the entry's effect with nothing written, and that
// run must not fail.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace } from '@norbital-ai/bolt-cli/test';
import { Effect } from 'effect';
import { idOf } from '../../src/lib/payroll_engine/reads.ts';
import {
	ENTITY,
	leaveCreate,
	pack,
	packTerms,
	syncAll,
	uuid,
	wholeDays,
	workspace
} from '../kit.ts';

const seed = pack('MY', 'Asia/Kuala_Lumpur', packTerms(3120, 'MANUAL_LABOUR'), {}, [], []);

describe('a leave request taken back', () => {
	it.live('leaves no failed run behind', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			const me = yield* t.as(t.member(['employee'], { id: uuid(3) }));
			const asked = yield* me.act({
				'leave_catalog_entry.create': [
					leaveCreate({
						entity_id: ENTITY,
						employment_id: idOf('employment', uuid(6)),
						catalog_code: 'ANNUAL_LEAVE',
						days: wholeDays('2026-07-20')
					})
				]
			});
			assert.equal(asked.kind, 'pending_approval');
			assert.ok(asked.kind === 'pending_approval' && asked.request_id !== undefined);
			yield* me.approvals.decide(asked.request_id, { decision: 'withdraw' });
			assert.deepEqual((yield* t.run_due()).failed, []);
		}).pipe(Effect.provide(workspace({ seed, now: '2026-08-05T02:00:00.000Z' })))
	);
});
