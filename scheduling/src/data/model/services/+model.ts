import { model } from '@norbital-ai/bolt';
import { normalizeSkill } from '../../../lib/matching.js';

const columns = [
	'name',
	'category',
	'skill',
	'duration_minutes',
	'price',
	'description',
	'active'
] as const;

/** Bookable service catalog: runtime skill tag, category, duration, and price. */
export default model('services', {
	description: 'A bookable service: category, required skill, duration, and price.',
	icon: 'lucide:briefcase',
	record_label: 'record.name',
	fields: {
		name: { kind: 'text', max: 160 },
		category: { kind: 'text', max: 80, optional: true },
		skill: { kind: 'text', max: 80 },
		duration_minutes: { kind: 'int', min: 15, max: 720 },
		price: { kind: 'money' },
		description: { kind: 'text', max: 1000, optional: true },
		active: { kind: 'bool', default: true }
	},
	constraints: { name: { unique: ['name'] } },
	indexes: { find: { text: ['name', 'category', 'skill'] } },
	outputs: {
		default: { fields: 'all' },
		customer: { fields: ['name', 'category', 'duration_minutes', 'price', 'description', 'skill'] },
		portal: { fields: ['name', 'category', 'duration_minutes', 'price', 'description'] },
		provider: { fields: ['name', 'category', 'duration_minutes', 'description'] }
	},
	create: {
		fields: columns,
		transform: function* (changes, ctx) {
			const out = [];
			for (const [row, { set }] of changes.entries()) {
				const skill = normalizeSkill(set.skill);
				if (skill === '')
					return yield* ctx.refuse('errors.skill_required', { row, field: 'skill' });
				out.push({ ...set, skill });
			}
			return out;
		},
		effect: function* (_, ctx) {
			yield* ctx.schedule('publish_openings', {}, { key: 'publish_openings' });
		}
	},
	update: {
		fields: columns,
		transform: function* (changes, ctx) {
			const out = [];
			for (const [row, { set }] of changes.entries()) {
				if (set.skill === undefined) {
					out.push(set);
					continue;
				}
				const skill = normalizeSkill(set.skill);
				if (skill === '')
					return yield* ctx.refuse('errors.skill_required', { row, field: 'skill' });
				out.push({ ...set, skill });
			}
			return out;
		},
		effect: function* (changes, ctx) {
			if (changes.some((c) => c.changed('active', 'skill', 'duration_minutes')))
				yield* ctx.schedule('publish_openings', {}, { key: 'publish_openings' });
		}
	},
	delete: {
		effect: function* (_, ctx) {
			yield* ctx.schedule('publish_openings', {}, { key: 'publish_openings' });
		}
	}
});
