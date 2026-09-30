import { model } from '@norbital-ai/bolt';
import { SKILLS } from '../../../lib/matching.js';

/** What a customer can book: the skill it needs and how long one visit takes. */
export default model({
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
	}
});
