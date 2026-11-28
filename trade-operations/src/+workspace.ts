import { workspace } from '@norbital-ai/bolt';
export default workspace({
	tz: 'Asia/Singapore',
	locale: 'en-SG',
	languages: ['en', 'zh'],
	currency: 'SGD',
	theme: { palette: 'crisp', accent: 'blue', radius: 'default' },
	apps: [
		'operations/trade',
		'operations/partners',
		'operations/warehouse',
		'operations/analysis',
		'operations/profile',
		'trade_configuration'
	],
	convert: { to: ['pdf'] }
});
