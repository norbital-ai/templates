import { policy } from '@norbital-ai/bolt';
/** What the PO reader holds: the orders and their documents, and the supplier list it matches against. */
export default policy({
	description: 'PO reader: fill purchase orders from their PO documents.',
	grants: {
		purchase_order: { outputs: { default: {} }, update: {} },
		po_document: { outputs: { default: {} } },
		business_partner: { outputs: { default: {} } }
	}
});
