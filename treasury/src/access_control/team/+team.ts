import { team } from '@norbital-ai/bolt';
/** One team per function: Treasury, Finance and Purchasing. */
export default team({
	treasury: { name: 'Treasury', policies: ['treasury'] },
	finance: { name: 'Finance', policies: ['finance'] },
	purchasing: { name: 'Purchasing', policies: ['purchasing'] }
});
