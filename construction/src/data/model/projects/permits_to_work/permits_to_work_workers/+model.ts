import type { Id, WriteCtx } from '@norbital-ai/bolt';
import { model } from '../../../../../../.norbital/models/permits_to_work_workers.ts';
import { Effect } from 'effect';
import { joinName } from '../../../../../lib/join-name.js';
const columns = ['permits_to_work_id', 'worker_id'] as const;
/** Each row's `name`: its two sides' labels, read once for the whole write. */
const names = Effect.fnUntraced(function* (
	sides: readonly { readonly a: Id<'permits_to_work'>; readonly b: Id<'workers'> }[],
	ctx: WriteCtx<'permits_to_work_workers'>
) {
	const { permits_to_work, workers } = yield* ctx.query({
		permits_to_work: {
			where: { id: { in: sides.map((s) => s.a) } },
			fields: ['permit_number']
		},
		workers: {
			where: { id: { in: sides.map((s) => s.b) } },
			fields: ['worker_name']
		}
	});
	const aName = new Map(permits_to_work.rows.map((r) => [r.id, r.permit_number]));
	const bName = new Map(workers.rows.map((r) => [r.id, r.worker_name]));
	return sides.map((s) => joinName(aName.get(s.a), bName.get(s.b)));
});
/** A join row: both sides are `ref` fields; its name is theirs, derived on every create and update. */
export default model({
	description: 'Join table linking permits to work to workers.',
	record_label: 'record.name',
	fields: {
		/** `<permit> · <worker>`, derived on every write (and by `seed/+seeder.ts`): a label is never a foreign key. */
		name: { kind: 'text', optional: true },
		permits_to_work_id: { kind: 'ref', to: 'permits_to_work', inverse: 'permits_to_work_workers' },
		worker_id: { kind: 'ref', to: 'workers', inverse: 'permits_to_work_workers' }
	},
	outputs: { default: { fields: 'all' } },
	create: {
		columns: { fields: columns },
		transform: function* (changes, ctx) {
			const name = yield* names(
				changes.map(({ after }) => ({ a: after.permits_to_work_id, b: after.worker_id })),
				ctx
			);
			return changes.map(({ set }, i) => ({ ...set, name: name[i] ?? null }));
		}
	},
	update: {
		columns: { fields: columns },
		transform: function* (changes, ctx) {
			const name = yield* names(
				changes.map(({ after }) => ({ a: after.permits_to_work_id, b: after.worker_id })),
				ctx
			);
			return changes.map(({ set }, i) => ({ ...set, name: name[i] ?? null }));
		}
	}
});
