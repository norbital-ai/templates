import { custom_field } from '@norbital-ai/bolt';

export default custom_field({
	description:
		'Co-located 3D BIM IFC element anchor: expressID, element name, GlobalId, 3D point coordinates, and saved camera viewpoint.',
	shape: {
		kind: 'object',
		fields: {
			express_id: { kind: 'int' },
			element_name: { kind: 'text' },
			global_id: { kind: 'text', optional: true },
			x: { kind: 'number', optional: true },
			y: { kind: 'number', optional: true },
			z: { kind: 'number', optional: true },
			camera_x: { kind: 'number', optional: true },
			camera_y: { kind: 'number', optional: true },
			camera_z: { kind: 'number', optional: true }
		}
	}
});
