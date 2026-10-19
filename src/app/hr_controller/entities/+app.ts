import { app } from '@norbital-ai/bolt';

export default app('hr_controller/entities', {
	title: 'Entities',
	description: 'app.hr_controller.entities_description',
	icon: 'lucide:building-2',
	banner: 'app-media/entities-banner.webp',
	pages: { entities: { title: 'app.hr_controller.entities_title', icon: 'lucide:building-2' } }
});
