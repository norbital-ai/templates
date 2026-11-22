import { workspace } from '@norbital-ai/bolt';
export default workspace({
	tz: 'Asia/Singapore',
	locale: 'en-SG',
	languages: ['en', 'zh'],
	currency: 'SGD',
	apps: [
		'operations/trade',
		'operations/partners',
		'operations/warehouse',
		'operations/analysis',
		'trade_configuration'
	],
	convert: { to: ['pdf'] }
});
