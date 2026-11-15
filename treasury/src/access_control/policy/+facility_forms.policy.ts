import { policy } from '@norbital-ai/bolt';
/** What the facility-form reader holds: the forms, their attachments, and the purchase orders it links them to. */
export default policy({
	description:
		'Facility-form reader: fill forms from their attachments and link their purchase orders.',
	grants: {
		facility_form: { outputs: { default: {} }, update: {} },
		facility_attachment: { outputs: { default: {} } },
		purchase_order: { outputs: { default: {} } }
	}
});
