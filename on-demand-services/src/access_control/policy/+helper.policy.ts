import { policy, type Actor } from '@norbital-ai/bolt';
const SELF = { user: { eq: { var: 'actor.id' } } } as const;
const OWN = { helper: { is: SELF } } as const;
/** The member writing. */
const memberOf = (actor: Actor) => (actor.kind === 'member' ? actor.id : null);
/**
 * A helper: their own visits and the customer details needed to reach them, their own record, and the position their
 * app reports. They answer the shift check and move a visit through its day; everything else is the scheduler's.
 */
export default policy({
	description: 'A helper’s own visits, shift check answers, completion and reported position.',
	capabilities: {
		apps: ['helper'],
		automations: ['visits_confirm_shift', 'visits_decline_shift']
	},
	grants: {
		helpers: {
			outputs: { helper: { where: SELF } },
			update: {
				fields: ['last_location'],
				verdict: function* (changes, ctx) {
					const me = memberOf(ctx.actor);
					const row = changes.findIndex((c) => me === null || c.before.user !== me);
					return row < 0 ? ctx.allow() : yield* ctx.refuse('errors.own_position', { row });
				}
			}
		},
		helper_time_off: { outputs: { default: { where: OWN } } },
		services: {
			outputs: { helper: {} }
		},
		visits: {
			outputs: {
				helper: {
					where: OWN,
					// only themselves: another helper's absence is the desk's
					unavailable_helper: { where: SELF }
				}
			},
			update: {
				fields: ['status', 'shift_check', 'mc', 'completion_notes'],
				moves: { status: ['scheduled->in_progress', 'in_progress->done'] },
				// their own visits: the visit's helper is the member (the helper column is not theirs to write)
				verdict: function* (changes, ctx) {
					const me = memberOf(ctx.actor);
					const ids = changes.flatMap((c) => (c.before.helper === null ? [] : [c.before.helper]));
					const { helpers } = yield* ctx.query({
						helpers: { where: { id: { in: ids } }, fields: ['user'] }
					});
					const mine = new Set(
						helpers.rows.flatMap((h) => (me !== null && h.user === me ? [h.id] : []))
					);
					const row = changes.findIndex(
						(c) => c.before.helper === null || !mine.has(c.before.helper)
					);
					return row < 0 ? ctx.allow() : yield* ctx.refuse('errors.own_visits', { row });
				}
			}
		},
		bookings: {
			outputs: { helper: { where: { visits: { some: OWN } } } }
		},
		customers: {
			outputs: {
				helper: { where: { bookings: { some: { visits: { some: OWN } } } } }
			}
		}
	}
});
