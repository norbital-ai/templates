import { policy } from '@norbital-ai/bolt';

/** The customer record the signed-in member is (bound at sign-up by their mobile number). */
const ME = { eq: { actor: 'party' } } as const;
const MINE = { customer: ME } as const;
const MY_VISITS = { booking: { is: MINE } } as const;

/**
 * A registered customer (signed up with their number): their own record, bookings and visits — when, where, who comes and
 * how far away they are — and the notices sent to them. Nothing of any other customer, and nothing they can change.
 */
export default policy({
	description: 'A customer’s own bookings, visits and notices.',
	capabilities: { apps: ['my_visits'] },
	grants: {
		customers: { read: { where: { id: ME }, fields: ['id', 'name', 'phone', 'email', 'address'] } },
		services: { read: { fields: ['id', 'name', 'duration_minutes', 'description'] } },
		bookings: {
			read: {
				where: MINE,
				fields: ['id', 'number', 'customer', 'service', 'repeat', 'status', 'visit_count']
			}
		},
		visits: {
			read: {
				where: MY_VISITS,
				fields: [
					'id',
					'number',
					'booking',
					'helper',
					'slot',
					'address',
					'status',
					'eta_minutes',
					'completed_at'
				]
			}
		},
		helpers: { read: { where: { visits: { some: MY_VISITS } }, fields: ['id', 'name'] } },
		customer_notices: {
			read: { where: MINE, fields: ['id', 'customer', 'visit', 'subject', 'body'] }
		}
	},
	limits: { read: '300/min' }
});
