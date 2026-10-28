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
 * Nothing of any other customer or of any helper's schedule; a request is booked by the `portal_intake` run.
 */
export default policy({
	description: 'A customer: book on the portal, and see their own bookings, visits and notices.',
	capabilities: { apps: ['portal'] },
	grants: {
		customers: {
			read: {
				customers: {
					where: { id: ME },
					fields: ['id', 'name', 'phone', 'email', 'address', 'location', 'area']
				}
			}
		},
		services: {
			read: {
				services: {
					where: { active: { eq: true } },
					fields: ['id', 'name', 'duration_minutes', 'price', 'description', 'skill']
				}
			}
		},
		openings: { read: { openings: { fields: ['id', 'service', 'day', 'starts'] } } },
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
			read: {
				booking_requests: {
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
			}
		},
		bookings: {
			read: {
				bookings: {
					where: MINE,
					fields: ['id', 'number', 'customer', 'service', 'repeat', 'status', 'visit_count']
				}
			}
		},
		visits: {
			read: {
				visits: {
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
				},
				// who comes, by name only; who could not come is the desk's
				'visits.helper': { fields: ['name'] },
				'visits.unavailable_helper': { where: { id: { in: [] } } },
				'visits.booking': {
					fields: ['number', 'customer', 'service', 'repeat', 'status', 'visit_count']
				},
				'visits.booking.customer': { fields: ['name'] },
				'visits.booking.service': { fields: ['name', 'duration_minutes', 'description'] }
			}
		},
		helpers: {
			read: { helpers: { where: { status: { eq: 'active' } }, fields: ['id', 'name', 'skills'] } }
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
			read: {
				availability_requests: {
					where: MY_NUMBER,
					fields: [
						'id',
						'phone',
						'address',
						'area',
						'service',
						'preference',
						'helper',
						'repeat',
						'starts',
						'estimated',
						'status',
						'problem',
						'checked_at'
					]
				}
			}
		},
		customer_notices: {
			read: {
				customer_notices: { where: MINE, fields: ['id', 'customer', 'visit', 'subject', 'body'] },
				'customer_notices.customer': { fields: ['name'] }
			}
		}
	},
	limits: { read: '300/min', act: '30/h' }
});
