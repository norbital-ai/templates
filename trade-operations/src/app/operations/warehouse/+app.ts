import { app } from '@norbital-ai/bolt';
export default app('operations/warehouse', {
	title: 'component.warehouse',
	description: 'app.warehouse.description',
	icon: 'lucide:package',
	banner: 'app-media/warehouse-resin-banner.webp',
	pages: { stock: { title: 'component.warehouse', icon: 'lucide:package' } }
});
