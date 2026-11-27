import { policy } from '@norbital-ai/bolt';

export default policy({
	description:
		'Personal connections, private calendar entries, and the CRM apps and automations for sales users.',
	grants: {
		calendar_entries: {
			outputs: { default: { where: { source_user: { eq: { var: 'actor.id' } } } } }
		}
	},
	capabilities: {
		apps: ['crm', 'configuration'],
		personal_connections: ['whatsapp', 'email', 'google_calendar'],
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
