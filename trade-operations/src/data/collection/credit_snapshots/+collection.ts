import { collection } from '@norbital-ai/bolt';
export default collection('credit_snapshots', {
	read: {
		fields: 'all'
	}
});
