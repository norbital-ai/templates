import { policy, type Actor } from '@norbital-ai/bolt';
/** The customer record the signed-in member is (bound by their mobile number). */
const ME = { eq: { var: 'actor.party' } } as const;
const MINE = { customer: ME } as const;
const MY_VISITS = { booking: { is: MINE } } as const;
/** A request is theirs by the number they signed in with. */
const MY_NUMBER = { phone: { eq: { var: 'actor.phone' } } } as const;
/** The first request raised under another number than the one the member signed in with; -1 when none. */
const notMine = (
	changes: readonly { readonly set: { readonly phone?: string | null } }[],
	actor: Actor
) =>
	changes.findIndex(
		({ set }) => actor.kind !== 'member' || actor.phone === null || set.phone !== actor.phone
	);
const OTHER_NUMBER = 'errors.other_number';
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
			outputs: { customer: { where: { id: ME } } }
		},
		services: {
			outputs: { customer: { where: { active: { eq: true } } } }
		},
		openings: { outputs: { portal: {} } },
		booking_requests: {
			create: {
				fields: [
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
				],
				verdict: function* (changes, ctx) {
					const row = notMine(changes, ctx.actor);
					return row < 0 ? ctx.allow() : yield* ctx.refuse(OTHER_NUMBER, { row, field: 'phone' });
				}
			},
			outputs: { customer: { where: MY_NUMBER } }
		},
		bookings: {
			outputs: { customer: { where: MINE } }
		},
		visits: {
			outputs: { customer: { where: MY_VISITS } }
		},
		helpers: {
			outputs: { customer: { where: { status: { eq: 'active' } } } }
		},
		availability_requests: {
			create: {
				fields: [
					'phone',
					'address',
					'location',
					'area',
					'service',
					'preference',
					'helper',
					'repeat'
				],
				verdict: function* (changes, ctx) {
					const row = notMine(changes, ctx.actor);
					return row < 0 ? ctx.allow() : yield* ctx.refuse(OTHER_NUMBER, { row, field: 'phone' });
				}
			},
			outputs: { customer: { where: MY_NUMBER } }
		},
		customer_notices: {
			outputs: { customer: { where: MINE } }
		}
	}
});
