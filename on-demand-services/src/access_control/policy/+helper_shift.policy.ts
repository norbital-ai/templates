import { policy } from '@norbital-ai/bolt';
/**
 * The shift-check answers (`visits_confirm_shift`, `visits_decline_shift`): read a helper's visits and record their
 * answer. The run is the system identity, so the body checks that the helper who started it owns every visit.
 */
export default policy({
	description: 'The shift-check runs: read visits and record a helper’s answer for their own day.',
	grants: {
		helpers: { read: true },
		visits: {
			outputs: { helper: true },
			update: { columns: { visits: ['shift_check', 'mc'] } }
		}
	},
	limits: { act: '120/min', read: '600/min' }
});
