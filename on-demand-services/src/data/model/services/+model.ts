import { model } from '@norbital-ai/bolt';
import { SKILLS } from '../../../lib/matching.js';
const columns = ['name', 'skill', 'duration_minutes', 'price', 'description', 'active'] as const;
/** What a customer can book: the skill it needs and how long one visit takes. */
export default model('services', {
	description: 'A bookable service: the skill it needs, how long a visit takes and its price.',
	icon: 'lucide:sparkles',
	label: 'name',
	fields: {
		name: { kind: 'text', unique: true },
		skill: { kind: 'enum', values: SKILLS },
		duration_minutes: { kind: 'int', min: 30, max: 720 },
		price: { kind: 'money' },
		description: { kind: 'text', optional: true },
		active: { kind: 'bool', default: true }
	},
	search: { text: ['name'] },
	read: 'all',
	outputs: {
		customer: {
			services: { fields: ['name', 'duration_minutes', 'price', 'description', 'skill'] }
		},
		portal: { services: { fields: ['name', 'duration_minutes', 'price', 'description'] } },
		helper: { services: { fields: ['name', 'duration_minutes', 'description'] } }
	},
	create: { columns: { services: columns } },
	update: { columns: { services: columns } },
	delete: {}
});
