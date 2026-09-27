import { policy } from '@norbital-ai/bolt';

/** Sole owner for the supplier master shared by procurement and its ERP mirror. */
export default policy({
	description: 'Reads and maintains the supplier master for procurement and the ERP vendor import.',
	grants: { suppliers: { read: true, create: true, update: true } }
});
