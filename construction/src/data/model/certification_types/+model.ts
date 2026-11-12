import { model } from '../../../../.norbital/models/certification_types.ts';
const columns = [
	'certification_name',
	'certification_code',
	'category',
	'issuing_body',
	'validity_period_months',
	'requires_refresher',
	'description',
	'requirements'
] as const;
export default model({
	description: 'Certification library used to define workforce requirements.',
	icon: 'lucide:badge-check',
	record_label: 'record.certification_name',
	fields: {
		certification_name: { kind: 'text' },
		certification_code: { kind: 'text', optional: true, unique: true },
		category: { kind: 'text', optional: true },
		issuing_body: { kind: 'text', optional: true },
		validity_period_months: { kind: 'decimal', scale: 2, optional: true },
		requires_refresher: { kind: 'bool', optional: true },
		description: { kind: 'text', optional: true },
		requirements: { kind: 'text', many: true, optional: true }
	},
	indexes: { find: { text: ['certification_name'] } },
	outputs: { default: { fields: 'all' } },
	create: { columns: { fields: columns } },
	update: { columns: { fields: columns } }
});
