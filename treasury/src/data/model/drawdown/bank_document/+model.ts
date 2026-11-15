import { model } from '@norbital-ai/bolt';
import { ADVICE } from '../../../../lib/charges.js';

/**
 * A bank advice or other document: the drawdown advice, the settlement advice, or anything else kept with a line.
 * An advice dropped in waits unmatched; it is read (by the reader or by hand into `extracted`), checked against its
 * own arithmetic and the line, and applied only when a person confirms.
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
		read_note: { kind: 'text', optional: true },
		notes: { kind: 'text', optional: true }
	},
	outputs: {
		default: {
			fields: 'all',
			bank: { fields: ['code'] },
			drawdown: { fields: ['bank_reference', 'product', 'currency', 'amount', 'status'] }
		}
	},
	create: {
		fields: ['bank', 'drawdown', 'doc_type', 'advice_reference', 'advice_date', 'file', 'notes']
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
			'read_note',
			'notes'
		]
	}
});
