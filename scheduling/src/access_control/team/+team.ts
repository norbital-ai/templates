import { team } from '@norbital-ai/bolt';

/** Source access roles: stable handles are membership and approval identities. */
export default team({
	operations: {
		name: 'Operations',
		parent: null,
		policies: ['operations']
	},
	providers: {
		name: 'Providers',
		parent: null,
		policies: ['provider']
	}
});
