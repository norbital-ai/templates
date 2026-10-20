import { collection } from '@norbital-ai/bolt';
import { dispatchFacts, searchTextFor } from '../../../lib/dispatch.js';
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
/** Work filed at an address from the site's side: a job created under it, or an existing job moved to it. */
const jobs = {
	create: {
		columns: ['external_ref', 'title', 'nature', 'scheduled_for', 'description', 'assignee_user_id']
	},
	link: {}
} as const;
/**
 * A site is identified by its location label and optional unit (`site_key`). Adding a location a site
 * already carries is refused with that site's name, and a site may not move onto another's address. Jobs filed
 * through `job_assignments` skip that collection's transform, so their dispatch facts are stamped here.
 */
const sites = collection('sites', {
	read: { fields: 'all' },
	create: { input: { columns, with: { job_assignments: jobs } } },
	update: { input: { columns, with: { job_assignments: jobs } } },
	delete: {}
});
export default sites;
sites.transform(function* (inputs, ctx) {
	const places = inputs.map((input, i) => {
		const stored = ctx.existing[i];
		const location = input.location !== undefined ? input.location : stored?.location;
		const moved =
			input.location !== undefined &&
			(input.location?.lat !== stored?.location?.lat ||
				input.location?.lng !== stored?.location?.lng);
		const address = input.address !== undefined ? input.address : moved ? null : stored?.address;
		const unit =
			input.unit_number !== undefined
				? input.unit_number
				: (stored?.unit_number ??
					/#[0-9]+-[0-9A-Z]+/i.exec(`${input.address ?? ''} ${stored?.site_key ?? ''}`)?.[0]);
		const unit_number = unit?.trim() || null;
		const name = address?.trim() || (location == null ? '' : `${location.lat}, ${location.lng}`);
		return { location, address: address?.trim() || null, name, unit_number };
	});
	if (places.some((place) => place.location == null))
		return yield* ctx.refuse('Choose a location for the site.', { field: 'location' });
	const keys = places.map((place) => siteKey(place.name, place.unit_number));
	if (new Set(keys).size < keys.length)
		return yield* ctx.refuse('Two sites in this batch have one address.');
	const linked = inputs.flatMap((input) => input.job_assignments?.link ?? []);
	const { holders, moved } = yield* ctx.db.read({
		holders: { collection: 'sites', where: { site_key: { in: keys } }, all: true },
		moved: { collection: 'job_assignments', where: { id: { in: [...linked] } }, all: true }
	});
	const holderOf = new Map(holders.rows.map((site) => [site.site_key, site]));
	const titleOf = new Map(moved.rows.map((job) => [job.id, job.title]));
	for (const [i, key] of keys.entries()) {
		const stored = ctx.existing[i];
		const holder = holderOf.get(key);
		if (holder !== undefined && holder.id !== stored?.id)
			return yield* ctx.refuse(
				stored === undefined
					? `A site at this address already exists: ${holder.name}.`
					: `Another site already has this address: ${holder.name}.`,
				{ field: 'location' }
			);
	}
	return inputs.map((input, i) => {
		const stored = ctx.existing[i];
		const words = {
			name: places[i]!.name,
			site_code: input.site_code !== undefined ? input.site_code : (stored?.site_code ?? null)
		};
		const filed = input.job_assignments;
		return {
			...input,
			name: places[i]!.name,
			address: places[i]!.address,
			unit_number: places[i]!.unit_number,
			site_key: keys[i]!,
			...(filed === undefined
				? {}
				: {
						job_assignments: {
							...filed,
							...(filed.create === undefined
								? {}
								: {
										create: filed.create.map((job) => ({
											...job,
											...dispatchFacts(job, words, ctx.now)
										}))
									}),
							// a moved job's search copy follows its new site
							...(filed.link === undefined
								? {}
								: {
										update: filed.link.map((id) => ({
											target: id,
											set: { search_text: searchTextFor(titleOf.get(id) ?? '', words) }
										}))
									})
						}
					})
		};
	});
});
