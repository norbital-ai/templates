import { app } from '@norbital-ai/bolt';

export default app('hr_controller/people', {
	title: 'app.people.title',
	description: 'app.people.description',
	icon: 'lucide:users',
	banner: 'app-media/people-banner.webp',
	pages: {
		people: { title: 'app.people.title', icon: 'lucide:users' }
	}
});
