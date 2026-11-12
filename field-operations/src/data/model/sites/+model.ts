import { type Point, type StoredRow, type WriteCtx } from '@norbital-ai/bolt';
import { model } from '../../../../.norbital/models/sites.ts';
import * as Effect from 'effect/Effect';
import { siteKey } from '../../../lib/site-key.js';
const columns = [
	'site_code',
	'location',
	'address',
	'unit_number',
	'client_name',
	'house_type',
	'floor_area_sqm'
] as const;
/** Work filed at an address from the site's side: a job created under it, or an existing job moved to it (its id). */
const jobs = [
	'external_ref',
	'title',
	'nature',
	'scheduled_for',
	'description',
	'assignee_contact'
] as const;
/** A site's jobs as its readers see them. */
const siteJobs = [
	'title',
	'nature',
	'scheduled_for',
	'status',
	'assignee_user_id',
	'assignee_contact',
	'description',
	'summary',
	'completed_at'
] as const;
type Place = {
	readonly location?: Point | null;
	readonly address?: string | null;
	readonly unit_number?: string | null;
};
/**
 * What a site's location makes of it, for creates (`before` absent) and updates alike: its name (the address, else the
 * coordinates), trimmed address and unit, and `site_key`. A write without a location, two sites of one batch at one
 * address, or an address another site already carries is refused.
 */
const placed = Effect.fnUntraced(function* (
	writes: readonly { readonly set: Place; readonly before: StoredRow<'sites'> | undefined }[],
	ctx: WriteCtx<'sites'>
) {
	const places = writes.map(({ set, before }) => {
		const location = set.location !== undefined ? set.location : before?.location;
		const moved =
			set.location !== undefined &&
			(set.location?.lat !== before?.location?.lat || set.location?.lng !== before?.location?.lng);
		const address = set.address !== undefined ? set.address : moved ? null : before?.address;
		const unit =
			set.unit_number !== undefined
				? set.unit_number
				: (before?.unit_number ??
					/#[0-9]+-[0-9A-Z]+/i.exec(`${set.address ?? ''} ${before?.site_key ?? ''}`)?.[0]);
		const unit_number = unit?.trim() || null;
		const name = address?.trim() || (location == null ? '' : `${location.lat}, ${location.lng}`);
		return { location, address: address?.trim() || null, name, unit_number };
	});
	const unlocated = places.findIndex((place) => place.location == null);
	if (unlocated >= 0)
		return yield* ctx.refuse('errors.site_location_required', {
			field: 'location',
			row: unlocated
		});
	const keys = places.map((place) => siteKey(place.name, place.unit_number));
	if (new Set(keys).size < keys.length) return yield* ctx.refuse('errors.sites_share_address');
	const { sites: holders } = yield* ctx.query({
		sites: { where: { site_key: { in: keys } }, fields: ['site_key'] }
	});
	const holderOf = new Map(holders.rows.map((site) => [site.site_key, site]));
	for (const [row, key] of keys.entries()) {
		const before = writes[row]?.before;
		const holder = holderOf.get(key);
		if (holder !== undefined && holder.id !== before?.id)
			return yield* ctx.refuse(
				before === undefined ? 'errors.site_address_exists' : 'errors.site_address_taken',
				{ field: 'location', row }
			);
	}
	return places.map((place, i) => ({
		name: place.name,
		address: place.address,
		unit_number: place.unit_number,
		site_key: keys[i]!
	}));
});
/**
 * A physical site, named by its location. `site_key` includes the optional unit so two units at one location remain
 * distinct. Existing nullable locations remain restorable; every write requires a location. Adding a location a site
 * already carries is refused with that site's name, and a site may not move onto another's address. Jobs filed or moved
 * under a site are dispatched and re-keyed by their own callbacks.
 */
export default model({
	description: 'Physical site with tenant and dwelling context. Past jobs hang off the site.',
	icon: 'lucide:map-pin',
	record_label: 'record.name',
	fields: {
		/** The dispatch system's own code for this site; absent for a site entered here. */
		site_code: { kind: 'text', optional: true },
		/** Derived from the location's formatted address, or its coordinates when geocoding is unavailable. */
		name: { kind: 'text' },
		/** Which site this is, derived from its address (`lib/site-key.ts`). */
		site_key: { kind: 'text', hidden: true },
		location: { kind: 'point', optional: true },
		/** The geocoder's formatted address for `location`, when the site was picked on a map. */
		address: { kind: 'text', optional: true },
		unit_number: { kind: 'text', optional: true },
		client_name: { kind: 'text', optional: true },
		house_type: {
			kind: 'enum',
			values: ['hdb_flat', 'condo', 'landed', 'commercial', 'industrial', 'other'],
			optional: true
		},
		floor_area_sqm: { kind: 'decimal', scale: 2, optional: true }
	},
	constraints: { site_code: { unique: ['site_code'] }, site_key: { unique: ['site_key'] } },
	indexes: { search: { text: ['name', 'address', 'unit_number', 'site_code', 'client_name'] } },
	outputs: {
		default: {
			fields: 'all',
			/** The work at a site: how a message naming an address finds its job (today's, else the next pending). */
			job_assignments: { fields: siteJobs }
		},
		/** A contractor's view of the sites they work at: the place and the dwelling, never its key. */
		contractor: {
			fields: [
				'site_code',
				'name',
				'location',
				'address',
				'unit_number',
				'client_name',
				'house_type',
				'floor_area_sqm'
			],
			job_assignments: { fields: siteJobs }
		}
	},
	create: {
		columns: { fields: columns, job_assignments: { fields: jobs } },
		transform: function* (changes, ctx) {
			const derived = yield* placed(
				changes.map(({ set }) => ({ set, before: undefined })),
				ctx
			);
			return changes.map(({ set }, i) => ({ ...set, ...derived[i] }));
		}
	},
	update: {
		columns: { fields: columns, job_assignments: { fields: jobs } },
		transform: function* (changes, ctx) {
			// from the site's side a job is only filed or moved here; its own update changes it
			const rewrite = changes.findIndex(
				({ set }) =>
					set.job_assignments !== undefined &&
					Object.keys(set.job_assignments).some((verb) => verb !== 'create' && verb !== 'link')
			);
			if (rewrite >= 0)
				return yield* ctx.refuse('errors.site_files_jobs_only', {
					row: rewrite
				});
			const derived = yield* placed(changes, ctx);
			return changes.map(({ set }, i) => ({ ...set, ...derived[i] }));
		}
	},
	delete: {}
});
