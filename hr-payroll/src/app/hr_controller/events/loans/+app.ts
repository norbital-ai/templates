import { app } from '@norbital-ai/bolt';

export default app('hr_controller/events/loans', {
	title: 'Loans',
	description:
		'Review staff loans, salary advances, and overpayment recoveries with their derived outstanding balance',
	icon: 'lucide:hand-coins',
	banner: 'app-media/loans-banner.webp',
	pages: { loans: { title: 'Loans', icon: 'lucide:hand-coins' } }
});
