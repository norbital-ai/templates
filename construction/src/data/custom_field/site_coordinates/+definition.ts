import { customField } from '@norbital-ai/bolt';

export default customField({
	description:
		'An x, y, and z point in the site model, used to place a location or defect inside the building rather than on a map, with any axis that was never surveyed left empty.',
	shape: {
		kind: 'object',
		fields: {
			x: { kind: 'number', optional: true },
			y: { kind: 'number', optional: true },
			z: { kind: 'number', optional: true }
		}
	}
});
