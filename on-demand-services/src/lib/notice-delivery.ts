import { Effect } from 'effect';
import type { ActInput, Row } from '@norbital-ai/bolt';
import type { ActFailure } from '@norbital-ai/bolt/errors';

type Notice = Pick<Row<'customer_notices'>, 'id' | 'revision' | 'subject' | 'body'> & {
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
			Effect.map((went): Status => ({
				target: { id: notice.id, revision: notice.revision },
				set: { whatsapp: went }
			}))
		)
	);
	if (set.length > 0) yield* write(set).pipe(Effect.catchTag('ActConflict', () => write(set)));
});

export const DELIVERY = [
	'queued',
	'sent',
	'deferred',
	'delivered',
	'opened',
	'replied',
	'bounced',
	'failed'
] as const;
type Delivery = (typeof DELIVERY)[number];
/** queued < sent < deferred < delivered < opened < replied; bounced and failed are final. */
const RANK: { readonly [D in Delivery]: number } = {
	queued: 0,
	sent: 1,
	deferred: 2,
	delivered: 3,
	opened: 4,
	replied: 5,
	bounced: 6,
	failed: 6
};
/** Whether a report of `next` moves a mail standing at `current`: only forward, never past a bounce or failure; a reply always lands. */
export const moves = (current: Delivery | null, next: Delivery) =>
	current === null || next === 'replied' || RANK[next] > RANK[current];
