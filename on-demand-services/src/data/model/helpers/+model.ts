import { model } from '@norbital-ai/bolt';
import { AREAS, DAYS, SKILLS } from '../../../lib/matching.js';

/**
 * A helper who takes visits. Skills and working hours are the hard requirements of a match; the home area and the last
 * reported position feed the soft ones and the ETA check. A helper who leaves stays on file, `left`.
 */
export default model({
	description:
		'A helper: skills, working days and hours, home area, and the last GPS position their app reported.',
	icon: 'lucide:user-round-check',
	label: 'name',
	fields: {
		name: { kind: 'text' },
		phone: { kind: 'text', format: 'phone' },
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
		/** Stamped by the transform whenever `last_location` changes. */
		last_location_at: { kind: 'instant', optional: true },
		warning_count: { kind: 'count', of: 'warnings' }
	},
	unique: [{ fields: ['user'] }],
	check: { hours: { day_end: { gt: { field: 'day_start' } } } },
	search: { text: ['name'] }
});
