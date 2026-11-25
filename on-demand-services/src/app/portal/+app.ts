import { app } from '@norbital-ai/bolt';

/**
 * Self-service customer booking portal: standalone embeddable pages where customers verify their
 * mobile number, book services with live availability, and track their upcoming appointments.
 */
export default app({
	title: 'app.portal.title',
	description: 'app.portal.description',
	icon: 'lucide:calendar-heart',
	banner: 'app-media/portal-banner.webp',
	audience: { public: ['portal_visitor'] },
	pages: {
		book: { title: 'app.portal.tab_book', icon: 'lucide:calendar-plus', portal: true },
		appointments: {
			title: 'app.portal.tab_appointments',
			icon: 'lucide:calendar-check',
			portal: true
		}
	}
});
