import { model } from '@norbital-ai/bolt';
/**
 * A bank advice or other document: the drawdown advice, the settlement advice, or anything else
 * kept with a line. An advice that is not matched to a line yet waits with no drawdown.
 */
export default model('bank_document', {
	description: 'A bank advice or other document kept with a line.',
	icon: 'lucide:file-scan',
	record_label: 'record.advice_reference',
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
			drawdown: { fields: ['bank_reference', 'status'] }
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
			'read_status',
			'read_note',
			'notes'
		]
	}
});
