import { app } from '@norbital-ai/bolt';

export default app('hr_controller/facts_owed', {
	title: 'Facts owed',
	description:
		'The declared facts the next payroll run will refuse on: every required, conditional, coded or evidenced input still missing for the entity and its people',
	icon: 'lucide:clipboard-list',
	// ponytail: shares the settings card image until a facts-owed banner ships
	banner: 'app-media/settings-banner.webp',
	pages: { facts_owed: { title: 'Facts owed', icon: 'lucide:clipboard-list' } }
});
