import { model } from '../../../../.norbital/models/services.ts';
import { SKILLS } from '../../../lib/matching.js';
const columns = ['name', 'skill', 'duration_minutes', 'price', 'description', 'active'] as const;
/** What a customer can book: the skill it needs and how long one visit takes. */
export default model({
	description: 'A bookable service: the skill it needs, how long a visit takes and its price.',
	icon: 'lucide:sparkles',
	record_label: 'record.name',
	fields: {
		name: { kind: 'text', unique: true },
		skill: { kind: 'enum', values: SKILLS },
		duration_minutes: { kind: 'int', min: 30, max: 720 },
		price: { kind: 'money' },
		description: { kind: 'text', optional: true },
		active: { kind: 'bool', default: true }
	},
	indexes: { find: { text: ['name'] } },
	outputs: {
		default: { fields: 'all' },
		customer: { fields: ['name', 'duration_minutes', 'price', 'description', 'skill'] },
		portal: { fields: ['name', 'duration_minutes', 'price', 'description'] },
		helper: { fields: ['name', 'duration_minutes', 'description'] }
	},
	create: { columns: { fields: columns } },
	update: { columns: { fields: columns } },
	delete: {}
});
