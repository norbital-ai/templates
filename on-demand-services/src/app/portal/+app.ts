import { app } from '@norbital-ai/bolt';

/** The public booking page: anyone may request a visit, no account needed. */
export default app('portal', {
	title: 'app.portal.title',
	description: 'app.portal.description',
	icon: 'lucide:calendar-heart',
	audience: { public: ['portal_visitor'] },
	pages: { book: { title: 'app.portal.tab_book', icon: 'lucide:calendar-plus' } }
});
