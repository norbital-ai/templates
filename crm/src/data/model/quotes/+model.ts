import { model } from '@norbital-ai/bolt';

/**
 * draft → sent → won → confirmed (terminal); sent → draft is a revision (the transform raises `revision_number`);
 * draft/sent/won → lost → won; draft/won → cancelled (terminal, reason required). Only a draft is edited: each other
 * state admits only the stamps of the moves out of it, and lines (owned) follow the draft.
 */
export default model({
	description:
		'Sales document — the CRM pipeline. Moves draft→sent→won, then confirmed once accepted. Lost and cancelled are terminal. Sent documents can be reopened to draft for revision, incrementing the revision number.',
	icon: 'lucide:file-text',
	label: 'doc_no',
	fields: {
		doc_no: { kind: 'seq', pattern: 'QT-{yyyy}-{0000}' },
		title: { kind: 'text' },
		status: {
			kind: 'state',
			initial: 'draft',
			states: {
				draft: { to: ['sent', 'won', 'lost', 'cancelled'] },
				sent: { to: ['draft', 'won', 'lost'], edit: ['revision_number', 'revision_of'] },
				won: {
					to: ['confirmed', 'lost', 'cancelled'],
					edit: ['credit_acknowledged', 'confirmed_at', 'cancel_reason', 'cancelled_at']
				},
				confirmed: { edit: 'none' },
				lost: { to: ['won'], edit: 'none' },
				cancelled: { edit: 'none' }
			}
		},
		currency: { kind: 'currency', optional: true },
		tax_inclusive: { kind: 'bool' },
		valid_until: { kind: 'date', optional: true },
		payment_terms: { kind: 'text', optional: true },
		shipping_terms: { kind: 'text', optional: true },
		place_of_loading: { kind: 'text', optional: true },
		place_of_delivery: { kind: 'text', optional: true },
		packaging: { kind: 'text', optional: true },
		shipping_mark: { kind: 'text', optional: true },
		time_of_shipment: { kind: 'text', optional: true },
		other_terms: { kind: 'text', optional: true },
		net: { kind: 'sum', of: 'quote_lines.net' },
		tax: { kind: 'sum', of: 'quote_lines.tax' },
		gross: { kind: 'sum', of: 'quote_lines.line_total' },
		lines: { kind: 'count', of: 'quote_lines' },
		description: { kind: 'text', optional: true },
		revision_number: { kind: 'int', default: 1 },
		confirmed_at: { kind: 'instant', optional: true },
		credit_acknowledged: { kind: 'bool', optional: true },
		cancelled_at: { kind: 'instant', optional: true },
		cancel_reason: { kind: 'text', optional: true }
	},
	index: ['status'],
	search: { text: ['doc_no', 'title'] }
});
