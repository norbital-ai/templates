import { app } from '@norbital-ai/bolt';

export default app('hr_controller/compliance', {
	title: 'Compliance',
	description:
		'Track the employer duties the settings declare: what is owed, when it falls due, and the evidence that closed it',
	icon: 'lucide:list-checks',
	// ponytail: shares the settings card image until the compliance banner ships
	banner: 'app-media/settings-banner.webp',
	pages: { compliance: { title: 'Compliance', icon: 'lucide:list-checks' } }
});
