import { policy } from '@norbital-ai/bolt';

const MINE = { owner_id: { eq: { actor: 'id' } } } as const;
/** A rep changes only their own documents; the new version may name another owner (a hand-over). */
const OWN = { previous: MINE } as const;

/**
 * A sales representative's surface: requestor-scoped quotes, sales invoices and signings, their lines, contacts and
 * activities. The limits are per holder; on the `sales_desk` envoy (one actor) they bound the whole desk, and
 * `envoys.receive` caps each outside sender and the desk as a whole.
 */
export default policy({
	description:
		'Opens the sales app and owns the requestor-scoped pipeline, contacts, activities, and sales documents.',
	capabilities: { apps: ['crm'] },
	grants: {
		contacts: { read: true, create: true, update: true },
		// the directory (id, name) a member reads by default (rule 35a), so the `sales_desk` envoy, which holds this policy,
		// can name a document's owner as a rep does
		sys_user: { read: true, fields: ['id', 'name'] },
		quotes: { read: MINE, create: true, update: OWN, moves: 'all', queries: ['export_confirmed'] },
		// a line reads as its document does: another rep's prices stay theirs
		quote_lines: { read: { quote_id: { is: MINE } }, create: true, update: true, delete: true },
		activities: { read: true, create: true, update: true },
		sales_invoices: { read: MINE, create: true, update: OWN, moves: 'all' },
		sales_invoice_lines: {
			read: { sales_invoice_id: { is: MINE } },
			create: true,
			update: true,
			delete: true
		},
		contract_signings: { read: MINE, create: true, update: OWN, moves: 'all' }
	},
	limits: {
		act: '600/min',
		read: '600/min',
		agent: '100/h',
		'envoys.receive': [
			{ rate: '8/min', per: 'sender' },
			{ rate: '300/min', per: 'subject' }
		]
	}
});
