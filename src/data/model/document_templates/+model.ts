import { model, type UpdateSet } from '@norbital-ai/bolt';
import { Result } from 'effect';
import { validateDocumentTemplate } from '../../../lib/order-document.js';
const valid = (body: string) => Result.isSuccess(Result.try(() => validateDocumentTemplate(body)));
export default model('document_templates', {
	label: 'title',
	description: 'Versioned quotation and contract document layouts.',
	fields: {
		kind: { kind: 'enum', values: ['quotation', 'contract'] },
		locale: { kind: 'enum', values: ['en', 'zh'] },
		version: { kind: 'text' },
		title: { kind: 'text' },
		body: { kind: 'text', default: '{agreement}' },
		published_at: { kind: 'instant', optional: true },
		status: {
			kind: 'state',
			initial: 'draft',
			states: { draft: { to: ['published'] }, published: { edit: 'none' } }
		}
	},
	key: ['kind', 'locale', 'version'],
	search: { text: ['title', 'kind'] },
	read: 'all',
	create: {
		columns: { document_templates: ['kind', 'locale', 'version', 'title', 'body'] },
		transform: function* (rows, ctx) {
			if (rows.some((row) => row.body !== undefined && !valid(row.body)))
				return yield* ctx.refuse('errors.document_template_invalid');
			return rows;
		}
	},
	update: {
		columns: { document_templates: ['title', 'body', 'status'] },
		transform: function* (changes, ctx) {
			const out: UpdateSet<'document_templates'>[] = [];
			for (const { before, set } of changes) {
				if (!valid(set.body ?? before.body))
					return yield* ctx.refuse('errors.document_template_invalid');
				out.push(set.status === 'published' ? { ...set, published_at: ctx.now } : set);
			}
			return out;
		}
	},
	// a published layout is the evidence a sealed agreement was rendered from
	locked: { status: { eq: 'published' } }
});
