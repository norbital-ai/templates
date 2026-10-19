import { collection } from '@norbital-ai/bolt';
export default collection('warehouses', {
	read: {
		fields: 'all'
	}
});
