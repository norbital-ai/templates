import { app } from '@norbital-ai/bolt';

export default app('hr_controller/people', {
	title: 'People',
	description:
		'Workforce health, and one profile per person carrying their employments, contractual terms and statutory registrations',
	icon: 'lucide:users',
	banner: 'app-media/people-banner.webp',
	pages: { people: { title: 'People', icon: 'lucide:users' } }
});
