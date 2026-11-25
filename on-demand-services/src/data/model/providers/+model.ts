import type { Instant, StoredRow } from '@norbital-ai/bolt';
import { model } from '@norbital-ai/bolt';
import { DAYS, normalizeSkill, type Point } from '../../../lib/matching.js';

const columns = [
	'name',
	'phone',
	'email',
	'user',
	'skills',
	'home_location',
	'work_days',
	'day_start',
	'day_end',
	'status',
	'inactive_since',
	'last_location'
] as const;

/** Stamp `last_location_at` whenever GPS coordinates change, or clear it when cleared. */
const withLocationStamp = <S extends { readonly last_location?: Point | null }>(
	set: S,
	before: Pick<StoredRow<'providers'>, 'last_location'> | null,
	now: Instant
) =>
	set.last_location !== undefined &&
	(set.last_location?.lat !== before?.last_location?.lat ||
		set.last_location?.lng !== before?.last_location?.lng)
		? { ...set, last_location_at: set.last_location === null ? null : now }
		: set;

const cleanSkills = (skills: readonly string[]): string[] => [
	...new Set(skills.map(normalizeSkill).filter((s) => s !== ''))
];

/**
 * A service provider who fulfills appointments: runtime skills, working days and hours, base
 * location for planned travel, and last GPS position for live ETA tracking.
 */
export default model('providers', {
	description: 'A service provider: skills, working schedule, base point, and live GPS location.',
	icon: 'lucide:user-round-check',
	record_label: 'record.name',
	fields: {
		name: { kind: 'text', max: 160 },
		phone: { kind: 'text', format: 'phone' },
		email: { kind: 'text', format: 'email', optional: true },
		user: { kind: 'ref', to: 'sys_user', optional: true, on_delete: 'set_null' },
		skills: { kind: 'text', max: 80, many: true },
		home_location: { kind: 'point', optional: true },
		work_days: { kind: 'enum', values: DAYS, many: true },
		day_start: { kind: 'time' },
		day_end: { kind: 'time' },
		status: {
			kind: 'state',
			initial: 'active',
			states: { active: { to: ['inactive'] }, inactive: { to: ['active'] } }
		},
		inactive_since: { kind: 'date', optional: true },
		last_location: { kind: 'point', optional: true },
		last_location_at: { kind: 'instant', optional: true }
	},
	constraints: {
		one_user: { unique: ['user'] },
		hours: { check: { day_end: { gt: { field: 'day_start' } } } }
	},
	indexes: { find: { text: ['name', 'phone', 'email'] } },
	outputs: {
		default: { fields: 'all' },
		customer: { fields: ['name', 'skills'] },
		provider: {
			fields: [
				'user',
				'name',
				'phone',
				'email',
				'skills',
				'work_days',
				'day_start',
				'day_end',
				'status',
				'last_location',
				'last_location_at'
			]
		}
	},
	create: {
		fields: columns,
		transform: function* (changes, ctx) {
			return changes.map(({ set }) =>
				withLocationStamp({ ...set, skills: cleanSkills(set.skills) }, null, ctx.now)
			);
		},
		effect: function* (_, ctx) {
			yield* ctx.schedule('publish_openings', {}, { key: 'publish_openings' });
			yield* ctx.schedule('check_drives', {}, { key: 'check_drives' });
		}
	},
	update: {
		fields: columns,
		transform: function* (changes, ctx) {
			return changes.map(({ before, set }) =>
				withLocationStamp(
					set.skills === undefined ? set : { ...set, skills: cleanSkills(set.skills) },
					before,
					ctx.now
				)
			);
		},
		effect: function* (changes, ctx) {
			if (changes.some((c) => c.changed('status', 'skills', 'work_days', 'day_start', 'day_end')))
				yield* ctx.schedule('publish_openings', {}, { key: 'publish_openings' });
			if (changes.some((c) => c.changed('home_location')))
				yield* ctx.schedule('check_drives', {}, { key: 'check_drives' });
		}
	}
});
