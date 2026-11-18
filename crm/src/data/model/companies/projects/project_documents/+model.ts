import { model } from '@norbital-ai/bolt';
import { projectCustomerRows } from '../../../../../lib/customer.js';
import { deriveFrom } from '../../../../../lib/derive.js';

/** Every column is the person's to set. */
const columns = [
	'title',
	'kind',
	'markdown_body',
	'attachment',
	'received_on',
	'company',
	'project_id'
] as const;

/** Files filed against a project: a brief or supporting material. Signed NDAs, MSAs and SOWs are `signed_documents`. */
export default model('project_documents', {
	description: 'A brief or supporting file linked to a project.',
	icon: 'lucide:file-text',
	record_label: 'record.title',
	fields: {
		title: { kind: 'text' },
		kind: { kind: 'enum', values: ['brief', 'supporting'], optional: true },
		markdown_body: { kind: 'text', format: 'markdown', optional: true },
		attachment: { kind: 'file', accept: ['*/*'], max: '20MiB', optional: true },
		received_on: { kind: 'date', optional: true },
		company: { kind: 'ref', to: 'companies', inverse: 'project_documents', optional: true },
		project_id: { kind: 'ref', to: 'projects', inverse: 'documents', optional: true }
	},
	outputs: {
		default: {
			fields: 'all',
			company: { fields: ['name'] },
			project_id: { fields: ['name'] }
		}
	},
	create: {
		fields: columns,
		filled: { fields: ['company'] },
		transform: function* (changes, ctx) {
			return yield* projectCustomerRows(changes, ctx);
		},
		// an uploaded document extracts its job's scope and customer's profile
		effect: function* (changes, ctx) {
			yield* deriveFrom(
				changes.map(({ after }) => after),
				ctx
			);
		}
	},
	update: {
		fields: columns,
		transform: function* (changes, ctx) {
			return yield* projectCustomerRows(changes, ctx);
		},
		// a changed document re-extracts its job's scope and customer's profile; a moved one also the ones it left
		effect: function* (changes, ctx) {
			yield* deriveFrom(
				changes
					.filter(
						({ before, after }) =>
							before.title !== after.title ||
							before.markdown_body !== after.markdown_body ||
							before.attachment?.id !== after.attachment?.id ||
							before.project_id !== after.project_id ||
							before.company !== after.company
					)
					.flatMap(({ before, after }) => [before, after]),
				ctx
			);
		}
	}
});
