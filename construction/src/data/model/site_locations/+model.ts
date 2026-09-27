import { model } from '@norbital-ai/bolt';

export default model({
	description: 'Work fronts and delivery zones within a project.',
	icon: 'lucide:map-pin',
	label: 'location_name',
	fields: {
		location_name: { kind: 'text' },
		location_code: { kind: 'text', optional: true, unique: true },
		location_type: { kind: 'text', optional: true },
		grid_reference: { kind: 'text', optional: true },
		description: { kind: 'text', optional: true },
		coordinates: { kind: 'custom', of: 'site_coordinates', optional: true },
		/** An external BIM element label, not a system id. */
		bim_model_element_id: { kind: 'text', optional: true }
	},
	search: { text: ['location_name'] }
});
