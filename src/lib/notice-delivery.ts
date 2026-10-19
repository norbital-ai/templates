import { Effect } from 'effect';
import type { ActInput, Row } from '@norbital-ai/bolt';
import type { ActFailure } from '@norbital-ai/bolt/errors';

type Notice = Pick<Row<'customer_notices'>, 'id' | 'subject' | 'body'> & {
	readonly customer: Pick<Row<'customers'>, 'phone'>;
};
type Status = Extract<ActInput<'customer_notices.update'>, readonly unknown[]>[number];

/** Send once; only a status-write conflict is safe to retry. */
export const deliverNoticeRows = Effect.fnUntraced(function* <E>(
	rows: readonly Notice[],
	send: (notice: Notice) => Effect.Effect<unknown, E>,
	write: (set: Status[]) => Effect.Effect<unknown, ActFailure>
) {
	const set = yield* Effect.forEach(rows, (notice) =>
		send(notice).pipe(
			Effect.match({
				onSuccess: () => 'sent',
				onFailure: (error) => `failed: ${String(error instanceof Error ? error.message : error)}`
			}),
			Effect.map((went): Status => ({ target: notice.id, set: { whatsapp: went } }))
		)
	);
	if (set.length > 0) yield* write(set).pipe(Effect.catchTag('ActConflict', () => write(set)));
});
