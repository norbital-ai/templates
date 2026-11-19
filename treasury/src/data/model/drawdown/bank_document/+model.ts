import { model } from '@norbital-ai/bolt';
import { ADVICE } from '../../../../lib/charges.js';

/**
 * A bank advice or other document: the drawdown advice, the settlement advice, or anything else kept with a line.
 * Uploading starts extraction. A unique match submits its figures through the native Treasury approval;
 * unmatched documents retain their figures for manual matching.
 */
export default model('bank_document', {
	description: 'A bank advice or other document kept with a line.',
	icon: 'lucide:file-scan',
	record_label: "record.advice_reference != null ? record.advice_reference : 'Advice'",
	fields: {
		bank: {
			kind: 'ref',
			to: 'bank',
			inverse: 'documents',
			optional: true,
			on_delete: 'set_null'
		},
		drawdown: {
			kind: 'ref',
			to: 'drawdown',
			inverse: 'documents',
			optional: true,
			on_delete: 'set_null'
		},
		doc_type: {
			kind: 'enum',
			values: ['drawdown_advice', 'settlement_advice', 'other'],
			default: 'other'
		},
		advice_reference: { kind: 'text', optional: true },
		advice_date: { kind: 'date', optional: true },
		file: { kind: 'file', accept: ['application/pdf'], max: '10MiB' },
		extracted: { kind: 'json', shape: ADVICE, optional: true },
		read_status: {
			kind: 'enum',
			values: ['uploaded', 'checked', 'applied', 'failed'],
			default: 'uploaded'
		},
		read_note: { kind: 'text', optional: true }
	},
	constraints: {
		submitted_advice: {
			locked: { read_status: { eq: 'applied' } },
			message: 'errors.advice_submitted'
		}
	},
	outputs: {
		default: {
			fields: 'all',
			bank: { fields: ['code'] },
			drawdown: { fields: ['bank_reference', 'product', 'currency', 'amount', 'status'] }
		}
	},
	create: {
		fields: ['bank', 'drawdown', 'doc_type', 'advice_reference', 'advice_date', 'file'],
		effect: function* (changes, ctx) {
			for (const { after } of changes)
				yield* ctx.schedule(
					'bank_document_read',
					{ advice: [after.id] },
					{ key: `read:${after.id}:${after.revision}` }
				);
		}
	},
	update: {
		fields: [
			'bank',
			'drawdown',
			'doc_type',
			'advice_reference',
			'advice_date',
			'file',
			'extracted',
			'read_status',
			'read_note'
		],
		transform: function* (changes) {
			return changes.map((change) =>
				change.changed('file') ||
				(change.changed('read_status') && change.after.read_status === 'uploaded')
					? { ...change.set, extracted: null, read_status: 'uploaded' as const, read_note: null }
					: change.set
			);
		},
		effect: function* (changes, ctx) {
			for (const change of changes) {
				const doc = change.after;
				if (
					change.changed('file') ||
					(change.changed('read_status') && doc.read_status === 'uploaded')
				)
					yield* ctx.schedule(
						'bank_document_read',
						{ advice: [doc.id] },
						{ key: `read:${doc.id}:${doc.revision}` }
					);
				else if (
					doc.read_status === 'checked' &&
					doc.extracted !== null &&
					doc.drawdown !== null &&
					doc.doc_type !== 'other' &&
					(change.changed('extracted') || change.changed('drawdown') || change.changed('doc_type'))
				)
					yield* ctx.schedule(
						'bank_document_apply',
						{ advice: [doc.id] },
						{ key: `submit:${doc.id}:${doc.revision}` }
					);
			}
		}
	},
	delete: {
		// a submitted advice is evidence of what its line holds; an unsubmitted one may go
		transform: function* (changes, ctx) {
			const row = changes.findIndex(({ before }) => before.read_status === 'applied');
			if (row >= 0) return yield* ctx.refuse('errors.advice_submitted', { row });
		}
	}
});
