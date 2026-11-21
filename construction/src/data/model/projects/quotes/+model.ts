import { model } from '@norbital-ai/bolt';
import { computeQuoteTotals } from '../../../../lib/claims.js';

const editableColumns = [
	'title',
	'project_id',
	'direction',
	'contact_id',
	'cost_item_id',
	'status',
	'issued_date',
	'valid_until',
	'currency',
	'tax_rate',
	'lines',
	'attachments',
	'notes'
] as const;

export default model('quotes', {
	description:
		'Client proposals and subcontractor/supplier quotes with co-located priced line items and automatic revision snapshots.',
	icon: 'lucide:file-spreadsheet',
	record_label:
		"record.quote_number != null ? record.quote_number + ' · ' + record.title : record.title",
	fields: {
		quote_number: { kind: 'seq', pattern: 'QT-{yyyy}-{000}', per: ['project_id'] },
		title: { kind: 'text' },
		direction: {
			kind: 'enum',
			values: ['client_quote', 'subcontractor_quote'],
			default: 'subcontractor_quote'
		},
		status: {
			kind: 'state',
			initial: 'draft',
			states: {
				draft: { to: ['sent', 'accepted', 'rejected'] },
				sent: { to: ['revised', 'accepted', 'rejected', 'expired'] },
				revised: { to: ['sent', 'accepted', 'rejected', 'expired'] },
				accepted: { to: [] },
				rejected: { to: ['draft'] },
				expired: { to: ['revised', 'draft'] }
			}
		},
		current_revision: { kind: 'int', min: 1, default: 1 },
		issued_date: { kind: 'date', optional: true, default: { var: 'today' } },
		valid_until: { kind: 'date', optional: true },
		currency: { kind: 'currency', default: 'SGD' },
		tax_rate: { kind: 'decimal', scale: 2, default: 9 },
		subtotal: { kind: 'money', currency: 'currency', default: 0 },
		tax_amount: { kind: 'money', currency: 'currency', default: 0 },
		total_amount: { kind: 'money', currency: 'currency', default: 0 },
		/** Co-located priced line items; server computes each line amount and quote totals. */
		lines: { kind: 'custom', of: 'priced_lines', optional: true },
		/** Co-located revision trail automatically snapshotted whenever a sent quote is revised. */
		revisions: { kind: 'custom', of: 'revision_trail', optional: true },
		attachments: { kind: 'file', accept: ['*/*'], max: '20MiB', many: true, optional: true },
		notes: { kind: 'text', format: 'markdown', optional: true },
		project_id: { kind: 'ref', to: 'projects', inverse: 'quotes', owned: true },
		contact_id: {
			kind: 'ref',
			to: 'contacts',
			inverse: 'quotes',
			optional: true,
			on_delete: 'set_null'
		},
		cost_item_id: {
			kind: 'ref',
			to: 'cost_items',
			inverse: 'quotes',
			optional: true,
			on_delete: 'set_null'
		}
	},
	constraints: {
		valid_tax_rate: { check: { tax_rate: { gte: 0, lte: 100 } } },
		/** Sent quotes cannot mutate pricing in place; transition `sent -> revised` to snapshot and revise. */
		sent_locked: {
			locked: { status: { eq: 'sent' } },
			except: ['status', 'current_revision', 'revisions', 'attachments', 'notes']
		},
		accepted_locked: {
			locked: { status: { eq: 'accepted' } },
			except: ['attachments', 'notes']
		}
	},
	indexes: {
		by_project_direction: { on: ['project_id', 'direction', 'status'] },
		find: { text: ['quote_number', 'title', 'notes'] }
	},
	outputs: {
		default: {
			fields: 'all',
			project_id: { fields: ['project_name', 'project_number'] },
			contact_id: { fields: ['full_name', 'company_name'] },
			cost_item_id: { fields: ['item_code', 'description'] }
		}
	},
	create: {
		fields: editableColumns.filter((f) => f !== 'status'),
		transform: function* (changes) {
			return changes.map(({ set, after }) => {
				const computed = computeQuoteTotals(after.lines, after.tax_rate);
				return {
					...set,
					...(after.lines != null ? { lines: computed.lines } : {}),
					subtotal: computed.subtotal,
					tax_amount: computed.tax_amount,
					total_amount: computed.total_amount
				};
			});
		}
	},
	update: {
		fields: editableColumns.filter((f) => f !== 'project_id'),
		transform: function* (changes, ctx) {
			return changes.map((c) => {
				const recompute = c.changed('lines') || c.changed('tax_rate');
				const computed = recompute ? computeQuoteTotals(c.after.lines, c.after.tax_rate) : null;
				const enteringRevised =
					c.changed('status') && c.after.status === 'revised' && c.before.status !== 'draft';
				return {
					...c.set,
					...(computed != null
						? {
								...(c.after.lines != null ? { lines: computed.lines } : {}),
								subtotal: computed.subtotal,
								tax_amount: computed.tax_amount,
								total_amount: computed.total_amount
							}
						: {}),
					...(enteringRevised
						? {
								current_revision: c.before.current_revision + 1,
								revisions: [
									...(c.before.revisions ?? []),
									{
										version: `R${c.before.current_revision}`,
										saved_on: ctx.today,
										reference: `${c.before.currency} ${c.before.total_amount}`,
										summary: `Revision ${c.before.current_revision} archived (${(c.before.lines ?? []).length} line(s))`
									}
								]
							}
						: {})
				};
			});
		}
	}
});
