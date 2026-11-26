import { automation } from '@norbital-ai/bolt';
import { salesStarter } from '../lib/customer.js';

export default automation({
	description: 'Assigns or reassigns captured messages to their customer and job.',
	input: {
		activities: { kind: 'rows', of: 'activities' },
		company: { kind: 'ref', to: 'companies' },
		contact: { kind: 'ref', to: 'contacts', optional: true },
		project: { kind: 'ref', to: 'projects' }
	},
	policies: ['crm'],
	run: function* (input, ctx) {
		if (!(yield* salesStarter(ctx.trigger, ctx))) return yield* ctx.refuse('errors.sales_only');
		const row = input.activities.findIndex(
			(item) => item.kind !== 'message' && item.source_calendar == null
		);
		if (row >= 0) return yield* ctx.refuse('errors.file_captured_only', { row });
		const read = yield* ctx.query({
			contacts: { where: { id: { in: input.contact == null ? [] : [input.contact] } } },
			projects: { where: { id: { in: input.project == null ? [] : [input.project] } } }
		});
		const chosenContact = read.contacts.rows[0] ?? null;
		const chosenProject = read.projects.rows[0] ?? null;
		if (
			input.contact != null &&
			(chosenContact === null || chosenContact.company_id !== input.company)
		)
			return yield* ctx.refuse('errors.contact_not_customer');
		if (
			input.project != null &&
			(chosenProject === null || chosenProject.company_id !== input.company)
		)
			return yield* ctx.refuse('errors.project_not_customer');
		yield* ctx.act({
			'activities.update': input.activities.map((target) => ({
				target,
				set: {
					company: input.company,
					contact_id: input.contact ?? null,
					project_id: input.project ?? null,
					classification: 'useful',
					classified_by: 'manual',
					reason: 'Customer assignment changed manually.',
					...(target.source_calendar == null ? {} : { calendar_manual: true }),
					classified_at: ctx.now
				}
			}))
		});
	}
});
