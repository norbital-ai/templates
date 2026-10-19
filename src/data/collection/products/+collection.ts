import { collection } from '@norbital-ai/bolt';
export default collection('products', {
	update: { input: { columns: ['commission_factor', 'commission_basis_unit'] } },
	read: {
		fields: 'all'
	}
});
