import { model } from '@norbital-ai/bolt';

const columns = ['projects_prompt', 'sender_name', 'apollo_projects_variable'] as const;

/**
 * The workspace's cold-outreach settings, one row edited in Settings (or by Norbius): the prompt `research_lead` proposes
 * each company's potential projects with (`prompt_version` counts its edits, and every proposal records the version that
 * made it), the `{{sender_name}}` a sequence renders, and the Apollo placeholder `{{potential_projects}}` becomes in the
 * steps `launch_cohort` pushes. `apollo_field_id` is the Apollo contact custom field `launch_cohort` created for the
 * rendered bullets.
 */
export default model('outreach_settings', {
	description:
		'Cold-outreach settings: the potential-project prompt, the sender and the Apollo field.',
	icon: 'lucide:send',
	record_label: "'Outreach settings'",
	fields: {
		scope: { kind: 'enum', values: ['workspace'], default: 'workspace', hidden: true },
		projects_prompt: { kind: 'text', format: 'markdown' },
		prompt_version: { kind: 'int', min: 1, default: 1 },
		sender_name: { kind: 'text', optional: true },
		apollo_projects_variable: { kind: 'text', default: '{{potential_projects}}' },
		apollo_field_id: { kind: 'text', optional: true, hidden: true }
	},
	constraints: { one_outreach_settings: { unique: ['scope'] } },
	outputs: { default: { fields: 'all' } },
	create: { fields: columns },
	update: {
		fields: [...columns, 'prompt_version', 'apollo_field_id'],
		// every edit of the prompt is a new version; proposals name the version that made them
		transform: function* (changes) {
			return changes.map((change) =>
				change.changed('projects_prompt')
					? { ...change.set, prompt_version: change.before.prompt_version + 1 }
					: change.set
			);
		}
	}
});
