import { policy, type Actor } from '@norbital-ai/bolt';

const SELF = { user: { eq: { var: 'actor.id' } } } as const;
const OWN = { provider: { is: SELF } } as const;
const memberOf = (actor: Actor) => (actor.kind === 'member' ? actor.id : null);

/**
 * A service provider: their own appointments and the customer details needed to serve them, their
 * own profile, and GPS position updates from My Day.
 */
export default policy({
	description: 'A provider’s own appointments, shift check-ins, completion, and live GPS position.',
	capabilities: {
		apps: ['provider'],
		automations: ['appointments_confirm_shift', 'appointments_decline_shift']
	},
	grants: {
		providers: {
			outputs: { provider: { where: SELF } },
			update: {
				fields: ['last_location'],
				verdict: function* (changes, ctx) {
					const me = memberOf(ctx.actor);
					const row = changes.findIndex((c) => me === null || c.before.user !== me);
					return row < 0 ? ctx.allow() : yield* ctx.refuse('errors.own_position', { row });
				}
			}
		},
		provider_time_off: { outputs: { default: { where: OWN } } },
		services: { outputs: { provider: {} } },
		appointments: {
			outputs: {
				provider: {
					where: OWN,
					unavailable_provider: { where: SELF }
				}
			},
			update: {
				fields: ['status', 'shift_check', 'completion_notes'],
				moves: { status: ['scheduled->in_progress', 'in_progress->completed'] },
				verdict: function* (changes, ctx) {
					const me = memberOf(ctx.actor);
					const ids = changes.flatMap((c) =>
						c.before.provider === null ? [] : [c.before.provider]
					);
					const { providers } = yield* ctx.query({
						providers: {
							where: { id: { in: ids } },
							fields: ['user'],
							limit: ids.length + 1
						}
					});
					const mine = new Set(
						providers.rows.flatMap((p) => (me !== null && p.user === me ? [p.id] : []))
					);
					const row = changes.findIndex(
						(c) => c.before.provider === null || !mine.has(c.before.provider)
					);
					return row < 0 ? ctx.allow() : yield* ctx.refuse('errors.own_appointments', { row });
				}
			}
		},
		bookings: {
			outputs: { provider: { where: { appointments: { some: OWN } } } }
		},
		customers: {
			outputs: {
				provider: { where: { bookings: { some: { appointments: { some: OWN } } } } }
			}
		}
	}
});
