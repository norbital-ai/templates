import { app } from '@norbital-ai/bolt';
export default app('operations/trade', {
	title: 'component.orders',
	description: 'app.trade.description',
	icon: 'lucide:clipboard-list',
	banner: 'app-media/orders-resin-banner.webp',
	pages: { orders: { title: 'component.orders', icon: 'lucide:clipboard-list' } }
});
