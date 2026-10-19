import { collection } from '@norbital-ai/bolt';
export default collection('commercial_settings', {
	read: {
		fields: 'all'
	},
	update: {
		input: {
			columns: ['freight_treatment', 'require_floor', 'credit_fresh_minutes', 'stock_fresh_minutes']
		}
	}
});
