import { Effect } from 'effect';
import type { ActInput, Id, Row } from '@norbital-ai/bolt';
import type { ActFailure } from '@norbital-ai/bolt/errors';

type Notice = Pick<Row<'customer_notices'>, 'id' | 'revision' | 'subject' | 'body'> & {
	readonly customer: Pick<Row<'customers'>, 'phone'>;
};
type Status = Extract<ActInput<'customer_notices.update'>, readonly unknown[]>[number];
type RevisionRow = { readonly id: Id<'customer_notices'>; readonly revision: number };

/**
 * Send each notice once via WhatsApp and record queue admission (`queued` or `failed: ...`).
 * On an `ActConflict` (for example from a concurrent email delivery update), reload fresh
 * revisions and retry the status write without resending WhatsApp.
 */
export const deliverNoticeRows = Effect.fnUntraced(function* <E, RE = never>(
	rows: readonly Notice[],
	send: (notice: Notice) => Effect.Effect<unknown, E>,
	write: (set: Status[]) => Effect.Effect<unknown, ActFailure>,
	reload: (ids: readonly Id<'customer_notices'>[]) => Effect.Effect<readonly RevisionRow[], RE>
) {
	const results = yield* Effect.forEach(rows, (notice) =>
		send(notice).pipe(
			Effect.match({
				onSuccess: () => 'queued',
				onFailure: (error) => `failed: ${String(error instanceof Error ? error.message : error)}`
			}),
			Effect.map((went) => ({ id: notice.id, revision: notice.revision, whatsapp: went }))
		)
	);
	if (results.length === 0) return;
	const toUpdate = (revisions: ReadonlyMap<Id<'customer_notices'>, number>): Status[] =>
		results.flatMap((r) => {
			const revision = revisions.get(r.id);
			return revision === undefined
				? []
				: [{ target: { id: r.id, revision }, set: { whatsapp: r.whatsapp } }];
		});
	const initial = new Map(results.map((r) => [r.id, r.revision]));
	yield* write(toUpdate(initial)).pipe(
		Effect.catchTag('ActConflict', () =>
			reload(results.map((r) => r.id)).pipe(
				Effect.flatMap((fresh) => {
					const next = toUpdate(new Map(fresh.map((r) => [r.id, r.revision])));
					return next.length === 0 ? Effect.void : write(next);
				})
			)
		)
	);
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
