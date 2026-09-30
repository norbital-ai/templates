import { app } from '@norbital-ai/bolt';

/**
 * The booking portal: standalone pages to link to or embed in another site. Anyone may open them; a customer verifies
 * their mobile number on the page, which signs them up, and from then on books and sees their own bookings as themselves.
 */
export default app('portal', {
	title: 'app.portal.title',
	description: 'app.portal.description',
	icon: 'lucide:calendar-heart',
	banner: 'app-media/portal-banner.webp',
	audience: { public: ['portal_visitor'] },
	pages: {
		book: { title: 'app.portal.tab_book', icon: 'lucide:calendar-plus', site: true },
		visits: { title: 'app.portal.tab_visits', icon: 'lucide:house-heart', site: true }
	}
});
