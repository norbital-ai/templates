import { workspace } from '@norbital-ai/bolt';

/** Construction delivery in one business zone; money carries its own currency on each row. */
export default workspace({
	tz: 'Asia/Singapore',
	locale: 'en-SG',
	apps: [
		'construction_project_workspace',
		'construction_settings_reference_matrix',
		'construction_settings_workforce'
	]
});
