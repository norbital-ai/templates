import { policy, type Actor } from '@norbital-ai/bolt';

const OWN = { owner: { eq: { var: 'actor.id' } } } as const;
/** The personal accounts a sales user connects; only their own, only of these definitions. */
const PERSONAL: readonly string[] = ['google_calendar', 'email', 'whatsapp'];
/** The member a write is made as: the signed-in member, or the one an envoy's sender is linked to. */
const me = (actor: Actor) =>
	actor.kind === 'member' ? actor.id : actor.kind === 'envoy' ? actor.member : null;

export default policy({
	description:
		'Personal communication configuration and the CRM apps and automations for sales users.',
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
			// owner and definition are not update columns: the stored row decides before and after
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
		calendar_entries: {
			outputs: { default: { where: { source_user: { eq: { var: 'actor.id' } } } } }
		},
		// owner is filled with the writer's own id on create and is no update column; an update keeps it
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
	},
	capabilities: {
		apps: ['crm', 'configuration'],
		automations: [
			'import_leads',
			'research_lead',
			'send_message',
			'update_requirements',
			'transcribe_meeting',
			'meeting_notes',
			'activities_file',
			'meeting_speakers_save_voice',
			'launch_cohort',
			'sync_cohort'
		]
	}
});
