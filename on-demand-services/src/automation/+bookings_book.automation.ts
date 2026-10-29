import { automation } from '@norbital-ai/bolt';
import { bookService } from '../lib/booking.js';
import { AREAS, REPEATS } from '../lib/matching.js';

export default automation('bookings_book', {
	description:
		'Books a service for a customer at their address, once or recurring. With preferred helpers every visit goes to the first of them who is free; without, to the best-matched helper. Every occurrence in the requested horizon must find a helper; otherwise nothing is booked.',
	input: {
		customer: { kind: 'id', of: 'customers' },
		service: { kind: 'id', of: 'services', where: { active: { eq: true } } },
		preference: { kind: 'enum', values: ['any', 'preferred'] },
		helpers: { kind: 'list', of: { kind: 'id', of: 'helpers' }, max: 5, optional: true },
		start: { kind: 'instant' },
		repeat: { kind: 'enum', values: REPEATS },
		visits: { kind: 'int', min: 1, max: 26, optional: true },
		notes: { kind: 'text', optional: true },
		address: { kind: 'text', max: 500, optional: true },
		area: { kind: 'enum', values: AREAS, optional: true },
		location: { kind: 'point', optional: true }
	},
	output: {
		kind: 'object',
		fields: {
			booking: { kind: 'id', of: 'bookings' },
			assigned: { kind: 'int' },
			unassigned: { kind: 'int' }
		}
	},
	policies: ['operations'],
	run: function* (input, ctx) {
		return yield* bookService(input, ctx);
	}
});
