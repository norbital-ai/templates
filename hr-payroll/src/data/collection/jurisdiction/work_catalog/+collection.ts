import { collection } from '@norbital-ai/bolt';

const columns = [
	'code',
	'name',
	'authority',
	'component_code',
	'eligibility',
	'quantity',
	'rate',
	'prorated',
	'denominator',
	'destination',
	'direction',
	'counts_toward'
] as const;

export default collection('work_catalog', {
	read: { fields: 'all' },
	create: { input: { columns: [...columns, 'settings_id'] } },
	update: { input: { columns } }
});
