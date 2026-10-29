import { model, type Id, type WriteCtx } from '@norbital-ai/bolt';
import { Effect } from 'effect';
import { joinName } from '../../../lib/join-name.js';
const columns = ['job_id', 'certification_type_id'] as const;
/** Each row's `name`: its two sides' labels, read once for the whole write. */
const names = Effect.fnUntraced(function* (
	sides: readonly { readonly a: Id<'jobs'>; readonly b: Id<'certification_types'> }[],
	ctx: WriteCtx<'jobs_certification_types'>
) {
	const { jobs, certification_types } = yield* ctx.db.query({
		jobs: {
			where: { id: { in: sides.map((s) => s.a) } },
			fields: ['job_title']
		},
		certification_types: {
			where: { id: { in: sides.map((s) => s.b) } },
			fields: ['certification_name']
		}
	});
	const aName = new Map(jobs.rows.map((r) => [r.id, r.job_title]));
	const bName = new Map(certification_types.rows.map((r) => [r.id, r.certification_name]));
	return sides.map((s) => joinName(aName.get(s.a), bName.get(s.b)));
});
/** A join row: both sides are `ref` fields; its name is theirs, derived on every create and update. */
export default model('jobs_certification_types', {
	description: 'Join table linking jobs to required certification types.',
	label: 'name',
	fields: {
		/** `<job> · <certification>`, derived on every write (and by `seed/+seeder.ts`): a label is never a foreign key. */
		name: { kind: 'text', optional: true },
		job_id: { kind: 'ref', to: 'jobs', inverse: 'jobs_certification_types' },
		certification_type_id: {
			kind: 'ref',
			to: 'certification_types',
			inverse: 'jobs_certification_types'
		}
	},
	read: 'all',
	create: {
		columns: { jobs_certification_types: columns },
		transform: function* (rows, ctx) {
			const name = yield* names(
				rows.map((r) => ({ a: r.job_id, b: r.certification_type_id })),
				ctx
			);
			return rows.map((r, i) => ({ ...r, name: name[i] ?? null }));
		}
	},
	update: {
		columns: { jobs_certification_types: columns },
		transform: function* (changes, ctx) {
			const name = yield* names(
				changes.map(({ before, set }) => ({
					a: set.job_id ?? before.job_id,
					b: set.certification_type_id ?? before.certification_type_id
				})),
				ctx
			);
			return changes.map(({ set }, i) => ({ ...set, name: name[i] ?? null }));
		}
	}
});
