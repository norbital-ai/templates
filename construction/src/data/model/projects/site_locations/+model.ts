import { model } from '../../../../../.norbital/models/site_locations.ts';
const columns = [
	'location_name',
	'location_code',
	'project_id',
	'location_type',
	'parent_location_id',
	'grid_reference',
	'description',
	'coordinates',
	'bim_model_element_id'
] as const;
export default model({
	description: 'Work fronts and delivery zones within a project.',
	icon: 'lucide:map-pin',
	record_label:
		"[record.location_code != null ? string(record.location_code) : '', record.location_name != null ? string(record.location_name) : ''].filter(part, part != '').join(' · ')",
	fields: {
		location_name: { kind: 'text' },
		location_code: { kind: 'text', optional: true, unique: true },
		location_type: { kind: 'text', optional: true },
		grid_reference: { kind: 'text', optional: true },
		description: { kind: 'text', optional: true },
		coordinates: { kind: 'custom', of: 'site_coordinates', optional: true },
		/** An external BIM element label, not a system id. */
		bim_model_element_id: { kind: 'text', optional: true },
		project_id: { kind: 'ref', to: 'projects', inverse: 'site_locations', optional: true },
		parent_location_id: {
			kind: 'ref',
			to: 'site_locations',
			inverse: 'child_locations',
			optional: true,
			on_delete: 'set_null'
		}
	},
	indexes: { find: { text: ['location_code', 'location_name'] } },
	outputs: { default: { fields: 'all' } },
	create: { columns: { fields: columns } },
	update: { columns: { fields: columns } }
});
