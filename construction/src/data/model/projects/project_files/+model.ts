import { model } from '@norbital-ai/bolt';
import { validateProjectZones } from '../../../../lib/zones.js';

const columns = [
	'document_number',
	'title',
	'project_id',
	'kind',
	'discipline',
	'status',
	'zone',
	'current_version',
	'autodesk_urn',
	'file',
	'notes'
] as const;

export default model('project_files', {
	description:
		'Filed project drawings, specifications, schedules, contract documents, handover records, and Autodesk ACC sheets. Record history keeps each earlier version.',
	icon: 'lucide:file-text',
	record_label:
		"record.document_number != null ? record.document_number + ' · ' + record.title : record.title",
	fields: {
		document_number: { kind: 'text' },
		title: { kind: 'text' },
		kind: {
			kind: 'enum',
			values: ['drawing', 'spec', 'schedule', 'contract_doc', 'handover', 'autodesk_model'],
			default: 'drawing'
		},
		discipline: {
			kind: 'enum',
			values: ['architecture', 'structural', 'mep', 'civil', 'federated', 'commercial'],
			optional: true
		},
		status: {
			kind: 'state',
			initial: 'draft',
			states: {
				draft: { to: ['in_review', 'issued', 'archived'] },
				in_review: { to: ['issued', 'draft', 'archived'] },
				issued: { to: ['superseded', 'in_review', 'archived'] },
				superseded: { to: ['archived'] },
				archived: { to: ['draft'] }
			}
		},
		zone: { kind: 'text', optional: true },
		current_version: { kind: 'text', default: 'P01' },
		/** Optional Autodesk ACC / BIM 360 item URN when synced from Autodesk Platform Services. */
		autodesk_urn: { kind: 'text', optional: true },
		file: { kind: 'file', accept: ['*/*'], max: '20MiB', optional: true },
		notes: { kind: 'text', format: 'markdown', optional: true },
		project_id: { kind: 'ref', to: 'projects', inverse: 'project_files', owned: true }
	},
	constraints: { document_number: { unique: ['project_id', 'document_number'], import_key: true } },
	indexes: { find: { text: ['document_number', 'title', 'zone'] } },
	outputs: {
		default: {
			fields: 'all',
			project_id: { fields: ['project_name', 'project_number'] }
		}
	},
	create: {
		fields: columns.filter((f) => f !== 'status'),
		transform: function* (changes, ctx) {
			yield* validateProjectZones(changes, ctx);
			return changes.map(({ set }) => set);
		}
	},
	update: {
		fields: columns.filter((f) => f !== 'project_id'),
		transform: function* (changes, ctx) {
			yield* validateProjectZones(changes, ctx);
			return changes.map(({ set }) => set);
		}
	}
});
