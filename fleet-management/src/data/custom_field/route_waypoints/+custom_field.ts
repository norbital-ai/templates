import { custom_field } from '@norbital-ai/bolt';

/** Ordered intermediate stops along a dispatched vehicle route. */
export default custom_field({
	description: 'Ordered GPS waypoints along a route with optional ETA and arrival time.',
	shape: {
		kind: 'object',
		many: true,
		fields: {
			name: { kind: 'text' },
			lat: { kind: 'number', min: -90, max: 90 },
			lng: { kind: 'number', min: -180, max: 180 },
			eta: { kind: 'time', optional: true },
			arrived_at: { kind: 'time', optional: true },
			status: {
				kind: 'enum',
				values: ['pending', 'arrived', 'skipped'],
				optional: true
			}
		}
	}
});
