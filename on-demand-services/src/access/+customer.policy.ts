import { policy } from '@norbital-ai/bolt';

/** The customer record the signed-in member is (bound by their mobile number). */
const ME = { eq: { actor: 'party' } } as const;
const MINE = { customer: ME } as const;
const MY_VISITS = { booking: { is: MINE } } as const;
/** A request is theirs by the number they signed in with. */
const MY_NUMBER = { phone: { eq: { actor: 'phone' } } } as const;

/**
 * A customer, signed up with their mobile number: the portal's services and open times, booking requests under their
 * own number, and their own record, bookings, visits (when, where, who comes and how far away they are) and notices.
 * Nothing of any other customer or of any helper's schedule; a request is booked by the `portal_intake` run.
 */
export default policy({
	description: 'A customer: book on the portal, and see their own bookings, visits and notices.',
	capabilities: { apps: ['portal'] },
	grants: {
		customers: {
			read: { where: { id: ME }, fields: ['id', 'name', 'phone', 'email', 'address', 'area'] }
		},
		services: {
			read: {
				where: { active: { eq: true } },
				fields: ['id', 'name', 'duration_minutes', 'price', 'description']
			}
		},
		openings: { read: { fields: ['id', 'service', 'day', 'starts'] } },
		booking_requests: {
			create: {
				where: MY_NUMBER,
				fields: ['name', 'email', 'phone', 'address', 'area', 'service', 'start', 'repeat', 'notes']
			},
			read: {
				where: MY_NUMBER,
				fields: [
					'id',
					'number',
					'phone',
					'service',
					'start',
					'repeat',
					'address',
					'status',
					'booking'
				]
			}
		},
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
	limits: { read: '300/min', act: '30/h' }
});
