import { team } from '@norbital-ai/bolt';

/** Stable source team handle; display names can change without changing member routing. */
export default team({
	sales: { name: 'Sales', policies: ['sales', 'crm'] }
});
