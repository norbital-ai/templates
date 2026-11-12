import { team } from '@norbital-ai/bolt';

export default team({
	investors: { name: 'Portfolio owners', policies: ['portfolio_manage'] },
	portfolio_viewers: { name: 'Portfolio viewers', policies: ['portfolio_read'] }
});
