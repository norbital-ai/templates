import { defineCommandHandler } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';
import { cloneSettingsVersion } from '../lib/settings_clone.js';
import type { Api } from './$types.js';

/**
 * A new version of a jurisdiction settings lineage: the chosen version and every row under it,
 * cloned into a draft of the same code with an open range starting on the given day.
 *
 * The clone itself is `lib/settings_clone.ts`, shared with the statutory drift automation, which
 * proposes a draft the same way. The draft is the controller's to edit; sealing it is the HR
 * Manager's act and ends the predecessor's range the day before (`+settings.svelte`).
 */
export default defineCommandHandler({
	description:
		'Clones one jurisdiction settings version and every row under it (schemes, bands, leave types, pay components, holidays) into a draft of the same lineage starting on a given day.',
	schema: Schema.Struct({
		settings_id: Schema.String.check(Schema.isUUID()),
		/** The first day the new version governs, YYYY-MM-DD. */
		starts_on: Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/)),
		name: Schema.optional(Schema.String)
	}),
	handler: ({ settings_id, starts_on, name }, api: Api) =>
		cloneSettingsVersion(api, settings_id, { starts_on, name })
});
