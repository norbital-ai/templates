import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import hooks from '../../src/collections/job_assignments/+hooks.js';

type Hook = (context: unknown) => unknown;
const mutateHook = (phase: 'before' | 'after'): Hook => {
	const hook = (
		hooks as unknown as {
			readonly mutate?: {
				readonly perRecord?: Readonly<Record<'before' | 'after', { readonly handler: Hook }>>;
			};
		}
	).mutate?.perRecord?.[phase]?.handler;
	if (hook === undefined) throw new Error(`job_assignments mutate.${phase} hook is missing`);
	return hook;
};

const settle = async (value: unknown): Promise<unknown> =>
	Effect.isEffect(value)
		? Effect.runPromise(value as Effect.Effect<unknown, unknown, never>)
		: value;

test('a system-only checked flag update does not rewrite status or touch the parent job', async () => {
	const prepared = await settle(
		mutateHook('before')({
			input: { suspicion_checked_at: '2026-08-24T08:30:14.312Z' },
			existing: {
				id: '019f6f10-3000-7000-8000-000000000008',
				job_id: '019f6f10-2000-7000-8000-000000000008',
				assignee_user_id: '019f6f10-0003-7000-8000-000000000012',
				status: 'assigned'
			}
		})
	);
	assert.deepEqual(prepared, { suspicion_checked_at: '2026-08-24T08:30:14.312Z' });

	let parentWrites = 0;
	await settle(
		mutateHook('after')({
			previous: { status: 'unassigned' },
			changes: prepared,
			record: {
				job_id: '019f6f10-2000-7000-8000-000000000008',
				status: 'assigned'
			},
			api: {
				db: {
					jobs: {
						mutate: () => {
							parentWrites += 1;
							return Effect.void;
						}
					}
				}
			}
		})
	);
	assert.equal(parentWrites, 0);
});

test('an update cannot replace the hook-owned board search label', async () => {
	const prepared = await settle(
		mutateHook('before')({
			input: { summary: 'Visit complete', search_text: 'forged title' },
			existing: {
				id: '019f6f10-3000-7000-8000-000000000008',
				job_id: '019f6f10-2000-7000-8000-000000000008',
				assignee_user_id: '019f6f10-0003-7000-8000-000000000012',
				status: 'assigned',
				search_text: 'Installation — 112, Hillview Crescent'
			}
		})
	);

	assert.deepEqual(prepared, { summary: 'Visit complete' });
});

test('a kanban drop to completed stamps completion and survives a reload-shaped re-read', async () => {
	const prepared = await settle(
		mutateHook('before')({
			input: { status: 'completed' },
			existing: {
				id: '019f6f10-3000-7000-8000-000000000008',
				job_id: '019f6f10-2000-7000-8000-000000000008',
				assignee_user_id: '019f6f10-0003-7000-8000-000000000012',
				status: 'assigned',
				completed_at: null
			}
		})
	);
	assert.equal((prepared as { status: string }).status, 'completed');
	assert.equal(typeof (prepared as { completed_at: string }).completed_at, 'string');

	const reloaded = {
		id: '019f6f10-3000-7000-8000-000000000008',
		status: (prepared as { status: string }).status,
		completed_at: (prepared as { completed_at: string }).completed_at
	};
	assert.equal(reloaded.status, 'completed');
	assert.ok(reloaded.completed_at.length > 0);
});
