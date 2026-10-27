import { model, type Instant, type StoredRow } from '@norbital-ai/bolt';
import { AREAS, DAYS, SKILLS, type Point } from '../../../lib/matching.js';
const columns = [
	'name',
	'phone',
	'user',
	'skills',
	'home_area',
	'home_location',
	'work_days',
	'day_start',
	'day_end',
	'status',
	'left_on',
	'last_location'
] as const;
/** A reported position is stamped with when it arrived; a write that leaves it where it was is not. */
const located = <S extends { readonly last_location?: Point | null }>(
	set: S,
	before: Pick<StoredRow<'helpers'>, 'last_location'> | null,
	now: Instant
) =>
	set.last_location !== undefined &&
	(set.last_location?.lat !== before?.last_location?.lat ||
		set.last_location?.lng !== before?.last_location?.lng)
		? { ...set, last_location_at: now }
		: set;
/**
 * A helper who takes visits. Skills and working hours constrain matching; the home point feeds planned travel and
 * the last reported position feeds the ETA check. Home area is descriptive metadata. Leaving helpers stay on file.
 * A helper's app reports their position into `last_location`, stamped with when. `src/lib/slots.ts` lays out when each of a
 * customer's preferred helpers could come; `helpers_offboard` records a helper leaving. A helper signs in as the member `user` names.
 */
export default model('helpers', {
	description:
		'A helper: skills, working days and hours, home area, and the last GPS position their app reported.',
	icon: 'lucide:user-round-check',
	label: 'name',
	fields: {
		name: { kind: 'text' },
		phone: { kind: 'text', format: 'phone' },
		user: { kind: 'ref', to: 'sys_user', optional: true, onDelete: 'setNull' },
		skills: { kind: 'enum', values: SKILLS, many: true },
		home_area: { kind: 'enum', values: AREAS, optional: true },
		home_location: { kind: 'point', optional: true },
		work_days: { kind: 'enum', values: DAYS, many: true },
		day_start: { kind: 'time' },
		day_end: { kind: 'time' },
		status: {
			kind: 'state',
			initial: 'active',
			states: { active: { to: ['left'] }, left: { to: ['active'] } }
		},
		left_on: { kind: 'date', optional: true },
		last_location: { kind: 'point', optional: true },
		/** Stamped whenever `last_location` changes. */
		last_location_at: { kind: 'instant', optional: true },
		warning_count: { kind: 'count', of: 'warnings' }
	},
	unique: [{ fields: ['user'] }],
	check: { hours: { day_end: { gt: { field: 'day_start' } } } },
	search: { text: ['name'] },
	read: 'all',
	create: {
		columns: { helpers: columns },
		transform: function* (rows, ctx) {
			return rows.map((r) => located(r, null, ctx.now));
		}
	},
	update: {
		columns: { helpers: columns },
		transform: function* (changes, ctx) {
			return changes.map(({ before, set }) => located(set, before, ctx.now));
		}
	}
});
