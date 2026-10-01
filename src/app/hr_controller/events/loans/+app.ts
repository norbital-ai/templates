import { app } from '@norbital-ai/bolt';

export default app('hr_controller/events/loans', {
	title: 'app.loans.title',
	description: 'app.loans.description',
	icon: 'lucide:hand-coins',
	banner: 'app-media/loans-banner.webp',
	pages: { loans: { title: 'app.loans.title', icon: 'lucide:hand-coins' } }
});
