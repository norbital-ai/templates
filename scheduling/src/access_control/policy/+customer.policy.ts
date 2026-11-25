import { policy, type Actor } from '@norbital-ai/bolt';

const ME = { eq: { var: 'actor.party' } } as const;
const MINE = { customer: ME } as const;
const MY_APPOINTMENTS = { booking: { is: MINE } } as const;
const MY_NUMBER = { phone: { eq: { var: 'actor.phone' } } } as const;

const notMine = (
	changes: readonly { readonly after: { readonly phone?: string | null } }[],
	actor: Actor
) =>
	changes.findIndex(
		({ after }) => actor.kind !== 'member' || actor.phone === null || after.phone !== actor.phone
	);
const OTHER_NUMBER = 'errors.other_number';

/**
 * Verified self-service customer: active services and published openings, availability and booking
 * requests under their verified phone number, and their own profile, bookings, appointments, and notices.
 */
export default policy({
	description:
		'A customer: book on the portal and view their own bookings, appointments, and notices.',
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
		appointments: {
			outputs: { customer: { where: MY_APPOINTMENTS } }
		},
		providers: {
			outputs: { customer: { where: { status: { eq: 'active' } } } }
		},
		availability_requests: {
			create: {
				fields: ['phone', 'address', 'location', 'service', 'preference', 'provider', 'repeat'],
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
