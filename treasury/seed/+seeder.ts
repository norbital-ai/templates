import { seeder } from '@norbital-ai/bolt';

/** The demo's rows: the bank tree `treasury-demo`, a fictitious book; its unread advices, hedge documents and
 * proposals are read on load. */
export default seeder({
	bank: {
		tree: 'treasury-demo',
		start: ['bank_document_read', 'fx_document_read', 'fx_proposal_read']
	}
});
