import { model, type UpdateSet } from '@norbital-ai/bolt';
import { Result } from 'effect';
import { validateDocumentTemplate } from '../../../../lib/order-document.js';
import { printFieldKind, validPrintFields } from '../../../../lib/print-details.js';
const valid = (body: string) => Result.isSuccess(Result.try(() => validateDocumentTemplate(body)));
export default model('document_templates', {
	label: 'title',
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
			states: { draft: { to: ['published'] }, published: { edit: 'none' } }
		}
	},
	search: { text: ['title'] },
	read: 'all',
	create: {
		columns: {
			document_templates: [
				'locale',
				'version',
				'title',
				'body',
				'layout',
				'print_layout',
				'print_fields',
				'letterhead',
				'contract_stamp'
			]
		},
		transform: function* (rows, ctx) {
			if (rows.some((row) => row.body !== undefined && !valid(row.body)))
				return yield* ctx.refuse('errors.document_template_invalid');
			if (rows.some((row) => !validPrintFields(row.print_fields ?? [])))
				return yield* ctx.refuse('errors.print_fields_invalid', { field: 'print_fields' });
			return rows;
		}
	},
	update: {
		columns: {
			document_templates: [
				'title',
				'body',
				'layout',
				'print_layout',
				'print_fields',
				'letterhead',
				'contract_stamp',
				'status'
			]
		},
		transform: function* (changes, ctx) {
			const out: UpdateSet<'document_templates'>[] = [];
			for (const { before, set } of changes) {
				if (!valid(set.body ?? before.body))
					return yield* ctx.refuse('errors.document_template_invalid');
				if (set.print_fields != null && !validPrintFields(set.print_fields))
					return yield* ctx.refuse('errors.print_fields_invalid', { field: 'print_fields' });
				out.push(set.status === 'published' ? { ...set, published_at: ctx.now } : set);
			}
			return out;
		}
	},
	// a published layout is the evidence a sealed agreement was rendered from
	locked: { status: { eq: 'published' } }
});
