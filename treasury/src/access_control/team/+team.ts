import { team } from '@norbital-ai/bolt';
/** One team per function: Treasury, Finance, Purchasing, and View for read-only access. */
export default team({
	treasury: { name: 'Treasury', policies: ['treasury'] },
	finance: { name: 'Finance', policies: ['finance'] },
	purchasing: { name: 'Purchasing', policies: ['purchasing'] },
	viewers: { name: 'View', policies: ['viewer'] }
});
