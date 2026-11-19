import { model, type EffectCtx, type Row } from '@norbital-ai/bolt';
import { FX_READ } from '../../../../lib/fx.js';

/**
 * A hedge document from a bank: a term sheet, confirmation, fixing or termination notice, letter or other. Uploading
 * asks only for the file; reading it fills its kind, bank, reference and trade date, keeps it with its deal (by
 * reference, else the same bank, pair and trade date), and turns an unmatched term sheet or confirmation into a deal
 * to confirm. A termination notice ends its deal from its effective date.
 */
export default model('fx_document', {
	description: 'A term sheet, confirmation, notice or letter for an FX hedge.',
	icon: 'lucide:file-scan',
	record_label: 'record.bank_reference != null ? record.bank_reference : string(record.kind)',
	fields: {
		bank: {
			kind: 'ref',
			to: 'bank',
			inverse: 'fx_documents',
			optional: true,
			on_delete: 'set_null'
		},
		deal: {
			kind: 'ref',
			to: 'fx_deal',
			inverse: 'documents',
			optional: true,
			on_delete: 'set_null'
		},
		kind: {
			kind: 'enum',
			values: ['term_sheet', 'confirmation', 'notice', 'letter', 'other'],
			default: 'other'
		},
		file: { kind: 'file', accept: ['application/pdf', 'image/jpeg', 'image/png'], max: '10MiB' },
		bank_reference: { kind: 'text', max: 100, optional: true },
		trade_date: { kind: 'date', optional: true },
		/** Signed or stamped by the company. */
		signed: { kind: 'bool', optional: true },
		extracted: { kind: 'json', shape: FX_READ, optional: true },
		read_status: {
			kind: 'enum',
			values: ['uploaded', 'checked', 'filed', 'failed'],
			default: 'uploaded'
		},
		read_note: { kind: 'text', optional: true }
	},
	outputs: {
		default: {
			fields: 'all',
			bank: { fields: ['code'] },
			deal: { fields: ['pair', 'structure', 'status', 'bank_reference'] }
		}
	},
	create: {
		fields: ['bank', 'deal', 'kind', 'file'],
		effect: function* (changes, ctx) {
			yield* read(
				changes.map(({ after }) => after),
				ctx
			);
		}
	},
	update: {
		fields: [
			'bank',
			'deal',
			'kind',
			'file',
			'bank_reference',
			'trade_date',
			'signed',
			'extracted',
			'read_status',
			'read_note'
		],
		effect: function* (changes, ctx) {
			yield* read(
				changes
					.filter(
						(c) =>
							c.changed('file') || (c.changed('read_status') && c.after.read_status === 'uploaded')
					)
					.map(({ after }) => after),
				ctx
			);
		}
	},
	delete: {}
});

function* read(
	rows: readonly Pick<Row<'fx_document'>, 'id' | 'revision'>[],
	ctx: EffectCtx<'fx_document'>
) {
	for (const r of rows)
		yield* ctx.schedule(
			'fx_document_read',
			{ document: [r.id] },
			{ key: `read:${r.id}:${r.revision}` }
		);
}
