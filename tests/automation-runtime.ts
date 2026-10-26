import { Effect, Schema } from 'effect';
import type { Committed, PendingApproval, RunHandle } from '@norbital-ai/bolt';
import { ActRefused, type ActFailure } from '@norbital-ai/bolt/errors';
import { present, type T } from './test-runtime.js';

const Run = Schema.Struct({
	state: Schema.String,
	output: Schema.NullOr(Schema.Json),
	error: Schema.NullOr(
		Schema.Struct({
			code: Schema.String,
			message: Schema.String,
			field: Schema.optional(Schema.String),
			row: Schema.optional(Schema.Number),
			rows: Schema.optional(Schema.Array(Schema.Number)),
			rule: Schema.optional(Schema.String),
			data: Schema.optional(Schema.Struct({ requestId: Schema.String }))
		})
	)
});

/** Admission queues a run; assertions inspect its real native completion separately. */
export const finished = Effect.fnUntraced(function* (
	t: T,
	start: Effect.Effect<Committed<RunHandle<string>> | PendingApproval, ActFailure>
) {
	const admitted = yield* start;
	if (admitted.kind !== 'committed') throw new Error(JSON.stringify(admitted));
	yield* t.runDue();
	const run = present(
		(yield* t.db.rows(Run, {
			text: 'SELECT state, output, error FROM sys_run WHERE id = $1',
			params: [admitted.output.id]
		}))[0]
	);
	if (run.state === 'failed' && run.error !== null)
		return yield* Effect.fail(new ActRefused(run.error));
	if (run.state !== 'succeeded') throw new Error(JSON.stringify(run));
	return run;
});
