import { model } from '@norbital-ai/bolt';
/**
 * A physical site, named by its location. `site_key` includes the optional unit so two units at one location remain
 * distinct. Existing nullable locations remain restorable; the collection requires a location on every write.
 */
export default model({
	description: 'Physical site with tenant and dwelling context. Past jobs hang off the site.',
	icon: 'lucide:map-pin',
	label: 'name',
	fields: {
		/** The dispatch system's own code for this site; absent for a site entered here. */
		site_code: { kind: 'text', optional: true, unique: true },
		/** Derived from the location's formatted address, or its coordinates when geocoding is unavailable. */
		name: { kind: 'text' },
		/** Which site this is, derived from its address (`lib/site-key.ts`). */
		site_key: { kind: 'text', unique: true, hidden: true },
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
	search: { text: ['name', 'address', 'unit_number', 'site_code', 'client_name'] }
});
