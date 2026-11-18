import { policy } from '@norbital-ai/bolt';

/**
 * What the workspace's own background work holds, by nobody's team: importing, enriching and researching leads (with the
 * host's web search) and proposing their potential projects, launching and syncing outreach cohorts through Apollo,
 * sending documents and outreach, reminding follow-up owners, filing new conversations under their
 * contacts, and transcribing meetings.
 */
export default policy({
	description:
		'Background work: import and research leads, launch and sync outreach cohorts, send documents, remind follow-up owners, file new client conversations, and transcribe meetings.',
	grants: {
		communication_settings: { outputs: { default: {} } },
		companies: { outputs: { default: {} }, create: {}, update: {} },
		project_documents: { outputs: { default: { history: true } } },
		contacts: { outputs: { crm: {} }, create: {}, update: {} },
		template_documents: { outputs: { default: {} } },
		agreement_settings: { outputs: { default: {} } },
		offering_settings: { outputs: { default: {} } },
		products: { outputs: { default: {} } },
		projects: { outputs: { default: {} }, update: {} },
		tasks: { outputs: { default: {} }, create: {}, update: {} },
		activities: {
			outputs: { default: { history: true } },
			create: {},
			update: {}
		},
		meeting_recordings: {
			outputs: { default: { history: true } },
			create: {},
			update: {}
		},
		// a speaker's contact shows by name: the voice profile stays with the Sales policy
		meeting_speakers: {
			outputs: { crm: {} },
			create: {},
			delete: {}
		},
		sys_user: { outputs: { default: {} } },
		sys_conversation: { outputs: { default: {} } },
		sys_message: { outputs: { default: {} } },
		sys_integration: { outputs: { default: {} } },
		// cold outreach: proposals from research, a cohort's launch and its Apollo progress
		outreach_settings: { outputs: { default: {} }, update: {} },
		potential_projects: { outputs: { default: {} }, create: {}, delete: {} },
		sequences: { outputs: { default: {} } },
		cohorts: { outputs: { default: {} }, update: { moves: { status: ['draft->launched'] } } },
		cohort_members: { outputs: { default: {} }, update: {} }
	},
	capabilities: { tools: ['web_search'] }
});
