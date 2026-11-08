import { policy } from '@norbital-ai/bolt';

export default policy({
	description: 'Manage your own signature and use it on your sales contracts.',
	capabilities: { apps: ['sales_profile'] },
	grants: {
		salesperson_signatures: {
			read: { salesperson_signatures: { where: { owner: { eq: { var: 'requestor.id' } } } } },
			create: {
				check: function* (_, ctx) {
					return ctx.actor.kind === 'member' ? ctx.allow() : ctx.deny('errors.signature_owner');
				}
			}
		}
	}
});
