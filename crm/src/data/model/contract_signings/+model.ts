import { model } from '@norbital-ai/bolt';

const FILE = { max: '20MiB', optional: true } as const;

export default model({
	description:
		'The contract lifecycle of a confirmed quote: the workspace generates the document, the counterparty returns a stamped copy, and the owner acknowledges it. `binding_hash` fingerprints the quote substance at generation, so a quote edited afterwards can never silently ride under an acknowledged contract. One active signing per quote; re-signing voids the predecessor.',
	icon: 'lucide:file-signature',
	label: ['variant', 'status'],
	fields: {
		variant: { kind: 'enum', values: ['advance', 'credit'], default: 'advance' },
		status: {
			kind: 'state',
			initial: 'unstamped',
			states: {
				unstamped: { to: ['counterparty_stamped', 'voided'] },
				counterparty_stamped: { to: ['acknowledged', 'voided'] },
				acknowledged: { to: ['voided'] },
				voided: { edit: 'none' }
			}
		},
		binding_hash: { kind: 'text' },
		generated_file: { kind: 'file', accept: ['application/pdf'], ...FILE },
		counterparty_file: {
			kind: 'file',
			accept: ['application/pdf', 'image/jpeg', 'image/png'],
			...FILE
		},
		share_token_hash: { kind: 'text', optional: true, hidden: true },
		share_expires_at: { kind: 'instant', optional: true },
		share_revoked_at: { kind: 'instant', optional: true },
		acknowledged_at: { kind: 'instant', optional: true },
		void_reason: { kind: 'text', optional: true }
	},
	unique: [{ fields: ['quote_id'], where: { status: { ne: 'voided' } }, name: 'one_live_signing' }],
	check: {
		stamped_has_file: {
			or: [{ status: { in: ['unstamped', 'voided'] } }, { counterparty_file: { isNull: false } }]
		},
		void_has_reason: { or: [{ status: { ne: 'voided' } }, { void_reason: { isNull: false } }] }
	},
	index: ['status'],
	search: { text: ['binding_hash'] }
});
