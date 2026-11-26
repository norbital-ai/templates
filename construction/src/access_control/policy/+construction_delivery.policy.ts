import { policy } from '@norbital-ai/bolt';

/** Site & delivery authority: projects, large-scale WBS tasks, polymorphic activities, BIM files, contacts, and WhatsApp/email intake. */
export default policy({
	description:
		'Delivery writes for projects, BIM files, WBS tasks, polymorphic activities, contacts, and WhatsApp/email coordination messages.',
	grants: {
		projects: { outputs: { default: {} }, create: {}, update: { moves: 'all' } },
		cost_estimates: {
			outputs: { default: {} },
			update: {
				fields: ['status'],
				moves: { status: ['draft->void', 'reviewed->void', 'baselined->void'] }
			}
		},
		project_files: {
			outputs: { default: {} },
			create: {},
			update: {
				fields: [
					'document_number',
					'title',
					'kind',
					'discipline',
					'status',
					'zone',
					'current_version',
					'autodesk_urn',
					'file',
					'notes'
				],
				moves: 'all'
			}
		},
		tasks: { outputs: { default: {} }, create: {}, update: { moves: 'all' } },
		activities: { outputs: { default: {} }, create: {}, update: {}, delete: {} },
		contacts: { outputs: { default: {} }, create: {}, update: {}, delete: {} },
		project_messages: { outputs: { default: {} }, create: {}, update: {} }
	},
	capabilities: {
		automations: ['sync_messages', 'analyze_bim_file'],
		syncs: ['tasks.autodesk_schedule', 'project_files.autodesk_files']
	}
});
