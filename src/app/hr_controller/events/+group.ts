import { group } from '@norbital-ai/bolt';

export default group('hr_controller/events', {
	label: 'Events',
	description:
		'Approved work, leave, claim, allowance, ad hoc and loan activity, grouped by its owning family.',
	icon: 'lucide:inbox',
	defaultChild: 'work'
});
