/**
 * Whether the settings version a record belongs to is sealed.
 *
 * A sealed version is law that has frozen: every form under it renders read-only — the display
 * surfaces, no footer — because the write hooks refuse such edits anyway. The scope the Settings
 * app sets names the version; a record opened outside it carries its own `settings_id`.
 */
import { client } from '../workspace-client.js';
import { hrCreateScope } from './create-scope.js';

export function settingsVersionSealed(recordSettingsId: () => unknown): () => boolean {
	const scope = hrCreateScope();
	const settingsId = $derived(
		scope?.settingsId?.() ?? (recordSettingsId() == null ? undefined : String(recordSettingsId()))
	);
	const versionQuery = $derived(
		settingsId == null
			? null
			: client.db.jurisdiction_settings.findFirst({
					where: { id: { eq: settingsId } },
					columns: { sealed_at: true }
				})
	);
	return () => versionQuery?.current?.sealed_at != null;
}
