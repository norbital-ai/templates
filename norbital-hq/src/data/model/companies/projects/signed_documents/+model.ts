import { model } from '@norbital-ai/bolt';
import { documentRead, documentValues, addressee } from '../../../../../lib/documents.js';

/**
 * A signed copy of a catalogue document (`template_documents`, kind `document`) with a customer, or with one of its jobs
 * for a job-scoped template: the uploaded copy, tagged with the template version and the placeholder values (`terms`) it
 * was signed on, frozen when it was uploaded. The text is never stored: it renders from that version and these values.
 * Rows are never edited; a newer signed copy supersedes the older, which stays as history; an administrator may delete a
 * mistaken upload.
 */
export default model('signed_documents', {
	description: 'A signed document: the signed copy and the frozen values it was signed on.',
	icon: 'lucide:file-signature',
	record_label: "record.title + ' · ' + string(record.signed_on)",
	fields: {
		title: { kind: 'text' },
		terms: { kind: 'json', shape: { kind: 'record', of: { kind: 'text' } }, hidden: true },
		signed_on: { kind: 'date', default: { var: 'today' } },
		signed_copy: { kind: 'file', accept: ['application/pdf', 'image/*'], max: '20MiB' },
		company: { kind: 'ref', to: 'companies', inverse: 'signed_documents' },
		project: { kind: 'ref', to: 'projects', inverse: 'signed_documents', optional: true },
		signed_by: {
			kind: 'ref',
			to: 'contacts',
			inverse: 'signed_documents',
			optional: true,
			on_delete: 'set_null'
		},
		template_version: { kind: 'ref', to: 'template_documents' }
	},
	// a signed copy renders from its frozen terms and the template version it was signed on
	outputs: {
		default: {
			fields: 'all',
			signed_by: { fields: ['full_name'] },
			project: { fields: ['name'] },
			template_version: { fields: ['key', 'body'] },
			company: { fields: ['name'] }
		}
	},
	create: {
		fields: ['company', 'project', 'signed_on', 'signed_by', 'signed_copy', 'template_version'],
		// uploading a signed copy freezes what it was signed on
		transform: function* (changes, ctx) {
			const [change, ...rest] = changes;
			if (change === undefined) return [];
			if (rest.length > 0) return yield* ctx.refuse('errors.one_signed_copy');
			const input = change.set;
			const signed_on = input.signed_on ?? ctx.today;
			const project = input.project ?? null;
			const version = (yield* ctx.query({
				template_documents: {
					where: { id: { eq: input.template_version } },
					fields: ['key', 'title', 'kind', 'scope', 'commitment'],
					limit: 1
				}
			})).template_documents.rows[0];
			if (version === undefined || version.kind !== 'document')
				return yield* ctx.refuse('errors.template_not_document', { field: 'template_version' });
			if (version.scope === 'project' && project === null)
				return yield* ctx.refuse('errors.document_needs_job', { field: 'project' });
			if (version.scope === 'company' && project !== null)
				return yield* ctx.refuse('errors.document_not_job', { field: 'project' });
			const data = yield* ctx.query(documentRead(version.key, input.company, project));
			if (project !== null && data.projects.rows[0]?.company_id !== input.company)
				return yield* ctx.refuse('errors.job_not_customer', { field: 'project' });
			const signer = input.signed_by ?? null;
			if (signer !== null && !data.contacts.rows.some((row) => row.id === signer))
				return yield* ctx.refuse('errors.signer_not_customer', { field: 'signed_by' });
			const contact = addressee(data, signer);
			const company = data.companies.rows[0];
			return {
				sets: [
					{
						...input,
						project,
						signed_on,
						title: version.title,
						signed_by: contact?.id ?? null,
						terms: documentValues(data, signed_on, contact)
					}
				],
				...(version.commitment && company !== undefined && company.stage !== 'client'
					? {
							with: {
								companies: { update: [{ target: company, set: { stage: 'client' as const } }] }
							}
						}
					: {})
			};
		}
	},
	delete: {
		transform: function* (changes, ctx) {
			const ids = [...new Set(changes.map((c) => c.before.company))];
			const templates = (yield* ctx.query({
				template_documents: { where: { commitment: { eq: true } }, fields: ['id'] }
			})).template_documents.rows;
			if (ids.length === 0) return;
			const { companies, signed_documents } = yield* ctx.query({
				companies: { where: { id: { in: ids }, stage: { eq: 'client' } }, fields: ['revision'] },
				signed_documents: {
					as_of: 'act',
					where: { company: { in: ids }, template_version: { in: templates.map((t) => t.id) } },
					fields: ['company']
				}
			});
			return {
				with: {
					companies: {
						update: companies.rows
							.filter(
								(company) => !signed_documents.rows.some((signed) => signed.company === company.id)
							)
							.map((target) => ({ target, set: { stage: 'qualified' as const } }))
					}
				}
			};
		}
	}
});
