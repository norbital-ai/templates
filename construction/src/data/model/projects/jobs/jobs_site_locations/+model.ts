import type { Id, WriteCtx } from '@norbital-ai/bolt';
import { model } from '../../../../../../.norbital/models/jobs_site_locations.ts';
import { Effect } from 'effect';
import { joinName } from '../../../../../lib/join-name.js';
const columns = ['job_id', 'site_location_id'] as const;
/** Each row's `name`: its two sides' labels, read once for the whole write. */
const names = Effect.fnUntraced(function* (
	sides: readonly { readonly a: Id<'jobs'>; readonly b: Id<'site_locations'> }[],
	ctx: WriteCtx<'jobs_site_locations'>
) {
	const { jobs, site_locations } = yield* ctx.query({
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
export default model({
	description: 'Join table linking jobs to site locations.',
	record_label: 'record.name',
	fields: {
		/** `<job> · <site location>`, derived on every write (and by `seed/+seeder.ts`): a label is never a foreign key. */
		name: { kind: 'text', optional: true },
		job_id: { kind: 'ref', to: 'jobs', inverse: 'jobs_site_locations' },
		site_location_id: { kind: 'ref', to: 'site_locations', inverse: 'jobs_site_locations' }
	},
	outputs: { default: { fields: 'all' } },
	create: {
		columns: { fields: columns },
		transform: function* (changes, ctx) {
			const name = yield* names(
				changes.map(({ after }) => ({ a: after.job_id, b: after.site_location_id })),
				ctx
			);
			return changes.map(({ set }, i) => ({ ...set, name: name[i] ?? null }));
		}
	},
	update: {
		columns: { fields: columns },
		transform: function* (changes, ctx) {
			const name = yield* names(
				changes.map(({ after }) => ({ a: after.job_id, b: after.site_location_id })),
				ctx
			);
			return changes.map(({ set }, i) => ({ ...set, name: name[i] ?? null }));
		}
	}
});
