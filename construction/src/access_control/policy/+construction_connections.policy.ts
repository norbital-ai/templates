import { policy, type Actor } from '@norbital-ai/bolt';

const OWN = { owner: { eq: { var: 'actor.id' } } } as const;
const me = (actor: Actor) =>
	actor.kind === 'member' ? actor.id : actor.kind === 'envoy' ? actor.member : null;

/** Personal WhatsApp & email connection management plus each member's intake/extraction rules. */
export default policy({
	description:
		'Connect personal WhatsApp and email accounts and manage personal message intake rules.',
	capabilities: {
		apps: ['configuration'],
		personal_connections: ['whatsapp', 'email']
	},
	grants: {
		communication_settings: {
			outputs: { default: { where: OWN } },
			create: {},
			update: {
				verdict: function* (changes, ctx) {
					const id = me(ctx.actor);
					return changes.every(({ before }) => id !== null && before.owner === id)
						? ctx.allow()
						: yield* ctx.refuse('errors.intake_not_own');
				}
			}
		}
	}
});
