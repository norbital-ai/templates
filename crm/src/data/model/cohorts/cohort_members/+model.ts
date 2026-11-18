import { model } from '@norbital-ai/bolt';

/** What `launch_cohort` and `sync_cohort` record; a person records only the booked meeting. */
const tracked = [
	'enrolled_on',
	'step',
	'replied',
	'meeting_booked',
	'stopped',
	'projects_sent',
	'apollo_contact_id'
] as const;

/**
 * A lead (a PIC and their company) in a cohort: when Apollo enrolled them, the step they reached, whether they replied,
 * booked a meeting, bounced or unsubscribed, and the `{{potential_projects}}` bullets they were sent. A lead may join
 * many cohorts over time but only one active cohort at a time: an active membership is unique per contact and per
 * company (natively), and it stops being active when its cohort is done.
 */
export default model('cohort_members', {
	description: 'A lead in a cohort, with its Apollo progress.',
	icon: 'lucide:user-round-check',
	record_label: "record.cohort.name + ' · ' + record.contact.full_name",
	fields: {
		cohort: { kind: 'ref', to: 'cohorts', inverse: 'members', on_delete: 'cascade' },
		contact: { kind: 'ref', to: 'contacts', inverse: 'cohort_memberships' },
		company: { kind: 'ref', to: 'companies', inverse: 'cohort_memberships' },
		active: { kind: 'bool', default: true, hidden: true },
		enrolled_on: { kind: 'date', optional: true },
		step: { kind: 'int', min: 0, optional: true },
		replied: { kind: 'bool', default: false },
		meeting_booked: { kind: 'bool', default: false },
		stopped: { kind: 'enum', values: ['bounced', 'unsubscribed'], optional: true },
		projects_sent: { kind: 'text', format: 'markdown', optional: true },
		apollo_contact_id: { kind: 'text', optional: true, hidden: true }
	},
	constraints: {
		one_active_cohort_per_contact: {
			unique: ['contact'],
			where: { active: { eq: true } },
			message: 'errors.lead_in_active_cohort'
		},
		one_active_cohort_per_company: {
			unique: ['company'],
			where: { active: { eq: true } },
			message: 'errors.lead_in_active_cohort'
		}
	},
	outputs: {
		default: {
			fields: 'all',
			cohort: { fields: ['name', 'status'] },
			contact: { fields: ['full_name', 'email'] },
			company: { fields: ['name'] }
		}
	},
	create: {
		fields: ['cohort', 'contact', 'company'],
		filled: { fields: ['company'] },
		transform: function* (changes, ctx) {
			// the lead's company is its PIC's
			const contacts = (yield* ctx.query({
				contacts: {
					output: 'crm',
					where: { id: { in: changes.map(({ set }) => set.contact) } },
					fields: ['company_id']
				}
			})).contacts.rows;
			const sets = [];
			for (const [row, { set }] of changes.entries()) {
				const company = contacts.find((contact) => contact.id === set.contact)?.company_id;
				if (company == null)
					return yield* ctx.refuse('errors.member_needs_company', { row, field: 'contact' });
				if (set.company != null && set.company !== company)
					return yield* ctx.refuse('errors.cohort_company', { row, field: 'contact' });
				sets.push({ ...set, company });
			}
			return sets;
		}
	},
	update: { fields: tracked },
	delete: {}
});
