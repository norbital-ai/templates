import { policy, type Actor } from '@norbital-ai/bolt';
/** The customer record the signed-in member is (bound by their mobile number). */
const ME = { eq: { var: 'requestor.party' } } as const;
const MINE = { customer: ME } as const;
const MY_VISITS = { booking: { is: MINE } } as const;
/** A request is theirs by the number they signed in with. */
const MY_NUMBER = { phone: { eq: { var: 'requestor.phone' } } } as const;
/** The first request raised under another number than the one the member signed in with; -1 when none. */
const notMine = (rows: readonly { readonly phone?: string | null }[], actor: Actor) =>
	rows.findIndex((r) => actor.kind !== 'member' || actor.phone === null || r.phone !== actor.phone);
const OTHER_NUMBER = 'Use the mobile number you signed in with.';
/**
 * A customer, signed up with their mobile number: the portal's services and open times, booking requests under their
 * own number, and their own record, bookings, visits (when, where, who comes and how far away they are) and notices.
 * Nothing of any other customer or of any helper's schedule; a request is booked by the `portal_intake` run
 * its effect schedules.
 */
export default policy({
	description: 'A customer: book on the portal, and see their own bookings, visits and notices.',
	capabilities: { apps: ['portal'] },
	grants: {
		customers: {
			outputs: { customer: { customers: { where: { id: ME } } } }
		},
		services: {
			outputs: { customer: { services: { where: { active: { eq: true } } } } }
		},
		openings: { outputs: { portal: true } },
		booking_requests: {
			create: {
				columns: {
					booking_requests: [
						'name',
						'email',
						'phone',
						'address',
						'area',
						'service',
						'start',
						'repeat',
						'notes',
						'availability'
					]
				},
				check: function* (rows, ctx) {
					const row = notMine(rows, ctx.actor);
					return row < 0 ? ctx.allow() : ctx.deny(OTHER_NUMBER, { row, field: 'phone' });
				}
			},
			outputs: { customer: { booking_requests: { where: MY_NUMBER } } }
		},
		bookings: {
			outputs: { customer: { bookings: { where: MINE } } }
		},
		visits: {
			outputs: { customer: { visits: { where: MY_VISITS } } }
		},
		helpers: {
			outputs: { customer: { helpers: { where: { status: { eq: 'active' } } } } }
		},
		availability_requests: {
			create: {
				columns: {
					availability_requests: [
						'phone',
						'address',
						'location',
						'area',
						'service',
						'preference',
						'helper',
						'repeat'
					]
				},
				check: function* (rows, ctx) {
					const row = notMine(rows, ctx.actor);
					return row < 0 ? ctx.allow() : ctx.deny(OTHER_NUMBER, { row, field: 'phone' });
				}
			},
			outputs: { customer: { availability_requests: { where: MY_NUMBER } } }
		},
		customer_notices: {
			outputs: { customer: { customer_notices: { where: MINE } } }
		}
	},
	limits: { read: '300/min', act: '30/h' }
});
