import { Effect, Schema } from 'effect';
import { ActRefused } from '@norbital-ai/bolt/errors';
import type { JobResult, Kit } from '@norbital-ai/bolt-cli/test';
import { present } from './test-runtime.js';

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
			data: Schema.optional(Schema.Struct({ request_id: Schema.String }))
		})
	)
});

/** Admission queues a run; assertions inspect its real native completion separately. */
export const finished = Effect.fnUntraced(function* <E>(
	t: Kit,
	start: Effect.Effect<JobResult, E>
) {
	const admitted = yield* start;
	if (admitted.kind !== 'committed') throw new Error(JSON.stringify(admitted));
	yield* t.run_due();
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
