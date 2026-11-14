import { policy, type Actor } from '@norbital-ai/bolt';

const SELF = { user: { eq: { var: 'actor.id' } } } as const;
/** The member writing. */
const memberOf = (actor: Actor) => (actor.kind === 'member' ? actor.id : null);

/** A viewer: reads the book and the reports, and subscribes or unsubscribes themselves to the daily report. */
export default policy({
	description:
		'Read-only access to the holdings and the daily reports, and the viewer’s own subscription to the report.',
	capabilities: { apps: ['portfolio'] },
	grants: {
		holding: { outputs: { default: {} } },
		report: { outputs: { default: {} } },
		/** Only their own row: create and delete it for themselves, never for someone else. */
		report_subscription: {
			outputs: { default: { where: SELF } },
			create: {
				verdict: function* (changes, ctx) {
					const me = memberOf(ctx.actor);
					const row = changes.findIndex((c) => me === null || c.after.user !== me);
					return row < 0 ? ctx.allow() : yield* ctx.refuse('errors.own_subscription', { row });
				}
			},
			delete: {
				verdict: function* (changes, ctx) {
					const me = memberOf(ctx.actor);
					const row = changes.findIndex((c) => me === null || c.before.user !== me);
					return row < 0 ? ctx.allow() : yield* ctx.refuse('errors.own_subscription', { row });
				}
			}
		}
	}
});
