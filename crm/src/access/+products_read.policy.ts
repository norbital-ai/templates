import { policy } from '@norbital-ai/bolt';

/** Sole read owner for the product master shared by both desks and its ERP mirror. */
export default policy({
	description: 'Reads the product catalogue shared by sales, procurement, and the ERP item import.',
	grants: { products: { read: true } }
});
