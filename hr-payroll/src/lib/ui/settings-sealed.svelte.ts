/**
 * Whether the settings version a record belongs to is sealed.
 *
 * A sealed version is law that has frozen: every form under it says so — the transforms refuse
 * such edits anyway. The scope the Settings app sets names the version; a record opened outside
 * it carries its own `settings_id`.
 */
import type { Id } from '@norbital-ai/bolt';
import { fromStore } from 'svelte/store';
import { bolt } from '$bolt';
import { hrCreateScope } from './create-scope.js';

export function settingsVersionSealed(
	recordSettingsId: () => Id<'jurisdiction_settings'> | undefined
): () => boolean {
	const scope = hrCreateScope();
	const settingsId = $derived(scope?.settingsId?.() ?? recordSettingsId());
	const version = $derived(
		settingsId == null
			? null
			: fromStore(bolt.live(bolt.get('jurisdiction_settings', settingsId, { sealed_at: true })))
	);
	return () => version?.current?.sealed_at != null;
}
