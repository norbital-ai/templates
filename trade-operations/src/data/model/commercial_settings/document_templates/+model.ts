import { model } from '@norbital-ai/bolt';
import { Result } from 'effect';
import { validateDocumentTemplate } from '../../../../lib/order-document.js';
import { printFieldKind, validPrintFields } from '../../../../lib/print-details.js';
const valid = (body: string) => Result.isSuccess(Result.try(() => validateDocumentTemplate(body)));
export default model('document_templates', {
	record_label: 'record.title',
	description: 'Versioned commercial document layouts.',
	fields: {
		locale: { kind: 'enum', values: ['en', 'zh'] },
		version: { kind: 'text' },
		title: { kind: 'text' },
		body: { kind: 'text', default: '{agreement}' },
		layout: { kind: 'enum', values: ['text', 'table_v1'], optional: true },
		print_fields: printFieldKind,
		print_layout: { kind: 'file', accept: ['text/html'], max: '3MiB', optional: true },
		letterhead: { kind: 'file', accept: ['image/png'], max: '512KiB', optional: true },
		contract_stamp: { kind: 'file', accept: ['image/png'], max: '512KiB', optional: true },
		published_at: { kind: 'instant', optional: true },
		status: {
			kind: 'state',
			initial: 'draft',
			states: { draft: { to: ['published'] }, published: {} }
		}
	},
	outputs: { default: { fields: 'all' } },
	indexes: { search: { text: ['title'] } },
	create: {
		fields: [
			'locale',
			'version',
			'title',
			'body',
			'layout',
			'print_layout',
			'print_fields',
			'letterhead',
			'contract_stamp'
		],
		transform: function* (changes, ctx) {
			if (changes.some(({ after }) => after.body !== undefined && !valid(after.body)))
				return yield* ctx.refuse('errors.document_template_invalid');
			if (changes.some(({ after }) => !validPrintFields(after.print_fields ?? [])))
				return yield* ctx.refuse('errors.print_fields_invalid', { field: 'print_fields' });
			return changes.map(({ set }) => set);
		}
	},
	update: {
		fields: [
			'title',
			'body',
			'layout',
			'print_layout',
			'print_fields',
			'letterhead',
			'contract_stamp',
			'status'
		],
		transform: function* (changes, ctx) {
			for (const { set, after } of changes) {
				if (!valid(after.body)) return yield* ctx.refuse('errors.document_template_invalid');
				if (set.print_fields != null && !validPrintFields(set.print_fields))
					return yield* ctx.refuse('errors.print_fields_invalid', { field: 'print_fields' });
			}
			return changes.map(({ set }) =>
				set.status === 'published' ? { ...set, published_at: ctx.now } : set
			);
		}
	},
	// a published layout is the evidence a sealed agreement was rendered from
	constraints: { published: { locked: { status: { eq: 'published' } } } }
});
