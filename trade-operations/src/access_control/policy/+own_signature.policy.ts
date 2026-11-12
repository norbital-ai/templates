import { policy } from '@norbital-ai/bolt';

export default policy({
	description: 'Read your own artwork retained by earlier contracts.',
	grants: {
		salesperson_signatures: {
			outputs: { default: { where: { owner: { eq: { var: 'requestor.id' } } } } }
		}
	}
});
