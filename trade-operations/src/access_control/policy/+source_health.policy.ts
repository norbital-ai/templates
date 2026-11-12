import { policy } from '@norbital-ai/bolt';

export default policy({
	description: 'Lets the ledger health check notify active workspace administrators.',
	grants: {
		sys_integration: {
			outputs: { default: { where: { integration: { eq: 'kingdee' } } } }
		},
		sys_user: {
			outputs: { default: true }
		}
	}
});
