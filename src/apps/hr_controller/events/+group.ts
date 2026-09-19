import { group } from '@norbital-ai/bolt/authoring';

export default group({
	label: 'Events',
	description:
		'Approved work, leave, claim, allowance, ad hoc and loan activity, grouped by its owning family.',
	icon: 'lucide:inbox',
	defaultChild: 'work'
});
