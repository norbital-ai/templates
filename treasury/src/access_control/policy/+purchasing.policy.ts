import { policy } from '@norbital-ai/bolt';
/**
 * Purchasing: a purchaser raises and changes purchase orders with their item lines and documents,
 * and reads the supplier list to pick from. Each purchaser sees only the orders they raised: the
 * rows are filtered by the created-by stamp every record carries, which the signed-in person's id
 * matches. They cannot touch treasury's lines, limits or month-ends.
 */
export default policy({
	description: 'Purchasing: raise and change your own purchase orders; read suppliers.',
	grants: {
		supplier: { outputs: { default: {} } },
		purchase_order: {
			outputs: { default: { where: { created_by: { eq: { var: 'actor.id' } } } } },
			create: {},
			update: {}
		},
		po_line: { outputs: { default: {} } },
		po_document: { outputs: { default: {} }, create: {}, update: {} }
	}
});
