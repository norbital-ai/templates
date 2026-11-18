import { policy } from '@norbital-ai/bolt';

/** The shared lead pipeline and customer CRM; it names no member, so the sales automations hold it too. */
export default policy({
	description: 'Shared lead pipeline and customer CRM.',
	grants: {
		// a lead moves through the pipeline; converting it makes it a client, and only an administrator reopens a lost one
		companies: {
			outputs: { default: {} },
			create: {},
			update: {
				moves: {
					stage: [
						'lead->qualified',
						'lead->lost',
						'qualified->lead',
						'qualified->lost',
						'lead->client',
						'qualified->client',
						'lost->client'
					]
				}
			}
		},
		contacts: { outputs: { default: {}, crm: {} }, create: {}, update: {} },
		projects: { outputs: { default: {} }, create: {}, update: {} },
		// a signed copy is uploaded, never edited; only an administrator deletes a mistaken one
		signed_documents: { outputs: { default: {} }, create: {} },
		activities: {
			outputs: { default: {} },
			create: {},
			// cancelling or reinstating a meeting writes it to its owner's Google Calendar
			update: { moves: { status: ['open->cancelled', 'cancelled->open'] } }
		},
		tasks: {
			outputs: { default: {} },
			create: {},
			update: {
				fields: [
					'subject',
					'kind',
					'detail',
					'attachments',
					'due_on',
					'owner',
					'status',
					'company',
					'project_id',
					'contact_id',
					'meeting'
				],
				moves: { status: ['open->done', 'open->cancelled', 'done->open', 'cancelled->open'] }
			}
		},
		issues: { outputs: { default: {} }, create: {}, update: {} },
		project_documents: { outputs: { default: {} }, create: {}, update: {} },
		meeting_recordings: { outputs: { default: {} }, create: {}, update: {}, delete: {} },
		meeting_speakers: { outputs: { default: {} }, create: {}, update: {} },
		notes: { outputs: { default: {} } },
		template_documents: { outputs: { default: {} }, update: { fields: ['drafting_instructions'] } },
		agreement_settings: { outputs: { default: {} } },
		offering_settings: { outputs: { default: {} }, create: {}, update: {} },
		products: { outputs: { default: {} }, create: {}, update: {}, delete: {} },
		// cold outreach: the prompt and sender, each company's potential projects, sequences and cohorts; a cohort is
		// launched by `launch_cohort` and finished by a person, and a person records only a member's booked meeting
		outreach_settings: {
			outputs: { default: {} },
			create: {},
			update: { fields: ['projects_prompt', 'sender_name', 'apollo_projects_variable'] }
		},
		potential_projects: { outputs: { default: {} }, create: {}, update: {}, delete: {} },
		sequences: { outputs: { default: {} }, create: {}, update: {}, delete: {} },
		cohorts: {
			outputs: { default: {} },
			create: {},
			update: { moves: { status: ['draft->done', 'launched->done'] } },
			delete: {}
		},
		cohort_members: {
			outputs: { default: {} },
			create: {},
			update: { fields: ['meeting_booked'] },
			delete: {}
		},
		// runs holding this policy name members (a follow-up's owner) by the directory
		sys_user: { outputs: { directory: {} } }
	}
});
