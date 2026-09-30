import { app } from '@norbital-ai/bolt';

/** The customer's own app: signed in with their mobile number, they see their visits and what they were told. */
export default app('my_visits', {
	title: 'app.my_visits.title',
	description: 'app.my_visits.description',
	icon: 'lucide:house-heart',
	audience: 'external',
	pages: { visits: { title: 'app.my_visits.tab_visits', icon: 'lucide:calendar-heart' } }
});
