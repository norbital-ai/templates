import { defineModel, enums, geolocation, numeric, sql, text } from '@norbital-ai/bolt/authoring';
import { siteKeySql } from '../../lib/site-key.mjs';

export default defineModel(
	{
		/**
		 * The dispatch system’s own code for this site.
		 *
		 * Nullable, because a site entered by hand here has no counterpart over there and inventing one
		 * would be a lie the unique index then enforces. It carries that index anyway: it is the key an
		 * imported job’s site is resolved through, and a code that matched two sites would silently
		 * file jobs against whichever row came back first.
		 */
		site_code: text(),
		name: text({ search: true }).notNull(),
		/**
		 * Which site this is, derived from its address: postal code plus unit (`460133#05-12`), or the
		 * normalised address when there is no postal code. `lib/site-key.mjs` holds the rule.
		 *
		 * Generated rather than stamped, so every path that files a site carries it — the seed loader
		 * writes rows directly, and a site created through another collection's relation skips this
		 * collection's transform. Unique, because two rows with one key are one site filed twice.
		 */
		site_key: text().notNull().generatedAlwaysAs(sql.raw(siteKeySql())),
		location: geolocation(),
		client_name: text(),
		house_type: enums(['hdb_flat', 'condo', 'landed', 'commercial', 'industrial', 'other']),
		floor_area_sqm: numeric()
	},
	{
		description: 'Physical site with tenant and dwelling context. Past jobs hang off the site.',
		recordLabel: 'name',
		icon: 'lucide:map-pin',
		indexes: [
			{ columns: ['site_code'], unique: true },
			{ columns: ['site_key'], unique: true }
		]
	}
);
