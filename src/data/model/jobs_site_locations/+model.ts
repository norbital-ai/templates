import { model, type Id, type WriteCtx } from '@norbital-ai/bolt';
import { Effect } from 'effect';
import { joinName } from '../../../lib/join-name.js';
const columns = ['job_id', 'site_location_id'] as const;
/** Each row's `name`: its two sides' labels, read once for the whole write. */
const names = Effect.fnUntraced(function* (
	sides: readonly { readonly a: Id<'jobs'>; readonly b: Id<'site_locations'> }[],
	ctx: WriteCtx<'jobs_site_locations'>
) {
	const { jobs, site_locations } = yield* ctx.db.query({
		jobs: {
			where: { id: { in: sides.map((s) => s.a) } },
			fields: ['job_title']
		},
		site_locations: {
			where: { id: { in: sides.map((s) => s.b) } },
			fields: ['location_name']
		}
	});
	const aName = new Map(jobs.rows.map((r) => [r.id, r.job_title]));
	const bName = new Map(site_locations.rows.map((r) => [r.id, r.location_name]));
	return sides.map((s) => joinName(aName.get(s.a), bName.get(s.b)));
});
/** A join row: both sides are `ref` fields; its name is theirs, derived on every create and update. */
export default model('jobs_site_locations', {
	description: 'Join table linking jobs to site locations.',
	label: 'name',
	fields: {
		/** `<job> · <site location>`, derived on every write (and by `seed/seed.ts`): a label is never a foreign key. */
		name: { kind: 'text', optional: true },
		job_id: { kind: 'ref', to: 'jobs', inverse: 'jobs_site_locations' },
		site_location_id: { kind: 'ref', to: 'site_locations', inverse: 'jobs_site_locations' }
	},
	read: 'all',
	create: {
		columns: { jobs_site_locations: columns },
		transform: function* (rows, ctx) {
			const name = yield* names(
				rows.map((r) => ({ a: r.job_id, b: r.site_location_id })),
				ctx
			);
			return rows.map((r, i) => ({ ...r, name: name[i] ?? null }));
		}
	},
	update: {
		columns: { jobs_site_locations: columns },
		transform: function* (changes, ctx) {
			const name = yield* names(
				changes.map(({ before, set }) => ({
					a: set.job_id ?? before.job_id,
					b: set.site_location_id ?? before.site_location_id
				})),
				ctx
			);
			return changes.map(({ set }, i) => ({ ...set, name: name[i] ?? null }));
		}
	}
});
