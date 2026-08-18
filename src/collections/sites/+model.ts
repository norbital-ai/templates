import { defineModel, enums, geolocation, numeric, text } from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		/**
		 * The dispatch system’s own code for this site.
		 *
		 * Nullable, because a site entered by hand here has no counterpart over there and inventing one
		 * would be a lie the unique index then enforces. It carries that index anyway: it is the key an
		 * inbound job’s `site_code` is resolved through, and a code that matched two sites would silently
		 * file jobs against whichever row came back first.
		 */
		site_code: text(),
		name: text({ search: true }).notNull(),
		location: geolocation(),
		client_name: text(),
		house_type: enums(['hdb_flat', 'condo', 'landed', 'commercial', 'industrial', 'other']),
		floor_area_sqm: numeric()
	},
	{
		description: 'Physical site with tenant and dwelling context. Past jobs hang off the site.',
		recordLabel: 'name',
		icon: 'lucide:map-pin',
		indexes: [{ columns: ['site_code'], unique: true }]
	}
);
