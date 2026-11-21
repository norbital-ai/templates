import { policy, type Actor } from '@norbital-ai/bolt';

const OWN = { owner: { eq: { var: 'actor.id' } } } as const;
const PERSONAL: readonly string[] = ['whatsapp', 'email'];
const me = (actor: Actor) =>
	actor.kind === 'member' ? actor.id : actor.kind === 'envoy' ? actor.member : null;

/** Personal WhatsApp & email connection management plus each member's intake/extraction rules (mirrors Norbital HQ). */
export default policy({
	description:
		'Connect personal WhatsApp and email accounts and manage personal message intake rules.',
	capabilities: { apps: ['configuration'] },
	grants: {
		sys_integration: {
			outputs: { default: { where: OWN } },
			create: {
				verdict: function* (changes, ctx) {
					const id = me(ctx.actor);
					const row = changes.findIndex(
						({ after }) =>
							id === null || after.owner !== id || !PERSONAL.includes(after.integration)
					);
					return row < 0
						? ctx.allow()
						: yield* ctx.refuse('errors.personal_accounts_only', { row });
				}
			},
			update: {
				fields: ['name', 'active', 'configuration', 'import_start'],
				verdict: function* (changes, ctx) {
					const id = me(ctx.actor);
					const row = changes.findIndex(
						({ before }) =>
							id === null || before.owner !== id || !PERSONAL.includes(before.integration)
					);
					return row < 0
						? ctx.allow()
						: yield* ctx.refuse('errors.personal_accounts_only', { row });
				}
			},
			delete: {
				verdict: function* (changes, ctx) {
					const id = me(ctx.actor);
					const row = changes.findIndex(
						({ before }) =>
							id === null || before.owner !== id || !PERSONAL.includes(before.integration)
					);
					return row < 0
						? ctx.allow()
						: yield* ctx.refuse('errors.personal_accounts_only', { row });
				}
			}
		},
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
